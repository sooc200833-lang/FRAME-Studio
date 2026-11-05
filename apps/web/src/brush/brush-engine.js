import { getStroke } from 'perfect-freehand';

export function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

export function normalizePointerPressure(event, enabled = true) {
  if (!enabled || event?.pointerType !== 'pen') return 0.5;
  const pressure = Number(event.pressure);
  return Number.isFinite(pressure) && pressure > 0 ? clamp01(pressure) : 0.5;
}

export function pressureToWidth(baseWidth, pressure, {
  minFactor = 0.16,
  maxFactor = 1.18,
  curve = 1.35,
} = {}) {
  const p = clamp01(pressure);
  const shaped = Math.pow(p, Math.max(0.1, curve));
  const factor = minFactor + (maxFactor - minFactor) * shaped;
  return Math.max(0.25, Number(baseWidth) * factor);
}

/**
 * Low-pass pointer stabilization. Higher strength reduces jitter while
 * preserving more responsiveness for fast movements.
 */
export function stabilizePoint(previous, current, strength = 0.28) {
  if (!previous) return { x: current.x, y: current.y };
  const amount = Math.max(0, Math.min(0.85, Number(strength) || 0));
  if (amount === 0) return { x: current.x, y: current.y };

  const distance = Math.hypot(current.x - previous.x, current.y - previous.y);
  const baseAlpha = 1 - amount * 0.88;
  const speedResponse = Math.min(0.38, distance / 180);
  const alpha = Math.min(1, baseAlpha + speedResponse);

  return {
    x: previous.x + (current.x - previous.x) * alpha,
    y: previous.y + (current.y - previous.y) * alpha,
  };
}

export function coalescedPointerEvents(event) {
  if (typeof event?.getCoalescedEvents === 'function') {
    const samples = event.getCoalescedEvents();
    if (samples?.length) return samples;
  }
  return [event];
}

/**
 * Turn timestamped pointer samples into a closed, pressure-aware brush outline.
 * The returned polygon is renderer-agnostic and can be painted to Canvas or Pixi.
 */
export function createBrushOutline(samples, {
  size = 7,
  stylus = false,
  pressureEnabled = true,
  smoothing = 0.55,
  streamline = 0.35,
  complete = true,
} = {}) {
  if (!Array.isArray(samples) || samples.length === 0) return [];

  const points = samples.map(sample => [
    Number(sample.x) || 0,
    Number(sample.y) || 0,
    clamp01(sample.pressure ?? 0.5),
  ]);

  if (points.length === 1) {
    points.push([points[0][0] + 0.01, points[0][1] + 0.01, points[0][2]]);
  }

  return getStroke(points, {
    size: Math.max(0.5, Number(size) || 1),
    thinning: stylus && pressureEnabled ? 0.72 : (pressureEnabled ? 0.32 : 0),
    smoothing: Math.max(0, Math.min(1, Number(smoothing) || 0)),
    streamline: Math.max(0, Math.min(1, Number(streamline) || 0)),
    simulatePressure: !(stylus && pressureEnabled),
    last: Boolean(complete),
    start: { cap: true, taper: 0 },
    end: { cap: true, taper: 0 },
  });
}
