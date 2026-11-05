import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createLineStroke,
  hitTestLineStroke,
  hitTestLineStrokes,
  translateLineStroke,
  updateLineStrokeStyle,
  smoothLineStroke,
  simplifyLineStroke,
} from '../apps/web/src/line/line-engine.js';

const line = () => createLineStroke({
  id: 'line-1',
  points: [{ x: 10, y: 10 }, { x: 100, y: 10 }, { x: 100, y: 80 }],
  color: '#24242a',
  width: 6,
});

test('creates an independently identified line with copied points', () => {
  const source = [{ x: 1, y: 2 }, { x: 3, y: 4 }];
  const created = createLineStroke({ id: 'a', points: source });
  source[0].x = 99;
  assert.equal(created.points[0].x, 1);
  assert.equal(created.id, 'a');
});

test('hit testing detects near the stroke and rejects distant points', () => {
  const stroke = line();
  assert.equal(hitTestLineStroke(stroke, { x: 50, y: 13 }, 2), true);
  assert.equal(hitTestLineStroke(stroke, { x: 50, y: 40 }, 2), false);
});

test('topmost matching stroke is selected first', () => {
  const lower = line();
  const upper = { ...line(), id: 'line-2', width: 12 };
  assert.equal(hitTestLineStrokes([lower, upper], { x: 50, y: 12 }, 3).id, 'line-2');
});

test('translation moves every point without mutating the original', () => {
  const original = line();
  const moved = translateLineStroke(original, 5, -3);
  assert.deepEqual(moved.points[0], { x: 15, y: 7 });
  assert.deepEqual(original.points[0], { x: 10, y: 10 });
});

test('style updates preserve identity and geometry', () => {
  const original = line();
  const updated = updateLineStrokeStyle(original, { color: '#e95d4f', width: 14 });
  assert.equal(updated.id, original.id);
  assert.deepEqual(updated.points, original.points);
  assert.equal(updated.color, '#e95d4f');
  assert.equal(updated.width, 14);
});

test('smoothing softens vector corners while preserving endpoints and style', () => {
  const original = line();
  const smoothed = smoothLineStroke(original, 1);
  assert.ok(smoothed.points.length > original.points.length);
  assert.deepEqual(smoothed.points[0], original.points[0]);
  assert.deepEqual(smoothed.points.at(-1), original.points.at(-1));
  assert.equal(smoothed.id, original.id);
  assert.equal(smoothed.color, original.color);
  assert.deepEqual(original.points[1], { x: 100, y: 10 });
});

test('smoothing clamps iteration count to keep geometry bounded', () => {
  const result = smoothLineStroke(line(), 99);
  assert.equal(result.points.length, 2 + (line().points.length - 2) * 16 + 2 * 15);
});

test('simplification removes near-collinear nodes and preserves endpoints', () => {
  const original = createLineStroke({
    id: 'dense',
    points: [{ x: 0, y: 0 }, { x: 10, y: 0.2 }, { x: 20, y: -0.1 }, { x: 30, y: 0 }],
  });
  const simplified = simplifyLineStroke(original, 1);
  assert.equal(simplified.points.length, 2);
  assert.deepEqual(simplified.points[0], original.points[0]);
  assert.deepEqual(simplified.points.at(-1), original.points.at(-1));
  assert.equal(original.points.length, 4);
});

test('simplification retains meaningful corners above tolerance', () => {
  const original = line();
  const simplified = simplifyLineStroke(original, 2);
  assert.ok(simplified.points.length >= 3);
});
