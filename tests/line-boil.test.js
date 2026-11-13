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

test('line boil keeps endpoints stable and moves the middle along its normal', () => {
  const result = computeLineBoilPoints(stroke, { phase: 1.1, amplitude: 8 });
  assert.deepEqual(result[0], stroke.points[0]);
  assert.deepEqual(result.at(-1), stroke.points.at(-1));
  assert.notDeepEqual(result[10], stroke.points[10]);
  assert.equal(result[10].x, stroke.points[10].x);
});

test('same id and phase produce deterministic animation', () => {
  const settings = { phase: 2.4, amplitude: 4, frequency: 0.1 };
  assert.deepEqual(computeLineBoilPoints(stroke, settings), computeLineBoilPoints(stroke, settings));
});

test('wave spacing is based on travelled distance, not point count', () => {
  const dense = {
    ...stroke,
    points: Array.from({ length: 201 }, (_, index) => ({ x: index, y: 100 })),
  };
  const sparseResult = computeLineBoilPoints(stroke, { phase: 1.7, amplitude: 7, frequency: 0.1 });
  const denseResult = computeLineBoilPoints(dense, { phase: 1.7, amplitude: 7, frequency: 0.1 });
  for (let index = 2; index < 19; index += 2) {
    assert.ok(Math.abs(sparseResult[index].y - denseResult[index * 10].y) < 1e-8);
  }
});

test('normal displacement follows the local curve normal', () => {
  const curved = {
    ...stroke,
    points: Array.from({ length: 41 }, (_, index) => ({
      x: index * 5,
      y: 120 + Math.sin(index / 40 * Math.PI) * 70,
    })),
  };
  const result = computeLineBoilPoints(curved, { phase: 0.9, amplitude: 5 });
  const index = 20;
  const before = curved.points[index - 1];
  const after = curved.points[index + 1];
  const tangent = { x: after.x - before.x, y: after.y - before.y };
  const delta = { x: result[index].x - curved.points[index].x, y: result[index].y - curved.points[index].y };
  assert.ok(Math.abs(delta.x * tangent.x + delta.y * tangent.y) < 1e-6);
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

test('lines left at the fixed style follow the global boil amplitude', () => {
  const fixed = { ...structuredClone(stroke), id: 'fixed-line', motionStyle: 'none', motionStrength: 3 };
  const moved = animateLineStrokes([fixed], { phase: 1.3, amplitude: 6 })[0];
  assert.notDeepEqual(moved.points, fixed.points, 'global boil moves a fixed line');
  const still = animateLineStrokes([fixed], { phase: 1.3, amplitude: 0 })[0];
  assert.deepEqual(still.points, fixed.points, 'amplitude 0 leaves it still');
  const own = { ...structuredClone(stroke), id: 'own-line', motionStyle: 'redraw', motionStrength: 4 };
  assert.equal(animateLineStrokes([own], { phase: 1, amplitude: 0 })[0].motionPasses.length, 3, 'a line with its own style keeps its own strength');
});


test('boiling brush creates three deterministic phase-shifted contour passes', () => {
  const boiling = { ...structuredClone(stroke), id: 'boiling-line', motionStyle: 'boil', motionStrength: 6 };
  const first = animateLineStrokes([boiling], { phase: 1.2, amplitude: 4 })[0];
  const second = animateLineStrokes([boiling], { phase: 1.2, amplitude: 4 })[0];
  assert.equal(first.motionPasses.length, 3);
  assert.deepEqual(first.motionPasses, second.motionPasses);
  assert.notDeepEqual(first.motionPasses[0].points, first.motionPasses[1].points);
  assert.deepEqual(boiling.points, stroke.points, 'source geometry remains untouched');
});

test('per-stroke animated styles produce motion while global amplitude is zero', () => {
  for (const style of ['wave', 'redraw', 'flicker', 'boil']) {
    const animated = { ...structuredClone(stroke), id: 'animated-' + style, motionStyle: style, motionStrength: 5 };
    const result = animateLineStrokes([animated], { phase: 0.7, amplitude: 0 })[0];
    if (style === 'wave') assert.notDeepEqual(result.points, animated.points);
    else assert.ok(result.motionPasses?.length, style + ' has rendered passes');
  }
});

test('static lines remain static when global amplitude is zero', () => {
  const fixed = { ...structuredClone(stroke), motionStyle: 'none' };
  const result = animateLineStrokes([fixed], { phase: 2, amplitude: 0 })[0];
  assert.equal(result.motionPasses, null);
  assert.deepEqual(result.points, fixed.points);
});
