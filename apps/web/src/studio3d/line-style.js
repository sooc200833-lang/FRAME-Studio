// Hand-drawn line styles for the 3D Background Studio's ink pass. Pure data
// and math (no Three.js): presets and the numbers the shader receives.
//
// Every length is in viewport CSS pixels; the renderer multiplies by its
// pixel scale, so a PNG export at any size matches the screen.

export const DEFAULT_LINE_STYLE = 'clean';
export const DEFAULT_LINE_HAND = 0.6;

/**
 * outline / crease: width multipliers for depth lines (silhouettes, overlaps)
 *   and fold lines inside an object.
 * taper: 0–1, how much distant lines thin out.
 * wobble: px the line wanders off the exact edge; wobbleSize: px per wave.
 * jitter: 0–1, thickness change along the line.
 * grain: 0–1, pencil tooth (line opacity broken by paper grain).
 * breakup: 0–1, dry-brush gaps along the line.
 * sketch: 0–1, opacity of a second, slightly offset sketch line.
 * opacity: line opacity.
 */
export const LINE_STYLES = Object.freeze({
  clean: Object.freeze({ id: 'clean', label: '깔끔', outline: 1, crease: 1, taper: 0, wobble: 0, wobbleSize: 90, jitter: 0, grain: 0, breakup: 0, sketch: 0, opacity: 1 }),
  pen: Object.freeze({ id: 'pen', label: '펜선', outline: 1.7, crease: 0.65, taper: 0.5, wobble: 1.6, wobbleSize: 70, jitter: 0.5, grain: 0, breakup: 0, sketch: 0, opacity: 1 }),
  pencil: Object.freeze({ id: 'pencil', label: '연필', outline: 1.15, crease: 0.8, taper: 0.3, wobble: 2.4, wobbleSize: 55, jitter: 0.2, grain: 0.55, breakup: 0, sketch: 0.55, opacity: 0.85 }),
  brush: Object.freeze({ id: 'brush', label: '붓', outline: 1.7, crease: 0.75, taper: 0.6, wobble: 1.8, wobbleSize: 80, jitter: 0.55, grain: 0.1, breakup: 0.3, sketch: 0, opacity: 1 }),
});

export const LINE_STYLE_IDS = Object.freeze(Object.keys(LINE_STYLES));

export function normalizeLineStyle(value) {
  return LINE_STYLES[value] ? value : DEFAULT_LINE_STYLE;
}

export function normalizeLineHand(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.max(0, Math.min(1, amount)) : DEFAULT_LINE_HAND;
}

/**
 * Shader numbers for a style at hand amount `hand` (0–1). Widths and taper
 * belong to the style; the hand amount scales only the irregular parts, so
 * 0 gives steady lines of the style's weights and 1 the full hand-drawn look.
 * Lengths are in CSS px (multiply by the pixel scale before use).
 */
export function lineStyleParams(style, hand = DEFAULT_LINE_HAND) {
  const preset = LINE_STYLES[normalizeLineStyle(style)];
  const amount = normalizeLineHand(hand);
  return {
    outline: preset.outline,
    crease: preset.crease,
    taper: preset.taper,
    wobble: preset.wobble * amount,
    wobbleSize: preset.wobbleSize,
    jitter: preset.jitter * amount,
    grain: preset.grain * amount,
    breakup: preset.breakup * amount,
    sketch: preset.sketch * amount,
    opacity: preset.opacity,
  };
}

/**
 * Width factor for a line at `distance` metres from the camera: 1 up to
 * `near` metres, then thinner in proportion, never below `floor`; `taper`
 * mixes between no change (0) and the full effect (1).
 */
export function distanceTaper(distance, taper, near = 8, floor = 0.35) {
  const d = Math.max(Number(distance) || 0, 1e-6);
  const full = Math.max(floor, Math.min(1, near / d));
  const amount = Math.max(0, Math.min(1, Number(taper) || 0));
  return 1 + (full - 1) * amount;
}
