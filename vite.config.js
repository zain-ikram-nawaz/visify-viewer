import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.js',
      name: 'Visify',
      fileName: 'embed',
      formats: ['iife'],
    },
    outDir: 'dist',
    rollupOptions: {
      external: [],
    },
  },
});