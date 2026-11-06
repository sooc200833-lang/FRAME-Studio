// Renderer-independent color helpers used by the HSV picker and eyedropper.

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function hexToRgb(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!match) return null;
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function rgbToHex(r, g, b) {
  return '#' + [r, g, b]
    .map(channel => clamp(Math.round(Number(channel) || 0), 0, 255).toString(16).padStart(2, '0'))
    .join('');
}

/** Returns hue in degrees [0, 360), saturation and value in [0, 1]. */
export function rgbToHsv(r, g, b) {
  const red = clamp(r, 0, 255) / 255;
  const green = clamp(g, 0, 255) / 255;
  const blue = clamp(b, 0, 255) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;
  if (delta > 0) {
    if (max === red) hue = ((green - blue) / delta) % 6;
    else if (max === green) hue = (blue - red) / delta + 2;
    else hue = (red - green) / delta + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  return { h: hue, s: max === 0 ? 0 : delta / max, v: max };
}

export function hsvToRgb(h, s, v) {
  const hue = ((Number(h) || 0) % 360 + 360) % 360;
  const saturation = clamp(Number(s) || 0, 0, 1);
  const value = clamp(Number(v) || 0, 0, 1);
  const chroma = value * saturation;
  const x = chroma * (1 - Math.abs((hue / 60) % 2 - 1));
  const m = value - chroma;
  let rgb;
  if (hue < 60) rgb = [chroma, x, 0];
  else if (hue < 120) rgb = [x, chroma, 0];
  else if (hue < 180) rgb = [0, chroma, x];
  else if (hue < 240) rgb = [0, x, chroma];
  else if (hue < 300) rgb = [x, 0, chroma];
  else rgb = [chroma, 0, x];
  return rgb.map(channel => Math.round((channel + m) * 255));
}

export function hexToHsv(hex) {
  const rgb = hexToRgb(hex);
  return rgb ? rgbToHsv(...rgb) : { h: 0, s: 0, v: 0 };
}

export function hsvToHex(h, s, v) {
  return rgbToHex(...hsvToRgb(h, s, v));
}

/**
 * Averages the opaque color around (x, y) in RGBA image data. Transparent
 * pixels are composited over `background` so picking empty paper returns the
 * paper color instead of black.
 */
export function sampleImageDataColor(data, width, height, x, y, { radius = 1, background = '#f4f0e8' } = {}) {
  if (!data || width <= 0 || height <= 0) return null;
  const cx = Math.round(x);
  const cy = Math.round(y);
  if (!(cx >= 0 && cy >= 0 && cx < width && cy < height)) return null;
  const paper = hexToRgb(background) || [255, 255, 255];
  const r = Math.max(0, Math.floor(radius));
  const sum = [0, 0, 0];
  let count = 0;
  for (let py = Math.max(0, cy - r); py <= Math.min(height - 1, cy + r); py++) {
    for (let px = Math.max(0, cx - r); px <= Math.min(width - 1, cx + r); px++) {
      const index = (py * width + px) * 4;
      const alpha = data[index + 3] / 255;
      for (let channel = 0; channel < 3; channel++) {
        sum[channel] += data[index + channel] * alpha + paper[channel] * (1 - alpha);
      }
      count++;
    }
  }
  return rgbToHex(sum[0] / count, sum[1] / count, sum[2] / count);
}
