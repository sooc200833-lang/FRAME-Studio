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
- [x] Add rectangular raster marquee selection with move and resize transforms on the active layer.
- [x] Add freeform lasso selection with polygon hit testing and active-layer pixel movement committed on pointer release.
- [x] Add active-raster selection rotation and scale transforms.
- [x] Add multi-layer raster selection transforms with grouped undo/redo.
- [x] Add vector stroke selection transforms with grouped raster/vector undo and redo.
- [ ] Add per-line texture and pressure profiles.
- [x] Add deterministic Line Boil deformation using arc-length sampling and each point's local centerline normal.
- [x] Add live preview controls for amplitude, spatial wave scale, and playback speed.
- [x] Smooth vector path rendering with quadratic curves in the stage and PNG export.
- [x] Add expanded color palette and custom color picker.
- [x] Add layer opacity, blend modes, duplication, and deletion.
- [x] Add non-destructive alpha masks with pen-to-hide and eraser-to-reveal editing.
- [x] Apply layer masks in PixiJS display compositing and PNG export.
- [x] Add layer folder groups with membership controls, visibility, opacity, and blend settings.
- [ ] Add isolated group compositing, nested folders, and per-frame group metadata.
- [x] Add frame-based vector-line snapshots with stable frame IDs.\n- [x] Add frame insertion, duplication, deletion, and selection.\n- [x] Add previous/next onion-skin ghost rendering.\n- [x] Add frame-based vector-line snapshots with stable frame IDs.
- [x] Add frame insertion, duplication, deletion, and selection.
- [x] Add previous/next onion-skin ghost rendering.
- [ ] Add per-line animation settings, frame caching, and timeline keyframes.
- [ ] Evaluate Paper.js behind a line-engine adapter.

## Phase 3 — Tone Studio
- Add halftone patterns, tone density, gradients, and comic-oriented filters.
- Support region- and layer-scoped effects.

## Phase 4 — Motion Studio
- [x] Frame management for vector-line snapshots.
- [x] Previous/next onion-skin preview.
- [x] Frame playback and FPS timing controls.
- [x] Save and restore raster paint-layer snapshots independently per frame.
- [ ] Keyframes and timeline interpolation.
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

## Phase 7 — Native iPad and input quality
- [x] Add browser Pointer Events stylus pressure mapping for raster pen and eraser strokes.
- [x] Integrate MIT perfect-freehand 1.2.3 to generate variable-width pressure-aware raster brush polygons.
- [x] Add configurable stroke stabilization with speed-responsive smoothing.
- [x] Add four brush profiles (pencil, ink, marker, brush) with distinct size, pressure, opacity, smoothing, and streamline dynamics.
- [x] Consume coalesced pointer samples when the browser provides them.
- [ ] Add tilt/azimuth response, palm rejection, and native low-latency PencilKit/Metal input.
- Maintain compatibility with the shared project document format.

## Current status — v1.0

The browser drawing engine uses perfect-freehand 1.2.3 to generate pressure-aware variable-width raster pen and eraser polygons, with pencil, ink, marker, and brush profiles. It applies adjustable speed-responsive stabilization and consumes coalesced stylus samples where available. PixiJS displays the live brush outline. Line Boil uses arc-length sampling and local centerline normals. The stage supports smooth vector paths, custom colors, layer opacity/blend modes, independent raster cels, playback, and onion skin. Native PencilKit, tilt, advanced brush textures, isolated/nested layer groups, per-frame group and mask metadata, keyframes, and interpolation remain future work.

## Current next action

Next: add non-destructive live previews and transform handles; improve vector hit-testing to account for stroke width; then add isolated/nested group compositing. Add visual regression fixtures for antialiased fill boundaries before calling fill cleanup production-ready.
