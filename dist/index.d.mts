interface ChunkedUploadOptions {
    /** Chunk size in bytes. Default is 5MB. */
    chunkSize?: number;
    /** API endpoint that accepts and finalizes uploaded chunks. */
    uploadUrl: string;
    /** Callback fired with the final chunk response after the upload completes. */
    onSuccess?: (response: Response) => void;
    /** Callback fired if validation or a chunk upload fails. */
    onError?: (error: Error) => void;
    /** Callback fired after a chunk completes, with byte-based progress (0-100). */
    onProgress?: (progress: number) => void;
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
