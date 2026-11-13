// Raster brush v2 — canvas side. Stamps dabs from raster-brush.js into a
// stroke buffer and composites that buffer for the live preview and the final
// commit. Both use the same buffer and the same composite settings, so the
// picture while drawing equals the picture after release.

import { PAPER_TILE, paperGrain, tipFalloff } from './raster-brush.js';

const TIP_SIZE = 128;
const baseTips = new Map();
const tintedTips = new Map();

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

// Deterministic value noise for pencil grain.
function grainNoise(x, y) {
  const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return n - Math.floor(n);
}

/** White brush tip with alpha from hardness (and grain), cached per preset. */
function baseTip(brush) {
  const key = `${brush.id}:${brush.hardness}:${brush.grain}`;
  if (baseTips.has(key)) return baseTips.get(key);
  const canvas = makeCanvas(TIP_SIZE, TIP_SIZE);
  const context = canvas.getContext('2d');
  const image = context.createImageData(TIP_SIZE, TIP_SIZE);
  const half = TIP_SIZE / 2;
  for (let y = 0; y < TIP_SIZE; y++) {
    for (let x = 0; x < TIP_SIZE; x++) {
      const distance = Math.hypot(x + 0.5 - half, y + 0.5 - half) / half;
      let alpha = tipFalloff(distance, brush.hardness);
      if (brush.grain) alpha *= 1 - brush.grain + brush.grain * grainNoise(x, y);
      const index = (y * TIP_SIZE + x) * 4;
      image.data[index] = 255;
      image.data[index + 1] = 255;
      image.data[index + 2] = 255;
      image.data[index + 3] = Math.round(alpha * 255);
    }
  }
  context.putImageData(image, 0, 0);
  baseTips.set(key, canvas);
  return canvas;
}

/** Brush tip in the paint color, cached per preset + color. */
export function tintedTip(brush, color) {
  const key = `${brush.id}:${brush.hardness}:${brush.grain}:${color}`;
  if (tintedTips.has(key)) return tintedTips.get(key);
  if (tintedTips.size > 48) tintedTips.clear();
  const canvas = makeCanvas(TIP_SIZE, TIP_SIZE);
  const context = canvas.getContext('2d');
  context.drawImage(baseTip(brush), 0, 0);
  context.globalCompositeOperation = 'source-in';
  context.fillStyle = color;
  context.fillRect(0, 0, TIP_SIZE, TIP_SIZE);
  tintedTips.set(key, canvas);
  return canvas;
}

const paperTiles = new Map();

/** White tile whose alpha is the paper tooth, cached per kind. */
export function paperTile(kind) {
  if (paperTiles.has(kind)) return paperTiles.get(kind);
  const alpha = paperGrain(kind, PAPER_TILE);
  const canvas = makeCanvas(PAPER_TILE, PAPER_TILE);
  const context = canvas.getContext('2d');
  const image = context.createImageData(PAPER_TILE, PAPER_TILE);
  for (let index = 0; index < alpha.length; index++) {
    image.data[index * 4] = 255;
    image.data[index * 4 + 1] = 255;
    image.data[index * 4 + 2] = 255;
    image.data[index * 4 + 3] = alpha[index];
  }
  context.putImageData(image, 0, 0);
  paperTiles.set(kind, canvas);
  return canvas;
}

/** Adds the current selection as a clip path, if there is one. */
export function clipToSelection(context, selection) {
  if (selection?.polygon?.length > 2) {
    context.beginPath();
    context.moveTo(selection.polygon[0].x, selection.polygon[0].y);
    for (let index = 1; index < selection.polygon.length; index++) context.lineTo(selection.polygon[index].x, selection.polygon[index].y);
    context.closePath();
    context.clip();
  } else if (selection?.rect && selection.rect.width > 1 && selection.rect.height > 1) {
    context.beginPath();
    context.rect(selection.rect.x, selection.rect.y, selection.rect.width, selection.rect.height);
    context.clip();
  }
}

export class StrokeBuffer {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.canvas = makeCanvas(width, height);
    this.context = this.canvas.getContext('2d');
    this.preview = makeCanvas(width, height);
    this.previewContext = this.preview.getContext('2d');
    this.tip = null;
    this.dabCount = 0;
    this.paper = null;
    this.masked = null;
    this.bounds = null;
  }

  begin(brush, color) {
    this.context.setTransform(1, 0, 0, 1, 0, 0);
    this.context.clearRect(0, 0, this.width, this.height);
    this.tip = tintedTip(brush, color);
    this.dabCount = 0;
    this.bounds = null;
    // Texture brushes: the paper tooth is anchored to the canvas (pattern at
    // the origin), applied to the whole stroke at composite time.
    this.paper = brush.paper ? this.context.createPattern(paperTile(brush.paper), 'repeat') : null;
    if (this.paper && !this.masked) {
      this.masked = makeCanvas(this.width, this.height);
      this.maskedContext = this.masked.getContext('2d');
    }
    // Bounds only grow during a stroke, so later frames clear just the bounds.
    if (this.paper) this.maskedContext.clearRect(0, 0, this.width, this.height);
  }

  /** The stroke as it will be composited: with the paper tooth cut out, if any. */
  strokeImage() {
    if (!this.paper || !this.bounds) return this.canvas;
    const x = Math.max(0, Math.floor(this.bounds.x0));
    const y = Math.max(0, Math.floor(this.bounds.y0));
    const w = Math.min(this.width, Math.ceil(this.bounds.x1)) - x;
    const h = Math.min(this.height, Math.ceil(this.bounds.y1)) - y;
    const context = this.maskedContext;
    context.save();
    if (w > 0 && h > 0) {
      context.clearRect(x, y, w, h);
      context.drawImage(this.canvas, x, y, w, h, x, y, w, h);
      context.globalCompositeOperation = 'destination-in';
      context.fillStyle = this.paper;
      context.fillRect(x, y, w, h);
    }
    context.restore();
    return this.masked;
  }

  stamp(dabs) {
    const context = this.context;
    for (const dab of dabs) {
      const size = Math.max(1, dab.radius * 2);
      const reach = size * 0.75; // covers rotated tips
      if (!this.bounds) this.bounds = { x0: dab.x - reach, y0: dab.y - reach, x1: dab.x + reach, y1: dab.y + reach };
      else {
        this.bounds.x0 = Math.min(this.bounds.x0, dab.x - reach);
        this.bounds.y0 = Math.min(this.bounds.y0, dab.y - reach);
        this.bounds.x1 = Math.max(this.bounds.x1, dab.x + reach);
        this.bounds.y1 = Math.max(this.bounds.y1, dab.y + reach);
      }
      // Dabs smaller than a pixel keep their visual weight through alpha.
      const coverage = dab.radius * 2 < 1 ? dab.radius * 2 : 1;
      context.globalAlpha = Math.min(1, dab.alpha * coverage);
      if (dab.angle) {
        const cos = Math.cos(dab.angle);
        const sin = Math.sin(dab.angle);
        context.setTransform(cos, sin, -sin, cos, dab.x, dab.y);
        context.drawImage(this.tip, -size / 2, -size / 2, size, size);
      } else {
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.drawImage(this.tip, dab.x - size / 2, dab.y - size / 2, size, size);
      }
    }
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = 1;
    this.dabCount += dabs.length;
  }

  /**
   * Draws the stroke buffer onto `context` the way it will be committed.
   * mode: { operation, alpha, selection }
   */
  compositeOnto(context, { operation = 'source-over', alpha = 1, selection = null } = {}) {
    context.save();
    clipToSelection(context, selection);
    context.globalCompositeOperation = operation;
    context.globalAlpha = alpha;
    context.drawImage(this.strokeImage(), 0, 0);
    context.restore();
  }

  /** Base image + stroke, for showing the stroke live before it is committed. */
  renderPreview(base, mode) {
    const context = this.previewContext;
    context.save();
    context.globalCompositeOperation = 'copy';
    context.drawImage(base, 0, 0);
    context.restore();
    this.compositeOnto(context, mode);
    return this.preview;
  }
}
