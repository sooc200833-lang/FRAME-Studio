import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RASTER_BRUSHES, applyPressureCurve, createRasterStroke, dabAlpha, dabBounds, dabRadius, getRasterBrush, tipFalloff,
} from '../apps/web/src/brush/raster-brush.js';

const ink = RASTER_BRUSHES.ink;
const run = (stroke, samples) => [...samples.flatMap(sample => stroke.add(sample)), ...stroke.finish()];
const line = (from, to, steps, pressure = () => 0.5) => Array.from({ length: steps + 1 }, (_, index) => ({
  x: from.x + (to.x - from.x) * index / steps,
  y: from.y + (to.y - from.y) * index / steps,
  pressure: pressure(index / steps),
}));

test('every UI preset id resolves, unknown ids fall back to ink', () => {
  for (const id of ['pencil', 'ink', 'marker', 'brush']) assert.equal(getRasterBrush(id).id, id);
  assert.equal(getRasterBrush('nope').id, 'ink');
});

test('a tap produces exactly one dab at the tap point', () => {
  const stroke = createRasterStroke({ brush: ink, size: 20, stylus: true });
  const dabs = run(stroke, [{ x: 50, y: 60, pressure: 0.8 }]);
  assert.equal(dabs.length, 1);
  assert.deepEqual([dabs[0].x, dabs[0].y], [50, 60]);
});

test('dabs are evenly spaced by brush spacing along the path', () => {
  const stroke = createRasterStroke({ brush: ink, size: 20, stylus: false, streamline: 0 });
  const dabs = run(stroke, line({ x: 0, y: 0 }, { x: 200, y: 0 }, 7));
  const step = 20 * ink.sizeScale * ink.spacing; // full pressure diameter × spacing
  for (let index = 1; index < dabs.length; index++) {
    assert.ok(Math.abs(dabs[index].x - dabs[index - 1].x - step) < 1e-6, `gap ${index}`);
  }
  assert.ok(dabs.at(-1).x > 200 - step - 1e-6, 'reaches the end');
});

test('spacing does not depend on how many samples the pointer sent', () => {
  const sparse = run(createRasterStroke({ brush: ink, size: 16, streamline: 0 }), line({ x: 0, y: 0 }, { x: 160, y: 0 }, 2));
  const dense = run(createRasterStroke({ brush: ink, size: 16, streamline: 0 }), line({ x: 0, y: 0 }, { x: 160, y: 0 }, 64));
  assert.equal(sparse.length, dense.length);
});

test('mouse and finger strokes use full pressure; pen pressure changes size', () => {
  const mouse = run(createRasterStroke({ brush: ink, size: 20, stylus: false, streamline: 0 }), line({ x: 0, y: 0 }, { x: 40, y: 0 }, 4, () => 0));
  assert.ok(mouse.every(dab => Math.abs(dab.radius - 10) < 1e-9), 'full size without a pen');
  const pen = run(createRasterStroke({ brush: ink, size: 20, stylus: true, streamline: 0, pressureCurve: 1 }), line({ x: 0, y: 0 }, { x: 200, y: 0 }, 20, t => t));
  assert.ok(pen[0].radius < pen.at(-1).radius, 'radius grows with pressure');
  assert.ok(pen.at(-1).radius <= 10 + 1e-9);
});

test('pressure curve, radius and alpha mapping', () => {
  assert.equal(applyPressureCurve(0.5, 1), 0.5);
  assert.ok(applyPressureCurve(0.5, 2) < 0.5);
  assert.ok(applyPressureCurve(0.5, 0.5) > 0.5);
  assert.equal(applyPressureCurve(Number.NaN, 1), 0.5);
  const pencil = RASTER_BRUSHES.pencil;
  assert.ok(dabAlpha(pencil, 0.1) < dabAlpha(pencil, 1));
  assert.equal(dabAlpha(ink, 0.1), 1, 'ink alpha ignores pressure');
  assert.ok(dabRadius(ink, 20, 0) > 0);
});

test('streamline smooths jitter but the stroke still ends at the pen', () => {
  const jitter = Array.from({ length: 40 }, (_, index) => ({ x: index * 5, y: index % 2 ? 6 : -6, pressure: 0.5 }));
  const rough = run(createRasterStroke({ brush: ink, size: 6, streamline: 0 }), jitter);
  const smooth = run(createRasterStroke({ brush: ink, size: 6, streamline: 0.8 }), jitter);
  // Ignore the start and the final catch-up to the pen tip.
  const spread = dabs => Math.max(...dabs.filter(dab => dab.x > 30 && dab.x < 160).map(dab => Math.abs(dab.y)));
  assert.ok(spread(smooth) < spread(rough) / 2);
  const end = smooth.at(-1);
  assert.ok(Math.hypot(end.x - 195, end.y - 6) < 3, 'finish catches up to the last sample');
});

test('grain rotation is deterministic per seed', () => {
  const samples = line({ x: 0, y: 0 }, { x: 80, y: 0 }, 8);
  const a = run(createRasterStroke({ brush: RASTER_BRUSHES.pencil, size: 10, seed: 7 }), samples).map(dab => dab.angle);
  const b = run(createRasterStroke({ brush: RASTER_BRUSHES.pencil, size: 10, seed: 7 }), samples).map(dab => dab.angle);
  assert.deepEqual(a, b);
  assert.ok(new Set(a).size > 1);
});

test('tip falloff is solid in the core and zero at the edge', () => {
  assert.equal(tipFalloff(0, 0.5), 1);
  assert.equal(tipFalloff(0.5, 0.5), 1);
  assert.equal(tipFalloff(1, 0.5), 0);
  assert.ok(tipFalloff(0.75, 0.5) > 0 && tipFalloff(0.75, 0.5) < 1);
});

test('dab bounds cover every dab', () => {
  assert.equal(dabBounds([]), null);
  assert.deepEqual(dabBounds([{ x: 10, y: 10, radius: 2 }, { x: 20, y: 5, radius: 3 }]), { x: 8, y: 2, width: 15, height: 10 });
});
