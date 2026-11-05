# Open-source components and reference projects

This document tracks projects that FRAME Studio may use, study, or interoperate with. A project being listed here does not mean its code has already been integrated.

## Preferred implementation candidates

| Project | License reported by upstream | Potential role | Decision |
|---|---|---|---|
| [PixiJS](https://github.com/pixijs/pixijs) | MIT | GPU-accelerated 2D stage renderer, sprites, textures, blend modes, filters | Integrated: stage rendering, smooth vector path display, layer opacity and standard blend modes |
| [Paper.js](https://github.com/paperjs/paper.js) | MIT | Vector paths, Bezier geometry, editable line objects | Candidate for Line Studio |
| [Three.js](https://github.com/mrdoob/three.js) | MIT | 3D primitives, camera, geometry, model preview | Primary web 3D candidate |
| [libmypaint](https://github.com/mypaint/libmypaint) | ISC | Natural brush engine and stroke dynamics | Research for a later native/WASM integration |
| [OpenToonz](https://github.com/opentoonz/opentoonz) | Modified BSD for core files; third-party components have separate terms | Animation workflow, cleanup, fill, compositing, screentone behavior | Study architecture and workflows; do not copy wholesale |
| [Krita](https://krita.org/en/about/license/) | GPL-3.0 for the application | Brush behavior, color management, animation and painting workflow research | Reference only unless GPL compatibility is deliberately accepted |
| [Nemo](https://github.com/mysteropodes/nemo) | GPL-3.0-or-later; early alpha per upstream README | Modern vector animation, inbetweening, timeline and motion design ideas | Research only; unstable and copyleft |
| [Blender](https://www.blender.org/about/license/) | GPL family | 3D-to-2D line-art workflow and Grease Pencil behavior | Interchange/workflow reference; use file formats and documented interfaces |

## Integration order

1. **perfect-freehand** — pressure-sensitive raster brush geometry, tapering and streamlining (integrated).
2. **PixiJS** — GPU stage, brush preview, masks, textures and compositing (integrated).
3. **Paper.js** — prototype editable vector paths and selection operations behind the line-engine adapter.
4. **Color.js / color picker research** — evaluate perceptual color spaces, palette harmony and gradient editing without replacing the document color model prematurely.
5. **Three.js** — add a separate 3D viewport and primitive assembly module; export geometry/line data into the shared document model.
6. **libmypaint** — evaluate richer textured brush dynamics after native iPad input and WASM feasibility are proven.
7. **Animation references** — compare OpenToonz, Krita, Blender Grease Pencil, and Nemo workflows after drawing tools are stable.

## License policy

- Prefer permissive licenses for components linked into the distributable app: MIT, ISC, BSD-2-Clause, and BSD-3-Clause.
- GPL/AGPL components are not automatically forbidden, but must not be copied or linked into a distributed build until the project owner has explicitly reviewed the resulting source-disclosure and distribution obligations.
- Check the exact license of each file, package, asset, brush, font, model, and transitive dependency. Repository-level badges are not sufficient.
- OpenToonz has separate terms for third-party directories and bundled brush assets; review each dependency independently.
- Preserve required copyright and license notices.
- Do not copy proprietary UI artwork, icons, branding, or distinctive interface assets from reference applications.
- Record version, source URL, license, modifications, and required notices for every adopted dependency.
- Recheck licenses on upgrades and before public distribution.

## Current status

PixiJS 8 and perfect-freehand 1.2.3 are integrated. PixiJS handles the stage and live polygon preview; perfect-freehand generates the variable-width brush outline from sampled pointer coordinates and pressure. Paper.js, Three.js, and libmypaint remain candidates for isolated evaluation. No upstream source code has been copied into the prototype; dependencies are installed as packages and their notices are recorded.
