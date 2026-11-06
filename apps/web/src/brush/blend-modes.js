export const BRUSH_BLEND_MODES = Object.freeze([
  'source-over',
  'multiply',
  'screen',
  'overlay',
]);

export function normalizeBrushBlendMode(mode) {
  return BRUSH_BLEND_MODES.includes(mode) ? mode : 'source-over';
}

export function toPixiBrushBlendMode(mode) {
  const normalized = normalizeBrushBlendMode(mode);
  return normalized === 'source-over' ? 'normal' : normalized;
}
