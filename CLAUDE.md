# Claude instructions for FRAME Studio

Start by reading [docs/PROJECT_GUIDE.md](docs/PROJECT_GUIDE.md). It is the project handoff and collaboration guide.

Core rules:
- The repository is currently a browser-based Vite + PixiJS prototype, not a native iPad app. Never claim physical iPad or Apple Pencil validation unless performed.
- Inspect current code and tests before editing; conversation summaries are not a substitute for repository state.
- Preserve the existing dark, iPad-first creative-app workflow and Korean UI.
- Make focused changes, add regression tests, and preserve undo/redo, frame cel persistence, masks, and renderer/document boundaries.
- Run `npm test` and `npm run build`; report actual results and any untested behavior.
- Use a feature branch and PR to `main`; do not force-push or rewrite shared history.
- Never commit secrets. GPT/Claude provider credentials must stay server-side, never in browser code.
- Check dependency licenses before adding open-source packages.
- Keep [README.md](README.md), [docs/architecture.md](docs/architecture.md), and [docs/roadmap.md](docs/roadmap.md) aligned with shipped behavior.
