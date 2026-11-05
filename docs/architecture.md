# FRAME Studio Architecture

## Product constraints
- iPad-first, dark interface.
- Large central canvas, timeline, contextual inspector, and compact tool strip.
- Original UI and assets; use other creative applications only as broad workflow inspiration.

## Proposed workspace
- `apps/web`: browser prototype and web application.
- `apps/ipad`: future native iPad client.
- `packages/document-model`: shared document schema, layers, frames, metadata.
- `packages/drawing-engine`: input normalization and stroke creation.
- `packages/fill-engine`: compositing, connected-region detection, fill output.
- `packages/line-engine`: line objects, selection, stroke rendering, Line Boil.
- `packages/tone-engine`: halftone and comic filters.
- `packages/animation-engine`: timeline, frames, keyframes, playback.
- `packages/rendering-engine`: shared rendering abstractions.
- `packages/3d-engine`: primitives, assemblies, and line extraction.
- `services/ai-api`: server-side provider proxy and usage controls.
- `docs`: product decisions, architecture, and roadmap.

## Document model principles
- Keep source line art and paint/fill layers independently editable.
- A fill operation reads the composited visible image but writes only to the selected paint layer.
- Store operations in a form that supports undo/redo.
- Preserve frame and layer identity across animation edits.
- Keep project data portable between web and native clients.

## Flood-fill behavior
1. Composite visible layers into a temporary boundary image.
2. Sample the pixel under the user's tap.
3. Find the connected region using a configurable color-distance tolerance.
4. Apply the selected color to the active paint layer, respecting alpha/edge settings.
5. Record the operation for undo/redo.

## Security
- Never commit API keys, personal access tokens, or credentials.
- GPT/Claude requests must go through a server-side proxy.
- Apply per-user limits and avoid logging secrets.

## Current implementation status
This repository currently contains project documentation only. The browser prototype has not yet been imported into this repository, and no production drawing engine or flood-fill implementation is claimed complete.
