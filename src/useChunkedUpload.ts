import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Headers for chunk requests: a static HeadersInit, or a function evaluated
 * before every chunk attempt so short-lived credentials can be refreshed
 * during long uploads.
 */
export type ChunkedUploadHeaders = HeadersInit | (() => HeadersInit | Promise<HeadersInit>);

/** Error thrown when a chunk request fails, carrying the failed chunk index and HTTP status when available. */
export class ChunkUploadError extends Error {
  readonly chunkIndex: number;
  readonly status?: number;

  constructor(message: string, chunkIndex: number, status?: number) {
    super(message);
    this.name = 'ChunkUploadError';
    this.chunkIndex = chunkIndex;
    this.status = status;
  }
}

export interface ChunkedUploadOptions {
  /** Chunk size in bytes. Default is 5MB. */
  chunkSize?: number;
  /** API endpoint that accepts and finalizes uploaded chunks. */
  uploadUrl: string;
  /**
   * Headers sent with each chunk request, or a (possibly async) function
   * evaluated before every chunk attempt. Do not set Content-Type for FormData.
   */
  headers?: ChunkedUploadHeaders;
  /** Extra multipart form fields appended to each chunk request. */
  fields?: Record<string, string | Blob>;
  /**
   * Automatic retry attempts per chunk after the first failure. Default is 0
   * (no automatic retries). Only network errors, timeouts, HTTP 5xx, 408, and
   * 429 are retried; other 4xx responses fail immediately.
   */
  retries?: number;
  /**
   * Delay in milliseconds before retry attempt N (1-based), as a number or a
   * function of the attempt and the error. Default is exponential backoff:
   * 500ms doubling per attempt, capped at 10 seconds.
   */
  retryDelay?: number | ((attempt: number, error: Error) => number);
  /**
   * Per-attempt timeout in milliseconds. A timed-out chunk request is aborted
   * and counts as a retryable failure.
   */
  timeout?: number;
  /** Callback fired with the final chunk response after the upload completes. */
  onSuccess?: (response: Response) => void;
  /** Callback fired if validation or a chunk upload fails. */
  onError?: (error: Error) => void;
  /** Callback fired after a chunk completes, with byte-based progress (0-100). */
  onProgress?: (progress: number) => void;
  /** Callback fired before each chunk request attempt starts. */
  onChunkStart?: (chunkIndex: number) => void;
  /** Callback fired after each chunk request succeeds. */
  onChunkSuccess?: (chunkIndex: number, response: Response) => void;
  /** Callback fired for each failed chunk request attempt. */
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
  headers?: ChunkedUploadHeaders;
  fields?: Record<string, string | Blob>;
  retries: number;
  retryDelay?: number | ((attempt: number, error: Error) => number);
  timeout?: number;
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

function isRetryableError(error: Error): boolean {
  if (error instanceof ChunkUploadError) {
    // No status means the request never completed (network drop or timeout).
    if (error.status === undefined) return true;
    return error.status >= 500 || error.status === 408 || error.status === 429;
  }

  // fetch rejects with TypeError on network failure.
  return error instanceof TypeError;
}

function resolveRetryDelay(
  retryDelay: UploadSession['retryDelay'],
  attempt: number,
  error: Error,
): number {
  if (typeof retryDelay === 'function') return Math.max(0, retryDelay(attempt, error));
  if (typeof retryDelay === 'number') return Math.max(0, retryDelay);

  return Math.min(500 * 2 ** (attempt - 1), 10_000);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function interruptedError(): DOMException {
  return new DOMException('The upload was interrupted.', 'AbortError');
}

/**
 * DOMException does not extend Error in every runtime (e.g. older browsers
 * and jsdom), so abort detection must not rely on instanceof.
 */
function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

export function useChunkedUpload(options: ChunkedUploadOptions) {
  const {
    chunkSize = 5 * 1024 * 1024,
    uploadUrl,
    headers,
    fields,
    retries = 0,
    retryDelay,
    timeout,
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
      retries: sessionRetries,
      retryDelay: sessionRetryDelay,
      timeout: sessionTimeout,
    } = session;
    const totalChunks = getTotalChunks(file, sessionChunkSize);
    let finalResponse: Response | null = null;

    const assertActive = () => {
      if (runId !== runIdRef.current || isPausedRef.current) {
        throw interruptedError();
      }
    };

    const uploadChunkWithRetries = async (chunkIndex: number): Promise<Response> => {
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

      for (let attempt = 0; ; attempt += 1) {
        const controller = new AbortController();
        abortControllerRef.current = controller;

        let timedOut = false;
        const timer = sessionTimeout !== undefined
          ? setTimeout(() => {
            timedOut = true;
            controller.abort();
          }, sessionTimeout)
          : undefined;

        try {
          const resolvedHeaders = typeof sessionHeaders === 'function'
            ? await sessionHeaders()
            : sessionHeaders;

          assertActive();
          onChunkStart?.(chunkIndex);

          const response = await fetch(sessionUploadUrl, {
            method: 'POST',
            headers: resolvedHeaders,
            body: formData,
            signal: controller.signal,
          });

          if (!response.ok) {
            throw new ChunkUploadError(
              `Chunk upload failed with status: ${response.status}`,
              chunkIndex,
              response.status,
            );
          }

          return response;
        } catch (error: unknown) {
          let failure = error;

          if (isAbortError(error)) {
            // Aborts from pause, cancel, restart, or unmount end the chunk;
            // only our own timeout abort converts into a retryable failure.
            if (!timedOut || runId !== runIdRef.current) throw error;

            failure = new ChunkUploadError(
              `Chunk upload timed out after ${sessionTimeout}ms`,
              chunkIndex,
            );
          }

          const uploadError = toError(failure);
          onChunkError?.(chunkIndex, uploadError);

          if (attempt >= sessionRetries || !isRetryableError(uploadError)) {
            throw uploadError;
          }

          await sleep(resolveRetryDelay(sessionRetryDelay, attempt + 1, uploadError));
          assertActive();
        } finally {
          if (timer !== undefined) clearTimeout(timer);
        }
      }
    };

    try {
      while (runId === runIdRef.current && !isPausedRef.current) {
        const chunkIndex = nextPendingChunk(totalChunks, completedChunksRef.current);

        if (chunkIndex === null) break;

        const response = await uploadChunkWithRetries(chunkIndex);

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

      if (isAbortError(error)) {
        return;
      }

      const uploadError = toError(error);
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
    // Flag the error without resetting progress or pause state, so a
    // paused session survives an invalid startUpload call.
    setState(current => ({
      ...current,
      isUploading: false,
      isError: true,
      isSuccess: false,
    }));
    onError?.(error);
  }, [onError]);

  const startUpload = useCallback((file: File) => {
    // Validate before tearing anything down so an invalid call cannot
    // destroy a paused session that could still be resumed.
    if (!Number.isFinite(chunkSize) || chunkSize <= 0) {
      reportValidationError('chunkSize must be a finite number greater than 0.');
      return;
    }

    if (!uploadUrl.trim()) {
      reportValidationError('uploadUrl must not be empty.');
      return;
    }

    if (!Number.isInteger(retries) || retries < 0) {
      reportValidationError('retries must be a non-negative integer.');
      return;
    }

    runIdRef.current += 1;
    isRunningRef.current = false;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    completedChunksRef.current = new Set();

    sessionRef.current = {
      file,
      uploadId: createUploadId(),
      chunkSize,
      uploadUrl,
      headers: typeof headers === 'function'
        ? headers
        : headers
          ? new Headers(headers)
          : undefined,
      fields: fields ? { ...fields } : undefined,
      retries,
      retryDelay,
      timeout,
    };
    isPausedRef.current = false;
    isRunningRef.current = true;

    setState({
      ...initialState,
      isUploading: true,
    });

    void uploadChunks(runIdRef.current);
  }, [chunkSize, fields, headers, reportValidationError, retries, retryDelay, timeout, uploadChunks, uploadUrl]);

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

  const cancelUpload = useCallback(() => {
    runIdRef.current += 1;
    isRunningRef.current = false;
    isPausedRef.current = false;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    sessionRef.current = null;
    completedChunksRef.current = new Set();
    setState(initialState);
  }, []);

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
    cancelUpload,
    ...state,
  };
}
