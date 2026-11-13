import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const web = fileURLToPath(new URL('./apps/web/', import.meta.url));

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
    // One app, three pages: the lobby (entry) and two independent workspaces.
    rollupOptions: {
      input: {
        lobby: resolve(web, 'index.html'),
        drawing: resolve(web, 'drawing.html'),
        backgroundStudio: resolve(web, 'background-studio.html'),
      },
    },
    outDir: '../../dist',
    emptyOutDir: true,
  },
});
