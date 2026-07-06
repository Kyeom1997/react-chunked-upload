interface ChunkedUploadOptions {
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
};

export { type ChunkedUploadOptions, type ChunkedUploadState, useChunkedUpload };
