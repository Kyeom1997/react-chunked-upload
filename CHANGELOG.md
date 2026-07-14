# Changelog

All notable changes to this project will be documented in this file.

## 0.2.0

### Added

- `retries` option for opt-in automatic per-chunk retries with exponential backoff (default `0`). Only network errors, timeouts, HTTP 5xx, 408, and 429 are retried; other 4xx responses fail immediately.
- `retryDelay` option: a number or `(attempt, error) => number` controlling backoff.
- `timeout` option: aborts a hung chunk request and counts it as a retryable failure.
- `headers` now also accepts a sync or async function evaluated before every chunk attempt, so expiring credentials can be refreshed during long uploads.
- `cancelUpload()`: aborts the in-flight request, discards the session, and resets state.
- `ChunkUploadError` export carrying `chunkIndex` and `status` for failed chunk requests.

### Changed

- Internal upload state is tracked as a set of completed chunks instead of a cursor, with byte-accurate progress. Groundwork for parallel uploads and resume-after-refresh.
- `onChunkStart` and `onChunkError` now fire once per attempt when retries are enabled; `onError` fires once when a chunk exhausts its retries.
- Calling `startUpload` with invalid options no longer destroys a paused session, and validation errors no longer reset progress or pause state.

### Fixed

- Abort detection no longer relies on `instanceof Error`, which is false for `DOMException` in some runtimes.
- Express example: completed files are namespaced by `uploadId` (no more same-filename collisions), merges are claimed atomically to prevent double-merge corruption, completion verifies every chunk index exists, and merging goes through a `.partial` file so a crash cannot leave a truncated final file.

### Documented

- Servers must treat `(uploadId, chunkIndex)` idempotently: a chunk whose response was in flight during `pauseUpload()` is re-sent on resume, and `onChunkSuccess` can fire more than once for the same chunk index.

## 0.1.4

- Improved npm search metadata for React and large-file upload queries.
- Reworked the README introduction with installation, fit guidance, and runnable examples.
- Replaced the generated Vite documentation with instructions for the React demo.

## 0.1.3

- Added GitHub Actions checks for tests and package builds.
- Added a runnable Express server that stores and merges uploaded chunks.
- Added package comparison and backend integration guidance.

## 0.1.2

- Added custom `headers` and multipart `fields` support.
- Added chunk lifecycle callbacks: `onChunkStart`, `onChunkSuccess`, and `onChunkError`.
- Added tests for chunk metadata, retry behavior, and callback behavior.
- Improved README API documentation and package metadata.

## 0.1.1

- Improved README documentation and GitHub metadata.
- Added community issue templates and contributing guidance.

## 0.1.0

- Initial release with sequential chunk uploads.
- Added pause, resume, retry, progress, success, and error state support.
