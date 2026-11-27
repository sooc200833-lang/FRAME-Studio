import test from 'node:test';
import assert from 'node:assert/strict';
import { RASTER_BRUSHES, createRasterStroke, dabRadius, tipAlpha } from '../apps/web/src/brush/raster-brush.js';

const PARTICLES = ['spray', 'sparkle', 'stipple'];

function draw(brush, seed = 7) {
  const stroke = createRasterStroke({ brush, size: 20, seed });
  const dabs = [];
  for (let i = 0; i <= 40; i++) dabs.push(...stroke.add({ x: 10 + i * 5, y: 100, pressure: 0.6 }));
  dabs.push(...stroke.finish());
  return dabs;
}

test('particle brushes scatter particles around the path', () => {
  for (const id of PARTICLES) {
    const brush = RASTER_BRUSHES[id];
    const dabs = draw(brush);
    const reach = dabRadius(brush, 20, 1) * brush.scatter + 0.001;
    assert.ok(dabs.length >= 5, `${id} makes particles`);
    assert.ok(dabs.every(dab => Math.abs(dab.y - 100) <= reach), `${id} stays within scatter`);
    assert.ok(new Set(dabs.map(dab => Math.round(dab.y))).size > 3, `${id} actually scatters`);
    const centre = dabRadius(brush, 20, 1);
    assert.ok(dabs.every(dab => dab.radius <= centre * brush.particle + 1e-9), `${id} particles are small`);
  }
});

test('particles are seeded: the same stroke gives the same picture', () => {
  for (const id of PARTICLES) {
    assert.deepEqual(draw(RASTER_BRUSHES[id], 3), draw(RASTER_BRUSHES[id], 3));
    assert.notDeepEqual(draw(RASTER_BRUSHES[id], 3), draw(RASTER_BRUSHES[id], 4));
  }
});

test('spray lays several particles per step; sparkle rotates its stars', () => {
  // Every path step becomes exactly `count` particles.
  for (const id of PARTICLES) {
    const brush = RASTER_BRUSHES[id];
    const steps = draw({ ...brush, scatter: 0 }).length;
    assert.equal(draw(brush).length, steps * brush.count, id);
  }
  assert.ok(draw(RASTER_BRUSHES.sparkle).some(dab => dab.angle > 0));
  assert.ok(draw(RASTER_BRUSHES.stipple).every(dab => dab.angle === 0));
});

test('round brushes are unchanged by the particle code', () => {
  for (const id of ['pencil', 'ink', 'marker', 'brush', 'chalk', 'crayon']) {
    const dabs = draw(RASTER_BRUSHES[id]);
    // Path dabs sit exactly on the line.
    assert.ok(dabs.every(dab => dab.y === 100), id);
  }
});

test('star tip: long arms on the axes, narrow between them', () => {
  const star = { tip: 'star', hardness: 0.85 };
  assert.ok(tipAlpha(0.6, 0, star) > 0.5, 'arm along x');
  assert.ok(tipAlpha(0, 0.6, star) > 0.5, 'arm along y');
  assert.equal(tipAlpha(0.42, 0.42, star), 0, 'empty between arms');
  assert.ok(tipAlpha(0, 0, star) > 0.99);
  const round = { hardness: 0.85 };
  assert.ok(tipAlpha(0.42, 0.42, round) > 0.5, 'round tips are filled there');
});
