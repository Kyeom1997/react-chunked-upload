import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChunkedUpload } from './useChunkedUpload';

function createFile(size: number) {
  return new File([new Uint8Array(size)], 'video.mp4', { type: 'video/mp4' });
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
