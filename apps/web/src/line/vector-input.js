// Pure helpers for collecting vector-line input samples. The same point list
// feeds the live preview and the committed stroke, so what the pen shows while
// drawing is what the line becomes on pen-up.

/** Pressure change that keeps a sample even when it is very close to the last one. */
export const VECTOR_PRESSURE_STEP = 0.06;

/**
 * Should a new input sample become a stroke point?
 * - Far enough from the previous point (`minDistance`, canvas units), or
 * - a real pressure change at a smaller distance, so slow, deliberate pressure
 *   changes are not dropped. Exact duplicates are never kept.
 */
export function shouldKeepVectorSample(previous, sample, { minDistance = 1.25, pressureStep = VECTOR_PRESSURE_STEP } = {}) {
  if (!previous) return true;
  const distance = Math.hypot(sample.x - previous.x, sample.y - previous.y);
  if (distance >= minDistance) return true;
  const pressureChange = Math.abs((sample.pressure ?? 0.5) - (previous.pressure ?? 0.5));
  return distance >= minDistance * 0.3 && pressureChange >= pressureStep;
}

/**
 * Minimum sample spacing in canvas units for the current zoom: about 1.5 screen
 * pixels, clamped so zoomed-out drawing doesn't explode the point count and
 * zoomed-in drawing keeps fine detail.
 */
export function vectorSampleSpacing(canvasUnitsPerScreenPixel) {
  const units = Number(canvasUnitsPerScreenPixel);
  if (!Number.isFinite(units) || units <= 0) return 1.25;
  return Math.max(0.35, Math.min(2.5, units * 1.5));
}

/**
 * Final point list for pen-up. The pointerup position may add one last point,
 * but its pressure is not trustworthy (a lifting pen reports 0, a mouse has
 * none), so it inherits the last real pressure. A single tap becomes a
 * two-point dot at that same pressure. Never mutates the input.
 */
export function finishVectorPoints(points, endPoint = null, { minDistance = 0.1 } = {}) {
  if (!Array.isArray(points) || !points.length) return [];
  const result = points.map(point => ({ ...point }));
  const last = result[result.length - 1];
  const pressure = last.pressure ?? 0.5;
  if (endPoint && Math.hypot(endPoint.x - last.x, endPoint.y - last.y) > minDistance) {
    result.push({ x: endPoint.x, y: endPoint.y, pressure });
  }
  if (result.length === 1) result.push({ x: last.x + 0.1, y: last.y + 0.1, pressure });
  return result;
}
