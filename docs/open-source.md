# Open-source components and reference projects

This document tracks projects that FRAME Studio may use, study, or interoperate with. A project being listed here does not mean its code has already been integrated.

## Preferred implementation candidates

| Project | License reported by upstream | Potential role | Decision |
|---|---|---|---|
| [PixiJS](https://github.com/pixijs/pixijs) | MIT | GPU-accelerated 2D stage renderer, sprites, textures, filters | Primary renderer candidate |
| [Paper.js](https://github.com/paperjs/paper.js) | MIT | Vector paths, Bezier geometry, editable line objects | Candidate for Line Studio |
| [Three.js](https://github.com/mrdoob/three.js) | MIT | 3D primitives, camera, geometry, model preview | Primary web 3D candidate |
| [libmypaint](https://github.com/mypaint/libmypaint) | ISC | Natural brush engine and stroke dynamics | Research for a later native/WASM integration |
| [OpenToonz](https://github.com/opentoonz/opentoonz) | Modified BSD for core files; third-party components have separate terms | Animation workflow, cleanup, fill, compositing, screentone behavior | Study architecture and workflows; do not copy wholesale |
| [Krita](https://krita.org/en/about/license/) | GPL-3.0 for the application | Brush behavior, color management, animation and painting workflow research | Reference only unless GPL compatibility is deliberately accepted |
| [Nemo](https://github.com/mysteropodes/nemo) | GPL-3.0-or-later; early alpha per upstream README | Modern vector animation, inbetweening, timeline and motion design ideas | Research only; unstable and copyleft |
| [Blender](https://www.blender.org/about/license/) | GPL family | 3D-to-2D line-art workflow and Grease Pencil behavior | Interchange/workflow reference; use file formats and documented interfaces |

## Integration order

1. **PixiJS** — replace the prototype's ad-hoc stage compositor with a renderer abstraction. Keep the document model and fill engine independent from PixiJS.
2. **Paper.js** — prototype editable vector strokes and path operations behind a line-engine adapter. Keep raster strokes supported.
3. **Three.js** — add a separate 3D viewport and primitive assembly module; export geometry/line data into the shared document model.
4. **libmypaint** — evaluate brush feel and pressure dynamics after the native iPad input path exists.
5. **Animation references** — compare OpenToonz, Krita, Blender Grease Pencil, and Nemo workflows before designing timeline features.

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

The v0.2 browser prototype remains a standalone HTML file. The projects above are evaluated candidates, not yet bundled dependencies. No upstream source code has been copied into the prototype.
