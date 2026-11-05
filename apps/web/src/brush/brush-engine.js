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
