# FRAME Studio

2D animation and 3D line-art studio, designed iPad-first with a dark interface.

## Current web prototype

- PixiJS 8.20.1 GPU-backed stage renderer.
- Canvas-backed paint layers for raster pen, eraser, and connected-region fill.
- Separate vector line objects for the vector pen.
- Individual vector line selection, movement, color/width editing, and deletion.
- Vector strokes participate in fill-boundary compositing and PNG export.
- Node.js unit tests for fill and vector-line algorithms.

### Key files

- PixiJS renderer: `apps/web/src/renderer.js`
- Drawing interaction and document state: `apps/web/src/main.js`
- Flood-fill engine: `apps/web/src/fill/flood-fill.js`
- Vector-line engine: `apps/web/src/line/line-engine.js`
- Tests: `tests/`

## Run locally

Requirements: Node.js 20.19+ or 22.12+.

```bash
npm install
npm run dev
```

Run unit tests and production build:

```bash
npm test
npm run build
```

## Current development status

- [x] Vite project and PixiJS renderer
- [x] Raster paint layers and connected-region fill
- [x] Protected edge expansion beneath upper line art
- [x] Renderer-independent fill module and unit tests
- [x] Independent vector strokes with stable IDs
- [x] Individual line selection and movement
- [x] Selected line color/width editing and deletion
- [x] Vector lines included in fill boundaries and PNG export
- [ ] Pressure-sensitive vector strokes and brush textures
- [x] Live Line Boil preview with non-destructive deterministic deformation
- [ ] Per-line Line Boil settings, timeline keyframes, and frame caching
- [ ] Comic tone and filter tools
- [ ] Timeline, keyframes, and onion skin
- [ ] 3D primitive assembly and 2D line conversion
- [ ] Secure server-side GPT/Claude API integration
- [ ] Native iPad Pencil input and performance work

## Architecture principles

1. Keep the project document independent of the web and native iPad front ends.
2. Separate rendering, fill, line, tone, animation, and 3D modules.
3. Keep provider API keys on a server; never commit secrets to this repository.
4. Preserve third-party license notices and test each module independently.

See [docs/roadmap.md](docs/roadmap.md), [docs/architecture.md](docs/architecture.md), and [docs/open-source.md](docs/open-source.md). Third-party dependency rules are tracked in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).


## Motion Studio preview (v0.6)

- Vector-line snapshots are stored independently per frame.
- Add, duplicate, delete, and select animation frames from the bottom timeline.
- Toggle previous/next onion-skin ghosts (blue for previous, pink for next).
- This is an early vector-line animation MVP; paint-layer frame snapshots, playback, and keyframes are not implemented yet.
