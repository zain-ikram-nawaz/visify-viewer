import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  server: {
    port: 5173,
  },
  build: {
    outDir: 'dist',
    copyPublicDir: true,
    rollupOptions: {
      input: {
        // Main entry point aapka HTML hi rahega taake Vercel website khole
        main: './index.html',
      },
      output: {
        // Yeh line ensure karegi ki aapki JS file ka naam 'embed.iife.js' hi bane
        entryFileNames: 'embed.iife.js',
        assetFileNames: '[name].[ext]',
        chunkFileNames: '[name].js',
      },
    },
  },
});