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

import { cloneRasterTransformCels, normalizeRasterTransformCels } from '../apps/web/src/animation/frame-cels.js';

const transform = {
  id: 'transform-1',
  sourceDataUrl: 'data:image/png;base64,AA==',
  clipPolygon: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }],
  matrix: [1, 0, 0, 1, 8, 9],
};

test('transform cels are deeply cloned by layer and operation', () => {
  const copy = cloneRasterTransformCels([[transform]]);
  copy[0][0].clipPolygon[0].x = 100;
  copy[0][0].matrix[4] = 200;
  assert.equal(transform.clipPolygon[0].x, 0);
  assert.equal(transform.matrix[4], 8);
});

test('transform cel normalization pads and trims layer slots', () => {
  assert.deepEqual(normalizeRasterTransformCels([[transform]], 2), [[transform], []]);
  assert.deepEqual(normalizeRasterTransformCels([[transform], [], []], 1), [[transform]]);
});
