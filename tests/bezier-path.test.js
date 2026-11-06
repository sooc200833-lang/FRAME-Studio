import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBezierPath,
  createBezierPathFromAnchors,
  cloneBezierPath,
  insertBezierAnchor,
  projectPointToBezierPath,
  sampleBezierPath,
  moveBezierHandle,
  moveBezierAnchor,
  setBezierAnchorMode,
  transformBezierPath,
} from '../apps/web/src/line/bezier-path.js';

const curvedPath = () => createBezierPath({
  id: 'curve-1',
  anchors: [{ x: 0, y: 0 }, { x: 120, y: 0 }],
  segments: [{ control1: { x: 30, y: 90 }, control2: { x: 90, y: 90 } }],
});

test('creates an explicit cubic path with copied anchors and handles', () => {
  const anchors = [{ x: 0, y: 0 }, { x: 90, y: 0 }];
  const segments = [{ control1: { x: 30, y: 40 }, control2: { x: 60, y: 40 } }];
  const path = createBezierPath({ id: 'a', anchors, segments });
  anchors[0].x = 500;
  segments[0].control1.x = 500;
  assert.deepEqual(path.anchors[0], { x: 0, y: 0 });
  assert.deepEqual(path.segments[0].control1, { x: 30, y: 40 });
});

test('rejects malformed anchor and segment counts', () => {
  assert.throws(() => createBezierPath({ anchors: [{ x: 0, y: 0 }], segments: [] }), RangeError);
  assert.throws(() => createBezierPath({
    anchors: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    segments: [],
  }), RangeError);
  assert.throws(() => createBezierPathFromAnchors([{ x: 0, y: NaN }, { x: 1, y: 1 }]), TypeError);
});

test('creates straight-line handles at one-third and two-thirds', () => {
  const path = createBezierPathFromAnchors([{ x: 0, y: 3 }, { x: 90, y: 30 }], 'straight');
  assert.deepEqual(path.segments[0], {
    control1: { x: 30, y: 12 },
    control2: { x: 60, y: 21 },
  });
});

test('adaptive sampling follows cubic curvature and preserves endpoints', () => {
  const path = curvedPath();
  const sampled = sampleBezierPath(path, { tolerance: 0.5 });
  assert.ok(sampled.points.length > 3);
  assert.deepEqual(sampled.points[0], path.anchors[0]);
  assert.deepEqual(sampled.points.at(-1), path.anchors[1]);
  assert.equal(sampled.segmentIndices.length, sampled.points.length - 1);
  assert.ok(Math.max(...sampled.points.map(point => point.y)) > 60);
});

test('moving an outgoing handle changes only its control geometry', () => {
  const path = curvedPath();
  const moved = moveBezierHandle(path, 0, 'out', { x: 30, y: 150 });
  assert.deepEqual(moved.anchors, path.anchors);
  assert.deepEqual(moved.segments[0].control1, { x: 30, y: 150 });
  assert.deepEqual(path.segments[0].control1, { x: 30, y: 90 });
});

test('linked handle movement mirrors direction and preserves opposite handle length', () => {
  const path = createBezierPath({
    anchors: [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 120, y: 0 }],
    segments: [
      { control1: { x: 20, y: 0 }, control2: { x: 40, y: 0 } },
      { control1: { x: 80, y: 0 }, control2: { x: 100, y: 0 } },
    ],
  });
  const moved = moveBezierHandle(path, 1, 'out', { x: 60, y: 20 }, { mirrorOpposite: true });
  assert.deepEqual(moved.segments[0].control2, { x: 60, y: -20 });
  assert.deepEqual(moved.segments[1].control1, { x: 60, y: 20 });
});

test('moving an anchor carries its adjacent handles without changing tangent offsets', () => {
  const path = createBezierPath({
    anchors: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }],
    segments: [
      { control1: { x: 10, y: 0 }, control2: { x: 40, y: 0 } },
      { control1: { x: 60, y: 0 }, control2: { x: 90, y: 0 } },
    ],
  });
  const moved = moveBezierAnchor(path, 1, { x: 50, y: 20 });
  assert.deepEqual(moved.segments[0].control2, { x: 40, y: 20 });
  assert.deepEqual(moved.segments[1].control1, { x: 60, y: 20 });
  assert.deepEqual(path.anchors[1], { x: 50, y: 0 });
});

test('affine transforms move anchors and both control handles', () => {
  const path = curvedPath();
  const moved = transformBezierPath(path, [2, 0, 0, 3, 5, -4]);
  assert.deepEqual(moved.anchors[1], { x: 245, y: -4 });
  assert.deepEqual(moved.segments[0].control1, { x: 65, y: 266 });
  assert.deepEqual(moved.segments[0].control2, { x: 185, y: 266 });
});

test('clone returns independent geometry', () => {
  const original = curvedPath();
  const copy = cloneBezierPath(original);
  copy.segments[0].control1.x = 999;
  assert.equal(original.segments[0].control1.x, 30);
});


test('interior anchors default to smooth mode and endpoints default to corner mode', () => {
  const path = createBezierPath({
    anchors: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }],
    segments: [
      { control1: { x: 10, y: 0 }, control2: { x: 40, y: 0 } },
      { control1: { x: 60, y: 0 }, control2: { x: 90, y: 0 } },
    ],
  });
  assert.deepEqual(path.anchorModes, ['corner', 'smooth', 'corner']);
});

test('smooth anchors mirror the opposite handle by default', () => {
  const path = createBezierPath({
    anchors: [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 120, y: 0 }],
    segments: [
      { control1: { x: 20, y: 0 }, control2: { x: 40, y: 0 } },
      { control1: { x: 80, y: 0 }, control2: { x: 100, y: 0 } },
    ],
  });
  const moved = moveBezierHandle(path, 1, 'out', { x: 60, y: 20 });
  assert.deepEqual(moved.segments[0].control2, { x: 60, y: -20 });
});

test('corner mode leaves the opposite handle independent; smooth mode restores linking', () => {
  const path = createBezierPath({
    anchors: [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 120, y: 0 }],
    segments: [
      { control1: { x: 20, y: 0 }, control2: { x: 40, y: 0 } },
      { control1: { x: 80, y: 0 }, control2: { x: 100, y: 0 } },
    ],
  });
  const corner = setBezierAnchorMode(path, 1, 'corner');
  const independent = moveBezierHandle(corner, 1, 'out', { x: 60, y: 20 });
  assert.deepEqual(independent.segments[0].control2, { x: 40, y: 0 });
  const smooth = setBezierAnchorMode(corner, 1, 'smooth');
  const linked = moveBezierHandle(smooth, 1, 'out', { x: 60, y: 20 });
  assert.deepEqual(linked.segments[0].control2, { x: 60, y: -20 });
  assert.throws(() => setBezierAnchorMode(path, 0, 'smooth'), RangeError);
});

test('anchor modes survive cloning and affine transforms', () => {
  const path = createBezierPath({
    anchors: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }],
    segments: [
      { control1: { x: 10, y: 0 }, control2: { x: 40, y: 0 } },
      { control1: { x: 60, y: 0 }, control2: { x: 90, y: 0 } },
    ],
  });
  const corner = setBezierAnchorMode(path, 1, 'corner');
  assert.deepEqual(cloneBezierPath(corner).anchorModes, ['corner', 'corner', 'corner']);
  assert.deepEqual(transformBezierPath(corner, [1, 0, 0, 1, 5, 8]).anchorModes, corner.anchorModes);
});


function evaluateCubic(start, control1, control2, end, t) {
  const inverse = 1 - t;
  return {
    x: inverse ** 3 * start.x + 3 * inverse ** 2 * t * control1.x + 3 * inverse * t ** 2 * control2.x + t ** 3 * end.x,
    y: inverse ** 3 * start.y + 3 * inverse ** 2 * t * control1.y + 3 * inverse * t ** 2 * control2.y + t ** 3 * end.y,
  };
}

test('adaptive samples expose parameter ranges for every rendered edge', () => {
  const sampled = sampleBezierPath(curvedPath());
  assert.equal(sampled.segmentRanges.length, sampled.points.length - 1);
  assert.equal(sampled.segmentRanges[0].t0, 0);
  assert.equal(sampled.segmentRanges.at(-1).t1, 1);
  sampled.segmentRanges.slice(1).forEach((range, index) => {
    assert.equal(range.t0, sampled.segmentRanges[index].t1);
  });
});

test('projects onto the visible curve and reports its source segment parameter', () => {
  const projection = projectPointToBezierPath(curvedPath(), { x: 60, y: 67.5 });
  assert.equal(projection.segmentIndex, 0);
  assert.ok(Math.abs(projection.t - 0.5) < 0.01);
  assert.ok(projection.distance < 0.1);
});

test('inserting an anchor splits a cubic without changing its shape', () => {
  const original = curvedPath();
  const inserted = insertBezierAnchor(original, 0, 0.4);
  assert.equal(inserted.anchors.length, 3);
  assert.equal(inserted.segments.length, 2);
  assert.equal(inserted.anchorModes[1], 'smooth');
  const expected = evaluateCubic(original.anchors[0], original.segments[0].control1, original.segments[0].control2, original.anchors[1], 0.4);
  assert.ok(Math.abs(inserted.anchors[1].x - expected.x) < 1e-9);
  assert.ok(Math.abs(inserted.anchors[1].y - expected.y) < 1e-9);
  const leftAtHalf = evaluateCubic(inserted.anchors[0], inserted.segments[0].control1, inserted.segments[0].control2, inserted.anchors[1], 0.5);
  const originalAtPointTwo = evaluateCubic(original.anchors[0], original.segments[0].control1, original.segments[0].control2, original.anchors[1], 0.2);
  assert.ok(Math.abs(leftAtHalf.x - originalAtPointTwo.x) < 1e-9);
  assert.ok(Math.abs(leftAtHalf.y - originalAtPointTwo.y) < 1e-9);
  assert.equal(original.anchors.length, 2);
});

test('rejects non-finite Bézier split parameters', () => {
  assert.throws(() => insertBezierAnchor(curvedPath(), 0, NaN), TypeError);
});
