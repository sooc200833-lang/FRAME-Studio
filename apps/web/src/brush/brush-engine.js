import { getStroke } from 'perfect-freehand';

const BRUSH_PRESETS = Object.freeze({
  pencil: Object.freeze({ label: '연필', sizeMultiplier: 0.78, thinning: 0.42, opacity: 0.76, smoothing: 0.28, streamline: 0.16, pressureCurve: 1.18 }),
  ink: Object.freeze({ label: '잉크 펜', sizeMultiplier: 1, thinning: 0.72, opacity: 1, smoothing: 0.58, streamline: 0.3, pressureCurve: 0.92 }),
  marker: Object.freeze({ label: '마커', sizeMultiplier: 1.45, thinning: 0.12, opacity: 0.34, smoothing: 0.48, streamline: 0.24, pressureCurve: 0.82 }),
  brush: Object.freeze({ label: '브러시', sizeMultiplier: 1.18, thinning: 0.88, opacity: 0.9, smoothing: 0.62, streamline: 0.38, pressureCurve: 1.08 }),
});

export function getBrushPreset(name = 'ink') {
  return BRUSH_PRESETS[name] || BRUSH_PRESETS.ink;
}

export function listBrushPresets() {
  return Object.entries(BRUSH_PRESETS).map(([id, preset]) => ({ id, ...preset }));
}

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

/**
 * Canonical stroke options shared by live preview and committed rendering.
 * Keeping this resolver in one place prevents preview/commit geometry drift.
 */
export function resolveBrushStrokeOptions({
  size = 7,
  stylus = false,
  pressureEnabled = true,
  preset = 'ink',
  pressureCurve,
  smoothing,
  streamline,
  complete = false,
} = {}) {
  const profile = getBrushPreset(preset);
  return {
    size,
    stylus,
    pressureEnabled,
    preset,
    pressureCurve: pressureCurve ?? profile.pressureCurve,
    smoothing: smoothing ?? profile.smoothing,
    streamline: streamline ?? profile.streamline,
    complete: Boolean(complete),
  };
}

/**
 * Reduce redundant pointer samples with a pressure-aware Ramer-Douglas-Peucker pass.
 * The same reduced sequence is used by preview and commit, so optimization does
 * not create a second geometry path. Endpoints and meaningful pressure changes survive.
 */
export function simplifyBrushSamples(samples, tolerance = 0.35, pressureTolerance = 0.025) {
  if (!Array.isArray(samples) || samples.length <= 2) return Array.isArray(samples) ? samples.slice() : [];
  const distanceLimit = Math.max(0, Number(tolerance) || 0);
  const pressureLimit = Math.max(0, Number(pressureTolerance) || 0);
  const keep = new Uint8Array(samples.length);
  keep[0] = 1;
  keep[samples.length - 1] = 1;
  const stack = [[0, samples.length - 1]];

  while (stack.length) {
    const [start, end] = stack.pop();
    const a = samples[start], b = samples[end];
    const dx = b.x - a.x, dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    let maxScore = 1;
    let split = -1;

    for (let i = start + 1; i < end; i++) {
      const point = samples[i];
      const t = lengthSquared > 1e-12
        ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared))
        : 0;
      const px = a.x + t * dx, py = a.y + t * dy;
      const spatialError = Math.hypot(point.x - px, point.y - py);
      const expectedPressure = Number(a.pressure ?? 0.5) +
        (Number(b.pressure ?? 0.5) - Number(a.pressure ?? 0.5)) * t;
      const pressureError = Math.abs(Number(point.pressure ?? 0.5) - expectedPressure);
      const score = Math.max(
        distanceLimit > 0 ? spatialError / distanceLimit : (spatialError > 0 ? Infinity : 0),
        pressureLimit > 0 ? pressureError / pressureLimit : (pressureError > 0 ? Infinity : 0),
      );
      if (score > maxScore) {
        maxScore = score;
        split = i;
      }
    }

    if (split >= 0) {
      keep[split] = 1;
      stack.push([start, split], [split, end]);
    }
  }

  const result = [];
  for (let i = 0; i < samples.length; i++) if (keep[i]) result.push(samples[i]);
  return result;
}

/**
 * Turn timestamped pointer samples into a closed, pressure-aware brush outline.
 * The returned polygon is renderer-agnostic and can be painted to Canvas or Pixi.
 */
export function createBrushOutline(samples, {
  size = 7,
  stylus = false,
  pressureEnabled = true,
  preset = 'ink',
  smoothing,
  streamline,
  pressureCurve,
  complete = true,
} = {}) {
  if (!Array.isArray(samples) || samples.length === 0) return [];
  const profile = getBrushPreset(preset);
  const curve = Math.max(0.25, Math.min(3, Number(pressureCurve ?? profile.pressureCurve) || 1));

  const reducedSamples = simplifyBrushSamples(samples);
  const points = reducedSamples.map(sample => [
    Number(sample.x) || 0,
    Number(sample.y) || 0,
    clamp01(sample.pressure ?? 0.5),
  ]);

  if (points.length === 1) {
    points.push([points[0][0] + 0.01, points[0][1] + 0.01, points[0][2]]);
  }

  return getStroke(points, {
    size: Math.max(0.5, (Number(size) || 1) * profile.sizeMultiplier),
    thinning: pressureEnabled ? profile.thinning : 0,
    smoothing: Math.max(0, Math.min(1, Number(smoothing ?? profile.smoothing) || 0)),
    streamline: Math.max(0, Math.min(1, Number(streamline ?? profile.streamline) || 0)),
    easing: pressure => Math.pow(clamp01(pressure), curve),
    simulatePressure: !(stylus && pressureEnabled),
    last: Boolean(complete),
    start: { cap: true, taper: 0 },
    end: { cap: true, taper: 0 },
  });
}

/**
 * Generate deterministic texture marks along a brush path. The marks are
 * clipped to the final outline when painted, so texture never leaks outside.
 */
export function createBrushTextureMarks(samples, { preset = 'ink', size = 7, seed } = {}) {
  if (!Array.isArray(samples) || samples.length < 2) return [];
  if (!['pencil', 'marker', 'brush'].includes(preset)) return [];
  samples = simplifyBrushSamples(samples, 0.45, 0.03);

  const first = samples[0];
  let state = Number.isFinite(seed)
    ? seed >>> 0
    : ((Math.round(first.x * 31) ^ Math.round(first.y * 17) ^ preset.length * 2654435761) >>> 0);
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const marks = [];
  const width = Math.max(1, Number(size) || 1);

  for (let index = 1; index < samples.length; index++) {
    const from = samples[index - 1];
    const to = samples[index];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (length < 0.25) continue;
    const tangentX = dx / length;
    const tangentY = dy / length;
    const normalX = -tangentY;
    const normalY = tangentX;
    const spacing = preset === 'pencil' ? Math.max(2.2, width * 0.42) : Math.max(4, width * 0.7);
    const count = Math.max(1, Math.ceil(length / spacing));

    for (let step = 0; step < count; step++) {
      const t = (step + 0.5) / count;
      const centerX = from.x + dx * t;
      const centerY = from.y + dy * t;
      const across = (random() - 0.5) * width * (preset === 'pencil' ? 0.9 : 0.58);
      const x = centerX + normalX * across;
      const y = centerY + normalY * across;

      if (preset === 'pencil') {
        marks.push({ type: 'grain', x, y, radius: 0.25 + random() * Math.min(0.8, width * 0.055), alpha: 0.12 + random() * 0.18 });
      } else if (preset === 'marker') {
        const run = 3 + random() * Math.min(9, width * 0.55);
        marks.push({ type: 'band', x: x - tangentX * run * 0.5, y: y - tangentY * run * 0.5, x2: x + tangentX * run * 0.5, y2: y + tangentY * run * 0.5, width: 0.35 + random() * 0.55, alpha: 0.035 + random() * 0.045 });
      } else {
        const run = 2 + random() * Math.min(7, width * 0.42);
        marks.push({ type: 'bristle', x: x - tangentX * run * 0.5, y: y - tangentY * run * 0.5, x2: x + tangentX * run * 0.5, y2: y + tangentY * run * 0.5, width: 0.25 + random() * Math.max(0.5, width * 0.045), alpha: 0.08 + random() * 0.12 });
      }
    }
  }
  return marks;
}

/** Paint a brush's subtle surface texture inside its already-filled outline. */
export function applyBrushTexture(context, outline, samples, options = {}) {
  if (!context || !Array.isArray(outline) || outline.length < 3) return 0;
  const marks = createBrushTextureMarks(samples, options);
  if (!marks.length) return 0;

  context.save();
  context.beginPath();
  context.moveTo(outline[0][0], outline[0][1]);
  for (let index = 1; index < outline.length; index++) context.lineTo(outline[index][0], outline[index][1]);
  context.closePath();
  context.clip();

  const preset = options.preset;
  const baseAlpha = context.globalAlpha;
  if (preset === 'pencil') {
    context.globalCompositeOperation = 'destination-out';
    for (const mark of marks) {
      context.globalAlpha = baseAlpha * mark.alpha;
      context.beginPath();
      context.ellipse(mark.x, mark.y, mark.radius * 1.45, mark.radius, 0, 0, Math.PI * 2);
      context.fill();
    }
  } else {
    context.globalCompositeOperation = 'source-atop';
    context.strokeStyle = options.color || '#24242a';
    for (const mark of marks) {
      context.globalAlpha = baseAlpha * mark.alpha;
      context.lineWidth = mark.width;
      context.lineCap = 'round';
      context.beginPath();
      context.moveTo(mark.x, mark.y);
      context.lineTo(mark.x2, mark.y2);
      context.stroke();
    }
  }
  context.restore();
  return marks.length;
}
