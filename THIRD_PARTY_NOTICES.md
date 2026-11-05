# Third-party notices

## Runtime dependencies

### perfect-freehand 1.2.3

- Package: `perfect-freehand`
- Version: `1.2.3` (pinned in `package.json`)
- License: MIT
- Source: https://github.com/steveruizok/perfect-freehand
- Package: https://www.npmjs.com/package/perfect-freehand

FRAME Studio uses `getStroke` to turn sampled pointer positions and Apple Pencil-compatible pressure values into smooth, variable-width brush polygons. The resulting geometry is rendered through PixiJS for preview and committed to the active raster paint layer. The dependency has no runtime dependencies of its own.

MIT license notice:

MIT License

Copyright (c) 2021 Stephen Ruiz Ltd

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

### PixiJS 8.20.1

- Package: `pixi.js`
- Version: `8.20.1` (pinned in `package.json`)
- License: MIT
- Source: https://github.com/pixijs/pixijs
- License text: https://github.com/pixijs/pixijs/blob/dev/LICENSE

PixiJS is used for the GPU-backed stage renderer. FRAME Studio's paint buffers and fill logic remain separate from PixiJS.

MIT license notice (retain with distributions):

Copyright (c) PixiJS contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.

## Development dependency

### Vite 8.3.6

- Package: `vite`
- Version: `8.3.6` (pinned in `package.json`)
- License: MIT
- Source: https://github.com/vitejs/vite
- License text: https://github.com/vitejs/vite/blob/main/LICENSE

Vite is used only for local development and production bundling.

## Evaluated candidates (not bundled)

See [Open-source components and reference projects](./docs/open-source.md).

Evaluated candidates include Paper.js (MIT), Three.js (MIT), and libmypaint (ISC). Listing a project here is not a claim that it is included in a build.

## Required process when adopting a dependency

For each dependency added to a release:
- Record exact package name, version, source repository, and license identifier.
- Include the upstream copyright and license text where required.
- Record local modifications and patches.
- Audit transitive dependencies and bundled assets.
- Update this file before shipping a distributable build.
