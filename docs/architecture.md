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
- The raster brush is an in-house stamp engine: pointer samples become evenly spaced dabs (`brush/raster-brush.js`) stamped into a stroke buffer that is shown live and composited onto the layer on release (`brush/raster-brush-canvas.js`).
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
- A newly drawn rectangular selection is non-destructive until a move or resize is committed on pointer release. The rectangular selection currently operates on the active raster layer only; multi-layer support applies to the separate rotation/scale transform operation.


## Freeform lasso selection
- The lasso tool records a polygon in document coordinates and displays a dashed PixiJS overlay.
- Clicking inside an existing lasso extracts the active raster layer through a polygon clip; dragging previews the polygon's new position and commits the pixel move on pointer release, clearing only the original polygon area. The move currently affects the active raster layer only.
- Polygon hit testing and bounded translation are pure helpers covered by unit tests.
- Lasso movement currently affects only the active raster layer. Rotation and scaling use the separate selection-transform operation; feathering and moving lasso contents across multiple raster layers or vector strokes remain future work.


## Selection transform
- Rectangular and lasso selections can be rotated and scaled around the average of their polygon vertices.
- Transform extracts pixels from each resolved raster target independently, transforms them around one shared origin, and composites them back after clearing the original selected area. If no transform-target checkboxes are selected, the active raster layer is used; otherwise all checked raster layers are used. Intersecting vector strokes are transformed as whole objects.
- The transformed boundary is retained as a polygon selection, including after rotating a rectangular selection.
- Rotation range is -180° to 180° and scale range is 25% to 200%. Pixels transformed beyond the canvas are clipped by the canvas bounds.
- This is a committed transform, not a live preview. Multi-layer raster and vector-stroke transforms are implemented below; masks are not transformed.


## Multi-layer raster selection transform
- Layer rows expose transform-target checkboxes. When one or more are checked, the same polygon selection, rotation, scale, and centroid are applied to every checked raster layer; with none checked, the active layer is used.
- Each layer's selected pixels are extracted independently and transformed with the same matrix, preserving layer ordering and separation rather than flattening the result.
- Multi-layer transforms create a grouped raster undo/redo record so one undo or redo restores all participating layers together. The grouped record is scoped to the current frame and is invalidated by subsequent raster or vector edits.
- Masks and layer metadata are not transformed; only paint pixels in the selected polygon and qualifying vector strokes are affected.


## Vector stroke selection transforms
- Vector strokes whose centerline intersects or enters the active polygon selection are included as whole strokes; a stroke crossing the selection boundary is not split into partial segments.
- Selected stroke points are transformed around the same selection centroid as raster pixels. Stroke width scales with the selected scale factor; color and other stroke metadata remain unchanged.
- Raster and vector snapshots are stored in one grouped transform undo/redo record so the operation can be reverted together. The vector selection is evaluated against the polygon at apply time.
- Vector stroke selection currently uses centerline intersection, not stroke-width-aware edge overlap; partially intersecting strokes move in full. Transform changes are committed immediately rather than shown as a live preview.


## Animated vector brush rendering (Doodraw-inspired)
- Vector strokes keep immutable source geometry and store a per-stroke motion style and strength.
- Wobbly/Wave deforms sampled path points along their local centerline normal; Boiling draws three deterministic phase-shifted contour passes; Trio/Redraw and Frame Echo/Flicker draw offset passes.
- Animated geometry is presentation-only. It is not written back into the source stroke, selection geometry, or document history.
- Per-stroke animated styles run without enabling the global Line Boil switch. The global switch remains available for applying the shared wave treatment to otherwise-static strokes.
- The in-progress vector preview uses the same motion pass renderer as committed strokes.
- This first slice does not yet provide texture/particle tips, per-brush speed, or a full raster-stroke animation model.
