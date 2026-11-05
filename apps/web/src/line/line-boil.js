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

/**
 * Returns a temporary animated copy. The source stroke is never mutated,
 * so animation can be paused or exported from the original geometry.
 */
export function computeLineBoilPoints(stroke, {
  phase = 0,
  amplitude = 2,
  frequency = 0.08,
  seed = hashId(stroke.id),
} = {}) {
  const points = stroke.points;
  if (!Array.isArray(points) || points.length < 2) return points || [];

  const safeAmplitude = Math.max(0, Math.min(24, Number(amplitude) || 0));
  const safeFrequency = Math.max(0.005, Math.min(0.5, Number(frequency) || 0.08));
  const seedPhase = (seed % 10000) / 997;
  const lastIndex = points.length - 1;

  return points.map((point, index) => {
    const before = points[Math.max(0, index - 1)];
    const after = points[Math.min(lastIndex, index + 1)];
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    const length = Math.hypot(dx, dy) || 1;
    const normalX = -dy / length;
    const normalY = dx / length;
    const along = index / lastIndex;
    const endpointGuard = smoothStep(Math.min(1, along * 5)) *
      smoothStep(Math.min(1, (1 - along) * 5));
    const waveA = Math.sin(index * safeFrequency * 2.1 + phase + seedPhase);
    const waveB = Math.sin(index * safeFrequency * 0.83 - phase * 1.37 + seedPhase * 2.3);
    const displacement = (waveA * 0.68 + waveB * 0.32) * safeAmplitude * endpointGuard;

    return {
      x: point.x + normalX * displacement,
      y: point.y + normalY * displacement,
    };
  });
}

export function animateLineStrokes(strokes, settings) {
  return strokes.map(stroke => ({
    ...stroke,
    points: computeLineBoilPoints(stroke, settings),
  }));
}

export function lineBoilPhase(elapsedMs, speed = 1) {
  return (Math.max(0, elapsedMs) / 1000) * Math.max(0, Math.min(8, speed)) * Math.PI * 2;
}
