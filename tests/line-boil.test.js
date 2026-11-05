import test from 'node:test';
import assert from 'node:assert/strict';
import { animateLineStrokes, computeLineBoilPoints, lineBoilPhase } from '../apps/web/src/line/line-boil.js';

const stroke = {
  id: 'line-stable-1',
  color: '#24242a',
  width: 5,
  points: Array.from({ length: 21 }, (_, index) => ({ x: index * 10, y: 100 })),
};

test('zero amplitude preserves every source point', () => {
  const result = computeLineBoilPoints(stroke, { phase: 1.2, amplitude: 0 });
  assert.deepEqual(result, stroke.points);
});

test('line boil changes interior points but preserves endpoints', () => {
  const result = computeLineBoilPoints(stroke, { phase: 1.1, amplitude: 8 });
  assert.deepEqual(result[0], stroke.points[0]);
  assert.deepEqual(result.at(-1), stroke.points.at(-1));
  assert.notDeepEqual(result[10], stroke.points[10]);
});

test('same id and phase produce deterministic animation', () => {
  const settings = { phase: 2.4, amplitude: 4, frequency: 0.1 };
  assert.deepEqual(
    computeLineBoilPoints(stroke, settings),
    computeLineBoilPoints(stroke, settings),
  );
});

test('animated copies do not mutate original line geometry', () => {
  const original = structuredClone(stroke);
  const result = animateLineStrokes([stroke], { phase: 0.8, amplitude: 6 });
  assert.notDeepEqual(result[0].points, stroke.points);
  assert.deepEqual(stroke, original);
  assert.equal(result[0].id, stroke.id);
});

test('phase follows playback speed and clamps negative elapsed time', () => {
  assert.equal(lineBoilPhase(-10, 1), 0);
  assert.equal(lineBoilPhase(1000, 1), Math.PI * 2);
});
