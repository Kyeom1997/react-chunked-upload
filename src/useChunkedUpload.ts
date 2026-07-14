import { useCallback, useEffect, useRef, useState } from 'react';

export interface ChunkedUploadOptions {
  /** Chunk size in bytes. Default is 5MB. */
  chunkSize?: number;
  /** API endpoint that accepts and finalizes uploaded chunks. */
  uploadUrl: string;
  /** Headers sent with each chunk request. Do not set Content-Type for FormData. */
  headers?: HeadersInit;
  /** Extra multipart form fields appended to each chunk request. */
  fields?: Record<string, string | Blob>;
  /** Callback fired with the final chunk response after the upload completes. */
  onSuccess?: (response: Response) => void;
  /** Callback fired if validation or a chunk upload fails. */
  onError?: (error: Error) => void;
  /** Callback fired after a chunk completes, with byte-based progress (0-100). */
  onProgress?: (progress: number) => void;
  /** Callback fired before each chunk request starts. */
  onChunkStart?: (chunkIndex: number) => void;
  /** Callback fired after each chunk request succeeds. */
  onChunkSuccess?: (chunkIndex: number, response: Response) => void;
  /** Callback fired when a chunk request fails. */
  onChunkError?: (chunkIndex: number, error: Error) => void;
}

export interface ChunkedUploadState {
  progress: number;
  isUploading: boolean;
  isPaused: boolean;
  isError: boolean;
  isSuccess: boolean;
}

interface UploadSession {
  file: File;
  uploadId: string;
  chunkSize: number;
  uploadUrl: string;
  headers?: HeadersInit;
  fields?: Record<string, string | Blob>;
}

const initialState: ChunkedUploadState = {
  progress: 0,
  isUploading: false,
  isPaused: false,
  isError: false,
  isSuccess: false,
};

function createUploadId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function getTotalChunks(file: File, chunkSize: number): number {
  return Math.max(1, Math.ceil(file.size / chunkSize));
}

/** Lowest chunk index that has not completed yet, or null when none remain. */
function nextPendingChunk(totalChunks: number, completed: ReadonlySet<number>): number | null {
  for (let index = 0; index < totalChunks; index += 1) {
    if (!completed.has(index)) return index;
  }

  return null;
}

/** Byte-accurate progress from the set of completed chunks (0-100). */
function computeProgress(file: File, chunkSize: number, completed: ReadonlySet<number>): number {
  if (file.size === 0) return completed.size > 0 ? 100 : 0;

  let uploadedBytes = 0;
  for (const index of completed) {
    uploadedBytes += Math.min(chunkSize, file.size - index * chunkSize);
  }

  return Math.round((uploadedBytes / file.size) * 100);
}

export function useChunkedUpload(options: ChunkedUploadOptions) {
  const {
    chunkSize = 5 * 1024 * 1024,
    uploadUrl,
    headers,
    fields,
    onSuccess,
    onError,
    onProgress,
    onChunkStart,
    onChunkSuccess,
    onChunkError,
  } = options;

  const [state, setState] = useState<ChunkedUploadState>(initialState);
  const sessionRef = useRef<UploadSession | null>(null);
  const completedChunksRef = useRef<Set<number>>(new Set());
  const abortControllerRef = useRef<AbortController | null>(null);
  const runIdRef = useRef(0);
  const isRunningRef = useRef(false);
  const isPausedRef = useRef(false);

  const uploadChunks = useCallback(async (runId: number) => {
    const session = sessionRef.current;

    if (!session || runId !== runIdRef.current) return;

    const {
      file,
      uploadId,
      chunkSize: sessionChunkSize,
      uploadUrl: sessionUploadUrl,
      headers: sessionHeaders,
      fields: sessionFields,
    } = session;
    const totalChunks = getTotalChunks(file, sessionChunkSize);
    let finalResponse: Response | null = null;
    let activeChunkIndex = 0;

    try {
      while (runId === runIdRef.current && !isPausedRef.current) {
        const chunkIndex = nextPendingChunk(totalChunks, completedChunksRef.current);

        if (chunkIndex === null) break;

        activeChunkIndex = chunkIndex;

        const start = chunkIndex * sessionChunkSize;
        const end = Math.min(start + sessionChunkSize, file.size);
        const formData = new FormData();

        formData.append('file', file.slice(start, end));
        formData.append('filename', file.name);
        formData.append('uploadId', uploadId);
        formData.append('chunkIndex', chunkIndex.toString());
        formData.append('totalChunks', totalChunks.toString());

        if (sessionFields) {
          for (const [key, value] of Object.entries(sessionFields)) {
            formData.append(key, value);
          }
        }

        const controller = new AbortController();
        abortControllerRef.current = controller;

        onChunkStart?.(chunkIndex);

        const response = await fetch(sessionUploadUrl, {
          method: 'POST',
          headers: sessionHeaders,
          body: formData,
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Chunk upload failed with status: ${response.status}`);
        }

        onChunkSuccess?.(chunkIndex, response.clone());

        if (runId !== runIdRef.current || isPausedRef.current) return;

        finalResponse = response;
        completedChunksRef.current.add(chunkIndex);

        const progress = computeProgress(file, sessionChunkSize, completedChunksRef.current);
        setState(current => ({ ...current, progress }));
        onProgress?.(progress);
      }

      if (
        runId === runIdRef.current &&
        !isPausedRef.current &&
        completedChunksRef.current.size >= totalChunks &&
        finalResponse
      ) {
        isRunningRef.current = false;
        abortControllerRef.current = null;
        setState(current => ({
          ...current,
          progress: 100,
          isUploading: false,
          isPaused: false,
          isError: false,
          isSuccess: true,
        }));
        onSuccess?.(finalResponse);
      }
    } catch (error: unknown) {
      if (runId !== runIdRef.current) return;

      isRunningRef.current = false;
      abortControllerRef.current = null;

      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }

      const uploadError = toError(error);
      onChunkError?.(activeChunkIndex, uploadError);
      setState(current => ({
        ...current,
        isUploading: false,
        isPaused: false,
        isError: true,
        isSuccess: false,
      }));
      onError?.(uploadError);
    }
  }, [onChunkError, onChunkStart, onChunkSuccess, onError, onProgress, onSuccess]);

  const reportValidationError = useCallback((message: string) => {
    const error = new Error(message);
    setState({
      ...initialState,
      isError: true,
    });
    onError?.(error);
  }, [onError]);

  const startUpload = useCallback((file: File) => {
    runIdRef.current += 1;
    isRunningRef.current = false;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    sessionRef.current = null;
    completedChunksRef.current = new Set();

    if (!Number.isFinite(chunkSize) || chunkSize <= 0) {
      reportValidationError('chunkSize must be a finite number greater than 0.');
      return;
    }

    if (!uploadUrl.trim()) {
      reportValidationError('uploadUrl must not be empty.');
      return;
    }

    sessionRef.current = {
      file,
      uploadId: createUploadId(),
      chunkSize,
      uploadUrl,
      headers: headers ? new Headers(headers) : undefined,
      fields: fields ? { ...fields } : undefined,
    };
    isPausedRef.current = false;
    isRunningRef.current = true;

    setState({
      ...initialState,
      isUploading: true,
    });

    void uploadChunks(runIdRef.current);
  }, [chunkSize, fields, headers, reportValidationError, uploadChunks, uploadUrl]);

  const pauseUpload = useCallback(() => {
    if (!isRunningRef.current) return;

    runIdRef.current += 1;
    isPausedRef.current = true;
    isRunningRef.current = false;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setState(current => ({ ...current, isUploading: false, isPaused: true }));
  }, []);

  const resumeUpload = useCallback(() => {
    const session = sessionRef.current;

    if (!session || isRunningRef.current) return;

    const totalChunks = getTotalChunks(session.file, session.chunkSize);
    if (completedChunksRef.current.size >= totalChunks) return;

    runIdRef.current += 1;
    isPausedRef.current = false;
    isRunningRef.current = true;
    setState(current => ({
      ...current,
      isUploading: true,
      isPaused: false,
      isError: false,
      isSuccess: false,
    }));
    void uploadChunks(runIdRef.current);
  }, [uploadChunks]);

  useEffect(() => () => {
    runIdRef.current += 1;
    isRunningRef.current = false;
    abortControllerRef.current?.abort();
  }, []);

  return {
    startUpload,
    pauseUpload,
    resumeUpload,
    retryUpload: resumeUpload,
    ...state,
  };
}
