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
  useChunkedUpload: () => useChunkedUpload
});
module.exports = __toCommonJS(index_exports);

// src/useChunkedUpload.ts
var import_react = require("react");
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
    onSuccess,
    onError,
    onProgress
  } = options;
  const [state, setState] = (0, import_react.useState)(initialState);
  const sessionRef = (0, import_react.useRef)(null);
  const currentChunkIndexRef = (0, import_react.useRef)(0);
  const abortControllerRef = (0, import_react.useRef)(null);
  const runIdRef = (0, import_react.useRef)(0);
  const isRunningRef = (0, import_react.useRef)(false);
  const isPausedRef = (0, import_react.useRef)(false);
  const uploadChunks = (0, import_react.useCallback)(async (runId) => {
    const session = sessionRef.current;
    if (!session || runId !== runIdRef.current) return;
    const { file, uploadId, chunkSize: sessionChunkSize, uploadUrl: sessionUploadUrl } = session;
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
        const controller = new AbortController();
        abortControllerRef.current = controller;
        const response = await fetch(sessionUploadUrl, {
          method: "POST",
          body: formData,
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error(`Chunk upload failed with status: ${response.status}`);
        }
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
      setState((current) => ({
        ...current,
        isUploading: false,
        isPaused: false,
        isError: true,
        isSuccess: false
      }));
      onError == null ? void 0 : onError(uploadError);
    }
  }, [onError, onProgress, onSuccess]);
  const reportValidationError = (0, import_react.useCallback)((message) => {
    const error = new Error(message);
    setState({
      ...initialState,
      isError: true
    });
    onError == null ? void 0 : onError(error);
  }, [onError]);
  const startUpload = (0, import_react.useCallback)((file) => {
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
      uploadUrl
    };
    currentChunkIndexRef.current = 0;
    isPausedRef.current = false;
    isRunningRef.current = true;
    setState({
      ...initialState,
      isUploading: true
    });
    void uploadChunks(runIdRef.current);
  }, [chunkSize, reportValidationError, uploadChunks, uploadUrl]);
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
    ...state
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  useChunkedUpload
});
//# sourceMappingURL=index.js.map