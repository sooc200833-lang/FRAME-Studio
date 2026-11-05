# FRAME Studio Roadmap

## Phase 0 — Repository foundation
- Establish project goals and module boundaries.
- Import the existing browser prototype and verify its behavior before modifying it.
- Add a repeatable test and release process.

## Phase 1 — Drawing and area fill
- Composite visible layers to identify color boundaries.
- Flood-fill the connected region at the tapped pixel.
- Write the result to the active paint layer without modifying source line art.
- Expose tolerance and edge behavior settings.
- Add undo/redo coverage for fill operations.

## Phase 2 — Line Studio
- Represent line objects independently where possible.
- Support selection, transforms, width, texture, and stroke properties.
- Add controllable Line Boil animation with stable line identity.

## Phase 3 — Tone Studio
- Add halftone patterns, tone density, gradients, and comic-oriented filters.
- Support region- and layer-scoped effects.

## Phase 4 — Motion Studio
- Timeline, frame management, keyframes, playback, and onion-skin workflow.
- Reuse the same document model as the drawing engine.

## Phase 5 — 3D Studio
- Combine primitives into editable figure-like assemblies.
- Convert 3D geometry into adjustable 2D line art.
- Keep 3D source geometry editable after line conversion.

## Phase 6 — AI Studio
- Support GPT and Claude through a server-side API proxy.
- Keep API credentials out of browser code, project files, and Git history.
- Add explicit user controls for model choice and usage limits.

## Phase 7 — Native iPad
- PencilKit/Metal-based input and rendering where appropriate.
- Pressure, tilt, palm rejection, and low-latency interaction.
- Maintain compatibility with the shared project document format.

## Current next action
Import and inspect the existing v0.1 prototype. Do not mark flood fill complete until it is implemented and tested with enclosed regions, open boundaries, and line art on a separate visible layer.
