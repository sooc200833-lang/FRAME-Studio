# UI/UX overhaul workstream

## Goal
Move FRAME Studio toward a canvas-first iPad drawing workspace while retaining its dark visual identity and distinctive vector/timeline tools.

## Scope
- Reorganize top bar, left tool rail, canvas stage, contextual inspector, and collapsible timeline.
- Keep frequently used brush size and opacity controls reachable near the canvas edge.
- Replace always-open wide inspector behavior with compact contextual panels.
- Ensure responsive layouts work on iPad-sized touch screens and desktop browsers.
- Add clear selected/pressed/focus states and accessible labels.

## Guardrails
- Do not rewrite drawing, layer, brush, or document engines in this branch.
- Preserve existing element IDs and event contracts unless coordinated.
- Avoid changing brush/layer internals; use existing controls and APIs.
- Do not claim native iPad behavior; this remains a web prototype.

## Acceptance
- Canvas gets maximum available workspace.
- Inspector and timeline can collapse and reopen without losing state.
- Touch targets are comfortable for tablet use.
- Existing controls remain functional.
- Build and existing tests pass.
