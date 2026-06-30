# react-chunked-upload

A lightweight React hook for sequential, chunked file uploads with pause, resume, and retry support.

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

## Backend Implementation

Your backend needs to handle the multipart form data sent by the hook. The hook sends the following fields with each request:
- `file`: The actual binary chunk data.
- `filename`: The original name of the file.
- `uploadId`: A unique ID for this upload attempt. Use this to isolate concurrent files.
- `chunkIndex`: The current chunk number (0-indexed).
- `totalChunks`: The total number of chunks.

The endpoint must not return a successful response for the final chunk until the server has finalized the file. `onSuccess` receives that final HTTP `Response`.

Example (Express.js / Node.js):
```javascript
app.post('/upload-chunk', upload.single('file'), async (req, res) => {
  const { filename, uploadId, chunkIndex, totalChunks } = req.body;
  // 1. Save the chunk to a temporary location
  // 2. If this is the final chunk, await merging/finalization before responding
  res.status(200).json({ uploadId, filename, chunkIndex, totalChunks });
});
```

## License

MIT
