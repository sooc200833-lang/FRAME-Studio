import test from 'node:test';
import assert from 'node:assert/strict';
import { getVectorGraphicsCacheEntry, pruneVectorGraphicsCache } from '../apps/web/src/renderer/vector-graphics-cache.js';

function fakeGraphics() {
  return { clears: 0, clear() { this.clears++; } };
}

test('reuses graphics without rebuilding an unchanged immutable stroke', () => {
  const cache = new Map();
  const stroke = { id: 'line-1', points: [{ x: 1, y: 2 }, { x: 3, y: 4 }], color: '#123456', width: 4 };
  let created = 0, drawn = 0;
  const create = () => { created++; return fakeGraphics(); };
  const draw = () => { drawn++; };
  const first = getVectorGraphicsCacheEntry(cache, stroke, create, draw);
  const second = getVectorGraphicsCacheEntry(cache, stroke, create, draw);
  assert.equal(first, second);
  assert.equal(created, 1);
  assert.equal(drawn, 1);
  assert.equal(first.graphics.clears, 1);
});

test('invalidates cached graphics when stroke geometry or style changes', () => {
  const cache = new Map();
  const original = { id: 'line-1', points: [{ x: 1, y: 2 }, { x: 3, y: 4 }], color: '#123456', width: 4 };
  let drawn = 0;
  const create = fakeGraphics;
  const draw = () => { drawn++; };
  const first = getVectorGraphicsCacheEntry(cache, original, create, draw);
  const changed = { ...original, points: [{ x: 1, y: 2 }, { x: 8, y: 9 }] };
  const second = getVectorGraphicsCacheEntry(cache, changed, create, draw);
  assert.equal(first.graphics, second.graphics);
  assert.equal(drawn, 2);
  assert.equal(second.graphics.clears, 2);
});

test('prunes inactive stroke entries and releases their graphics', () => {
  const cache = new Map();
  const stroke = { id: 'line-1', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], color: '#000000', width: 2 };
  const entry = getVectorGraphicsCacheEntry(cache, stroke, fakeGraphics, () => {});
  const released = [];
  pruneVectorGraphicsCache(cache, new Set(), graphics => released.push(graphics));
  assert.equal(cache.size, 0);
  assert.deepEqual(released, [entry.graphics]);
});

test('detects in-place edits to point coordinates', () => {
  const cache = new Map();
  const stroke = { id: 'line-2', points: [{ x: 0, y: 0 }, { x: 5, y: 5 }], color: '#000000', width: 3 };
  let drawn = 0;
  getVectorGraphicsCacheEntry(cache, stroke, fakeGraphics, () => { drawn++; });
  stroke.points[1].x = 12;
  getVectorGraphicsCacheEntry(cache, stroke, fakeGraphics, () => { drawn++; });
  assert.equal(drawn, 2);
});
