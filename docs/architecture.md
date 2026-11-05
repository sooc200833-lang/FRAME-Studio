# FRAME Studio Architecture

## Product constraints
- iPad-first, dark interface.
- Large central canvas, timeline, contextual inspector, and compact tool strip.
- Original UI and assets; use other creative applications only as broad workflow inspiration.

## Workspace
- `apps/web`: Vite browser application.
- `apps/web/src/renderer.js`: PixiJS stage renderer.
- `apps/web/src/fill/flood-fill.js`: renderer-independent connected-region fill and edge-mask expansion.
- `apps/web/src/line/line-engine.js`: vector line data, hit testing, translation, and style operations.
- `apps/web/src/main.js`: drawing interactions, paint layers, vector strokes, and document state.
- `apps/ipad`: future native iPad client.
- `packages/document-model`: future shared document schema, layers, frames, and metadata.
- `packages/animation-engine`: future timeline, frames, keyframes, and playback.
- `packages/tone-engine`: future halftone and comic filters.
- `packages/3d-engine`: future primitives, assemblies, and line extraction.
- `services/ai-api`: future server-side provider proxy and usage controls.

## Rendering boundary
- PixiJS owns visible stage presentation.
- Editable raster paint remains in ordinary Canvas buffers.
- Editable vector lines remain plain document objects with stable IDs and point arrays.
- The PixiJS renderer draws raster layers and vector strokes but does not own the source document data.
- The fill engine operates on a composite image and does not depend on PixiJS.

## Raster and fill behavior
1. Composite visible raster layers and vector strokes into a temporary boundary image.
2. Sample the pixel under the user's tap.
3. Find the connected region using configurable RGBA tolerance.
4. Optionally expand the fill mask while protecting opaque upper-layer pixels and vector line pixels.
5. Apply the selected color to the active raster paint layer.
6. Record the operation for undo/redo.

## Vector line model
- The vector pen creates a stroke object containing a stable ID, point array, color, and width.
- Selection uses distance-to-segment hit testing, checking topmost strokes first.
- Moving a selected line changes its point coordinates without rasterizing its geometry.
- Color and width edits update the line object.
- Vector strokes are rendered by PixiJS and raster-composited for fill-boundary detection and PNG export.
- The raster eraser currently affects raster paint layers only; vector deletion is performed through line selection.

## Line Boil preview
- `apps/web/src/line/line-boil.js` creates deterministic, non-destructive line deformations from stable stroke IDs.
- A normal-direction displacement combines two sine waves; endpoint guards reduce movement at stroke ends.
- Preview controls adjust amplitude, pattern frequency, and playback speed.
- The original vector geometry remains unchanged and is used for fill boundaries and PNG export.
- This is a live preview foundation, not yet a frame-keyed animation system.

## Current implementation status
The web prototype includes raster drawing, connected-region fill, PixiJS rendering, editable vector line objects, line selection/movement/style editing, and PNG export. Node unit tests cover the fill and line-engine algorithms. Browser and iPad interaction testing remains a separate verification step.
\n\n## Animation timeline\n\nThe current Motion Studio MVP stores deep-copied vector stroke geometry in frame records. The active frame is edited in the Line Studio vector model. Previous and next frames are supplied to the renderer as non-editable tinted onion-skin overlays. Paint layers remain document-global until per-frame raster snapshots are implemented.\n