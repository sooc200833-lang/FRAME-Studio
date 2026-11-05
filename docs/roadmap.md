# FRAME Studio Roadmap

## Phase 0 — Repository foundation
- [x] Establish project goals and module boundaries.
- [x] Create a Vite-based web workspace.
- [x] Add a PixiJS renderer adapter with Canvas-backed paint buffers.
- [ ] Add a repeatable automated test and release process.

## Phase 1 — Drawing and area fill
- [x] Composite visible layers to identify color boundaries.
- [x] Flood-fill the connected region at the tapped pixel.
- [x] Write the result to the active paint layer without modifying source line art.
- [x] Expose fill tolerance.
- [x] Add protected edge expansion beneath upper line art.
- [x] Add Node unit tests for fill region detection and edge protection.
- [ ] Refine antialias cleanup with visual regression fixtures.

## Phase 2 — Line Studio
- [x] Store new vector strokes as independently identified line objects.
- [x] Select individual strokes with distance-based hit testing.
- [x] Move selected strokes without rasterizing their geometry.
- [x] Edit selected stroke color and width; delete selected strokes.
- [x] Include vector strokes in fill-boundary composites and PNG export.
- [ ] Add per-line texture and pressure profiles.
- [x] Add deterministic Line Boil deformation with stable per-line phase seeds.
- [x] Add live preview controls for amplitude, pattern frequency, and playback speed.
- [x] Add frame-based vector-line snapshots with stable frame IDs.\n- [x] Add frame insertion, duplication, deletion, and selection.\n- [x] Add previous/next onion-skin ghost rendering.\n- [ ] Add per-line animation settings, frame caching, and timeline keyframes.
- [ ] Evaluate Paper.js behind a line-engine adapter.

## Phase 3 — Tone Studio
- Add halftone patterns, tone density, gradients, and comic-oriented filters.
- Support region- and layer-scoped effects.

## Phase 4 — Motion Studio
- Timeline, frame management, keyframes, playback, and onion-skin workflow.
- Reuse the same document model as the drawing engine.

## Phase 5 — 3D Studio
- Combine primitives into editable figure-like assemblies.
- Convert 3D geometry into adjustable 2D line art.
- Keep 3D source geometry editable after line conversion.
- Evaluate Three.js as an isolated 3D viewport.

## Phase 6 — AI Studio
- Support GPT and Claude through a server-side API proxy.
- Keep API credentials out of browser code, project files, and Git history.
- Add explicit user controls for model choice and usage limits.

## Phase 7 — Native iPad
- PencilKit/Metal-based input and rendering where appropriate.
- Pressure, tilt, palm rejection, and low-latency interaction.
- Maintain compatibility with the shared project document format.

## Current next action

Run the Vite prototype on a desktop browser and an iPad browser. Verify pen, eraser, line, layer visibility, fill boundaries, undo/redo, and PNG export. Do not mark edge expansion complete until it has dedicated tests for antialiased and imperfect line boundaries.
