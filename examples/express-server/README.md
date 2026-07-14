# Express Chunk Upload Server

Runnable backend example for `react-chunked-upload`.

It accepts the multipart fields sent by the hook, stores chunks by `uploadId`, and merges the file after the final chunk arrives.

## Run

```bash
npm install
npm start
```

The server listens on `http://localhost:4000` and accepts chunk uploads at:

```txt
POST /upload-chunk
```

Uploaded files are written to `tmp/completed`.

## Notes

- This is a local development example, not production storage code.
- For production, validate auth, upload ownership, file size limits, MIME types, and cleanup of abandoned chunks.
- The example only merges when the final chunk arrives and all expected chunk files exist.
