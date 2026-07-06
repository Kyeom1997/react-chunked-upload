// src/useChunkedUpload.ts
import { useCallback, useEffect, useRef, useState } from "react";
var initialState = {
  progress: 0,
  isUploading: false,
  isPaused: false,
  isError: false,
  isSuccess: false
};
function createUploadId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function toError(error) {
  return error instanceof Error ? error : new Error(String(error));
}
function useChunkedUpload(options) {
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
    onChunkError
  } = options;
  const [state, setState] = useState(initialState);
  const sessionRef = useRef(null);
  const currentChunkIndexRef = useRef(0);
  const abortControllerRef = useRef(null);
  const runIdRef = useRef(0);
  const isRunningRef = useRef(false);
  const isPausedRef = useRef(false);
  const uploadChunks = useCallback(async (runId) => {
    const session = sessionRef.current;
    if (!session || runId !== runIdRef.current) return;
    const {
      file,
      uploadId,
      chunkSize: sessionChunkSize,
      uploadUrl: sessionUploadUrl,
      headers: sessionHeaders,
      fields: sessionFields
    } = session;
    const totalChunks = Math.max(1, Math.ceil(file.size / sessionChunkSize));
    let finalResponse = null;
    try {
      while (currentChunkIndexRef.current < totalChunks && runId === runIdRef.current && !isPausedRef.current) {
        const chunkIndex = currentChunkIndexRef.current;
        const start = chunkIndex * sessionChunkSize;
        const end = Math.min(start + sessionChunkSize, file.size);
        const formData = new FormData();
        formData.append("file", file.slice(start, end));
        formData.append("filename", file.name);
        formData.append("uploadId", uploadId);
        formData.append("chunkIndex", chunkIndex.toString());
        formData.append("totalChunks", totalChunks.toString());
        if (sessionFields) {
          for (const [key, value] of Object.entries(sessionFields)) {
            formData.append(key, value);
          }
        }
        const controller = new AbortController();
        abortControllerRef.current = controller;
        onChunkStart == null ? void 0 : onChunkStart(chunkIndex);
        const response = await fetch(sessionUploadUrl, {
          method: "POST",
          headers: sessionHeaders,
          body: formData,
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error(`Chunk upload failed with status: ${response.status}`);
        }
        onChunkSuccess == null ? void 0 : onChunkSuccess(chunkIndex, response.clone());
        if (runId !== runIdRef.current || isPausedRef.current) return;
        finalResponse = response;
        currentChunkIndexRef.current = chunkIndex + 1;
        const uploadedBytes = Math.min(currentChunkIndexRef.current * sessionChunkSize, file.size);
        const progress = file.size === 0 ? 100 : Math.round(uploadedBytes / file.size * 100);
        setState((current) => ({ ...current, progress }));
        onProgress == null ? void 0 : onProgress(progress);
      }
      if (runId === runIdRef.current && !isPausedRef.current && currentChunkIndexRef.current >= totalChunks && finalResponse) {
        isRunningRef.current = false;
        abortControllerRef.current = null;
        setState((current) => ({
          ...current,
          progress: 100,
          isUploading: false,
          isPaused: false,
          isError: false,
          isSuccess: true
        }));
        onSuccess == null ? void 0 : onSuccess(finalResponse);
      }
    } catch (error) {
      if (runId !== runIdRef.current) return;
      isRunningRef.current = false;
      abortControllerRef.current = null;
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }
      const uploadError = toError(error);
      onChunkError == null ? void 0 : onChunkError(currentChunkIndexRef.current, uploadError);
      setState((current) => ({
        ...current,
        isUploading: false,
        isPaused: false,
        isError: true,
        isSuccess: false
      }));
      onError == null ? void 0 : onError(uploadError);
    }
  }, [onChunkError, onChunkStart, onChunkSuccess, onError, onProgress, onSuccess]);
  const reportValidationError = useCallback((message) => {
    const error = new Error(message);
    setState({
      ...initialState,
      isError: true
    });
    onError == null ? void 0 : onError(error);
  }, [onError]);
  const startUpload = useCallback((file) => {
    var _a;
    runIdRef.current += 1;
    isRunningRef.current = false;
    (_a = abortControllerRef.current) == null ? void 0 : _a.abort();
    abortControllerRef.current = null;
    sessionRef.current = null;
    currentChunkIndexRef.current = 0;
    if (!Number.isFinite(chunkSize) || chunkSize <= 0) {
      reportValidationError("chunkSize must be a finite number greater than 0.");
      return;
    }
    if (!uploadUrl.trim()) {
      reportValidationError("uploadUrl must not be empty.");
      return;
    }
    sessionRef.current = {
      file,
      uploadId: createUploadId(),
      chunkSize,
      uploadUrl,
      headers: headers ? new Headers(headers) : void 0,
      fields: fields ? { ...fields } : void 0
    };
    currentChunkIndexRef.current = 0;
    isPausedRef.current = false;
    isRunningRef.current = true;
    setState({
      ...initialState,
      isUploading: true
    });
    void uploadChunks(runIdRef.current);
  }, [chunkSize, fields, headers, reportValidationError, uploadChunks, uploadUrl]);
  const pauseUpload = useCallback(() => {
    var _a;
    if (!isRunningRef.current) return;
    runIdRef.current += 1;
    isPausedRef.current = true;
    isRunningRef.current = false;
    (_a = abortControllerRef.current) == null ? void 0 : _a.abort();
    abortControllerRef.current = null;
    setState((current) => ({ ...current, isUploading: false, isPaused: true }));
  }, []);
  const resumeUpload = useCallback(() => {
    const session = sessionRef.current;
    if (!session || isRunningRef.current) return;
    const totalChunks = Math.max(1, Math.ceil(session.file.size / session.chunkSize));
    if (currentChunkIndexRef.current >= totalChunks) return;
    runIdRef.current += 1;
    isPausedRef.current = false;
    isRunningRef.current = true;
    setState((current) => ({
      ...current,
      isUploading: true,
      isPaused: false,
      isError: false,
      isSuccess: false
    }));
    void uploadChunks(runIdRef.current);
  }, [uploadChunks]);
  useEffect(() => () => {
    var _a;
    runIdRef.current += 1;
    isRunningRef.current = false;
    (_a = abortControllerRef.current) == null ? void 0 : _a.abort();
  }, []);
  return {
    startUpload,
    pauseUpload,
    resumeUpload,
    retryUpload: resumeUpload,
    ...state
  };
}
export {
  useChunkedUpload
};
//# sourceMappingURL=index.mjs.map