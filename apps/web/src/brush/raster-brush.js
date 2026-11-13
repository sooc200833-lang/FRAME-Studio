// Raster brush v2: a stamp (dab) engine. Pure math, no DOM.
//
// A stroke turns pointer samples into evenly spaced round dabs. Each dab has a
// position, radius, alpha and angle. The DOM side stamps those dabs into a
// stroke buffer that is shown live and committed unchanged on release, so the
// preview and the result are always the same picture.

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Brush presets. Pressure maps to size and/or alpha:
 *   radius = size/2 * lerp(1 - sizePressure, 1, p)
 *   alpha  = flow   * lerp(1 - flowPressure, 1, p)
 * `opacity` caps the whole stroke (dabs inside one stroke never build past it).
 */
export const RASTER_BRUSHES = Object.freeze({
  pencil: Object.freeze({ id: 'pencil', label: '연필', hardness: 0.82, grain: 0.55, spacing: 0.1, sizePressure: 0.35, flow: 0.42, flowPressure: 0.85, opacity: 1, sizeScale: 0.8, streamline: 0.12, pressureCurve: 1.15 }),
  ink: Object.freeze({ id: 'ink', label: '잉크 펜', hardness: 0.97, grain: 0, spacing: 0.05, sizePressure: 0.85, flow: 1, flowPressure: 0, opacity: 1, sizeScale: 1, streamline: 0.3, pressureCurve: 0.95 }),
  marker: Object.freeze({ id: 'marker', label: '마커', hardness: 0.72, grain: 0, spacing: 0.06, sizePressure: 0.12, flow: 0.7, flowPressure: 0.2, opacity: 0.7, sizeScale: 1.4, streamline: 0.22, pressureCurve: 1 }),
  brush: Object.freeze({ id: 'brush', label: '브러시', hardness: 0.32, grain: 0, spacing: 0.08, sizePressure: 0.6, flow: 0.3, flowPressure: 0.6, opacity: 1, sizeScale: 1.2, streamline: 0.28, pressureCurve: 1.05 }),
});

export function getRasterBrush(id) {
  return RASTER_BRUSHES[id] || RASTER_BRUSHES.ink;
}

/** Pressure after the response curve. Curve > 1 needs a firmer press. */
export function applyPressureCurve(pressure, curve = 1) {
  const p = clamp(Number.isFinite(pressure) ? pressure : 0.5, 0, 1);
  const exponent = clamp(Number(curve) || 1, 0.3, 3);
  return p ** exponent;
}

export function dabRadius(brush, size, pressure) {
  const base = Math.max(0.5, Number(size) || 1) * (brush.sizeScale ?? 1) / 2;
  return Math.max(0.35, base * lerp(1 - brush.sizePressure, 1, pressure));
}

export function dabAlpha(brush, pressure) {
  return clamp(brush.flow * lerp(1 - brush.flowPressure, 1, pressure), 0, 1);
}

// Small deterministic PRNG so the same stroke always renders the same grain.
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Creates a stroke. Feed it samples with `add`, then call `finish`.
 * Both return only the new dabs, so callers can stamp incrementally.
 *
 * options:
 *   brush       preset object (see RASTER_BRUSHES)
 *   size        brush size in canvas px (diameter at full pressure)
 *   stylus      true for a pen; mouse/finger strokes use full pressure
 *   pressureCurve, streamline (0..0.95; smoothing of the drawn path)
 *   seed        grain rotation seed
 */
export function createRasterStroke({ brush = RASTER_BRUSHES.ink, size = 7, stylus = false, pressureCurve = brush.pressureCurve, streamline = brush.streamline, seed = 1 } = {}) {
  const random = mulberry32(seed);
  const smoothing = clamp(Number(streamline) || 0, 0, 0.95);
  let smoothed = null;     // streamlined position + pressure
  let lastDab = null;      // last stamped dab
  let carry = 0;           // distance travelled since the last dab
  let raw = null;          // latest raw sample (to finish exactly at the pen)
  let count = 0;

  const pressureOf = sample => (stylus ? applyPressureCurve(sample.pressure, pressureCurve) : 1);

  const makeDab = (x, y, pressure) => ({
    x,
    y,
    radius: dabRadius(brush, size, pressure),
    alpha: dabAlpha(brush, pressure),
    angle: brush.grain ? random() * Math.PI * 2 : 0,
    pressure,
  });

  // Walk from the end of the previous segment towards (x, y, p), stamping a
  // dab every `spacing` × diameter. `carry` is the distance already covered
  // since the last dab, so spacing stays even across segment boundaries.
  let cursor = null;
  const walkTo = (x, y, pressure) => {
    const dabs = [];
    if (!cursor) {
      cursor = { x, y, p: pressure };
      lastDab = makeDab(x, y, pressure);
      dabs.push(lastDab);
      return dabs;
    }
    const from = cursor;
    const dx = x - from.x;
    const dy = y - from.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-6) return dabs;
    let travelled = 0;
    for (let guard = 0; guard < 100000; guard++) {
      const p = lerp(from.p, pressure, travelled / length);
      const step = Math.max(0.35, dabRadius(brush, size, p) * 2 * brush.spacing);
      const needed = step - carry;
      if (travelled + needed > length + 1e-9) {
        carry += length - travelled;
        break;
      }
      travelled += needed;
      carry = 0;
      const u = travelled / length;
      lastDab = makeDab(from.x + dx * u, from.y + dy * u, lerp(from.p, pressure, u));
      dabs.push(lastDab);
    }
    cursor = { x, y, p: pressure };
    return dabs;
  };

  return {
    /** Adds one pointer sample {x, y, pressure}; returns the new dabs. */
    add(sample) {
      raw = { x: Number(sample.x), y: Number(sample.y), p: pressureOf(sample) };
      count++;
      if (!smoothed) smoothed = { ...raw };
      else {
        // Streamline: the drawn point follows the pen with some lag, which
        // removes hand jitter. Pressure is smoothed lightly as well.
        smoothed.x = lerp(raw.x, smoothed.x, smoothing);
        smoothed.y = lerp(raw.y, smoothed.y, smoothing);
        smoothed.p = lerp(raw.p, smoothed.p, smoothing * 0.5);
      }
      return walkTo(smoothed.x, smoothed.y, smoothed.p);
    },
    /** Ends the stroke at the pen's last real position; returns the new dabs. */
    finish() {
      if (!raw) return [];
      return walkTo(raw.x, raw.y, smoothed ? smoothed.p : raw.p);
    },
    get sampleCount() { return count; },
  };
}

/** Bounding box of dabs (for partial redraws and tests). */
export function dabBounds(dabs) {
  if (!dabs.length) return null;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const dab of dabs) {
    left = Math.min(left, dab.x - dab.radius);
    top = Math.min(top, dab.y - dab.radius);
    right = Math.max(right, dab.x + dab.radius);
    bottom = Math.max(bottom, dab.y + dab.radius);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Alpha of a round tip at normalized distance d (0 centre, 1 edge) for a
 * given hardness: solid core up to `hardness`, smooth falloff to the edge.
 */
export function tipFalloff(distance, hardness) {
  const d = clamp(distance, 0, 1);
  const core = clamp(hardness, 0, 0.999);
  if (d <= core) return 1;
  const t = (d - core) / (1 - core);
  return 1 - t * t * (3 - 2 * t);
}
