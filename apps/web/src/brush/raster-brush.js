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
  // Texture brushes: `paper` names a canvas-anchored grain (see paperGrain),
  // so overlapping strokes reveal the same paper tooth, like real chalk/crayon.
  chalk: Object.freeze({ id: 'chalk', label: '분필', hardness: 0.55, grain: 0, paper: 'chalk', spacing: 0.07, sizePressure: 0.45, flow: 0.9, flowPressure: 0.45, opacity: 1, sizeScale: 1.5, streamline: 0.18, pressureCurve: 1 }),
  crayon: Object.freeze({ id: 'crayon', label: '크레용', hardness: 0.88, grain: 0, paper: 'crayon', spacing: 0.06, sizePressure: 0.3, flow: 0.95, flowPressure: 0.35, opacity: 1, sizeScale: 1.2, streamline: 0.2, pressureCurve: 1 }),
  // Particle brushes: each spacing step scatters `count` particles within
  // `scatter` × size of the path; `particle` scales their size, with jitter.
  // Seeded per stroke, so preview and result are the same picture.
  spray: Object.freeze({ id: 'spray', label: '스프레이', hardness: 0.5, grain: 0, spacing: 0.22, sizePressure: 0.2, flow: 0.8, flowPressure: 0.6, opacity: 1, sizeScale: 1.6, streamline: 0.15, pressureCurve: 1, scatter: 1, count: 6, particle: 0.11, sizeJitter: 0.6, alphaJitter: 0.5 }),
  sparkle: Object.freeze({ id: 'sparkle', label: '반짝이', hardness: 0.85, grain: 0, tip: 'star', spacing: 0.9, sizePressure: 0.4, flow: 1, flowPressure: 0.3, opacity: 1, sizeScale: 1.4, streamline: 0.2, pressureCurve: 1, scatter: 1.1, count: 1, particle: 0.55, sizeJitter: 0.75, alphaJitter: 0.25, rotate: true }),
  stipple: Object.freeze({ id: 'stipple', label: '점묘', hardness: 0.95, grain: 0, spacing: 0.35, sizePressure: 0.3, flow: 1, flowPressure: 0.4, opacity: 1, sizeScale: 1.3, streamline: 0.2, pressureCurve: 1, scatter: 0.8, count: 3, particle: 0.16, sizeJitter: 0.45, alphaJitter: 0 }),
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

  // Particle brushes replace each path dab by scattered particles.
  const particlesAt = (x, y, pressure) => {
    const centre = makeDab(x, y, pressure);
    const reach = centre.radius * brush.scatter;
    const particles = [];
    for (let index = 0; index < brush.count; index++) {
      // Uniform over the disc (sqrt), so particles don't bunch in the middle.
      const distance = Math.sqrt(random()) * reach;
      const direction = random() * Math.PI * 2;
      particles.push({
        x: x + Math.cos(direction) * distance,
        y: y + Math.sin(direction) * distance,
        radius: Math.max(0.35, centre.radius * brush.particle * (1 - (brush.sizeJitter || 0) * random())),
        alpha: centre.alpha * (1 - (brush.alphaJitter || 0) * random()),
        angle: brush.rotate ? random() * Math.PI * 2 : 0,
        pressure,
      });
    }
    return particles;
  };
  const emit = (dabs, x, y, pressure) => {
    lastDab = makeDab(x, y, pressure);
    if (brush.scatter) dabs.push(...particlesAt(x, y, pressure));
    else dabs.push(lastDab);
  };

  // Walk from the end of the previous segment towards (x, y, p), stamping a
  // dab every `spacing` × diameter. `carry` is the distance already covered
  // since the last dab, so spacing stays even across segment boundaries.
  let cursor = null;
  const walkTo = (x, y, pressure) => {
    const dabs = [];
    if (!cursor) {
      cursor = { x, y, p: pressure };
      emit(dabs, x, y, pressure);
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
      emit(dabs, from.x + dx * u, from.y + dy * u, lerp(from.p, pressure, u));
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


// ── Paper grain for texture brushes ──────────────────────────────────────────

export const PAPER_TILE = 256;

function latticeValue(ix, iy, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Value noise that tiles every `periodX`×`periodY` lattice cells. */
function tiledNoise(x, y, cellW, cellH, periodX, periodY, seed) {
  const fx = x / cellW;
  const fy = y / cellH;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const wrap = (value, period) => ((value % period) + period) % period;
  const v = (ix, iy) => latticeValue(wrap(ix, periodX), wrap(iy, periodY), seed);
  const top = lerp(v(x0, y0), v(x0 + 1, y0), sx);
  const bottom = lerp(v(x0, y0 + 1), v(x0 + 1, y0 + 1), sx);
  return lerp(top, bottom, sy);
}

const smooth = (edge0, edge1, value) => {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

const PAPERS = Object.freeze({
  // Chalk: open, speckled tooth; coarse clumps plus fine grit.
  chalk: { octaves: [[8, 8, 0.6], [2, 2, 0.4]], low: 0.34, high: 0.6 },
  // Crayon: waxy, slightly streaky tooth (cells stretched horizontally).
  crayon: { octaves: [[16, 4, 0.55], [4, 2, 0.45]], low: 0.26, high: 0.5 },
});

export const PAPER_KINDS = Object.freeze(Object.keys(PAPERS));

/**
 * Seamless paper-tooth alpha tile (PAPER_TILE² bytes, 0 = hole, 255 = paint).
 * Deterministic for a kind, so every stroke and every reload shows the same paper.
 */
export function paperGrain(kind, size = PAPER_TILE) {
  const paper = PAPERS[kind];
  if (!paper) throw new RangeError(`unknown paper: ${kind}`);
  const alpha = new Uint8ClampedArray(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let value = 0;
      paper.octaves.forEach(([cellW, cellH, weight], octave) => {
        value += weight * tiledNoise(x, y, cellW, cellH, size / cellW, size / cellH, octave + 1);
      });
      alpha[y * size + x] = Math.round(smooth(paper.low, paper.high, value) * 255);
    }
  }
  return alpha;
}

/**
 * Tip opacity at an offset (dx, dy) from the centre, in tip radii (|d| = 1 is
 * the edge). Round tips use tipFalloff; the star tip is a soft four-point
 * sparkle whose arms reach the edge and whose waist is a quarter of it.
 */
export function tipAlpha(dx, dy, brush) {
  const distance = Math.hypot(dx, dy);
  if (brush.tip !== 'star') return tipFalloff(distance, brush.hardness);
  const angle = Math.atan2(dy, dx);
  const reach = 0.22 + 0.78 * Math.pow(Math.abs(Math.cos(2 * angle)), 6);
  return tipFalloff(distance / reach, brush.hardness);
}
