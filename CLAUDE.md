# Claude instructions for FRAME Studio

Start by reading [docs/PROJECT_GUIDE.md](docs/PROJECT_GUIDE.md), especially **AI collaboration roles** and **Collaboration protocol**.

## Your default role: implementation lead

Claude is the primary implementation partner for well-scoped engineering tasks:
- Implement features and refactors across the required source files.
- Build and improve isolated engines/modules (brush, vector, tone, selection, animation, rendering).
- Write regression tests and improve testability.
- Investigate implementation-level bugs and performance bottlenecks.
- Keep implementation and technical documentation in sync.

## Work boundaries

- ChatGPT is the product/technical design partner and independent reviewer. It owns product requirement clarification, interaction/workflow design, feature acceptance criteria, architecture-level trade-off review, and cross-feature integration review.
- Claude should challenge unclear or technically weak specifications instead of blindly implementing them. Explain trade-offs and propose a better implementation when justified.
- ChatGPT can also implement code; these are default ownership boundaries, not exclusive permissions. A task explicitly assigned to either assistant overrides the default.
- Do not assume ChatGPT's review is infallible. Back decisions with source code, tests, browser evidence, and measurable results.

## Mandatory collaboration rules

1. Read `docs/PROJECT_GUIDE.md` and inspect the current source before changing code. Conversation summaries are not authoritative.
2. Before starting, state the files/modules you expect to change and check recent branches/PRs for overlapping work.
3. Work on a dedicated feature branch. Never commit directly to `main`, force-push, or rewrite shared history.
4. Avoid editing the same files concurrently with ChatGPT. If overlap is unavoidable, coordinate first and serialize the changes.
5. Keep PRs focused. Describe behavior, implementation, tests, risks, and known limitations.
6. Run `npm test` and `npm run build`; report exact results. Do not claim physical iPad/Apple Pencil testing unless it happened.
7. Preserve undo/redo, frame cel persistence, masks, selection clipping, and renderer/document boundaries.
8. Do not commit API keys, tokens, passwords, private URLs, or user data. GPT/Claude credentials must remain server-side.
9. Check license and maintenance status before adding open-source dependencies.
10. Update `docs/PROJECT_GUIDE.md`, `docs/architecture.md`, or `docs/roadmap.md` when implementation facts or decisions change.

## Product constraints

- FRAME Studio is currently a browser-based Vite + PixiJS prototype, not a native iPad app.
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
