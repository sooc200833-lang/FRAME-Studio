import test from 'node:test';
import assert from 'node:assert/strict';
import { finishVectorPoints, shouldKeepVectorSample, vectorSampleSpacing } from '../apps/web/src/line/vector-input.js';
import { createLineStroke } from '../apps/web/src/line/line-engine.js';

test('pen-up never overwrites the last pressure with the lift pressure', () => {
  const points = [{ x: 0, y: 0, pressure: 0.2 }, { x: 10, y: 0, pressure: 0.25 }];
  const finished = finishVectorPoints(points, { x: 12, y: 0, pressure: 0 });
  assert.equal(finished.length, 3);
  assert.equal(finished[2].pressure, 0.25);
  assert.deepEqual(points.length, 2, 'input is not mutated');
});

test('pen-up at the last sample adds no duplicate point', () => {
  const points = [{ x: 0, y: 0, pressure: 0.9 }, { x: 10, y: 0, pressure: 0.8 }];
  assert.equal(finishVectorPoints(points, { x: 10.05, y: 0 }).length, 2);
});

test('a tap becomes a two-point dot at the tap pressure', () => {
  const finished = finishVectorPoints([{ x: 5, y: 5, pressure: 0.3 }], { x: 5, y: 5 });
  assert.equal(finished.length, 2);
  assert.deepEqual(finished.map(point => point.pressure), [0.3, 0.3]);
  // The committed stroke keeps that pressure too (no silent 0.5).
  assert.deepEqual(createLineStroke({ id: 'dot', points: finished }).points.map(point => point.pressure), [0.3, 0.3]);
});

test('preview points and committed points agree except for the end point', () => {
  const live = [{ x: 0, y: 0, pressure: 0.1 }, { x: 4, y: 1, pressure: 0.4 }, { x: 9, y: 3, pressure: 0.7 }];
  const committed = finishVectorPoints(live, { x: 9.5, y: 3.2, pressure: 0 });
  assert.deepEqual(committed.slice(0, live.length), live);
  assert.equal(committed.at(-1).pressure, 0.7);
});

test('samples: distance keeps, near duplicates drop, close pressure changes keep', () => {
  const previous = { x: 0, y: 0, pressure: 0.3 };
  assert.equal(shouldKeepVectorSample(previous, { x: 1.3, y: 0, pressure: 0.3 }), true);
  assert.equal(shouldKeepVectorSample(previous, { x: 0.5, y: 0, pressure: 0.31 }), false);
  assert.equal(shouldKeepVectorSample(previous, { x: 0.5, y: 0, pressure: 0.45 }), true);
  assert.equal(shouldKeepVectorSample(previous, { x: 0.1, y: 0, pressure: 0.9 }), false, 'never stack points on top of each other');
  assert.equal(shouldKeepVectorSample(null, { x: 0, y: 0 }), true);
});

test('a slow pressure ramp keeps its pressure steps', () => {
  // Pen moves 0.4 canvas units per sample while pressure ramps 0.1 → 0.9.
  // A distance-only 1.25 cutoff keeps every 4th sample (0.16 pressure jumps).
  const ramp = keep => {
    const kept = [{ x: 0, y: 0, pressure: 0.1 }];
    for (let i = 1; i <= 20; i++) {
      const sample = { x: i * 0.4, y: 0, pressure: 0.1 + 0.8 * i / 20 };
      if (keep(kept.at(-1), sample)) kept.push(sample);
    }
    return Math.max(...kept.slice(1).map((point, index) => point.pressure - kept[index].pressure));
  };
  const distanceOnly = ramp((a, b) => Math.hypot(b.x - a.x, b.y - a.y) >= 1.25);
  const withPressure = ramp((a, b) => shouldKeepVectorSample(a, b));
  assert.ok(distanceOnly > 0.15, `old rule loses steps (${distanceOnly.toFixed(3)})`);
  assert.ok(withPressure <= 0.081, `pressure steps stay small (${withPressure.toFixed(3)})`);
});

test('sample spacing follows zoom within bounds', () => {
  assert.equal(vectorSampleSpacing(1), 1.5);
  assert.equal(vectorSampleSpacing(0.1), 0.35);
  assert.equal(vectorSampleSpacing(10), 2.5);
  assert.equal(vectorSampleSpacing(Number.NaN), 1.25);
});
