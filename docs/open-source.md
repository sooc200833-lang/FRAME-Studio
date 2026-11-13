# Open-source components and reference projects

This document tracks components FRAME Studio uses and projects reviewed for architecture or workflow ideas. Listing a project does not mean its code is integrated.

## Integrated runtime components

| Project | License | Use in FRAME Studio |
|---|---|---|
| [gifenc](https://github.com/mattdesl/gifenc) | MIT | GIF encoding for animation export (loaded on demand) |
| [fflate](https://github.com/101arrowz/fflate) | MIT | Zip for PNG-sequence export (loaded on demand) |
| [Mediabunny](https://github.com/Vanilagy/mediabunny) | MPL-2.0 | MP4/WebM muxing with WebCodecs for video export (loaded on demand, unmodified) |
| [PixiJS](https://github.com/pixijs/pixijs) | MIT | Stage rendering, textures, vector display and layer compositing |
| [three.js](https://github.com/mrdoob/three.js) 0.187.0 | MIT | 3D Background Studio only (scene, OrbitControls, TransformControls). npm dependency, pinned; not loaded by the drawing page |

## Brush engine and color-mixing work

- perfect-freehand was removed in v1.8; the raster brush is now an in-house stamp engine.
- PixiJS is used for live brush preview; the preview and committed Canvas 2D stroke share a constrained blend-mode mapping (`normal`, `multiply`, `screen`, `overlay`).
- `apps/web/src/brush/smudge-engine.js` is a small, local ImageData smudge implementation with pressure-scaled radius, configurable spacing, alpha-aware color mixing, and bounded per-dab pixel work.
- The smudge interaction is informed by the MIT-licensed [Klecks](https://github.com/bitbof/klecks) brush workflow. Its upstream smudge and blend modules were inspected, but not copied: they depend on Klecks-specific history, tile, selection-mask, and canvas abstractions.
- [libmypaint](https://github.com/mypaint/libmypaint) is ISC-licensed and documents a mature dab-based brush model. It remains a future candidate for a separately built WebAssembly adapter; the current browser project does not yet contain a maintained, drop-in WASM build, and the native C library has GLib/json-c build dependencies.

## Reviewed reference projects

| Project | Upstream license | Useful ideas | Decision |
|---|---|---|---|
| [Klecks](https://github.com/bitbof/klecks) | MIT | Browser painting, pressure input, stabilizer, touch gestures, blend/smudge workflow | Reference; adapt focused behaviors, do not embed the full app |
| [Quickdraw](https://github.com/quickdrawjs/quickdraw) | MIT | Stylus/finger separation, speed-sensitive ink and canvas gestures | Reference; velocity-derived mouse pressure independently implemented |
| [Graphite](https://github.com/GraphiteEditor/Graphite) | Apache-2.0 / MIT (mixed repository) | Non-destructive vector/raster graph and procedural compositing | Architecture reference; Rust/WASM core is not a drop-in PixiJS dependency |
| [miniPaint](https://github.com/viliusle/miniPaint) | MIT | Browser editor structure, layers, editable shapes and Bezier tools | Reference for future import/export and shape workflows; not bundled |
| [Pencil2D](https://github.com/pencil2d/pencil) | GPL-2.0 | Raster/vector animation layers and frame-by-frame workflow | Workflow reference only; no code copied |
| [Sakura Crossing](https://github.com/Kenton-GMI/sakura-crossing) | not checked | Three.js scene rendered as a 2D animation background; screen-space ink lines from depth | Idea only (depth-based ink). The 3D studio's ink/tone shader is written for this project; no code copied |
| [MyPaint](https://github.com/mypaint/mypaint) | GPL-2.0-or-later (verify exact component before reuse) | Tablet brush dynamics, per-stroke settings and pigment-like painting | Brush-engine research only; no code copied |
| [Paper.js](https://github.com/paperjs/paper.js) | MIT | Vector paths and Bezier geometry | Candidate for isolated Line Studio evaluation |
| [Three.js](https://github.com/mrdoob/three.js) | MIT | 3D primitives, camera and geometry | Candidate for a separate 3D viewport |
| [libmypaint](https://github.com/mypaint/libmypaint) | ISC | Natural brush engine and stroke dynamics | Research for a later WASM/native integration |
| [OpenToonz](https://github.com/opentoonz/opentoonz) | Modified BSD for core files; third-party components have separate terms | Animation, cleanup, fill and compositing workflow | Workflow reference; review each component separately |
| [Krita](https://krita.org/) | GPL-3.0 for the application | Brush behavior, color management and animation workflow | Reference only unless GPL compatibility is deliberately accepted |
| [Blender](https://www.blender.org/) | GPL family | 3D-to-2D line-art and Grease Pencil workflows | Interchange/workflow reference |

## Implementation order

1. Keep the drawing canvas reliable across browser GPU backends before expanding brush features.
2. Improve stylus input, touch/finger separation and gesture handling with Klecks and Quickdraw as references.
3. Evaluate one textured or blending brush family at a time; keep the existing brush API stable.
4. Improve vector editing behind the existing line-engine adapter before introducing another vector dependency.
5. Evaluate Three.js in an isolated 3D viewport, then connect exported geometry to the shared document model.
6. Expand animation only after drawing, selection, and layer behavior are stable.

## License and integration policy

- Prefer permissive licenses for code linked into the distributable app: MIT, ISC, BSD-2-Clause and BSD-3-Clause.
- GPL/AGPL projects are useful references, but their code must not be copied or linked into a distributed build until the project owner has explicitly reviewed source-disclosure and distribution obligations.
- Check the exact license of each file, package, asset, brush, font, model and transitive dependency. Repository-level badges are not sufficient.
- Preserve required copyright and license notices.
- Do not copy proprietary UI artwork, icons, branding or distinctive interface assets.
- Record version, source URL, license and modifications for every adopted dependency.

## Current status

PixiJS 8.20.1 is integrated (perfect-freehand was used until v1.8). Klecks, Quickdraw, Graphite, miniPaint, Pencil2D, MyPaint, and libmypaint have been reviewed as references. No upstream source code from these reference projects is copied or bundled. The local smudge engine is an independent implementation.
