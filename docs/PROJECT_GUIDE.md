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
- Raster brush: in-house stamp (dab) engine (`brush/raster-brush.js`, `brush/raster-brush-canvas.js`); perfect-freehand was removed in v1.8.
- App entry point: `apps/web/src/main.js`.
- Current project scripts: `npm run dev`, `npm test`, `npm run build`.
- Node requirement from package metadata: Node.js 20.19+ or 22.12+.
- The current app seeds a demo drawing at startup in `main.js`; do not mistake it for user document content.

Always distinguish code-level tests from visual browser checks and physical iPad tests. Never claim a deployment, device test, or performance improvement unless it was actually verified.

## 3. Existing implementation

### Workspace UI (v1.1)
- Full-bleed canvas with a top tool bar: left group = 작업 (export/view/gestures), 효과 (line boil, screentone), 선택 (marquee/lasso), 변형 (vector select), 채우기, 도형 (line/shape), 손; right group = 그리기 (vector or raster), 스머지, 지우개, 레이어, 색상.
- Tapping the already-active paint/smudge/eraser/selection tool opens its popover (brush library, settings). Tapping outside closes it; a canvas tap that closes a popover does not draw.
- Floating left sidebar: vertical brush size, eyedropper, vertical opacity (drives vector or raster opacity depending on the active tool), undo/redo.
- Popovers live in `index.html` (`.popover` sections); `bindWorkspaceUi`, `setTool`, `togglePopover`, `syncBrushUi` in `main.js` own the wiring. All previous control ids were kept.
- Gestures (`viewport/gestures.js`, pure): two-finger pinch zoom/rotate/pan anchored at the finger midpoint, two-finger tap undo, three-finger tap redo. A second finger cancels the in-progress stroke via the `pointercancel` path, which now discards partial pen/eraser/vector/line/shape strokes. Touch fills are deferred to release.
- Color (`color/color-utils.js`, pure): hex/HSV conversion for the HSV picker and neighborhood sampling for the eyedropper.
- Keyboard: B/S/E/V/H/G tools, I eyedropper, [ ] size, Space play, ⌘Z/⇧⌘Z.
- Freehand vector strokes are no longer left selected after drawing, so brush/color changes apply to the next stroke rather than restyling the previous one.
- Verified in headless Chrome (layout at 1180×820 and 390×844, synthetic touch pinch/undo, eyedropper). Not yet verified on a physical iPad.

### Raster brush v2 (v1.8)
- Rebuilt from scratch at the user's request. `brush/raster-brush.js` (pure, tested) turns pointer samples into evenly spaced dabs: spacing is a fraction of the dab diameter and carries across samples (independent of pointer sample rate); streamline smoothing; pressure curve; pressure→size and pressure→flow per preset; mouse/finger use full pressure; the stroke ends exactly at the last pen sample (pen-up pressure 0 is ignored).
- Presets: 연필 (grain tip, pressure→opacity), 잉크 펜 (hard, pressure→size), 마커 (flat opacity cap per stroke), 브러시 (soft). 획 안정화 adds to each preset's streamline.
- `brush/raster-brush-canvas.js`: tinted tip cache, `StrokeBuffer` stamps dabs; `rasterStrokeMode()` in main.js is the single source of composite operation/alpha/selection clip used by both the live preview (`renderer.setLayerPreview`) and the commit, so the preview equals the result. Strokes are clipped to the active selection. Mask editing stamps into the mask live (paint hides, erase reveals). Cancelled strokes (palm/gesture) leave no pixels and no undo entry.
- Removed: perfect-freehand dependency, polygon outline/texture code, renderer brush preview texture.

### Layers own their vector lines (v1.7)
- Vector lines belong to a layer: each stroke has `layerId`, and every layer track clip stores both `cel` (pixels) and `strokes`. The shared vector track was removed; project format v2 migrates an old vector track into a new top layer "벡터 선" with the same timing.
- Renderer: one container per layer (raster sprite + that layer's lines), so visibility, opacity (applied to the whole layer via `AlphaFilter`), blend mode, stacking order and movement keyframes apply to lines too. Display objects of deleted layers are now removed (previously they stayed on screen).
- Live state: `vectorStrokes` holds the loaded lines of all layers; `syncClipsToPlayhead` swaps only the lines of layers whose clip changed; `persistVectorClip` writes each layer's lines into its loaded clip. Line ids stay unique (duplicated layers re-id lines; `nextLineId` is raised above saved ids after loading).
- Lines on hidden layers can't be picked; picking a line activates its layer; selection transforms only move lines on the target layers. Vector drawing on a moved layer is mapped into layer space.
- Known gaps: picking/node-editing lines on a layer with movement keyframes uses canvas space; 비우기 clears pixels only.

### Project saving (v1.5)
- `document/project-format.js` (pure, tested): project JSON v1 — layers (id, name, visibility, opacity, blend, group, mask flag, movement keyframes), groups, tracks/clips (hold, transform records, vector strokes), fps, playhead, id counters, thumbnail. Clip cels and layer masks are stored separately by image key (`<projectId>/clip/<clipId>`, `<projectId>/mask/<layerId>`). `parseProjectDocument` validates, drops broken parts and keeps id counters above saved ids; `migrateProjectDocument` is the hook for future versions.
- `document/project-store.js` (browser): IndexedDB `frame-studio` with `projects`, `images` (Blobs), `meta` (`lastProjectId`). One transaction per save writes the document, changed images and deletes unreferenced images. Requests persistent storage.
- `main.js`: autosave 1.5 s after the last render, never mid-stroke/clip load/playback; also on `visibilitychange: hidden` and `pagehide`. Only images whose data URL changed since the last save are written. Startup restores the last project. 작업 popover: project name, 새 작품 시작, list of saved projects to open. HUD shows save state.
- Not yet: deleting/duplicating projects, import/export of project files, thumbnails of non-visited clips after reload.

### Multi-track timeline (v1.4)
- `animation/tracks.js` (pure) replaces the old single frame list. `timeline.tracks[trackId].clips` — one track per raster layer (`layer.id`, stable `layer-N`) plus the shared vector-line track (`'vector'`). Clips lie end to end from tick 0; each has `hold` (1–240 ticks), raster `cel`/`transformCel` or vector `strokes`. Tracks are independent: a background clip can hold 24 frames while a character track changes every 2.
- `timeline.playhead` is the current tick; timeline length is the longest track. Past a track's end that layer shows nothing; drawing there creates a clip (`ensureEditableClip` → `ensureClipAt`).
- `loadedClips` maps track → clip currently held by the live layer canvas / `vectorStrokes`. `saveActiveFrame()` writes the live canvases back into those clips; `syncClipsToPlayhead()` loads only tracks whose clip changed (decoded images cached per clip). New layers adopt their blank clip on the next save.
- Layer pixel undo stacks and vector line undo are cleared when that track's clip changes (snapshots belong to one clip).
- Timeline UI (`drawTimeline`): ruler, one row per track (vector first, then layers top-first), clip cells sized by hold with thumbnails, playhead. Selecting a row (or drawing on it) makes it the current track; ＋ / 복제 / 삭제 / − ＋ / grip / prev-next act on the current track only.
- Playback advances a fractional tick and loads clips without re-saving; layer movement transforms update every animation frame.
- Onion skin shows the vector track's previous/next clips.

### Movement keyframes (v1.2)
- `animation/motion.js` (pure): keyframes `{tick, x, y, rotation, scale, opacity, easing}` stored on `layer.motionTrack`, evaluated at the playhead tick (fractional while playing); values are held before the first/after the last keyframe.
- `applyGroupState()` sets `layer.renderMotion`, `layer.renderMatrix` (null when identity) and multiplies motion opacity into `renderOpacity`. The renderer applies `renderMatrix` to layer sprites; `composite()` applies it for export, thumbnails, eyedropper.
- Pen/eraser/smudge input maps through the inverse matrix (`position()`); `stagePosition()` is the raw canvas point. The live preview container follows the active layer matrix. Fill is blocked on moved layers.
- 움직임 panel (timeline 움직임 button, shortcut M): sliders create/update the keyframe at the current frame, canvas drag in movement-edit mode moves the layer, undo/redo act on movement history while editing movement.
- Raster pixels, cels and transform records are never modified by movement.

### Drawing and input
- Vector node/Bezier handles and their hit targets are sized in CSS pixels (`canvasUnitsPerCssPixel`, `cssToCanvasUnits`, `renderer.setHandleScale`) so they stay the same physical size at every zoom (ported from #29).
- Raster pen and eraser on Canvas-backed layers.
- Brush profiles: pencil, ink, marker, and brush.
- Stamp-based raster brush: evenly spaced round dabs with hardness, grain, pressure→size/flow, streamline; one stroke buffer used for both live preview and commit.
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
- Rectangular marquee and freeform lasso support direct move/resize/rotation gestures with live raster-content previews.
- The layer-list transform checkboxes determine which raster layers participate; if none are checked, only the active layer is transformed.
- All selected layers preview the same geometry independently, commit together on release, and use grouped undo/redo.
- The source layers remain unchanged during the gesture; pointer cancellation restores every layer's original display.
- Pointer cancellation restores the source display; the committed operation remains covered by the existing layer undo snapshot.
- Rectangular marquee rotation converts the boundary to a freeform polygon; lasso movement now previews the clipped raster pixels live and commits on release.
- Lasso selections expose eight bounding-box resize handles and a rotation handle; the freeform polygon shape is proportionally resized or rotated around its centroid.
- Lasso move/resize/rotate gestures preview clipped raster pixels live and commit to all checked target layers on release.
- Rotation/scale transforms from the inspector and direct selection handles share the same checked-layer target list.
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
- Controls: spacing (screen frequency), nominal mark-area coverage, angle, opacity, selected color. Dot radius is derived from spacing and coverage; opacity remains an independent alpha setting.
- Apply writes pixels directly into the active raster layer.
- If a selection polygon exists, the effect is clipped to it; otherwise it affects the whole active layer.
- It participates in the raster layer's existing undo snapshot flow.
- This is currently destructive raster application, not a live/non-destructive tone layer.
- Independent nominal coverage percentage is available separately from spacing and opacity. Calibrated print LPI output and non-destructive tone layers are not implemented. Do not describe opacity as tone coverage: opacity and dot-area coverage are different concepts.

## 4. Code map

| Path | Responsibility |
|---|---|
| `apps/web/index.html` | App shell and inspector markup |
| `apps/web/src/main.js` | App state, input events, UI bindings, layer/frame operations, export |
| `apps/web/src/renderer.js` | PixiJS stage and raster/vector presentation |
| `apps/web/src/renderer/vector-graphics-cache.js` | Stable vector Graphics cache |
| `apps/web/src/brush/brush-engine.js` | Pointer helpers: pressure, smoothing, coalesced samples, frame scheduler |
| `apps/web/src/brush/raster-brush.js` | Raster brush v2: presets and dab placement (pure) |
| `apps/web/src/brush/raster-brush-canvas.js` | Raster brush v2: tips, stroke buffer, preview/commit compositing |
| `apps/web/src/fill/flood-fill.js` | Renderer-independent fill algorithms |
| `apps/web/src/line/line-engine.js` | Vector stroke geometry and editing helpers |
| `apps/web/src/line/line-boil.js` | Deterministic line deformation |
| `apps/web/src/tone/screentone.js` | Screentone normalization and Canvas application |
| `apps/web/src/selection/selection.js` | Selection geometry and transforms |
| `apps/web/src/document/project-format.js` | Project document format, validation, migration |
| `apps/web/src/document/project-store.js` | IndexedDB project storage |
| `apps/web/src/animation/tracks.js` | Multi-track timeline: tracks, clips, holds |
| `apps/web/src/animation/motion.js` | Layer movement keyframes and matrices |
| `apps/web/src/animation/frame-cels.js` | Raster cel normalization |
| `apps/web/src/viewport/coordinates.js` | Pointer-to-canvas coordinate conversion |
| `apps/web/src/viewport/gestures.js` | Pinch viewport math and multi-touch tap shortcuts |
| `apps/web/src/color/color-utils.js` | Hex/HSV conversion and eyedropper sampling |
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

Updated 2026-11-07 at the user's request. The project uses two assistants with one shared source of truth: this GitHub repository. **Claude owns the product and the codebase.** ChatGPT works only in areas where a mistake is cheap to notice and cheap to undo. Either assistant may take any task the user explicitly assigns to it; an explicit assignment overrides this section.

### Claude — product and engineering lead (default owner of almost everything)

Responsibilities:
- Turn the user's ideas into specifications, acceptance criteria and UI/workflow designs, and confirm direction with the user before large changes.
- Own architecture and all core systems: document model and saving, timeline/tracks, movement keyframes, undo/redo, rendering, pointer/pencil input, brush/vector/tone/selection engines, export, performance.
- Implement features and refactors, write tests, run browser checks, maintain `docs/PROJECT_GUIDE.md`, `docs/architecture.md`, `docs/roadmap.md` and `docs/planning/`.
- Triage and fix bugs, including those reported by ChatGPT or the user.
- Merge PRs to `main` after CI passes and the user has agreed (a "go ahead" in chat is enough).
- Decide whether to apply ChatGPT's suggestions; ChatGPT reviews are advisory, not gates.

Deliverables per task: focused branch and PR, behavior/implementation/tests/limitations in the PR description, exact `npm test` and `npm run build` results, and a clear statement of what was not tested (for example physical iPad).

### ChatGPT — low-risk contributor and second pair of eyes

ChatGPT works on tasks where a wrong answer causes little harm: the result is text or data that is easy to review, does not change how drawings are stored or edited, and can be reverted with one commit.

ChatGPT may **edit directly** (small PRs, one topic each):
- User-facing writing: `README.md`, user guide and help pages under `docs/user/`, release notes/changelog, workstream notes under `docs/workstreams/`.
- Proposals for Korean UI wording (labels, tooltips, toasts, gesture help) collected in `docs/copy/ui-text.md`. Claude applies accepted wording to the app code.
- Test plans and manual QA checklists, especially iPad/Apple Pencil test scripts under `docs/qa/`, and filled-in results from manual testing the user performs.
- Research notes under `docs/research/`: library comparisons, license checks, how other drawing/animation apps handle a workflow (broad inspiration only — no copied assets or UI).
- Sample data proposals: palette presets, brush preset parameter suggestions, demo scene ideas (as documents; Claude wires them into code).

ChatGPT may **comment but not change**:
- Reviews of Claude's PRs (bugs, edge cases, wording, accessibility). Reviews are non-blocking; Claude responds and decides.
- Bug reports as GitHub issues with reproduction steps, expected vs actual behavior, device/browser.

ChatGPT should **not** change, unless the user explicitly assigns the task:
- Anything under `apps/web/src/` or `apps/web/index.html`, `tests/`, `.github/`, `package.json`/lockfile, `vite.config.js`.
- `CLAUDE.md`, `AGENTS.md`, and sections 2–7 of this guide.
- Repository operations: merging, closing others' PRs, deleting branches, force-pushing, changing settings.

### Why this split

Core systems (saving, timeline, undo, input, rendering) are tightly coupled: a plausible-looking change in one can silently corrupt drawings in another, and only shows up in long editing sessions. One owner for all of them avoids conflicting designs and overlapping edits. Writing, research, QA scripts and wording suggestions are valuable, easy to verify by reading, and harmless if wrong.

### Hand-off rules
- Files have one owner at a time. ChatGPT's directories (`docs/user/`, `docs/copy/`, `docs/qa/`, `docs/research/`, `docs/workstreams/`, `README.md`) are not edited by Claude while a ChatGPT PR touching them is open, and vice versa for everything else.
- When ChatGPT's work implies a code change (new wording, a bug, a QA failure), it opens an issue or adds to `docs/copy/ui-text.md`; Claude picks it up.
- If ChatGPT disagrees with a technical decision, it writes the concern on the PR or an issue with evidence; Claude answers with code, tests or measurements. The user breaks ties.

## 7. Collaboration protocol

### Before editing
1. Read this guide, `README.md`, relevant architecture/roadmap sections, and the exact source files involved.
2. Check current `main`, recent commits, open PRs, and active branches. Do not assume an earlier chat summary reflects the current repository.
3. Confirm the task is in your area (section 6) and that no open PR from the other assistant touches the same files.
4. Code changes (Claude): trace the complete user interaction from HTML control → event binding → state/algorithm → canvas/document mutation → renderer refresh → undo/frame persistence, and define acceptance criteria and neighboring tests.

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
1. Code changes: run `npm test` and `npm run build`; run a browser check for UI changes.
2. Inspect the diff for accidental unrelated changes, broken controls, stale docs, and accessibility regressions.
3. Report exactly what was tested. If browser interaction or physical iPad testing was not performed, say so.
4. Work on a feature branch and open a PR to `main`; do not force-push or rewrite shared history.
5. Merge only after required CI checks pass and the user has agreed. ChatGPT review comments are welcome but do not block merging.
6. After merge, verify the relevant files on `main` and update this guide if the project state changed.

### Git coordination
- One task = one owner = one branch = one PR.
- Never let two assistants modify the same file at the same time.
- Prefer separate PRs for independent features. If changes depend on each other, merge the prerequisite first and rebase/update the follow-up branch safely.
- Treat `main` as the shared baseline. The GitHub repository—not either assistant's chat history—is the source of truth.

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
- Tone controls expose spacing, nominal coverage percentage, angle, and opacity; calibrated LPI and editable tone objects/layers remain future work.
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
- Visual direction: dark interface, top tool bar, floating size/opacity sidebar, large central canvas, contextual popovers, bottom timeline.
- The user values polished, practical drawing tools and asks for actual implementation plus validation—not just mockups or feature promises.
- Treat requested features as product requirements, but verify technical feasibility and current code before claiming completion.

---
Last updated: 2026-11-06


## Non-destructive raster transforms
- Raster selection drags (lasso and marquee) and the inspector angle/scale action append affine transform records instead of overwriting the source layer pixels.
- Each layer keeps an original canvas and a composed presentation canvas; frame cels persist transform records and their source image snapshots.
- Undo/redo restores the transform records with the layer snapshot. The Layers panel exposes **변형 픽셀로 확정** to bake the composed result into the source canvas.
- Starting a raster paint/erase/line/fill action on a transformed layer creates a new layer above it, preserving the transform stack. Manga tone application follows the same rule.
- These changes are implemented on the non-destructive selection feature branch; browser and physical iPad/Apple Pencil interaction testing are still required.
