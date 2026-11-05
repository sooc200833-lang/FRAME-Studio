# Performance work log

This document records the first coordinated performance pass for FRAME Studio.

## Brush input and preview

- Pointer samples are reduced with a pressure-aware Ramer–Douglas–Peucker pass.
- Endpoints, corners, and meaningful pressure changes are retained.
- The same reduced sample sequence is used to construct preview and committed brush outlines.
- Texture generation uses a reduced sample sequence as well.
- Preview bounds are calculated in one pass rather than allocating temporary coordinate arrays.
- Reused preview texture canvases are cleared before each draw.
- Pixi vector overlay Graphics objects are pooled and reused across sync calls instead of being destroyed and re-created every redraw.

## Vector editing primitives

- Nearest-segment projection supports inserting a node on an existing path.
- Interior node removal protects the two endpoints.
- Catmull–Rom interpolation produces editable polyline samples while preserving endpoints.

## Animation

- Onion-skin rendering reads adjacent frame stroke geometry without deep-cloning every point on each redraw.
- Onion-skin stroke references are read-only renderer inputs; timeline frame data remains the source of truth.

## Validation

Each feature branch passed the repository unit-test workflow and Vite production build before merge. A final integrated CI run is used to validate the combined main-branch state.

No numeric performance improvement is claimed until measured on representative iPad and desktop hardware.
