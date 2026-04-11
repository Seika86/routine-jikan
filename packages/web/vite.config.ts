import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://api:3001',
        changeOrigin: true,
      },
      ...(process.env.VITE_TTS_URL
        ? {
            '/tts': {
              target: process.env.VITE_TTS_URL,
              changeOrigin: true,
              rewrite: (path: string) => path.replace(/^\/tts/, ''),
            },
          }
        : {}),
    },
  },
})
