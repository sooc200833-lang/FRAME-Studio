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
- Raster layers may carry a separate alpha mask canvas; mask edits do not destructively modify the paint pixels.
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

## Raster brush engine
- `perfect-freehand` converts sampled pointer positions and pressure into a closed polygon with variable width.
- Apple Pencil-compatible Pointer Events pressure is passed through when available; mouse/touch input uses simulated pressure from movement speed.
- Stabilized and coalesced pointer samples feed the brush engine. The outline is previewed with PixiJS and committed to the active raster layer on pointer release.
- The brush geometry is renderer-independent; the current raster layer stores the final painted pixels. Brush presets, textured tips, wet-media simulation, and pressure response curves remain future work.

## Line Boil preview
- `apps/web/src/line/line-boil.js` creates deterministic, non-destructive line deformations from stable stroke IDs.
- A normal-direction displacement combines two sine waves; endpoint guards reduce movement at stroke ends.
- Preview controls adjust amplitude, pattern frequency, and playback speed.
- The original vector geometry remains unchanged and is used for fill boundaries and PNG export.
- This is a live preview foundation, not yet a frame-keyed animation system.

## Current implementation status
The web prototype includes raster drawing, connected-region fill, PixiJS rendering, editable vector line objects, line selection/movement/style editing, and PNG export. Node unit tests cover the fill and line-engine algorithms. Browser and iPad interaction testing remains a separate verification step.
\n\n## Animation timeline\n\nThe current Motion Studio MVP stores deep-copied vector stroke geometry in frame records. The active frame is edited in the Line Studio vector model. Previous and next frames are supplied to the renderer as non-editable tinted onion-skin overlays. Paint layers remain document-global until per-frame raster snapshots are implemented.\n

## Layer masks
- Each raster layer owns an optional mask canvas initialized to fully visible white.
- Mask painting uses alpha semantics: pen strokes erase mask alpha (hide paint), while eraser strokes paint opaque white back into the mask (reveal paint).
- PixiJS displays a masked presentation canvas while the source paint canvas remains intact.
- The document composite and PNG export apply the same mask, so the visible result is preserved outside the editor.
- Mask strokes have their own undo/redo snapshots. Masks are layer-level metadata shared by the current frame cels; per-frame masks and groups remain future work.


## Layer folder groups
- Raster layers may reference a document-level folder group by stable `groupId`.
- Folder groups provide visibility, opacity, and blend-mode controls; layers can be moved into or out of the selected folder without rasterizing their content.
- Effective group visibility, opacity, and blend settings are applied to PixiJS presentation and the raster composite used for fill and PNG export.
- Current group implementation is a flat folder list. Isolated group compositing, nested folders, and per-frame group metadata are not implemented yet.


## Raster selection and transform
- The marquee tool stores a rectangular selection in document coordinates and renders a dashed boundary plus a bottom-right resize handle in the PixiJS overlay.
- Dragging inside the boundary moves the selected raster pixels; dragging the handle scales the selected pixel region. The original pixels are extracted before clearing and redrawing, avoiding overlap corruption.
- Selection geometry helpers are isolated in `apps/web/src/selection/selection.js` and covered by Node tests.
- The current tool operates on the active raster layer only. Freeform/lasso selection, transform rotation, multi-layer transforms, and vector selection remain separate capabilities.


## Freeform lasso selection
- The lasso tool records a polygon in document coordinates and displays a dashed PixiJS overlay.
- Clicking inside an existing lasso extracts the active raster layer through a polygon clip; dragging moves those pixels while clearing only the original polygon area.
- Polygon hit testing and bounded translation are pure helpers covered by unit tests.
- The lasso currently transforms the active raster layer only. Rotation, feathering, vector inclusion, and multi-layer transforms are not yet implemented.


## Selection transform
- Rectangular and lasso selections can be rotated and scaled around the average of their polygon vertices.
- Transform applies to the active raster layer: pixels inside the selection are extracted to a temporary canvas, transformed, and composited back after clearing the original selected area.
- The transformed boundary is retained as a polygon selection, including after rotating a rectangular selection.
- Rotation range is -180° to 180° and scale range is 25% to 200%. Pixels transformed beyond the canvas are clipped by the canvas bounds.
- This is a committed transform, not a live preview; multi-layer and vector selection transforms remain future work.
