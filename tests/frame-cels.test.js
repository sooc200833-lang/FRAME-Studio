import test from 'node:test';
import assert from 'node:assert/strict';
import { blankRasterCels, cloneRasterCels, normalizeRasterCels } from '../apps/web/src/animation/frame-cels.js';

test('blank raster cels allocate one empty slot per paint layer', () => {
  assert.deepEqual(blankRasterCels(3), [null, null, null]);
  assert.deepEqual(blankRasterCels(-2), []);
});

test('raster cel snapshots are copied into an independent array', () => {
  const original = ['data:image/png;base64,AAA', null];
  const copy = cloneRasterCels(original);
  copy[0] = 'changed';
  assert.equal(original[0], 'data:image/png;base64,AAA');
  assert.equal(copy[1], null);
});

test('normalization pads missing layers and trims removed layers', () => {
  assert.deepEqual(normalizeRasterCels(['cel-a'], 3), ['cel-a', null, null]);
  assert.deepEqual(normalizeRasterCels(['a', 'b', 'c'], 1), ['a']);
});
