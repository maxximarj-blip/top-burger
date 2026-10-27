import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' permite publicar em https://<usuario>.github.io/<repositorio>/
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    chunkSizeWarningLimit: 1200,
  },
})
