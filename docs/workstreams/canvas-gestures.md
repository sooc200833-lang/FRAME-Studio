# Canvas and gestures workstream

## Goal
Make the canvas feel natural on touch devices and prepare a clean path to native iPad input.

## Scope
- Two-finger pan, pinch zoom, and canvas rotation.
- Fit-to-screen, reset rotation, and 100% zoom commands.
- Gesture arbitration so drawing, selection, and two-finger navigation do not conflict.
- Device-pixel-ratio and viewport resizing correctness.
- Pointer capture/cancel and palm/touch filtering improvements where browser APIs permit.

## Guardrails
- Do not claim native Apple Pencil latency, tilt, or palm rejection.
- Keep document coordinates independent from viewport transforms.
- Preserve existing drawing coordinates and export dimensions.
- Coordinate canvas shell changes with UI workstream.

## Acceptance
- Pinch/pan/rotate do not alter document pixels.
- Pen input remains accurate at all zoom/rotation levels.
- Gesture cancel/release cannot leave tools stuck.
- Tests cover coordinate transforms and gesture arbitration.
