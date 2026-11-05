# Brush Studio workstream

## Goal
Create a visual brush library and contextual brush editor over the existing brush engine.

## Scope
- Card/list brush library with live stroke thumbnails and categories.
- Brush settings grouped by shape, dynamics, rendering, and texture.
- Save/duplicate/reset custom brush presets without breaking existing four presets.
- Improve preview/commit parity and pressure-driven texture behavior.
- Add texture intensity and grain controls only when supported by the engine.

## Guardrails
- Own brush modules and brush-specific UI only.
- Coordinate shared markup/CSS changes with UI workstream.
- Preserve deterministic texture generation and undo behavior.
- Do not claim Apple Pencil tilt support until native input exists.

## Acceptance
- Existing pencil/ink/marker/brush presets remain selectable.
- Preview and committed strokes look materially consistent.
- Settings are validated and tested.
- Build and brush tests pass.
