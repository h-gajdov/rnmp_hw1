import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// In development the Python bridge runs on :8000; Vite forwards the live
// Socket.IO connection and the REST API to it, so the browser sees one origin.
const bridge = process.env.BRIDGE_URL ?? 'http://localhost:8000'

export default defineConfig({
  plugins: [react()],
  // maplibre-gl alone is ~1 MB; that is expected for a map app
  build: { chunkSizeWarningLimit: 1600 },
  server: {
    proxy: {
      '/api': bridge,
      '/socket.io': { target: bridge, ws: true },
    },
  },
})
