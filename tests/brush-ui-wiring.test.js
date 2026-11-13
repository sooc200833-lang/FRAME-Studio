import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

test('raster brush and smudge tools are reachable from the toolbar', async () => {
  const html = await read('apps/web/index.html');
  // Raster painting is chosen from the brush library behind the paint tool.
  assert.match(html, /id="paintTool" data-tool="vector" data-popover="brushPopover"/);
  assert.match(html, /data-brush-kind="raster"/);
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

test('raster brush preview and commit share one composite mode', async () => {
  const main = await read('apps/web/src/main.js');
  // One function decides operation/alpha/selection; preview and commit both call it.
  assert.match(main, /operation: normalizeBrushBlendMode\(brushBlendMode\)/);
  assert.match(main, /const mode = rasterStrokeMode\(rasterStrokeTarget\);/);
  assert.match(main, /strokeBuffer\.renderPreview\(base, mode\)/);
  assert.match(main, /strokeBuffer\.compositeOnto\(layer\.canvas\.getContext\('2d'\), rasterStrokeMode\(rasterStrokeTarget\)\)/);
});

test('vector pressure profile canvas exists for its pointer event bindings', async () => {
  const html = await read('apps/web/index.html');
  const main = await read('apps/web/src/main.js');
  assert.match(html, /<canvas[^>]*id="vectorPressureProfile"/);
  assert.match(main, /const profileCanvas = document\.getElementById\('vectorPressureProfile'\)/);
  assert.match(main, /profileCanvas\.addEventListener\('pointerdown'/);
});

test('every statically referenced DOM id exists exactly once in the app HTML', async () => {
  const html = await read('apps/web/index.html');
  const main = await read('apps/web/src/main.js');
  const declaredIds = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]);
  const declaredSet = new Set(declaredIds);
  const duplicateIds = [...new Set(declaredIds.filter((id, index) => declaredIds.indexOf(id) !== index))];
  const referencedIds = [...new Set(
    [...main.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)].map(match => match[1]),
  )];
  const missingIds = referencedIds.filter(id => !declaredSet.has(id));

  assert.deepEqual(duplicateIds, [], `duplicate HTML ids: ${duplicateIds.join(', ')}`);
  assert.deepEqual(missingIds, [], `missing HTML elements: ${missingIds.join(', ')}`);
});

test('the id check really sees the app ids (guards against a vacuous regex)', async () => {
  const html = await read('apps/web/index.html');
  const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]);
  assert.ok(ids.includes('pixiHost'));
  assert.ok(ids.length > 100);
});

test('every popover trigger and tool-mode host points at an existing element', async () => {
  const html = await read('apps/web/index.html');
  const ids = new Set([...html.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]));
  const popovers = [...html.matchAll(/data-popover="([^"]+)"/g)].map(match => match[1]);
  const hosts = [...html.matchAll(/data-host="([^"]+)"/g)].map(match => match[1]);
  assert.ok(popovers.length >= 10);
  for (const id of [...popovers, ...hosts]) assert.ok(ids.has(id), `missing #${id}`);
  for (const id of new Set(popovers)) assert.match(html, new RegExp(`class="popover[^"]*" id="${id}"`));
});

test('brush library cards cover every raster and vector preset option', async () => {
  const html = await read('apps/web/index.html');
  const optionValues = id => {
    const select = html.match(new RegExp(`<select id="${id}">([\\s\\S]*?)</select>`))[1];
    return [...select.matchAll(/value="([^"]+)"/g)].map(match => match[1]).sort();
  };
  const cards = kind => [...new Set([...html.matchAll(new RegExp(`data-brush-kind="${kind}" data-brush="([^"]+)"`, 'g'))].map(match => match[1]))].sort();
  assert.deepEqual(cards('vector'), optionValues('vectorBrushPreset'));
  assert.deepEqual(cards('raster'), optionValues('brushPreset'));
});


test('Doodraw-inspired animated vector brush modes are selectable and wired to live rendering', async () => {
  const html = await read('apps/web/index.html');
  const main = await read('apps/web/src/main.js');
  for (const value of ['none', 'wave', 'boil', 'redraw', 'flicker']) {
    assert.match(html, new RegExp(`<option value="${value}"`), `missing motion style ${value}`);
  }
  assert.match(main, /hasAnimatedVectorStrokes\(\)/);
  assert.match(main, /motionStyle: vectorMotionStyle/);
  assert.match(main, /animateLineStrokes\(\[previewStroke\]/);
  assert.match(main, /motionStyle && stroke\.motionStyle !== 'none'/);
});
