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
- [x] Add frame-based vector-line snapshots with stable frame IDs.
- [x] Add frame insertion, duplication, deletion, and selection.
- [x] Add previous/next onion-skin ghost rendering.
- [ ] Add per-line animation settings, frame caching, and timeline keyframes.
- [ ] Evaluate Paper.js behind a line-engine adapter.

## Phase 3 — Tone Studio
- [x] Add halftone patterns: dots, gradient dots, lines, and crosshatch.
- [x] Separate screen spacing (frequency) from nominal mark-area coverage and opacity.
- [x] Support selection-clipped application to the active raster layer.
- [ ] Add non-destructive editable tone layers and calibrated print LPI/output controls.
- [ ] Add richer region- and layer-scoped tone workflows.

## Phase 4 — Motion Studio
- [x] Frame management for vector-line snapshots.
- [x] Previous/next onion-skin preview.
- [x] Frame playback and FPS timing controls.
- [x] Save and restore raster paint-layer snapshots independently per frame.
- [x] Layer movement keyframes and interpolation (see v1.2).
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

The browser drawing engine uses an in-house stamp (dab) raster brush with pencil, ink, marker, and brush profiles (v1.8; perfect-freehand was used before). It applies adjustable speed-responsive stabilization and consumes coalesced stylus samples where available. PixiJS displays the live brush outline. Line Boil uses arc-length sampling and local centerline normals. The stage supports smooth vector paths, custom colors, layer opacity/blend modes, independent raster cels, playback, and onion skin. Native PencilKit, tilt, advanced brush textures, isolated/nested layer groups, per-frame group and mask metadata, keyframes, and interpolation remain future work.

## Workspace UI — v1.1
- [x] Full-bleed canvas workspace: top tool bar, floating size/opacity sidebar, contextual popovers, bottom timeline track.
- [x] Brush library popover (vector and raster presets) opened by tapping the active paint tool again.
- [x] HSV color picker, eyedropper, layers listed top-first.
- [x] Multi-touch: two-finger pinch zoom/rotate/pan, two-finger tap undo, three-finger tap redo; cancelled strokes are discarded.
- [x] Timeline thumbnails, playhead marker, previous/next frame, pen/mouse scrubbing.
- [ ] Physical iPad/Apple Pencil validation of gestures and palm handling.

## Movement keyframes — v1.2
- [x] Per-layer movement track: position, rotation, scale, opacity keyframes (absolute ticks since v1.3).
- [x] Easing per segment (부드럽게, 일정하게, 점점 빠르게, 점점 느리게, 멈췄다 바뀜); geometric scale interpolation.
- [x] Applied as a presentation transform in PixiJS, export/composite, and painting input (pen/eraser/smudge map through the inverse transform).
- [x] 움직임 panel, canvas drag in movement-edit mode, timeline keyframe markers, separate undo/redo while editing movement.
- [ ] Fill, selection transforms and masks editing on moved layers still work in canvas space (fill is blocked with a message).
- [ ] Vector lines are not on layers yet, so they do not follow layer movement.
- [x] Held drawings (see v1.3).

## Drawing holds and tick timeline — v1.3
- [x] Each drawing has a hold (1–96 frames); playback, frame counter and timeline use frame ticks.
- [x] Timeline lane with tick ruler, playhead, drawings sized by hold, drag the active drawing's right edge or use − ＋ to change its hold.
- [x] Movement keyframes live at absolute ticks, so a held drawing keeps moving; playback evaluates movement at fractional ticks for smooth motion.
- [x] Multiple tracks (see v1.4).

## Multi-track timeline — v1.4
- [x] One track per raster layer plus a vector-line track, each with its own clips and holds.
- [x] Track rows in the timeline; drawing buttons, hold and stepping act on the selected track.
- [x] Clip loading only for tracks whose clip changes; decoded images cached per clip.
- [x] Layer thumbnails and move up/down in the layers panel (from #4); timeline tracks follow layers by id.
- [ ] Drag clips to reorder/move them, gaps that are not filled with empty clips.
- [ ] Raster onion skin; per-layer vector tracks (vector lines are still one shared track).
- [x] Deleting a drawing can be undone from the toast (되돌리기).
- [ ] Undo across clip changes and full undo history for timeline edits (insert/hold).

## Current next action

Next: add non-destructive live previews and transform handles; improve vector hit-testing to account for stroke width; then add isolated/nested group compositing. Add visual regression fixtures for antialiased fill boundaries before calling fill cleanup production-ready.


## Doodraw-inspired animated brushes — first implementation
- [x] Add per-stroke Wobbly/Wave, Boiling, Trio/Redraw, and Frame Echo/Flicker modes.
- [x] Keep the source vector path immutable; render animation as presentation-only geometry.
- [x] Animate selected per-stroke styles without requiring the global Line Boil toggle.
- [x] Use the same animated passes in the in-progress vector preview.
- [x] Per-line Speed and hand-drawn Rhythm (smooth, or 12/8/6/4 redraws per second); Jiggle = existing strength. (2nd pass)
- [x] Per-line Thickness pulse and vector Stabilization controls. (3rd pass)
- [x] Deterministic frame capture: export uses the same per-line motion as the screen, also with Line Boil off. (2nd pass)
- [ ] Add raster animated strokes and project-format migration tests.
- [x] Chalk and Crayon raster brushes with a canvas-anchored paper tooth. (2nd pass)
- [x] Particle brushes: spray, sparkle, stipple. (3rd pass)
- [ ] Pressure-dependent grain fill.
- [ ] Validate interaction and rendering on a physical iPad with Apple Pencil.
