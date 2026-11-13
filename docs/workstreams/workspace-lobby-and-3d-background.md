# Workspace Lobby and 3D Manga Background Workflow

## Purpose

Make FRAME Studio feel like one creative application with a clear starting point, while keeping each editor modular and safe to develop independently. The immediate goal is a simple, usable prototype—not a full 3D production suite.

## Product structure

The website should open at a **Lobby**. The lobby is a workspace selector, not a replacement for the drawing editor.

| Workspace | Role | Current state |
|---|---|---|
| Drawing Studio | Main 2D drawing, vector line, screentone, layers, and animation editor | Existing PixiJS editor; preserved as `apps/web/drawing.html` |
| 3D Background Studio | Build simple manga backgrounds and set a camera before exporting an image | First Three.js prototype at `apps/web/background-studio.html` |
| Asset Library | Reusable props, room parts, materials, brushes, and scene presets | Planned; not implemented |
| Motion Studio | Camera movement and scene-based motion tools | Planned; not implemented |

### Entry and navigation

- `apps/web/index.html` is the lobby / website entry.
- `apps/web/drawing.html` opens the existing drawing editor.
- `apps/web/background-studio.html` opens the independent 3D editor.
- Each workspace should provide a clear route back to the lobby.
- Keep workspace cards simple and readable on desktop, tablet, and phone.
- Do not make planned workspaces look functional before they exist; label them as planned or keep them disabled.

## User workflow

1. Open FRAME Studio and arrive at the Lobby.
2. Choose Drawing Studio to work on a 2D illustration, or 3D Background Studio to block out a scene.
3. In 3D Background Studio, choose a starter space (room, corridor, street, or empty scene).
4. Add and arrange simple objects; select objects from the scene list or viewport.
5. Adjust position, rotation, scale, camera projection, and viewpoint.
6. Use toon shading and outlines as a manga-oriented preview.
7. Save the editable scene as JSON so it can be reopened and adjusted later.
8. Export a PNG background and bring it into Drawing Studio as a raster layer. The PNG handoff is the first integration target; direct editable 3D scene layers are a later milestone.

## 3D Background Studio — prototype scope

### In the current prototype

- Room, corridor, street, and empty-space starter presets.
- Basic primitive / furniture objects.
- Viewport selection and a scene-object list.
- Translate, rotate, and scale controls.
- Orbit, pan, and zoom camera controls.
- Perspective and orthographic camera modes; front, side, and top views.
- Toon shading and an outline toggle.
- Local browser save, JSON import/export, PNG export, and transparent-background export option.

### Deliberately out of scope for this first pass

- Full architectural CAD or precision measurement.
- A complete catalog of commercial-quality 3D assets.
- Automatic conversion to clean, editable vector manga line art.
- Character rigging, posing, or advanced animation.
- Direct insertion of editable 3D objects into the PixiJS drawing document.
- Cloud sync or account-based project storage.

## Development boundaries

- The 3D editor is an independent Three.js workspace. It must not insert Three.js objects into the PixiJS stage.
- The existing drawing document remains the source of truth for 2D layers, vector lines, timeline, and illustration edits.
- The first bridge between workspaces is a rendered PNG. JSON remains the portable editable source for the 3D scene.
- A future bridge may add a linked 3D scene layer or camera reference to the shared document model, but only after the document format and undo/save behavior have been designed and tested.
- Keep 3D-specific UI, styles, and scene logic isolated from the drawing editor.
- Three.js is currently loaded from a CDN; the prototype needs network access. Review dependency delivery and version pinning before treating it as production-ready.

## Next milestones

### M0 — Make the lobby the real entry point
- [x] Add a lobby layout with workspace cards.
- [x] Preserve the existing drawing editor on its own page.
- [x] Add the 3D Background Studio entry.
- [x] Configure the Vite multi-page build inputs for the lobby and workspaces.
- [ ] Confirm the branch build and deployment configuration.
- [ ] Merge only after review and user approval; then verify the deployed GitHub Pages URL.
- [ ] Add and test a return-to-lobby link in every workspace.

### M1 — Stabilize the 3D prototype
- [ ] Run automated tests and a production build on the updated branch.
- [ ] Browser-check the full workflow: create scene → add/select object → transform → change camera → save → reload → import/export.
- [ ] Check mobile/tablet layout and touch behavior; do not claim physical iPad validation without testing on a device.
- [ ] Fix camera switching, transform gizmo interaction, scene loading, and object-ID edge cases found during QA.
- [ ] Document known limitations in the UI/help.

### M2 — Improve manga background construction
- [ ] Add wall, floor, ceiling, door, and window tools with predictable snapping.
- [ ] Add reusable room / corridor / street templates and adjustable dimensions.
- [ ] Add practical camera presets, perspective guides, and composition framing.
- [ ] Improve outline quality and line-weight controls; distinguish preview outlines from production-quality line extraction.
- [ ] Add reusable prop placement and grouping.

### M3 — Connect 3D output to drawing
- [ ] Add a reliable one-click PNG handoff to Drawing Studio.
- [ ] Import the PNG into a newly created raster layer without flattening existing artwork.
- [ ] Preserve transparent backgrounds and predictable canvas sizing.
- [ ] Later evaluate editable line export (SVG/vector) and linked scene references separately.

### M4 — Asset Library and Motion Studio
- [ ] Create a searchable library of reusable props, scene templates, and materials.
- [ ] Record asset source, license, attribution, and version before reuse.
- [ ] Add camera keyframes and simple camera animation only after static scene editing is stable.
- [ ] Keep these as separate modules so they do not destabilize the drawing engine.

## Acceptance criteria for the prototype

The first usable version is acceptable when a user can:

1. Open the site and understand which workspace to choose.
2. Enter the existing Drawing Studio without losing its current functionality.
3. Enter the 3D Background Studio and build a basic room/corridor/street composition.
4. Select and transform objects without the camera controls stealing the gesture.
5. Save a scene, reload it, and continue editing.
6. Export a PNG and a JSON scene file.
7. Return to the lobby from either workspace.

Automated build success, browser interaction checks, and physical iPad testing must be reported separately.

## Current status and caveats

- The lobby and workspace pages have been added on the feature branch `feature/3d-background-studio-prototype`.
- The existing drawing page is copied to a dedicated `drawing.html` entry so the lobby can own `index.html`.
- The 3D editor is a newly built isolated Three.js prototype. The linked manga-background reference site has not been confirmed as a source of reusable engine code; do not claim that its implementation was imported.
- The feature is tracked in PR #74 and is not merged by this document update.
- The deployed GitHub Pages site may continue showing the old entry page until the PR is merged and Pages finishes deploying.
- Build, browser, and physical-device verification remain separate tasks; only report checks that have actually completed.
