# React Chunked Upload Demo

Interactive Vite demo for `react-chunked-upload`. Select a file to see chunk progress and test pause, resume, and retry behavior.

The Vite development server includes a lightweight mock endpoint at `/api/upload-chunk`, so the UI works without a separate backend. It accepts each request but does not store or merge chunks.

## Run

Build the package from the repository root first:

```bash
npm install
npm run build
```

Then start the demo:

```bash
cd example
npm install
npm run dev
```

Open the local URL printed by Vite and select a file.

## Test with a real backend

For a server that stores and merges chunks, run the [Express example](../examples/express-server) and point `uploadUrl` in `src/App.tsx` to `http://localhost:4000/upload-chunk`.
