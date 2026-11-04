import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// In dev, /api is proxied to the Source Easy server (server/, default :8080). Twenty is never called from the browser.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': process.env.API_URL ?? 'http://localhost:8080' } },
  preview: { proxy: { '/api': process.env.API_URL ?? 'http://localhost:8080' } },
})
