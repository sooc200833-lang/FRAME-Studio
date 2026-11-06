import { sampleStrokePath } from './line-engine.js';
import { getVectorBrushPreset, getVectorPointWidth } from './vector-brush.js';

/**
 * Shared vector stroke segment model used by the Pixi canvas and Canvas2D export.
 * Keeping widths, pressure interpolation and preset opacity in one place prevents
 * the exported image from silently dropping the on-canvas brush appearance.
 */
export function buildVectorStrokeSegments(stroke, pointsOverride = null) {
  const points = pointsOverride || sampleStrokePath(stroke).points || [];
  if (points.length < 2) return [];
  const source = stroke.points || [];
  if (source.length < 2) return [];
  const preset = getVectorBrushPreset(stroke.brushPreset);
  const alpha = (stroke.opacity ?? preset.opacity) * (preset.texture === 'marker' ? 0.72 : 1);
  const pressureAt = index => {
    const ratio = index / Math.max(1, points.length - 1);
    const position = ratio * (source.length - 1);
    const left = Math.floor(position);
    const right = Math.min(source.length - 1, left + 1);
    const mix = position - left;
    return (source[left].pressure ?? 0.5) * (1 - mix) + (source[right].pressure ?? 0.5) * mix;
  };
  const segments = [];
  for (let index = 1; index < points.length; index++) {
    const widthA = getVectorPointWidth(stroke, { pressure: pressureAt(index - 1) }, index - 1, points.length);
    const widthB = getVectorPointWidth(stroke, { pressure: pressureAt(index) }, index, points.length);
    segments.push({
      from: points[index - 1],
      to: points[index],
      width: Math.max(0.35, (widthA + widthB) / 2),
      alpha,
      skip: preset.texture === 'dry' && index % 7 === 0,
    });
  }
  return segments;
}
