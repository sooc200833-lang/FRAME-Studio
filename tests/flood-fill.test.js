import test from 'node:test';
import assert from 'node:assert/strict';
import { expandRegionMask, findConnectedRegion } from '../apps/web/src/fill/flood-fill.js';

function makeImage(width, height, color = [255, 255, 255, 255]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(color, i * 4);
  return data;
}
function setPixel(data, width, x, y, color) {
  data.set(color, (y * width + x) * 4);
}

test('finds only the 4-connected enclosed region', () => {
  const width = 5, height = 5, data = makeImage(width, height);
  for (let x = 1; x <= 3; x++) {
    setPixel(data, width, x, 1, [0, 0, 0, 255]);
    setPixel(data, width, x, 3, [0, 0, 0, 255]);
  }
  for (let y = 1; y <= 3; y++) {
    setPixel(data, width, 1, y, [0, 0, 0, 255]);
    setPixel(data, width, 3, y, [0, 0, 0, 255]);
  }
  const result = findConnectedRegion({ data, width, height, x: 2, y: 2 });
  assert.equal(result.count, 1);
  assert.equal(result.mask[12], 1);
  assert.equal(result.mask[0], 0);
});

test('tolerance includes nearby antialias colors but excludes distant colors', () => {
  const width = 3, height = 1, data = makeImage(width, height, [100, 100, 100, 255]);
  setPixel(data, width, 1, 0, [108, 108, 108, 255]);
  setPixel(data, width, 2, 0, [150, 150, 150, 255]);
  const result = findConnectedRegion({ data, width, height, x: 0, y: 0, tolerance: 10 });
  assert.equal(result.count, 2);
  assert.equal(result.mask[2], 0);
});

test('edge expansion respects opaque line-art protection', () => {
  const width = 5, height = 3;
  const mask = new Uint8Array(width * height);
  const protection = new Uint8Array(width * height);
  mask[6] = 1;
  protection[7] = 255;
  const expanded = expandRegionMask(mask, width, height, 1, protection);
  assert.equal(expanded[6], 1);
  assert.equal(expanded[7], 0);
  assert.equal(expanded[0], 1);
});

test('expansion stays within image bounds and clamps to four pixels', () => {
  const mask = new Uint8Array(25);
  mask[0] = 1;
  const expanded = expandRegionMask(mask, 5, 5, 99);
  assert.equal(expanded.length, 25);
  assert.equal(expanded[24], 1);
});
