/**
 * Headers for chunk requests: a static HeadersInit, or a function evaluated
 * before every chunk attempt so short-lived credentials can be refreshed
 * during long uploads.
 */
type ChunkedUploadHeaders = HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
/** Error thrown when a chunk request fails, carrying the failed chunk index and HTTP status when available. */
declare class ChunkUploadError extends Error {
    readonly chunkIndex: number;
    readonly status?: number;
    constructor(message: string, chunkIndex: number, status?: number);
}
interface ChunkedUploadOptions {
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
interface ChunkedUploadState {
    progress: number;
    isUploading: boolean;
    isPaused: boolean;
    isError: boolean;
    isSuccess: boolean;
}
declare function useChunkedUpload(options: ChunkedUploadOptions): {
    progress: number;
    isUploading: boolean;
    isPaused: boolean;
    isError: boolean;
    isSuccess: boolean;
    startUpload: (file: File) => void;
    pauseUpload: () => void;
    resumeUpload: () => void;
    retryUpload: () => void;
    cancelUpload: () => void;
};

export { ChunkUploadError, type ChunkedUploadHeaders, type ChunkedUploadOptions, type ChunkedUploadState, useChunkedUpload };
