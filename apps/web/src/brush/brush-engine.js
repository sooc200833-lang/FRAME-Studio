// Shared pointer helpers for brushes: frame scheduling, pressure
// normalization, stabilization and coalesced pointer samples.
// (The raster brush itself lives in raster-brush.js / raster-brush-canvas.js.)

/**
 * Coalesce expensive preview work to at most one render per animation frame.
 * The injected frame functions make scheduling deterministic in unit tests.
 */
export function createFrameScheduler(render, {
  requestFrame = callback => requestAnimationFrame(callback),
  cancelFrame = id => cancelAnimationFrame(id),
} = {}) {
  let frameId = null;
  let cancelled = false;
  return {
    schedule() {
      if (cancelled || frameId !== null) return;
      frameId = requestFrame(() => {
        frameId = null;
        if (!cancelled) render();
      });
    },
    cancel() {
      if (frameId !== null) cancelFrame(frameId);
      frameId = null;
    },
    dispose() {
      this.cancel();
      cancelled = true;
    },
    get pending() {
      return frameId !== null;
    },
  };
}

export function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

export function normalizePointerPressure(event, enabled = true) {
  if (!enabled || event?.pointerType !== 'pen') return 0.5;
  const pressure = Number(event.pressure);
  return Number.isFinite(pressure) && pressure > 0 ? clamp01(pressure) : 0.5;
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
    if (samples?.length) {
      const last = samples[samples.length - 1];
      const coordinate = (sample, primary, fallback) => sample?.[primary] ?? sample?.[fallback];
      const eventX = coordinate(event, 'clientX', 'x');
      const eventY = coordinate(event, 'clientY', 'y');
      if (eventX === undefined && eventY === undefined) return samples;
      const samePosition =
        coordinate(last, 'clientX', 'x') === eventX &&
        coordinate(last, 'clientY', 'y') === eventY;
      const samePressure = Number(last?.pressure ?? 0.5) === Number(event?.pressure ?? 0.5);
      if (samePosition && samePressure) return samples;

      // PointerEvent fields are commonly inherited accessors, so object spread
      // drops them. Snapshot the fields consumed by the drawing pipeline and
      // deliberately omit getCoalescedEvents itself.
      const dispatched = { ...event };
      delete dispatched.getCoalescedEvents;
      for (const key of ['clientX', 'clientY', 'pressure', 'pointerType']) {
        if (event[key] !== undefined) dispatched[key] = event[key];
      }
      return [...samples, dispatched];
    }
  }
  return [event];
}
