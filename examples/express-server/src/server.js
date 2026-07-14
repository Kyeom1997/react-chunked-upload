import cors from 'cors';
import express from 'express';
import multer from 'multer';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
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

    await rename(req.file.path, path.join(uploadDir, String(currentIndex)));

    const receivedChunks = await readdir(uploadDir);
    const isComplete = receivedChunks.length === expectedChunks;

    if (!isComplete) {
      return res.json({
        uploadId,
        filename,
        chunkIndex: currentIndex,
        totalChunks: expectedChunks,
        complete: false,
      });
    }

    const completedPath = path.join(completedRoot, safePathSegment(filename));
    await mergeChunks(uploadDir, completedPath, expectedChunks);
    await rm(uploadDir, { recursive: true, force: true });

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

async function mergeChunks(uploadDir, completedPath, totalChunks) {
  await writeFile(completedPath, '');

  for (let index = 0; index < totalChunks; index += 1) {
    const chunk = await readFile(path.join(uploadDir, String(index)));
    await writeFile(completedPath, chunk, { flag: 'a' });
  }
}
