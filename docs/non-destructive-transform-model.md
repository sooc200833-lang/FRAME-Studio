# Non-destructive raster transform model

## Status

The affine model, transform-stack compositor, per-frame transform metadata, and selection transform commits are implemented. Lasso and rectangular selection drags plus the inspector angle/scale action append non-destructive transform records. Undo/redo restores transform stacks, and a layer-panel command explicitly rasterizes them. Painting on a transformed layer creates a new layer above it so new marks do not disappear behind the transformed content.

## Why the current workflow needs a model change

The current selection workflow previews a transformed raster region and then writes the result back into the layer canvas. Repeated scale/rotation therefore resamples pixels repeatedly. The new workflow must preserve the original selected pixel snapshot and keep its transform as editable metadata until the user explicitly rasterizes it.

## Operation record

Each raster transform operation is JSON-safe and contains:

- `id`: stable operation identifier.
- `sourceDataUrl`: PNG snapshot of the selected pixels before this operation.
- `clipPolygon`: source region in document coordinates. Rendering clears this region from the presentation accumulated so far.
- `matrix`: Canvas-compatible affine matrix `[a, b, c, d, e, f]`.

The matrix maps source coordinates to destination coordinates:

`x' = a·x + c·y + e`

`y' = b·x + d·y + f`

Operations are replayed in order over the layer's original raster canvas. Each operation removes its source polygon from the accumulated presentation and draws its untouched source snapshot through the matrix. A later operation can therefore capture pixels produced by earlier operations without rewriting the original layer canvas.

## Integration requirements

1. **Preview:** compose the layer's existing operation stack, then preview the current gesture as one temporary operation. Pointer cancellation must discard only that temporary operation.
2. **Commit:** append one operation per selected raster layer. Never resample or overwrite the original layer canvas.
3. **Undo/redo:** snapshot operation arrays together with vector snapshots and restore them as one grouped action across all selected layers.
4. **Frames:** each animation frame stores its own per-layer transform-operation arrays. Frame duplication deep-clones the arrays; frame switching restores them before rendering.
5. **Rendering/export/fill:** PixiJS presentation, fill-boundary composites, and PNG export must use the same composed layer image. Layer masks and group blend/opacity remain applied after the transform stack.
6. **Rasterize:** a future explicit command may bake the composed presentation into the source canvas and clear the operation stack. It must be a deliberate user action.
7. **Compatibility:** older frames without transform metadata normalize to empty arrays and render exactly as before.

## Important edge cases

- A transform operation must retain its source polygon and source pixels, not just the final transformed polygon.
- Move, non-uniform resize, and rotation all use the same affine matrix representation.
- Transform targets continue to follow the existing layer checkbox rules.
- Vector strokes remain in their own editable object model; this raster model must not silently rasterize them.
- Repeated transforms must compose without changing earlier source snapshots.
- Out-of-canvas drawing is clipped by the presentation canvas, not by mutating the source data.
- Layer deletion/reordering must keep frame transform arrays aligned with layer indices, just like raster cels.

## Current implementation boundary

Implemented:
- `apps/web/src/selection/raster-transform.js`: validated affine matrix operations, bounds calculation, serializable records, stack composition, and an explicit rasterize helper.
- `apps/web/src/animation/frame-cels.js` and `timeline.js`: deep-cloned per-layer transform metadata stored and duplicated per animation frame.
- `main.js`: layers maintain an original canvas and a separate presentation canvas; frame save/load serializes transform records and hydrates their source images.
- `renderer.js`: PixiJS layer sprites consume the composed presentation canvas.
- `composite()`: fill-boundary and PNG export composites use the presentation canvas, with layer masks applied afterward.

Not yet implemented:
- Vector strokes are still transformed through their existing editable-object path, not stored in the raster transform stack.
- The auto-created paint layer is a workflow choice; direct painting into an existing transformed layer requires explicit rasterization first.
- Browser interaction, long-session performance checks, and physical iPad/Apple Pencil testing remain outstanding.

The next integration should add automated interaction-level coverage and verify transform persistence through layer operations and export in a real browser.
