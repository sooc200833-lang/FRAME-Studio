# 3D Background Studio — prototype

## Goal
A separate 3D workspace that can be developed and tested without destabilizing the PixiJS drawing canvas.

## Boundary
- apps/web/background-studio.html: independent workspace entry.
- apps/web/src/background-studio.js: Three.js scene, camera, object presets, transforms, local save and export.
- apps/web/src/background-studio.css: isolated responsive UI.
- FRAME Studio remains the owner of drawing layers, vector lines, timeline, and final illustration document.
- Initial handoff is transparent PNG plus a portable JSON scene file. A direct editable-layer bridge is a later milestone.

## Prototype scope
- Room, corridor, street, and empty-space presets.
- Add/select/move/rotate/scale simple objects.
- Orbit camera, perspective/orthographic projection, front/side/top views.
- Toon shading and edge outlines.
- Local browser save, JSON import/export, transparent PNG export.

## Technical choices
- Three.js 0.180.0 is loaded from jsDelivr using an import map. It is isolated from PixiJS.
- No Three.js objects are inserted into the existing Pixi stage.
- Scene data is a versioned JSON document; geometry is reconstructed from object type and transform.
- PNG output is the first exchange format. Later, the shared document model can add a linked 3D scene layer and camera keyframes.

## Known prototype limitations
- Basic primitives and procedural furniture only; no model library yet.
- Toon shading and edge lines are a first pass, not production-quality manga line extraction.
- Camera projection switching and mobile transform handles need browser/device QA.
- PNG is a rendered snapshot; JSON is required to continue editing the 3D scene.
- CDN access is required for the 3D engine.

## Next milestones
1. Validate build and desktop/mobile browser behavior.
2. Improve object selection, camera switching, and transform controls.
3. Add editable wall/door/window tools and reusable scene templates.
4. Add a one-click PNG handoff into a new FRAME raster layer.
5. Add camera keyframes and optional 3D scene references to the document model.
