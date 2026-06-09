import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: '',
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
    rollupOptions: {
      input: 'index.html',
    },
  },
});