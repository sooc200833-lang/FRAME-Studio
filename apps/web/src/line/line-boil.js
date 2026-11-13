import { sampleBezierPath } from './bezier-path.js';

function hashId(id) {
  let hash = 2166136261;
  for (let index = 0; index < String(id).length; index++) {
    hash ^= String(id).charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function smoothStep(value) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function buildArcLengths(points) {
  const lengths = new Float64Array(points.length);
  for (let index = 1; index < points.length; index++) {
    lengths[index] = lengths[index - 1] + Math.hypot(
      points[index].x - points[index - 1].x,
      points[index].y - points[index - 1].y,
    );
  }
  return lengths;
}

function tangentAt(points, index) {
  const point = points[index];
  let before = index - 1;
  let after = index + 1;

  while (before >= 0 && Math.hypot(point.x - points[before].x, point.y - points[before].y) < 1e-4) before--;
  while (after < points.length && Math.hypot(points[after].x - point.x, points[after].y - point.y) < 1e-4) after++;

  if (before < 0 && after >= points.length) return { x: 1, y: 0 };
  if (before < 0) before = index;
  if (after >= points.length) after = index;

  let dx = points[after].x - points[before].x;
  let dy = points[after].y - points[before].y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: dx / length, y: dy / length };
}

/**
 * Builds a non-destructive line-boil preview in the stroke's local normal
 * direction. The wave is parameterized by travelled distance, not point
 * index, so its shape does not change when input sampling density changes.
 */
export function computeLineBoilPoints(stroke, {
  phase = 0,
  amplitude = 2,
  frequency = 0.08,
  seed = hashId(stroke.id),
} = {}) {
  const points = stroke.bezierPath ? sampleBezierPath(stroke.bezierPath).points : stroke.points;
  if (!Array.isArray(points) || points.length < 2) return points || [];

  const safeAmplitude = Math.max(0, Math.min(24, Number(amplitude) || 0));
  const safeFrequency = Math.max(0.005, Math.min(0.5, Number(frequency) || 0.08));
  if (safeAmplitude === 0) return points.map(point => ({ x: point.x, y: point.y }));

  const lengths = buildArcLengths(points);
  const totalLength = lengths[lengths.length - 1];
  if (totalLength < 1e-4) return points.map(point => ({ x: point.x, y: point.y }));

  const seedPhase = (seed % 10000) / 997;
  const spatialFrequency = safeFrequency * 0.075;
  const endpointGuard = Math.min(48, Math.max(12, totalLength * 0.14));

  return points.map((point, index) => {
    const tangent = tangentAt(points, index);
    const normalX = -tangent.y;
    const normalY = tangent.x;
    const distance = lengths[index];
    const envelope = smoothStep(distance / endpointGuard) *
      smoothStep((totalLength - distance) / endpointGuard);

    const waveA = Math.sin(distance * spatialFrequency + phase + seedPhase);
    const waveB = Math.sin(distance * spatialFrequency * 0.47 - phase * 1.31 + seedPhase * 2.3);
    const waveC = Math.sin(distance * spatialFrequency * 1.91 + phase * 0.73 - seedPhase * 1.7);
    const displacement = (waveA * 0.52 + waveB * 0.31 + waveC * 0.17) * safeAmplitude * envelope;

    return {
      x: point.x + normalX * displacement,
      y: point.y + normalY * displacement,
    };
  });
}

export function animateLineStrokes(strokes, settings = {}) {
  const phase = Number(settings.phase) || 0;
  return strokes.map(stroke => {
    // Per-stroke animation styles work independently of the global boil toggle.
    // "none" still follows the global Line Boil panel for backward compatibility.
    const ownStyle = stroke.motionStyle && stroke.motionStyle !== 'none' ? stroke.motionStyle : null;
    const mode = ownStyle || 'wave';
    const strength = Math.max(0, Math.min(16, Number(ownStyle ? (stroke.motionStrength ?? settings.amplitude) : settings.amplitude) || 0));
    if (strength === 0) return { ...stroke, motionPasses: null };
    const source = stroke.bezierPath ? sampleBezierPath(stroke.bezierPath).points : stroke.points;
    if (mode === 'wave') {
      const moved = computeLineBoilPoints(stroke, { ...settings, amplitude: strength });
      return { ...stroke, points: moved.map((point, index) => ({ ...point, pressure: stroke.points[Math.min(index, stroke.points.length - 1)]?.pressure ?? 0.5 })), bezierPath: undefined, motionPasses: null };
    }

    const passes = [];
    const count = mode === 'redraw' || mode === 'boil' ? 3 : 2;
    for (let pass = 0; pass < count; pass++) {
      if (mode === 'boil') {
        // Three phase-shifted redraws create a hand-drawn boiling contour.
        const phaseOffset = (pass - 1) * 0.92;
        const passPoints = computeLineBoilPoints(stroke, {
          ...settings,
          phase: phase + phaseOffset,
          amplitude: strength * (pass === 1 ? 0.72 : 0.88),
        });
        passes.push({ points: passPoints, alpha: [0.28, 0.42, 0.28][pass] });
        continue;
      }
      const offset = (pass - (count - 1) / 2) * strength * (mode === 'redraw' ? 0.42 : 0.18);
      const passPoints = source.map((point, index) => {
        const tangent = tangentAt(source, index);
        const seed = hashId(stroke.id) % 31;
        const distance = index / Math.max(1, source.length - 1);
        const drift = Math.sin(distance * Math.PI * (3 + pass) + phase + seed) * strength * 0.16;
        return { x: point.x - tangent.y * (offset + drift), y: point.y + tangent.x * (offset + drift) };
      });
      passes.push({ points: passPoints, alpha: mode === 'redraw' ? [0.28, 0.42, 0.28][pass] : 0.32 });
    }
    return { ...stroke, motionPasses: passes };
  });
}
export function lineBoilPhase(elapsedMs, speed = 1) {
  return (Math.max(0, elapsedMs) / 1000) * Math.max(0, Math.min(8, speed)) * Math.PI * 2;
}
