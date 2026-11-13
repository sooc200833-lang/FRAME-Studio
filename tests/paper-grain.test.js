import test from 'node:test';
import assert from 'node:assert/strict';
import { PAPER_KINDS, PAPER_TILE, RASTER_BRUSHES, paperGrain } from '../apps/web/src/brush/raster-brush.js';

const at = (tile, x, y, size = PAPER_TILE) => tile[((y + size) % size) * size + ((x + size) % size)];

test('every texture brush names a known paper', () => {
  const textured = Object.values(RASTER_BRUSHES).filter(brush => brush.paper);
  assert.deepEqual(textured.map(brush => brush.id).sort(), ['chalk', 'crayon']);
  for (const brush of textured) assert.ok(PAPER_KINDS.includes(brush.paper));
});

test('paper grain is deterministic and has real holes and paint', () => {
  for (const kind of PAPER_KINDS) {
    const a = paperGrain(kind);
    assert.deepEqual(a, paperGrain(kind));
    let sum = 0; let holes = 0; let solid = 0;
    for (const value of a) { sum += value; if (value < 30) holes++; if (value > 225) solid++; }
    const coverage = sum / 255 / a.length;
    assert.ok(coverage > 0.4 && coverage < 0.9, `${kind} coverage ${coverage.toFixed(2)}`);
    assert.ok(holes / a.length > 0.05, `${kind} has holes`);
    assert.ok(solid / a.length > 0.2, `${kind} has solid paint`);
  }
});

test('paper grain tiles without a seam', () => {
  for (const kind of PAPER_KINDS) {
    const tile = paperGrain(kind);
    // Step across the wrap edge vs. an ordinary step inside the tile.
    let seam = 0; let inside = 0;
    for (let i = 0; i < PAPER_TILE; i++) {
      seam += Math.abs(at(tile, PAPER_TILE - 1, i) - at(tile, 0, i)) + Math.abs(at(tile, i, PAPER_TILE - 1) - at(tile, i, 0));
      inside += Math.abs(at(tile, 99, i) - at(tile, 100, i)) + Math.abs(at(tile, i, 99) - at(tile, i, 100));
    }
    assert.ok(seam < inside * 1.6, `${kind}: seam ${seam} vs inside ${inside}`);
  }
});

test('unknown paper is rejected', () => {
  assert.throws(() => paperGrain('velvet'), RangeError);
});
