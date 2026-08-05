import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so dist runs from file:// and custom app schemes.
  base: './',
  server: {
    port: 5173,
    open: false,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsDir: 'assets',
  },
});
