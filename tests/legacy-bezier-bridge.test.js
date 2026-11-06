import test from 'node:test';
import assert from 'node:assert/strict';
import { convertLegacyPointsToBezierPath } from '../apps/web/src/line/legacy-bezier-bridge.js';
import { sampleBezierPath } from '../apps/web/src/line/bezier-path.js';

function evaluateCubic(start, control1, control2, end, t) {
  const u = 1 - t;
  return {
    x: u ** 3 * start.x + 3 * u ** 2 * t * control1.x + 3 * u * t ** 2 * control2.x + t ** 3 * end.x,
    y: u ** 3 * start.y + 3 * u ** 2 * t * control1.y + 3 * u * t ** 2 * control2.y + t ** 3 * end.y,
  };
}

function evaluateLegacyQuadratic(start, control, end, t) {
  const u = 1 - t;
  return {
    x: u * u * start.x + 2 * u * t * control.x + t * t * end.x,
    y: u * u * start.y + 2 * u * t * control.y + t * t * end.y,
  };
}

test('converts a two-point legacy stroke into an exactly straight cubic segment', () => {
  const path = convertLegacyPointsToBezierPath([{ x: 3, y: 6 }, { x: 93, y: 36 }], 'legacy');
  assert.equal(path.id, 'legacy');
  assert.deepEqual(path.anchors, [{ x: 3, y: 6 }, { x: 93, y: 36 }]);
  assert.deepEqual(path.segments[0], {
    control1: { x: 33, y: 16 },
    control2: { x: 63, y: 26 },
  });
});

test('converts each legacy quadratic segment without changing its curve', () => {
  const points = [{ x: 0, y: 0 }, { x: 50, y: 100 }, { x: 100, y: 0 }];
  const path = convertLegacyPointsToBezierPath(points);
  const end = { x: 75, y: 50 };
  assert.deepEqual(path.anchors, [{ x: 0, y: 0 }, end, points[2]]);
  for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
    const actual = evaluateCubic(path.anchors[0], path.segments[0].control1, path.segments[0].control2, end, t);
    const expected = evaluateLegacyQuadratic(points[0], points[1], end, t);
    assert.ok(Math.abs(actual.x - expected.x) < 1e-9);
    assert.ok(Math.abs(actual.y - expected.y) < 1e-9);
  }
});

test('converts multiple legacy control nodes into contiguous cubic segments', () => {
  const points = [
    { x: 0, y: 0 }, { x: 20, y: 60 }, { x: 60, y: -20 }, { x: 100, y: 20 },
  ];
  const path = convertLegacyPointsToBezierPath(points, 'multi');
  assert.equal(path.anchors.length, points.length);
  assert.equal(path.segments.length, points.length - 1);
  assert.deepEqual(path.anchors[0], points[0]);
  assert.deepEqual(path.anchors.at(-1), points.at(-1));
  assert.equal(sampleBezierPath(path).segmentIndices.at(-1), path.segments.length - 1);
});

test('rejects invalid legacy point data', () => {
  assert.throws(() => convertLegacyPointsToBezierPath([]), RangeError);
  assert.throws(() => convertLegacyPointsToBezierPath([{ x: 0, y: 0 }, { x: NaN, y: 2 }]), TypeError);
});
