# FRAME Studio

2D animation and 3D line-art studio, designed iPad-first with a dark interface.

## Product direction

FRAME Studio is an original drawing and animation application inspired by the broad workflow of modern digital-art tools. Its focus is comic production, editable line art, area-based coloring, line animation, and 3D-to-2D workflows.

## Current prototype

The web prototype now uses **PixiJS 8.20.1** for GPU-backed stage presentation while keeping editable paint buffers and the flood-fill engine on independent Canvas layers.

- PixiJS stage renderer adapter: `apps/web/src/renderer.js`
- Drawing tools and fill engine: `apps/web/src/main.js`
- Web entry point: `apps/web/index.html`

The renderer is deliberately isolated so the document and paint model can later be reused by native iPad and other front ends.

## Run locally

Requirements: Node.js 20.19+ or 22.12+.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. To create a production build:

```bash
npm run build
npm run preview
```

## Development status

- [x] Private GitHub repository connected
- [x] Vite project structure established
- [x] PixiJS stage renderer integrated
- [x] Separate line-art and paint layers
- [x] Visible-layer composite used for flood-fill boundaries
- [x] Fill tolerance control
- [ ] Add robust edge expansion and anti-alias cleanup to fill
- [ ] Add automated browser tests for drawing, fill, undo, and export
- [ ] Build independent vector line selection and Line Boil
- [ ] Add comic tone and filter tools
- [ ] Add timeline and keyframe animation
- [ ] Add 3D primitive assembly and 2D line conversion
- [ ] Add secure server-side GPT/Claude API integration
- [ ] Develop native iPad drawing support

## Architecture principles

1. Keep the drawing document format independent of the web and native iPad front ends.
2. Separate rendering, fill, line, tone, animation, and 3D modules.
3. Keep provider API keys on a server; never commit secrets to this repository.
4. Prefer small, testable changes with a clear commit history.

See [docs/roadmap.md](docs/roadmap.md), [docs/architecture.md](docs/architecture.md), and [docs/open-source.md](docs/open-source.md). Third-party dependency rules are tracked in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
