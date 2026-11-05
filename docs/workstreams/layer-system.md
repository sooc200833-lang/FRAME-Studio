# Layer system workstream

## Goal
Bring layer management closer to a professional drawing application.

## Scope
- Layer thumbnails and drag reorder.
- Multi-select, duplicate, merge, lock, alpha lock, clipping mask.
- Correct isolated group compositing and nested groups.
- Clarify mask controls and layer/group selection states.
- Define document-level and frame-level metadata behavior.

## Guardrails
- Preserve raster/vector separation and stable frame IDs.
- Do not change document serialization without migration tests.
- Keep undo/redo atomic for multi-layer operations.
- Coordinate shared inspector layout with UI workstream.

## Acceptance
- Reordering preserves visual stacking and active layer identity.
- Group opacity/blend render as isolated group composites.
- Undo/redo restores all affected layer and group state.
- Tests cover nested groups and serialization.
