"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  ChunkUploadError: () => ChunkUploadError,
  useChunkedUpload: () => useChunkedUpload
});
module.exports = __toCommonJS(index_exports);

// src/useChunkedUpload.ts
var import_react = require("react");
var ChunkUploadError = class extends Error {
  constructor(message, chunkIndex, status) {
    super(message);
    this.name = "ChunkUploadError";
    this.chunkIndex = chunkIndex;
    this.status = status;
  }
};
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
function getTotalChunks(file, chunkSize) {
  return Math.max(1, Math.ceil(file.size / chunkSize));
}
function nextPendingChunk(totalChunks, completed) {
  for (let index = 0; index < totalChunks; index += 1) {
    if (!completed.has(index)) return index;
  }
  return null;
}
function computeProgress(file, chunkSize, completed) {
  if (file.size === 0) return completed.size > 0 ? 100 : 0;
  let uploadedBytes = 0;
  for (const index of completed) {
    uploadedBytes += Math.min(chunkSize, file.size - index * chunkSize);
  }
  return Math.round(uploadedBytes / file.size * 100);
}
function isRetryableError(error) {
  if (error instanceof ChunkUploadError) {
    if (error.status === void 0) return true;
    return error.status >= 500 || error.status === 408 || error.status === 429;
  }
  return error instanceof TypeError;
}
function resolveRetryDelay(retryDelay, attempt, error) {
  if (typeof retryDelay === "function") return Math.max(0, retryDelay(attempt, error));
  if (typeof retryDelay === "number") return Math.max(0, retryDelay);
  return Math.min(500 * 2 ** (attempt - 1), 1e4);
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function interruptedError() {
  return new DOMException("The upload was interrupted.", "AbortError");
}
function isAbortError(error) {
  return typeof error === "object" && error !== null && error.name === "AbortError";
}
function useChunkedUpload(options) {
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
    onChunkError
  } = options;
  const [state, setState] = (0, import_react.useState)(initialState);
  const sessionRef = (0, import_react.useRef)(null);
  const completedChunksRef = (0, import_react.useRef)(/* @__PURE__ */ new Set());
  const abortControllerRef = (0, import_react.useRef)(null);
  const runIdRef = (0, import_react.useRef)(0);
  const isRunningRef = (0, import_react.useRef)(false);
  const isPausedRef = (0, import_react.useRef)(false);
  const uploadChunks = (0, import_react.useCallback)(async (runId) => {
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
      timeout: sessionTimeout
    } = session;
    const totalChunks = getTotalChunks(file, sessionChunkSize);
    let finalResponse = null;
    const assertActive = () => {
      if (runId !== runIdRef.current || isPausedRef.current) {
        throw interruptedError();
      }
    };
    const uploadChunkWithRetries = async (chunkIndex) => {
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
      for (let attempt = 0; ; attempt += 1) {
        const controller = new AbortController();
        abortControllerRef.current = controller;
        let timedOut = false;
        const timer = sessionTimeout !== void 0 ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, sessionTimeout) : void 0;
        try {
          const resolvedHeaders = typeof sessionHeaders === "function" ? await sessionHeaders() : sessionHeaders;
          assertActive();
          onChunkStart == null ? void 0 : onChunkStart(chunkIndex);
          const response = await fetch(sessionUploadUrl, {
            method: "POST",
            headers: resolvedHeaders,
            body: formData,
            signal: controller.signal
          });
          if (!response.ok) {
            throw new ChunkUploadError(
              `Chunk upload failed with status: ${response.status}`,
              chunkIndex,
              response.status
            );
          }
          return response;
        } catch (error) {
          let failure = error;
          if (isAbortError(error)) {
            if (!timedOut || runId !== runIdRef.current) throw error;
            failure = new ChunkUploadError(
              `Chunk upload timed out after ${sessionTimeout}ms`,
              chunkIndex
            );
          }
          const uploadError = toError(failure);
          onChunkError == null ? void 0 : onChunkError(chunkIndex, uploadError);
          if (attempt >= sessionRetries || !isRetryableError(uploadError)) {
            throw uploadError;
          }
          await sleep(resolveRetryDelay(sessionRetryDelay, attempt + 1, uploadError));
          assertActive();
        } finally {
          if (timer !== void 0) clearTimeout(timer);
        }
      }
    };
    try {
      while (runId === runIdRef.current && !isPausedRef.current) {
        const chunkIndex = nextPendingChunk(totalChunks, completedChunksRef.current);
        if (chunkIndex === null) break;
        const response = await uploadChunkWithRetries(chunkIndex);
        onChunkSuccess == null ? void 0 : onChunkSuccess(chunkIndex, response.clone());
        if (runId !== runIdRef.current || isPausedRef.current) return;
        finalResponse = response;
        completedChunksRef.current.add(chunkIndex);
        const progress = computeProgress(file, sessionChunkSize, completedChunksRef.current);
        setState((current) => ({ ...current, progress }));
        onProgress == null ? void 0 : onProgress(progress);
      }
      if (runId === runIdRef.current && !isPausedRef.current && completedChunksRef.current.size >= totalChunks && finalResponse) {
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
      if (isAbortError(error)) {
        return;
      }
      const uploadError = toError(error);
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
  const reportValidationError = (0, import_react.useCallback)((message) => {
    const error = new Error(message);
    setState((current) => ({
      ...current,
      isUploading: false,
      isError: true,
      isSuccess: false
    }));
    onError == null ? void 0 : onError(error);
  }, [onError]);
  const startUpload = (0, import_react.useCallback)((file) => {
    var _a;
    if (!Number.isFinite(chunkSize) || chunkSize <= 0) {
      reportValidationError("chunkSize must be a finite number greater than 0.");
      return;
    }
    if (!uploadUrl.trim()) {
      reportValidationError("uploadUrl must not be empty.");
      return;
    }
    if (!Number.isInteger(retries) || retries < 0) {
      reportValidationError("retries must be a non-negative integer.");
      return;
    }
    runIdRef.current += 1;
    isRunningRef.current = false;
    (_a = abortControllerRef.current) == null ? void 0 : _a.abort();
    abortControllerRef.current = null;
    completedChunksRef.current = /* @__PURE__ */ new Set();
    sessionRef.current = {
      file,
      uploadId: createUploadId(),
      chunkSize,
      uploadUrl,
      headers: typeof headers === "function" ? headers : headers ? new Headers(headers) : void 0,
      fields: fields ? { ...fields } : void 0,
      retries,
      retryDelay,
      timeout
    };
    isPausedRef.current = false;
    isRunningRef.current = true;
    setState({
      ...initialState,
      isUploading: true
    });
    void uploadChunks(runIdRef.current);
  }, [chunkSize, fields, headers, reportValidationError, retries, retryDelay, timeout, uploadChunks, uploadUrl]);
  const pauseUpload = (0, import_react.useCallback)(() => {
    var _a;
    if (!isRunningRef.current) return;
    runIdRef.current += 1;
    isPausedRef.current = true;
    isRunningRef.current = false;
    (_a = abortControllerRef.current) == null ? void 0 : _a.abort();
    abortControllerRef.current = null;
    setState((current) => ({ ...current, isUploading: false, isPaused: true }));
  }, []);
  const resumeUpload = (0, import_react.useCallback)(() => {
    const session = sessionRef.current;
    if (!session || isRunningRef.current) return;
    const totalChunks = getTotalChunks(session.file, session.chunkSize);
    if (completedChunksRef.current.size >= totalChunks) return;
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
  const cancelUpload = (0, import_react.useCallback)(() => {
    var _a;
    runIdRef.current += 1;
    isRunningRef.current = false;
    isPausedRef.current = false;
    (_a = abortControllerRef.current) == null ? void 0 : _a.abort();
    abortControllerRef.current = null;
    sessionRef.current = null;
    completedChunksRef.current = /* @__PURE__ */ new Set();
    setState(initialState);
  }, []);
  (0, import_react.useEffect)(() => () => {
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
    cancelUpload,
    ...state
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ChunkUploadError,
  useChunkedUpload
});
//# sourceMappingURL=index.js.map