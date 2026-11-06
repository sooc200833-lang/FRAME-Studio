# Direct Bézier Handle Editing

Vector strokes can carry an optional `bezierPath` alongside their legacy `points` data. Existing documents remain valid; a selected legacy stroke is converted lazily when a Bézier handle is first dragged.

## Interaction

1. Select a vector stroke with the Select tool.
2. Enable **곡선 핸들 편집 모드** in the line inspector.
3. Drag a blue control point to change the curve.
4. Hold Shift while dragging to mirror the adjacent handle direction and preserve its length at a shared anchor.

Anchor dots are shown as fixed references in this first UI pass. The control handles are directly draggable.

## Persistence and compatibility

- Bézier geometry is included in line snapshots, undo/redo, and frame snapshots.
- Rendering, export, hit testing, selection intersection, affine transforms, translation, onion skin, and line-boil preview use the Bézier path when present.
- Legacy node insertion is retained for strokes that have not yet been converted.
- Applying the legacy smoothing operation intentionally clears the Bézier override and returns the stroke to legacy point geometry.

## Current limitations

- Anchor dragging, corner/smooth node modes, and per-handle link-mode UI are not implemented yet.
- Shift is the current temporary mirrored-handle modifier; it is not persisted as an anchor mode.
- Handle editing has not yet been physically validated with Apple Pencil on iPad.
