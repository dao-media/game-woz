import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so dist runs from file:// and custom app schemes.
  base: './',
  // MPA: /3d-studio.html + /particle-studio.html. Avoid SPA HTML fallback
  // for missing .glb/.fbx (GLTFLoader was parsing <!doctype as JSON).
  appType: 'mpa',
  server: {
    // Dedicated Oz port (avoid clashing with other local apps on 5173).
    port: 5180,
    strictPort: true,
    host: '127.0.0.1',
    open: false,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsDir: 'assets',
    rollupOptions: {
      input: {
        main: 'index.html',
        studio3d: '3d-studio.html',
        particle: 'particle-studio.html',
      },
    },
  },
});
