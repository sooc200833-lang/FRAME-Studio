# Explicit Bézier Path Model

`apps/web/src/line/bezier-path.js` introduces an additive cubic Bézier geometry model for future direct handle editing.

## Data shape

- `anchors`: ordered path anchors.
- `segments[i].control1`: outgoing handle from anchor `i`.
- `segments[i].control2`: incoming handle toward anchor `i + 1`.

There is exactly one cubic segment between each adjacent anchor pair. Handle coordinates are absolute document coordinates.

## Operations

- `createBezierPath` validates and copies geometry.
- `createBezierPathFromAnchors` creates straight cubic segments.
- `sampleBezierPath` uses adaptive De Casteljau subdivision and returns source-segment mapping for each sampled edge.
- `moveBezierHandle` edits one handle and can optionally mirror the opposite handle at a shared anchor while preserving its length.
- `moveBezierAnchor` moves an anchor and its adjacent handles together.
- `transformBezierPath` applies a Canvas2D affine matrix to every anchor and handle.
- `cloneBezierPath` returns independent geometry.

## Compatibility boundary

This is a geometry foundation only. Existing vector strokes still use the legacy `points` representation and are not silently migrated. Renderer integration, visible handle overlays, pointer interaction, serialization, and undo/redo integration are follow-up work. This separation prevents an unreviewed schema change from corrupting existing documents.
