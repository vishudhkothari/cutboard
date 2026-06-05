import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          // Split heavy charting lib into its own chunk so the main bundle is leaner
          recharts: ['recharts'],
        },
      },
    },
  },
})
