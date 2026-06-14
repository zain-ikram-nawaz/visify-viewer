import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  server: {
    port: 5173,
  },
  build: {
    lib: {
      entry: 'src/index.js',
      name: 'Visify',
      fileName: 'embed',
      formats: ['iife'],
    },
    outDir: 'dist',
    copyPublicDir: true,
    rollupOptions: {
      external: [],
    },
  },
});