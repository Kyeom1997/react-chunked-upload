# react-chunked-upload

[![npm version](https://img.shields.io/npm/v/react-chunked-upload.svg)](https://www.npmjs.com/package/react-chunked-upload)
[![npm downloads](https://img.shields.io/npm/dm/react-chunked-upload.svg)](https://www.npmjs.com/package/react-chunked-upload)
[![GitHub stars](https://img.shields.io/github/stars/Kyeom1997/react-chunked-upload?style=flat)](https://github.com/Kyeom1997/react-chunked-upload/stargazers)
[![license](https://img.shields.io/npm/l/react-chunked-upload.svg)](./LICENSE)

A lightweight React hook for sequential, chunked file uploads with pause, resume, and retry support.

[npm](https://www.npmjs.com/package/react-chunked-upload) | [GitHub](https://github.com/Kyeom1997/react-chunked-upload) | [Report a bug](https://github.com/Kyeom1997/react-chunked-upload/issues/new?template=bug_report.yml) | [Request a feature](https://github.com/Kyeom1997/react-chunked-upload/issues/new?template=feature_request.yml)

## Why this exists?

When uploading large files (e.g., 5GB videos or huge CSV datasets) in a traditional single-request manner, a network hiccup or timeout can cause the entire upload to fail, resulting in poor user experience and wasted bandwidth. 

By splitting the file into small chunks (e.g., 5MB) on the client side using the HTML5 `File` and `Blob` APIs, `react-chunked-upload` provides:
- **Resiliency**: A failed chunk can be retried without restarting completed chunks.
- **Control**: You can pause and resume the upload at any time.
- **Feedback**: Byte-based progress after each completed chunk.
- **Memory Efficiency**: The browser doesn't need to load the entire file into memory at once.

## Installation

```bash
npm install react-chunked-upload
```

## Usage

```tsx
import React, { useState } from 'react';
import { useChunkedUpload } from 'react-chunked-upload';

function App() {
  const [file, setFile] = useState<File | null>(null);
  
  const { 
    startUpload, 
    pauseUpload, 
    resumeUpload,
    retryUpload,
    progress, 
    isUploading, 
    isPaused, 
    isError, 
    isSuccess 
  } = useChunkedUpload({
    chunkSize: 1024 * 1024 * 5, // 5MB chunks
    uploadUrl: 'https://your-api.com/upload-chunk',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    fields: {
      folderId: 'invoices',
    },
    onChunkStart: (chunkIndex) => console.log(`Chunk ${chunkIndex} started`),
    onChunkSuccess: (chunkIndex) => console.log(`Chunk ${chunkIndex} uploaded`),
    onChunkError: (chunkIndex, err) => console.error(`Chunk ${chunkIndex} failed`, err),
    onSuccess: (response) => console.log('Upload complete!', response),
    onError: (err) => console.error('Upload failed', err),
    onProgress: (p) => console.log(`Progress: ${p}%`)
  });

  return (
    <div>
      <input type="file" onChange={e => setFile(e.target.files?.[0] || null)} />
      
      {!isUploading && !isPaused && (
        <button onClick={() => file && startUpload(file)}>Start</button>
      )}
      
      {isUploading && <button onClick={pauseUpload}>Pause</button>}
      {isPaused && <button onClick={resumeUpload}>Resume</button>}
      {isError && <button onClick={retryUpload}>Retry failed chunk</button>}
      
      <div>Progress: {progress}%</div>
      {isSuccess && <div>Upload Successful! 🎉</div>}
      {isError && <div>Error uploading file.</div>}
    </div>
  );
}
```


## API Reference

### Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `uploadUrl` | `string` | Required | Endpoint that receives each chunk as multipart form data. |
| `chunkSize` | `number` | `5 * 1024 * 1024` | Chunk size in bytes. Must be greater than `0`. |
| `headers` | `HeadersInit` | `undefined` | Headers sent with every chunk request. Useful for authorization. Do not set `Content-Type` manually when using `FormData`. |
| `fields` | `Record<string, string \| Blob>` | `undefined` | Extra multipart fields appended to every chunk request. |
| `onProgress` | `(progress: number) => void` | `undefined` | Called after each completed chunk with byte-based progress from `0` to `100`. |
| `onChunkStart` | `(chunkIndex: number) => void` | `undefined` | Called before each chunk request starts. |
| `onChunkSuccess` | `(chunkIndex: number, response: Response) => void` | `undefined` | Called after each chunk request succeeds. Receives a cloned response. |
| `onChunkError` | `(chunkIndex: number, error: Error) => void` | `undefined` | Called when a chunk request fails. |
| `onSuccess` | `(response: Response) => void` | `undefined` | Called after the final chunk succeeds. Receives the final HTTP `Response`. |
| `onError` | `(error: Error) => void` | `undefined` | Called when validation or a chunk request fails. |

### Return value

| Value | Type | Description |
| --- | --- | --- |
| `startUpload` | `(file: File) => void` | Starts a new upload session for the selected file. |
| `pauseUpload` | `() => void` | Aborts the in-flight request and pauses before the next chunk. |
| `resumeUpload` | `() => void` | Continues from the last completed chunk. |
| `retryUpload` | `() => void` | Retries from the failed chunk. Currently equivalent to `resumeUpload`. |
| `progress` | `number` | Upload progress from `0` to `100`. |
| `isUploading` | `boolean` | `true` while a chunk request is active. |
| `isPaused` | `boolean` | `true` after pausing an active upload. |
| `isError` | `boolean` | `true` after validation or request failure. |
| `isSuccess` | `boolean` | `true` after the final chunk completes successfully. |

## Backend Implementation

Your backend needs to handle the multipart form data sent by the hook. The hook sends one `POST` request per chunk to `uploadUrl`.

### Multipart fields

| Field | Description |
| --- | --- |
| `file` | The binary chunk data. |
| `filename` | The original file name. |
| `uploadId` | A generated ID for the current upload attempt. Use this to isolate concurrent uploads. |
| `chunkIndex` | The current chunk number, starting at `0`. |
| `totalChunks` | The total number of chunks for the file. |

Any `fields` values you provide are appended to the same multipart request, so your backend can receive project-specific metadata such as `folderId` or `userId` alongside each chunk.

The endpoint should store each chunk by `uploadId` and `chunkIndex`. When `chunkIndex === totalChunks - 1`, merge/finalize the file before returning a successful response. `onSuccess` receives that final HTTP `Response`.

### Express example

```js
import express from 'express';
import multer from 'multer';
import { mkdir, rename } from 'node:fs/promises';
import path from 'node:path';

const app = express();
const upload = multer({ dest: 'tmp/chunks' });

app.post('/upload-chunk', upload.single('file'), async (req, res) => {
  const { filename, uploadId, chunkIndex, totalChunks } = req.body;

  if (!req.file || !filename || !uploadId || chunkIndex == null || !totalChunks) {
    return res.status(400).json({ message: 'Missing chunk upload fields' });
  }

  const uploadDir = path.join('tmp/uploads', uploadId);
  await mkdir(uploadDir, { recursive: true });

  const chunkPath = path.join(uploadDir, String(chunkIndex));
  await rename(req.file.path, chunkPath);

  const isFinalChunk = Number(chunkIndex) === Number(totalChunks) - 1;

  if (isFinalChunk) {
    // Merge chunks 0..totalChunks - 1 into the final file here.
    // Only send a 2xx response after the merge/finalization succeeds.
  }

  return res.status(200).json({ uploadId, filename, chunkIndex, totalChunks });
});
```

## Behavior Notes

- Uploads are sequential: the next chunk starts after the previous chunk succeeds.
- Progress is updated after each completed chunk, not continuously while a chunk is streaming.
- Pausing aborts the active request and resumes from the last completed chunk.
- This package does not persist upload state across browser refreshes yet.
- This package does not merge chunks on the server; your backend owns storage and finalization.
- Custom `headers` are sent with every chunk request, but `Content-Type` should be left to the browser when using `FormData`.

## Community

Using `react-chunked-upload` in a project? Open a [Show and tell issue](https://github.com/Kyeom1997/react-chunked-upload/issues/new?template=show_and_tell.yml) to share what you built. Real-world use cases help guide compatibility and future releases.

Bug reports and focused feature requests are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request.

## License

MIT
