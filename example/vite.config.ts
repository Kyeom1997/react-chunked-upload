import { defineConfig } from 'vite'
import type { Connect, Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const mockUploadHandler: Connect.NextHandleFunction = (request, response, next) => {
  if (request.method !== 'POST') {
    next()
    return
  }

  request.on('data', () => undefined)
  request.on('end', () => {
    response.statusCode = 200
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ message: 'Chunk received' }))
  })
}

const mockUploadPlugin = (): Plugin => ({
  name: 'local-mock-upload',
  configureServer(server) {
    server.middlewares.use('/api/upload-chunk', mockUploadHandler)
  },
  configurePreviewServer(server) {
    server.middlewares.use('/api/upload-chunk', mockUploadHandler)
  },
})

export default defineConfig({
  plugins: [react(), mockUploadPlugin()],
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
})
