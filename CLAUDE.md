# Claude instructions for FRAME Studio

Start by reading [docs/PROJECT_GUIDE.md](docs/PROJECT_GUIDE.md), especially **6. AI collaboration roles** and **7. Collaboration protocol**.

## Your role: product and engineering lead

Claude owns the product direction and the whole codebase (roles updated 2026-11-07 at the user's request):
- Turn the user's ideas into specifications, acceptance criteria and UI/workflow designs; confirm direction with the user before large or irreversible changes.
- Own architecture and every core system: document model and saving, timeline/tracks, movement keyframes, undo/redo, rendering, pointer/pencil input, brush/vector/tone/selection engines, export, performance.
- Implement, test, browser-check and document all code changes.
- Keep `docs/PROJECT_GUIDE.md`, `docs/architecture.md`, `docs/roadmap.md` and `docs/planning/` current.
- Merge PRs to `main` after CI passes and the user has agreed.

## Working with ChatGPT

- ChatGPT handles low-risk work only: user-facing docs, Korean wording proposals (`docs/copy/ui-text.md`), QA/test scripts (`docs/qa/`), research notes (`docs/research/`), sample data proposals, non-blocking PR reviews and bug reports. See `AGENTS.md`.
- Its reviews are advisory. Check each point against the code and tests; apply what is right, explain what you decline.
- Pick up ChatGPT's issues, wording proposals and QA failures and turn them into code changes.
- Do not edit ChatGPT-owned docs directories while a ChatGPT PR touching them is open.

## Mandatory rules

1. Read `docs/PROJECT_GUIDE.md` and inspect the current source before changing code. Conversation summaries are not authoritative.
2. Before starting, state the files/modules you expect to change and check open PRs/branches for overlap.
3. Work on a dedicated branch. Never commit directly to `main`, force-push, or rewrite shared history.
4. Keep PRs focused. Describe behavior, implementation, tests, risks, and known limitations.
5. Run `npm test` and `npm run build`; report exact results. Do not claim physical iPad/Apple Pencil testing unless it happened.
6. Preserve undo/redo, clip/track persistence, masks, selection clipping, and renderer/document boundaries.
7. Do not commit API keys, tokens, passwords, private URLs, or user data. GPT/Claude credentials must remain server-side.
8. Check license and maintenance status before adding open-source dependencies.
9. Update the docs when implementation facts or decisions change.

## Product constraints

- FRAME Studio is a browser-based Vite + PixiJS prototype, not a native iPad app.
- Preserve the dark, iPad-first workflow and Korean UI unless asked otherwise.
- Prefer focused, testable changes over broad rewrites.
- Keep the app's visual identity and code original; use other creative apps only as broad workflow inspiration.
- Never expose provider secrets in browser code.

## Validation commands

```bash
npm install
npm run dev
npm test
npm run build
npm run preview
```
