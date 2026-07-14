import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChunkedUpload } from './useChunkedUpload';

function createFile(size: number, name = 'video.mp4') {
  return new File([new Uint8Array(size)], name, { type: 'video/mp4' });
}

interface DeferredFetchCall {
  url: string;
  init: RequestInit;
  body: FormData;
  signal: AbortSignal | null | undefined;
  resolve: (response?: Response) => void;
  reject: (error: unknown) => void;
}

/**
 * A fetch mock whose responses resolve on demand and that rejects with an
 * AbortError when the request signal aborts, mirroring real fetch behavior.
 */
function createDeferredFetch() {
  const calls: DeferredFetchCall[] = [];

  const fetchMock = vi.fn((url: RequestInfo | URL, init: RequestInit = {}) => {
    return new Promise<Response>((resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      });
      calls.push({
        url: String(url),
        init,
        body: init.body as FormData,
        signal: init.signal,
        resolve: (response = new Response('ok', { status: 200 })) => resolve(response),
        reject,
      });
    });
  });

  return { fetchMock, calls };
}

function chunkIndexOf(call: DeferredFetchCall) {
  return call.body.get('chunkIndex');
}

describe('useChunkedUpload', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uploads chunks sequentially with headers, fields, and lifecycle callbacks', async () => {
    const onProgress = vi.fn();
    const onChunkStart = vi.fn();
    const onChunkSuccess = vi.fn();
    const onSuccess = vi.fn();

    const { result } = renderHook(() => useChunkedUpload({
      uploadUrl: '/api/upload-chunk',
      chunkSize: 2,
      headers: { Authorization: 'Bearer token' },
      fields: { folderId: 'demo-folder' },
      onProgress,
      onChunkStart,
      onChunkSuccess,
      onSuccess,
    }));

    act(() => {
      result.current.startUpload(createFile(5));
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(onChunkStart).toHaveBeenNthCalledWith(1, 0);
    expect(onChunkStart).toHaveBeenNthCalledWith(2, 1);
    expect(onChunkStart).toHaveBeenNthCalledWith(3, 2);
    expect(onChunkSuccess).toHaveBeenCalledTimes(3);
    expect(onProgress).toHaveBeenNthCalledWith(1, 40);
    expect(onProgress).toHaveBeenNthCalledWith(2, 80);
    expect(onProgress).toHaveBeenNthCalledWith(3, 100);
    expect(onSuccess).toHaveBeenCalledTimes(1);

    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall[0]).toBe('/api/upload-chunk');
    expect(firstCall[1]?.method).toBe('POST');
    expect(firstCall[1]?.headers).toBeInstanceOf(Headers);
    expect((firstCall[1]?.headers as Headers).get('Authorization')).toBe('Bearer token');

    const firstBody = firstCall[1]?.body;
    expect(firstBody).toBeInstanceOf(FormData);
    expect((firstBody as FormData).get('chunkIndex')).toBe('0');
    expect((firstBody as FormData).get('totalChunks')).toBe('3');
    expect((firstBody as FormData).get('filename')).toBe('video.mp4');
    expect((firstBody as FormData).get('folderId')).toBe('demo-folder');
  });

  it('reports failed chunk requests', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    const onError = vi.fn();
    const onChunkError = vi.fn();

    const { result } = renderHook(() => useChunkedUpload({
      uploadUrl: '/api/upload-chunk',
      chunkSize: 2,
      onError,
      onChunkError,
    }));

    act(() => {
      result.current.startUpload(createFile(4));
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.isUploading).toBe(false);
    expect(onChunkError).toHaveBeenCalledWith(0, expect.any(Error));
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it('validates chunk size and upload URL', () => {
    const onInvalidChunkSize = vi.fn();
    const invalidChunkSize = renderHook(() => useChunkedUpload({
      uploadUrl: '/api/upload-chunk',
      chunkSize: 0,
      onError: onInvalidChunkSize,
    }));

    act(() => {
      invalidChunkSize.result.current.startUpload(createFile(1));
    });

    expect(invalidChunkSize.result.current.isError).toBe(true);
    expect(onInvalidChunkSize).toHaveBeenCalledWith(expect.any(Error));

    const onEmptyUploadUrl = vi.fn();
    const emptyUploadUrl = renderHook(() => useChunkedUpload({
      uploadUrl: ' ',
      onError: onEmptyUploadUrl,
    }));

    act(() => {
      emptyUploadUrl.result.current.startUpload(createFile(1));
    });

    expect(emptyUploadUrl.result.current.isError).toBe(true);
    expect(onEmptyUploadUrl).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe('useChunkedUpload pause/resume/retry semantics', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('pause aborts the in-flight chunk and resume re-sends it', async () => {
    const { fetchMock, calls } = createDeferredFetch();
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useChunkedUpload({
      uploadUrl: '/api/upload-chunk',
      chunkSize: 2,
    }));

    act(() => {
      result.current.startUpload(createFile(6));
    });

    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () => {
      calls[0].resolve();
    });
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(chunkIndexOf(calls[1])).toBe('1');

    act(() => {
      result.current.pauseUpload();
    });

    expect(result.current.isPaused).toBe(true);
    expect(result.current.isUploading).toBe(false);
    expect(result.current.progress).toBe(33);
    expect(calls[1].signal?.aborted).toBe(true);

    act(() => {
      result.current.resumeUpload();
    });

    // Resumes from the aborted chunk, not from zero and not skipping it.
    await waitFor(() => expect(calls).toHaveLength(3));
    expect(chunkIndexOf(calls[2])).toBe('1');

    await act(async () => {
      calls[2].resolve();
    });
    await waitFor(() => expect(calls).toHaveLength(4));
    await act(async () => {
      calls[3].resolve();
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.progress).toBe(100);
  });

  it('pausing after a chunk response lands re-sends that chunk and re-fires onChunkSuccess', async () => {
    const { fetchMock, calls } = createDeferredFetch();
    vi.stubGlobal('fetch', fetchMock);
    const onChunkSuccess = vi.fn();

    const { result } = renderHook(() => useChunkedUpload({
      uploadUrl: '/api/upload-chunk',
      chunkSize: 2,
      onChunkSuccess,
    }));

    act(() => {
      result.current.startUpload(createFile(4));
    });

    await waitFor(() => expect(calls).toHaveLength(1));

    // The server processed chunk 0, but pause wins the race against the
    // response continuation: the chunk is not recorded as completed.
    await act(async () => {
      calls[0].resolve();
      result.current.pauseUpload();
    });

    expect(onChunkSuccess).toHaveBeenCalledTimes(1);
    expect(result.current.progress).toBe(0);

    act(() => {
      result.current.resumeUpload();
    });

    // Chunk 0 is re-sent; consumers observe onChunkSuccess(0) twice. Servers
    // must treat (uploadId, chunkIndex) idempotently.
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(chunkIndexOf(calls[1])).toBe('0');

    await act(async () => {
      calls[1].resolve();
    });
    await waitFor(() => expect(calls).toHaveLength(3));
    await act(async () => {
      calls[2].resolve();
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(onChunkSuccess).toHaveBeenCalledTimes(3);
    expect(onChunkSuccess.mock.calls.map(call => call[0])).toEqual([0, 0, 1]);
  });

  it('retryUpload retries from the failed chunk after an error', async () => {
    const { fetchMock, calls } = createDeferredFetch();
    vi.stubGlobal('fetch', fetchMock);
    const onChunkError = vi.fn();

    const { result } = renderHook(() => useChunkedUpload({
      uploadUrl: '/api/upload-chunk',
      chunkSize: 2,
      onChunkError,
    }));

    act(() => {
      result.current.startUpload(createFile(6));
    });

    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () => {
      calls[0].resolve();
    });
    await waitFor(() => expect(calls).toHaveLength(2));
    await act(async () => {
      calls[1].resolve(new Response('nope', { status: 500 }));
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(onChunkError).toHaveBeenCalledWith(1, expect.any(Error));

    act(() => {
      result.current.retryUpload();
    });

    await waitFor(() => expect(calls).toHaveLength(3));
    expect(chunkIndexOf(calls[2])).toBe('1');

    await act(async () => {
      calls[2].resolve();
    });
    await waitFor(() => expect(calls).toHaveLength(4));
    await act(async () => {
      calls[3].resolve();
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('unmount aborts the in-flight chunk and stops the loop', async () => {
    const { fetchMock, calls } = createDeferredFetch();
    vi.stubGlobal('fetch', fetchMock);

    const { result, unmount } = renderHook(() => useChunkedUpload({
      uploadUrl: '/api/upload-chunk',
      chunkSize: 2,
    }));

    act(() => {
      result.current.startUpload(createFile(6));
    });

    await waitFor(() => expect(calls).toHaveLength(1));

    unmount();

    expect(calls[0].signal?.aborted).toBe(true);
    await act(async () => {
      await Promise.resolve();
    });
    expect(calls).toHaveLength(1);
  });

  it('starting a new upload aborts the previous session and issues a new uploadId', async () => {
    const { fetchMock, calls } = createDeferredFetch();
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useChunkedUpload({
      uploadUrl: '/api/upload-chunk',
      chunkSize: 2,
    }));

    act(() => {
      result.current.startUpload(createFile(6, 'first.mp4'));
    });

    await waitFor(() => expect(calls).toHaveLength(1));

    act(() => {
      result.current.startUpload(createFile(4, 'second.mp4'));
    });

    expect(calls[0].signal?.aborted).toBe(true);

    await waitFor(() => expect(calls).toHaveLength(2));
    expect(chunkIndexOf(calls[1])).toBe('0');
    expect(calls[1].body.get('filename')).toBe('second.mp4');
    expect(calls[1].body.get('uploadId')).not.toBe(calls[0].body.get('uploadId'));
  });

  it('cancelUpload aborts, discards the session, and resets state', async () => {
    const { fetchMock, calls } = createDeferredFetch();
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useChunkedUpload({
      uploadUrl: '/api/upload-chunk',
      chunkSize: 2,
    }));

    act(() => {
      result.current.startUpload(createFile(6));
    });

    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () => {
      calls[0].resolve();
    });
    await waitFor(() => expect(result.current.progress).toBe(33));

    act(() => {
      result.current.cancelUpload();
    });

    expect(calls[1].signal?.aborted).toBe(true);
    expect(result.current.progress).toBe(0);
    expect(result.current.isUploading).toBe(false);
    expect(result.current.isPaused).toBe(false);

    // A canceled session cannot be resumed.
    act(() => {
      result.current.resumeUpload();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(calls).toHaveLength(2);
  });

  it('an invalid startUpload call does not destroy a paused session', async () => {
    const { fetchMock, calls } = createDeferredFetch();
    vi.stubGlobal('fetch', fetchMock);
    const onError = vi.fn();

    const { result, rerender } = renderHook(
      ({ url }: { url: string }) => useChunkedUpload({
        uploadUrl: url,
        chunkSize: 2,
        onError,
      }),
      { initialProps: { url: '/api/upload-chunk' } },
    );

    act(() => {
      result.current.startUpload(createFile(4));
    });

    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () => {
      calls[0].resolve();
    });
    await waitFor(() => expect(result.current.progress).toBe(50));

    act(() => {
      result.current.pauseUpload();
    });

    // uploadUrl becomes invalid, then a stray startUpload is issued.
    rerender({ url: ' ' });
    act(() => {
      result.current.startUpload(createFile(4));
    });

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(result.current.isError).toBe(true);
    expect(result.current.progress).toBe(50);

    // The paused session is still resumable.
    rerender({ url: '/api/upload-chunk' });
    act(() => {
      result.current.resumeUpload();
    });

    await waitFor(() => expect(calls).toHaveLength(3));
    expect(chunkIndexOf(calls[2])).toBe('1');
  });
});
