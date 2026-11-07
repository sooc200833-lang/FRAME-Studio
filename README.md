# FRAME Studio

2D drawing, comic-art, and animation studio with an iPad-first workflow and a dark interface.

## Current web prototype

- PixiJS 8.20.1 stage renderer.
- Canvas-backed raster paint layers, pressure-aware brushes, eraser, and connected-region fill.
- Editable vector line objects, node editing, and Line Boil preview.
- Layer masks, folder groups, palettes, selection transforms, and PNG export.
- Frame-based raster/vector cels, onion skin, and playback.
- Manga screentone: dots, gradient dots, lines, and crosshatch.

**Status:** this is a browser prototype, not a native iPad app. Physical Apple Pencil validation and several advanced document/animation features remain future work.

## Start locally

Requirements: Node.js 20.19+ or 22.12+.

```bash
npm install
npm run dev
npm test
npm run build
```

## Key documentation

- [Project guide and Claude handoff](docs/PROJECT_GUIDE.md)
- [Claude instructions](CLAUDE.md)
- [Architecture](docs/architecture.md)
- [Roadmap](docs/roadmap.md)
- [Open-source dependency review](docs/open-source.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

## Key source files

- App state and interaction: `apps/web/src/main.js`
- PixiJS renderer: `apps/web/src/renderer.js`
- Raster brush: `apps/web/src/brush/raster-brush.js`, `apps/web/src/brush/raster-brush-canvas.js`
- Fill engine: `apps/web/src/fill/flood-fill.js`
- Vector line engine: `apps/web/src/line/line-engine.js`
- Screentone engine: `apps/web/src/tone/screentone.js`
- Tests: `tests/`

Keep provider API keys server-side. Never commit credentials or place them in browser code.
