import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  server: {
    port: 5173,
  },
  build: {
    // lib block ko hata diya taake yeh poori web app build kare
    outDir: 'dist',
    copyPublicDir: true,
  },
});