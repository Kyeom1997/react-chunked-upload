import cors from 'cors';
import express from 'express';
import multer from 'multer';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const port = process.env.PORT || 4000;
const tmpRoot = path.resolve('tmp');
const chunkRoot = path.join(tmpRoot, 'chunks');
const completedRoot = path.join(tmpRoot, 'completed');

await mkdir(chunkRoot, { recursive: true });
await mkdir(completedRoot, { recursive: true });

const app = express();
const upload = multer({
  dest: path.join(tmpRoot, 'incoming'),
  limits: {
    files: 1,
    fileSize: 25 * 1024 * 1024,
  },
});

app.use(cors());

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/upload-chunk', upload.single('file'), async (req, res, next) => {
  try {
    const { filename, uploadId, chunkIndex, totalChunks } = req.body;

    if (!req.file || !filename || !uploadId || chunkIndex == null || !totalChunks) {
      return res.status(400).json({ message: 'Missing chunk upload fields' });
    }

    const currentIndex = Number(chunkIndex);
    const expectedChunks = Number(totalChunks);

    if (!Number.isInteger(currentIndex) || !Number.isInteger(expectedChunks) || currentIndex < 0 || expectedChunks <= 0) {
      return res.status(400).json({ message: 'Invalid chunk metadata' });
    }

    const uploadDir = path.join(chunkRoot, safePathSegment(uploadId));
    await mkdir(uploadDir, { recursive: true });

    // rename overwrites an existing chunk file, so re-sent chunks (the hook
    // may repeat a chunk after pause/resume) stay idempotent.
    await rename(req.file.path, path.join(uploadDir, String(currentIndex)));

    if (!(await hasAllChunks(uploadDir, expectedChunks))) {
      return res.json({
        uploadId,
        filename,
        chunkIndex: currentIndex,
        totalChunks: expectedChunks,
        complete: false,
      });
    }

    // Atomically claim the merge by renaming the chunk directory. If two
    // requests observe a complete set at once, only one rename succeeds and
    // the other request reports the chunk as stored.
    const mergingDir = `${uploadDir}.merging`;
    try {
      await rename(uploadDir, mergingDir);
    } catch {
      return res.json({
        uploadId,
        filename,
        chunkIndex: currentIndex,
        totalChunks: expectedChunks,
        complete: false,
      });
    }

    // Namespace the completed file by uploadId so concurrent uploads of
    // files with the same name cannot overwrite each other.
    const completedName = `${safePathSegment(uploadId)}-${safePathSegment(filename)}`;
    const completedPath = path.join(completedRoot, completedName);

    await mergeChunks(mergingDir, completedPath, expectedChunks);
    await rm(mergingDir, { recursive: true, force: true });

    return res.json({
      uploadId,
      filename,
      totalChunks: expectedChunks,
      complete: true,
      path: completedPath,
    });
  } catch (error) {
    return next(error);
  }
});

app.use((error, _req, res, _next) => {
  res.status(500).json({ message: error.message });
});

app.listen(port, () => {
  console.log(`Chunk upload server listening on http://localhost:${port}`);
});

function safePathSegment(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, '_');
}

/** Every chunk index 0..totalChunks-1 exists, rather than counting entries. */
async function hasAllChunks(uploadDir, totalChunks) {
  const entries = new Set(await readdir(uploadDir));

  if (entries.size < totalChunks) return false;

  for (let index = 0; index < totalChunks; index += 1) {
    if (!entries.has(String(index))) return false;
  }

  return true;
}

async function mergeChunks(uploadDir, completedPath, totalChunks) {
  // Merge into a temp file first so a crash mid-merge never leaves a
  // truncated file at the final path.
  const partialPath = `${completedPath}.partial`;

  await writeFile(partialPath, '');

  for (let index = 0; index < totalChunks; index += 1) {
    const chunk = await readFile(path.join(uploadDir, String(index)));
    await writeFile(partialPath, chunk, { flag: 'a' });
  }

  await rename(partialPath, completedPath);
  await stat(completedPath);
}
