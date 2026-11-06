/**
 * Explicit cubic Bézier geometry for editable vector paths.
 *
 * Anchors remain separate from their incoming/outgoing control handles.
 * This model is intentionally additive: legacy FRAME strokes continue to use
 * their existing `points` representation until the renderer/editor migrates.
 */

const copyPoint = point => ({ x: Number(point.x), y: Number(point.y) });
const isFinitePoint = point => Number.isFinite(point?.x) && Number.isFinite(point?.y);

function assertPoint(point, label) {
  if (!isFinitePoint(point)) throw new TypeError(`${label} must contain finite x/y coordinates.`);
}

export function createBezierPath({ id = null, anchors, segments, anchorModes = null }) {
  if (!Array.isArray(anchors) || anchors.length < 2) {
    throw new RangeError('A Bézier path needs at least two anchors.');
  }
  if (!Array.isArray(segments) || segments.length !== anchors.length - 1) {
    throw new RangeError('A Bézier path needs exactly one segment between each pair of anchors.');
  }
  anchors.forEach((point, index) => assertPoint(point, `Anchor ${index}`));
  segments.forEach((segment, index) => {
    assertPoint(segment?.control1, `Segment ${index} control1`);
    assertPoint(segment?.control2, `Segment ${index} control2`);
  });
  const modes = anchorModes == null
    ? anchors.map((_, index) => index > 0 && index < anchors.length - 1 ? 'smooth' : 'corner')
    : anchorModes.slice();
  if (modes.length !== anchors.length || modes.some(mode => mode !== 'corner' && mode !== 'smooth')) {
    throw new RangeError('Each Bézier anchor needs a corner or smooth mode.');
  }
  return {
    id,
    anchors: anchors.map(copyPoint),
    anchorModes: modes,
    segments: segments.map(segment => ({
      control1: copyPoint(segment.control1),
      control2: copyPoint(segment.control2),
    })),
  };
}

/** Create a straight cubic path whose handles lie at one-third and two-thirds. */
export function createBezierPathFromAnchors(anchors, id = null) {
  if (!Array.isArray(anchors) || anchors.length < 2) {
    throw new RangeError('A Bézier path needs at least two anchors.');
  }
  const points = anchors.map(copyPoint);
  points.forEach((point, index) => assertPoint(point, `Anchor ${index}`));
  const segments = points.slice(0, -1).map((start, index) => {
    const end = points[index + 1];
    return {
      control1: {
        x: start.x + (end.x - start.x) / 3,
        y: start.y + (end.y - start.y) / 3,
      },
      control2: {
        x: start.x + (end.x - start.x) * 2 / 3,
        y: start.y + (end.y - start.y) * 2 / 3,
      },
    };
  });
  return createBezierPath({ id, anchors: points, segments });
}

export function cloneBezierPath(path) {
  return createBezierPath(path);
}

function distanceToChord(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length <= Number.EPSILON) return Math.hypot(point.x - start.x, point.y - start.y);
  return Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x) / length;
}

function splitCubic(p0, p1, p2, p3) {
  const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const p01 = midpoint(p0, p1);
  const p12 = midpoint(p1, p2);
  const p23 = midpoint(p2, p3);
  const p012 = midpoint(p01, p12);
  const p123 = midpoint(p12, p23);
  const p0123 = midpoint(p012, p123);
  return [
    [p0, p01, p012, p0123],
    [p0123, p123, p23, p3],
  ];
}

function sampleCubicAdaptive(points, tolerance, maxDepth, output, ranges, t0 = 0, t1 = 1, depth = 0) {
  const [p0, p1, p2, p3] = points;
  const flatness = Math.max(distanceToChord(p1, p0, p3), distanceToChord(p2, p0, p3));
  if (flatness <= tolerance || depth >= maxDepth) {
    output.push({ x: p3.x, y: p3.y });
    ranges.push({ t0, t1 });
    return;
  }
  const [left, right] = splitCubic(p0, p1, p2, p3);
  const middle = (t0 + t1) / 2;
  sampleCubicAdaptive(left, tolerance, maxDepth, output, ranges, t0, middle, depth + 1);
  sampleCubicAdaptive(right, tolerance, maxDepth, output, ranges, middle, t1, depth + 1);
}

/**
 * Adaptive De Casteljau sampling. segmentIndices[i] identifies the source
 * segment for the edge from points[i] to points[i + 1].
 */
export function sampleBezierPath(path, { tolerance = 0.75, maxDepth = 10 } = {}) {
  if (!path?.anchors || path.anchors.length < 2 || path.segments?.length !== path.anchors.length - 1) {
    return { points: [], segmentIndices: [] };
  }
  const flatness = Math.max(0.05, Number(tolerance) || 0.75);
  const depthLimit = Math.max(1, Math.min(16, Math.floor(Number(maxDepth) || 10)));
  const points = [copyPoint(path.anchors[0])];
  const segmentIndices = [];
  const segmentRanges = [];
  path.segments.forEach((segment, index) => {
    const before = points.length;
    sampleCubicAdaptive([
      path.anchors[index],
      segment.control1,
      segment.control2,
      path.anchors[index + 1],
    ], flatness, depthLimit, points, segmentRanges);
    for (let edge = before - 1; edge < points.length - 1; edge++) segmentIndices.push(index);
  });
  return { points, segmentIndices, segmentRanges };
}

/** Project a document point onto the sampled visible cubic path. */
export function projectPointToBezierPath(path, point, options = {}) {
  const sampled = sampleBezierPath(path, options);
  let best = { distance: Infinity, segmentIndex: -1, t: 0, point: null, edgeIndex: -1 };
  for (let index = 0; index < sampled.points.length - 1; index++) {
    const start = sampled.points[index];
    const end = sampled.points[index + 1];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const edgeT = lengthSquared > Number.EPSILON
      ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared))
      : 0;
    const projected = { x: start.x + dx * edgeT, y: start.y + dy * edgeT };
    const distance = Math.hypot(point.x - projected.x, point.y - projected.y);
    if (distance < best.distance) {
      const range = sampled.segmentRanges[index];
      best = {
        distance,
        segmentIndex: sampled.segmentIndices[index],
        t: range.t0 + (range.t1 - range.t0) * edgeT,
        point: projected,
        edgeIndex: index,
      };
    }
  }
  return best.segmentIndex < 0 ? null : best;
}

/** Split one cubic segment at t, preserving the original curve exactly. */
export function insertBezierAnchor(path, segmentIndex, t) {
  if (!path?.segments || !Number.isInteger(segmentIndex) || !path.segments[segmentIndex]) return path;
  const amount = Math.max(0.001, Math.min(0.999, Number(t)));
  if (!Number.isFinite(amount)) throw new TypeError('A finite split parameter is required.');
  const next = cloneBezierPath(path);
  const start = next.anchors[segmentIndex];
  const end = next.anchors[segmentIndex + 1];
  const segment = next.segments[segmentIndex];
  const lerp = (a, b) => ({
    x: a.x + (b.x - a.x) * amount,
    y: a.y + (b.y - a.y) * amount,
  });
  const p01 = lerp(start, segment.control1);
  const p12 = lerp(segment.control1, segment.control2);
  const p23 = lerp(segment.control2, end);
  const p012 = lerp(p01, p12);
  const p123 = lerp(p12, p23);
  const anchor = lerp(p012, p123);
  next.anchors.splice(segmentIndex + 1, 0, anchor);
  next.anchorModes.splice(segmentIndex + 1, 0, 'smooth');
  next.segments.splice(segmentIndex, 1,
    { control1: p01, control2: p012 },
    { control1: p123, control2: p23 },
  );
  return next;
}

/** Remove an interior anchor and fit one cubic using the adjacent endpoint tangents. */
export function removeBezierAnchor(path, anchorIndex) {
  if (!path?.anchors || !Number.isInteger(anchorIndex) || anchorIndex <= 0 || anchorIndex >= path.anchors.length - 1) {
    return path;
  }
  const next = cloneBezierPath(path);
  const start = next.anchors[anchorIndex - 1];
  const anchor = next.anchors[anchorIndex];
  const end = next.anchors[anchorIndex + 1];
  const incoming = next.segments[anchorIndex - 1];
  const outgoing = next.segments[anchorIndex];
  const incomingLength = Math.hypot(anchor.x - incoming.control2.x, anchor.y - incoming.control2.y);
  const outgoingLength = Math.hypot(outgoing.control1.x - anchor.x, outgoing.control1.y - anchor.y);
  const total = incomingLength + outgoingLength;
  const chordIncoming = Math.hypot(anchor.x - start.x, anchor.y - start.y);
  const chordOutgoing = Math.hypot(end.x - anchor.x, end.y - anchor.y);
  const chordTotal = chordIncoming + chordOutgoing;
  const ratio = total > Number.EPSILON
    ? incomingLength / total
    : (chordTotal > Number.EPSILON ? chordIncoming / chordTotal : 0.5);
  const split = Math.max(0.05, Math.min(0.95, ratio));
  const control1 = {
    x: start.x + (incoming.control1.x - start.x) / split,
    y: start.y + (incoming.control1.y - start.y) / split,
  };
  const control2 = {
    x: end.x + (outgoing.control2.x - end.x) / (1 - split),
    y: end.y + (outgoing.control2.y - end.y) / (1 - split),
  };
  next.anchors.splice(anchorIndex, 1);
  next.anchorModes.splice(anchorIndex, 1);
  next.segments.splice(anchorIndex - 1, 2, { control1, control2 });
  return next;
}

/** Move one control handle. Optionally mirror the opposite handle at its anchor. */
export function moveBezierHandle(path, segmentIndex, handle, point, { mirrorOpposite } = {}) {
  if (!path?.segments || !Number.isInteger(segmentIndex) || !path.segments[segmentIndex]) return path;
  if (handle !== 'out' && handle !== 'in') throw new RangeError('Handle must be "out" or "in".');
  assertPoint(point, 'Handle point');
  const next = cloneBezierPath(path);
  const segment = next.segments[segmentIndex];
  const isOutgoing = handle === 'out';
  const moved = isOutgoing ? segment.control1 : segment.control2;
  const anchorIndex = isOutgoing ? segmentIndex : segmentIndex + 1;
  const anchor = next.anchors[anchorIndex];
  const oppositeSegmentIndex = isOutgoing ? segmentIndex - 1 : segmentIndex + 1;
  const oppositeSegment = next.segments[oppositeSegmentIndex];
  const oppositeKey = isOutgoing ? 'control2' : 'control1';
  const opposite = oppositeSegment?.[oppositeKey];
  const oldOppositeLength = opposite ? Math.hypot(opposite.x - anchor.x, opposite.y - anchor.y) : 0;

  if (isOutgoing) segment.control1 = copyPoint(point);
  else segment.control2 = copyPoint(point);

  const shouldMirror = mirrorOpposite ?? next.anchorModes?.[anchorIndex] === 'smooth';
  if (shouldMirror && opposite && oldOppositeLength > 0) {
    const dx = point.x - anchor.x;
    const dy = point.y - anchor.y;
    const length = Math.hypot(dx, dy);
    if (length > Number.EPSILON) {
      oppositeSegment[oppositeKey] = {
        x: anchor.x - dx / length * oldOppositeLength,
        y: anchor.y - dy / length * oldOppositeLength,
      };
    }
  }
  return next;
}

export function setBezierAnchorMode(path, anchorIndex, mode) {
  if (!path?.anchors || !Number.isInteger(anchorIndex) || !path.anchors[anchorIndex]) return path;
  if (mode !== 'corner' && mode !== 'smooth') throw new RangeError('Anchor mode must be corner or smooth.');
  if (mode === 'smooth' && (anchorIndex === 0 || anchorIndex === path.anchors.length - 1)) {
    throw new RangeError('Endpoint anchors cannot use smooth mode because they have only one adjacent handle.');
  }
  const next = cloneBezierPath(path);
  next.anchorModes[anchorIndex] = mode;
  return next;
}

/** Move an anchor and the two handles attached to it, preserving local tangents. */
export function moveBezierAnchor(path, anchorIndex, point) {
  if (!path?.anchors || !Number.isInteger(anchorIndex) || !path.anchors[anchorIndex]) return path;
  assertPoint(point, 'Anchor point');
  const next = cloneBezierPath(path);
  const previous = next.anchors[anchorIndex];
  const dx = point.x - previous.x;
  const dy = point.y - previous.y;
  next.anchors[anchorIndex] = copyPoint(point);
  if (next.segments[anchorIndex - 1]) {
    const handle = next.segments[anchorIndex - 1].control2;
    next.segments[anchorIndex - 1].control2 = { x: handle.x + dx, y: handle.y + dy };
  }
  if (next.segments[anchorIndex]) {
    const handle = next.segments[anchorIndex].control1;
    next.segments[anchorIndex].control1 = { x: handle.x + dx, y: handle.y + dy };
  }
  return next;
}

/** Apply a Canvas2D affine matrix to anchors and all control handles. */
export function transformBezierPath(path, matrix) {
  if (!Array.isArray(matrix) || matrix.length !== 6 || !matrix.every(Number.isFinite)) {
    throw new TypeError('A finite six-value affine matrix is required.');
  }
  const [a, b, c, d, e, f] = matrix;
  const transform = point => ({ x: a * point.x + c * point.y + e, y: b * point.x + d * point.y + f });
  return {
    id: path.id ?? null,
    anchors: path.anchors.map(transform),
    anchorModes: path.anchorModes ? [...path.anchorModes] : path.anchors.map((_, index) => index > 0 && index < path.anchors.length - 1 ? 'smooth' : 'corner'),
    segments: path.segments.map(segment => ({
      control1: transform(segment.control1),
      control2: transform(segment.control2),
    })),
  };
}
