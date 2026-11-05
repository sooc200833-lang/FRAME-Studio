import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves this project from /FRAME-Studio/.
  base: '/FRAME-Studio/',
  root: 'apps/web',
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
  },
});
