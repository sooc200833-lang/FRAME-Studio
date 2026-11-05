# FRAME Studio — Project Guide for AI Collaborators

> Read this file before making changes. It is the canonical handoff document for Claude and other AI coding assistants. If this guide conflicts with the running code, inspect the code and tests, then update this guide in the same change.

## 1. Product vision

FRAME Studio is an iPad-first digital drawing, comic-art, and 2D animation workspace with a dark, compact creative-app interface. The long-term direction is a serious drawing application rather than a collection of image filters.

The product is intended to grow toward:
- Responsive raster drawing with a natural stylus feel.
- Editable vector line art and comic-specific line/tone tools.
- Layers, masks, selections, transforms, and color workflows.
- Frame-based animation, onion skin, playback, and eventually keyframes.
- A 3D primitive/figure assembly workspace that can produce editable 2D line art.
- Optional GPT and Claude assistance through a secure server-side integration.

Use other creative apps only as broad workflow inspiration. Keep FRAME Studio's UI, visual identity, and implementation original.

## 2. Current reality — do not overstate

**The repository currently contains a browser-based Vite + PixiJS prototype. It is not a native iPad app and is not yet an App Store product.** The UI is designed around an iPad-first workflow, but actual Apple Pencil latency, tilt/azimuth, palm rejection, memory use, and touch ergonomics still require physical-device testing.

- Canvas/document coordinates: 1200 × 900.
- Stage presentation: PixiJS 8.20.1.
- Raster paint buffers: HTML Canvas 2D.
- Brush outline generation: perfect-freehand 1.2.3.
- App entry point: `apps/web/src/main.js`.
- Current project scripts: `npm run dev`, `npm test`, `npm run build`.
- Node requirement from package metadata: Node.js 20.19+ or 22.12+.
- The current app seeds a demo drawing at startup in `main.js`; do not mistake it for user document content.

Always distinguish code-level tests from visual browser checks and physical iPad tests. Never claim a deployment, device test, or performance improvement unless it was actually verified.

## 3. Existing implementation

### Drawing and input
- Raster pen and eraser on Canvas-backed layers.
- Brush profiles: pencil, ink, marker, and brush.
- perfect-freehand variable-width stroke polygons.
- Pointer pressure when the browser supplies pen pressure; fallback behavior for mouse/touch.
- Coalesced pointer samples and configurable stroke stabilization.
- Brush texture support and frame-scheduled preview rendering.

### Vector line studio
- Independent vector stroke objects with stable IDs.
- Hit testing, selecting, moving, color/width editing, deleting.
- Node insertion/removal/smoothing primitives and node editing UI.
- Quadratic curve presentation.
- Deterministic, non-destructive Line Boil preview.
- Vector graphics cache in the PixiJS renderer.

### Color and paint
- Custom color picker, categorized palettes, recent colors.
- Raster layer opacity and blend modes.
- Layer duplication/deletion and folder-group membership.
- Raster layer masks with separate undo/redo.
- Flood fill with tolerance and protected edge expansion beneath line art.
- PNG export/compositing.

### Selection and transforms
- Rectangular marquee and freeform lasso.
- Active-layer pixel movement and rectangular resize with eight edge/corner handles and a rotation control.
- Move, resize, and rotation gestures show a live raster-content preview without mutating the source layer until pointer release.
- Pointer cancellation restores the source display; the committed operation remains covered by the existing layer undo snapshot.
- Rectangular marquee rotation converts the boundary to a freeform polygon; lasso movement now previews the clipped raster pixels live and commits on release.
- Lasso pointer cancellation restores the original polygon and source pixels; lasso-specific resize/rotate handles remain future work.
- Rotation/scale transform across selected raster layers.
- Intersecting vector strokes can participate as whole objects.
- Grouped raster/vector undo and redo for multi-target transforms.
- Selection feathering and some cross-layer selection workflows remain incomplete.

### Animation
- Frame management, duplication, deletion, selection.
- Raster cel snapshots per frame.
- Vector-line snapshots per frame.
- Onion-skin ghosts and playback/FPS controls.
- This is an early animation system; keyframes and interpolation are not implemented.

### Manga screentone
- Dedicated MANGA · SCREENTONE controls currently live inside the **도구 (Tools)** inspector panel.
- Implemented patterns: dots, gradient dots, lines, crosshatch.
- Controls: spacing, dot/line size, angle, opacity, selected color.
- Apply writes pixels directly into the active raster layer.
- If a selection polygon exists, the effect is clipped to it; otherwise it affects the whole active layer.
- It participates in the raster layer's existing undo snapshot flow.
- This is currently destructive raster application, not a live/non-destructive tone layer.
- There is no independent tone coverage percentage or calibrated LPI control yet. Do not describe opacity as tone coverage: opacity and dot-area coverage are different concepts.

## 4. Code map

| Path | Responsibility |
|---|---|
| `apps/web/index.html` | App shell and inspector markup |
| `apps/web/src/main.js` | App state, input events, UI bindings, layer/frame operations, export |
| `apps/web/src/renderer.js` | PixiJS stage and raster/vector presentation |
| `apps/web/src/renderer/vector-graphics-cache.js` | Stable vector Graphics cache |
| `apps/web/src/brush/brush-engine.js` | Brush presets, pressure, smoothing, pointer sampling |
| `apps/web/src/fill/flood-fill.js` | Renderer-independent fill algorithms |
| `apps/web/src/line/line-engine.js` | Vector stroke geometry and editing helpers |
| `apps/web/src/line/line-boil.js` | Deterministic line deformation |
| `apps/web/src/tone/screentone.js` | Screentone normalization and Canvas application |
| `apps/web/src/selection/selection.js` | Selection geometry and transforms |
| `apps/web/src/animation/timeline.js` | Frame/timeline data operations |
| `apps/web/src/animation/frame-cels.js` | Raster cel normalization |
| `apps/web/src/viewport/coordinates.js` | Pointer-to-canvas coordinate conversion |
| `apps/web/src/styles.css` | Dark UI styling and responsive layout |
| `tests/` | Node built-in test runner unit tests |
| `docs/architecture.md` | Architecture notes |
| `docs/roadmap.md` | Planned and completed product work |
| `docs/open-source.md`, `THIRD_PARTY_NOTICES.md` | Dependency/license tracking |

The current architecture is intentionally pragmatic: app state and much of the UI orchestration are in `main.js`. Extract modules only when doing so creates a clear boundary and can be tested independently; avoid large rewrites merely for stylistic reasons.

## 5. Architecture rules

1. Keep domain algorithms independent of PixiJS and DOM where practical. Prefer pure functions for geometry, normalization, and calculations.
2. Canvas layers are the editable raster source of truth. PixiJS is the presentation renderer, not the document model.
3. Vector strokes remain editable objects; do not silently rasterize them during ordinary vector editing.
4. Preserve stable IDs for persistent objects such as vector strokes, layers, and frames.
5. Keep preview/transient graphics separate from committed document content.
6. Respect the existing undo/redo conventions. A user-visible destructive operation must be undoable.
7. Save frame cel snapshots when an operation changes frame content; avoid accidental cross-frame leakage.
8. Respect masks, visibility, opacity, blend mode, and selection clipping when touching compositing paths.
9. Do not introduce a second rendering or state architecture without documenting the migration and compatibility plan.
10. Keep UI controls touch-friendly and readable at iPad-sized viewports; avoid tiny desktop-only controls.

## 6. AI collaboration roles

The project uses a two-assistant workflow with one shared source of truth: this GitHub repository. These are default ownership boundaries, not claims that one model is universally better. Either assistant may take a task explicitly assigned to it.

### ChatGPT — product/technical design partner and independent reviewer

Default responsibilities:
- Translate the user's product ideas into precise requirements and acceptance criteria.
- Design workflows, tool organization, inspector/navigation structure, and iPad-oriented UI/UX.
- Define expected behavior and edge cases before implementation.
- Review architecture boundaries and trade-offs across drawing, vector, tone, layers, selection, animation, and future 3D workflows.
- Review Claude's PRs against the requirements, inspect diffs, identify regressions, and request targeted fixes.
- Coordinate integration across features and maintain a coherent product roadmap.
- Implement code directly when explicitly assigned or when a focused change is more efficient to complete directly.

Expected deliverables:
- Feature specification and acceptance checklist.
- UI/workflow proposal where relevant.
- Independent code review with concrete file/line references and reproducible concerns.
- Integration and regression test plan.

### Claude — implementation lead

Default responsibilities:
- Implement well-scoped features and refactors in the codebase.
- Build isolated, testable engines/modules for brush, vector geometry, screentone, selection, animation, and rendering.
- Investigate implementation-level bugs and performance bottlenecks.
- Write unit/regression tests and improve module boundaries where justified.
- Keep implementation details and technical documentation aligned with shipped behavior.

Expected deliverables:
- Focused feature branch and pull request.
- Implementation summary and changed-file list.
- Tests added/updated and exact test/build results.
- Known limitations and any browser/device checks not performed.

### Shared responsibilities

Both assistants can:
- Research and compare open-source libraries, verify licenses, and evaluate integration costs.
- Review complex algorithms and propose alternative approaches.
- Work on high-risk systems such as brush input, vector editing, compositing, undo/redo, and animation.
- Challenge incorrect assumptions and correct each other's proposals using code and evidence.

For critical systems, prefer a two-pass process: one assistant implements; the other independently reviews. Do not have both assistants make simultaneous edits to the same files.

## 7. Collaboration protocol

### Before editing
1. Read this guide, `README.md`, relevant architecture/roadmap sections, and the exact source files involved.
2. Check current `main`, recent commits, open PRs, and active branches. Do not assume an earlier chat summary reflects the current repository.
3. Confirm the task's owner and whether another assistant is editing overlapping files.
4. Trace the complete user interaction from HTML control → event binding → state/algorithm → canvas/document mutation → renderer refresh → undo/frame persistence.
5. Define acceptance criteria and identify neighboring tests.

### While editing
- Make the smallest complete change that solves the requested task.
- Preserve Korean UI wording and the existing dark visual language unless the task requests a redesign.
- Keep functions and controls named consistently with existing code.
- Add or update unit tests for pure logic and regression cases.
- Handle invalid inputs and missing browser APIs gracefully.
- Avoid adding dependencies unless there is a concrete benefit. Check license and maintenance status before adopting an open-source library.
- Do not commit API keys, tokens, passwords, private URLs, or user data. Never put provider secrets in browser code; GPT/Claude calls must go through a future server-side proxy.
- Do not delete working features or demo/test fixtures without explaining why and updating documentation.
- If implementation reveals a flaw in the specification, stop and explain the conflict before making a broad or irreversible design change.

### After editing
1. Run `npm test`.
2. Run `npm run build`.
3. Inspect the diff for accidental unrelated changes, broken controls, stale docs, and accessibility regressions.
4. Report exactly what was tested. If browser interaction or physical iPad testing was not performed, say so.
5. Work on a feature branch and open a PR to `main`; do not force-push or rewrite shared history.
6. The other assistant should review critical PRs before merge. Do not merge until required CI checks pass and review concerns are resolved.
7. After merge, verify the relevant files on `main` and update this guide if the project state changed.

### Git coordination
- One task = one owner = one feature branch = one PR.
- Never let two assistants independently modify the same file at the same time.
- Prefer separate PRs for independent features. If changes depend on each other, merge the prerequisite first and rebase/update the follow-up branch safely.
- Treat `main` as the shared, reviewed baseline. The GitHub repository—not either assistant's chat history—is the source of truth.

## 7. Test and development commands

```bash
npm install
npm run dev
npm test
npm run build
npm run preview
```

Tests use Node's built-in `node:test` runner. Keep tests deterministic and avoid requiring a real browser for pure algorithm tests. For Canvas integration, separate the pure math from the browser adapter where possible.

## 8. Known limitations and design risks

- Browser prototype only; no native iPad/PencilKit implementation.
- No verified Apple Pencil tilt, azimuth, hover, palm rejection, or device latency.
- No proof of sustained performance on large canvases or complex documents.
- Some document concepts (nested/isolated groups, per-frame group/mask metadata) are incomplete.
- Animation keyframes/interpolation are not implemented.
- Tone is currently destructive raster output; no editable tone objects/layers.
- Tone controls currently expose spacing, size, angle, opacity; no separate coverage percentage or calibrated LPI.
- Selection feathering and some multi-layer/lasso workflows are incomplete.
- AI provider integration is a roadmap item; do not expose API credentials in client code.
- Review `docs/roadmap.md` and the source before assuming any unchecked item is complete.

## 9. Near-term product priorities

When prioritizing work, favor foundations that make the app reliable as a drawing program:

1. Improve brush/viewport accuracy and stylus interaction, with reproducible tests.
2. Make layer, selection, mask, and undo behavior predictable and consistent.
3. Improve vector editing and non-destructive transform previews.
4. Evolve manga tones toward independent coverage and density controls, tone shapes, reversible/editable application, and print-aware output.
5. Complete animation data consistency before adding complex timeline features.
6. Define a shared document format before native iPad and 3D clients diverge.
7. Add secure AI assistance only after defining a server-side credential and privacy model.

## 10. Product decisions to preserve

- Product name: FRAME Studio.
- Primary target: iPad-first drawing/animation workflow.
- Visual direction: dark interface, compact tool strip, large central canvas, contextual inspector, bottom timeline.
- The user values polished, practical drawing tools and asks for actual implementation plus validation—not just mockups or feature promises.
- Treat requested features as product requirements, but verify technical feasibility and current code before claiming completion.

---
Last updated: 2026-11-06
