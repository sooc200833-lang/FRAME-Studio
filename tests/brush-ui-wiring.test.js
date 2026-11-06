import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

test('raster brush and smudge tools are reachable from the toolbar', async () => {
  const html = await read('apps/web/index.html');
  assert.match(html, /data-tool="pen"/);
  assert.match(html, /data-tool="smudge"/);
});

test('brush blend and smudge controls exist exactly once', async () => {
  const html = await read('apps/web/index.html');
  for (const id of ['brushBlendMode', 'smudgeStrength', 'smudgeSpacing']) {
    const matches = html.match(new RegExp(`id=["']${id}["']`, 'g')) || [];
    assert.equal(matches.length, 1, `expected one element with id ${id}`);
  }
});

test('canvas interaction connects smudge sessions and frame-scheduled texture uploads', async () => {
  const main = await read('apps/web/src/main.js');
  assert.match(main, /createSmudgeSession\(imageData/);
  assert.match(main, /smudgeRenderScheduler\.schedule\(\)/);
  assert.match(main, /smudgeRenderScheduler\.cancel\(\)/);
  assert.match(main, /event\.type === 'pointercancel'/);
});

test('raster brush preview uses the same blend-mode adapter as commit', async () => {
  const main = await read('apps/web/src/main.js');
  const renderer = await read('apps/web/src/renderer.js');
  assert.match(main, /normalizeBrushBlendMode\(brushBlendMode\)/);
  assert.match(renderer, /toPixiBrushBlendMode\(options\.blendMode\)/);
});
