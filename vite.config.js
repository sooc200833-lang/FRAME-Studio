import { resolve } from 'node:path';
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
    rollupOptions: {
      input: {
        main: resolve(process.cwd(), 'apps/web/index.html'),
        backgroundStudio: resolve(process.cwd(), 'apps/web/background-studio.html'),
      },
    },
    outDir: '../../dist',
    emptyOutDir: true,
  },
});
