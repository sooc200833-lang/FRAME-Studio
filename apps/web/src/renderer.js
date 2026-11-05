import { Application, Graphics, Sprite, Texture } from 'pixi.js';

export class PixiStageRenderer {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.app = null;
    this.background = null;
    this.preview = null;
    this.entries = new Map();
    this.strokeGraphics = [];
  }

  async init(host) {
    const app = new Application();
    await app.init({
      width: this.width,
      height: this.height,
      backgroundColor: 0xf4f0e8,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      preference: 'webgl',
      powerPreference: 'high-performance',
    });

    this.app = app;
    app.canvas.className = 'pixi-canvas';
    app.canvas.setAttribute('aria-label', 'FRAME Studio drawing canvas');
    host.replaceChildren(app.canvas);

    this.background = new Graphics().rect(0, 0, this.width, this.height).fill(0xf4f0e8);
    this.preview = new Graphics();
    app.stage.addChild(this.background, this.preview);
    return app.canvas;
  }

  drawPath(graphics, points, color, width, alpha = 1) {
    if (!points?.length) return;
    graphics.moveTo(points[0].x, points[0].y);
    if (points.length === 2) {
      graphics.lineTo(points[1].x, points[1].y);
    } else {
      for (let index = 1; index < points.length - 1; index++) {
        const current = points[index];
        const next = points[index + 1];
        graphics.quadraticCurveTo(current.x, current.y, (current.x + next.x) / 2, (current.y + next.y) / 2);
      }
      const last = points[points.length - 1];
      graphics.lineTo(last.x, last.y);
    }
    graphics.stroke({ color, width, alpha, cap: 'round', join: 'round' });
  }

  sync(layers, dirtyIndices = [], strokes = [], selectedStrokeId = null, onionSkin = [], selectionRect = null) {
    if (!this.app) return;

    // Rebuild vector overlays after paint-layer sprites and before the live preview.
    for (const graphics of this.strokeGraphics) {
      this.app.stage.removeChild(graphics);
      graphics.destroy();
    }
    this.strokeGraphics = [];

    layers.forEach((layer, index) => {
      let entry = this.entries.get(layer);
      if (!entry) {
        const displayCanvas = document.createElement('canvas');
        displayCanvas.width = this.width; displayCanvas.height = this.height;
        const texture = Texture.from(displayCanvas);
        const sprite = new Sprite(texture);
        sprite.width = this.width;
        sprite.height = this.height;
        entry = { texture, sprite, displayCanvas };
        this.entries.set(layer, entry);
        this.app.stage.addChildAt(sprite, this.app.stage.children.length - 1);
      }

      entry.sprite.visible = layer.renderVisible ?? layer.visible;
      entry.sprite.alpha = layer.renderOpacity ?? layer.opacity ?? 1;
      entry.sprite.blendMode = layer.renderBlendMode || layer.blendMode || 'normal';
      if (dirtyIndices.includes(index) || !entry.initialized) {
        const context = entry.displayCanvas.getContext('2d');
        context.clearRect(0, 0, this.width, this.height);
        context.globalCompositeOperation = 'source-over';
        context.drawImage(layer.canvas, 0, 0);
        if (layer.maskEnabled && layer.maskCanvas) {
          context.globalCompositeOperation = 'destination-in';
          context.drawImage(layer.maskCanvas, 0, 0);
        }
        context.globalCompositeOperation = 'source-over';
        entry.texture.source.update();
        entry.initialized = true;
      }
    });

    layers.forEach((layer, index) => {
      const sprite = this.entries.get(layer)?.sprite;
      if (sprite) this.app.stage.setChildIndex(sprite, 1 + index);
    });

    for (const ghost of onionSkin) {
      for (const stroke of ghost.strokes) {
        const graphics = new Graphics();
        this.drawPath(graphics, stroke.points, ghost.tint, stroke.width, ghost.alpha);
        this.app.stage.addChildAt(graphics, this.app.stage.children.length - 1);
        this.strokeGraphics.push(graphics);
      }
    }

    for (const stroke of strokes) {
      const graphics = new Graphics();
      if (stroke.id === selectedStrokeId) {
        this.drawPath(graphics, stroke.points, 0xe5b85c, stroke.width + 8, 0.55);
      }
      this.drawPath(graphics, stroke.points, Number.parseInt(stroke.color.slice(1), 16), stroke.width);
      this.app.stage.addChildAt(graphics, this.app.stage.children.length - 1);
      this.strokeGraphics.push(graphics);
    }

    if (selectionRect && selectionRect.width > 1 && selectionRect.height > 1) {
      const outline = new Graphics();
      const drawDash = (x1, y1, x2, y2) => {
        const length = Math.hypot(x2 - x1, y2 - y1);
        const steps = Math.ceil(length / 10);
        for (let index = 0; index < steps; index += 2) {
          const start = index / steps;
          const end = Math.min(1, (index + 1) / steps);
          outline.moveTo(x1 + (x2 - x1) * start, y1 + (y2 - y1) * start);
          outline.lineTo(x1 + (x2 - x1) * end, y1 + (y2 - y1) * end);
        }
      };
      const left = selectionRect.x, top = selectionRect.y;
      const right = left + selectionRect.width, bottom = top + selectionRect.height;
      drawDash(left, top, right, top);
      drawDash(right, top, right, bottom);
      drawDash(right, bottom, left, bottom);
      drawDash(left, bottom, left, top);
      outline.stroke({ color: 0x268cff, width: 1.5, alpha: 0.95 });
      outline.rect(right - 5, bottom - 5, 10, 10).fill(0xffffff).stroke({ color: 0x268cff, width: 1.5 });
      this.app.stage.addChildAt(outline, this.app.stage.children.length - 1);
      this.strokeGraphics.push(outline);
    }

    this.app.stage.setChildIndex(this.preview, this.app.stage.children.length - 1);
  }

  previewStroke(points, color, width) {
    if (!this.preview || !points?.length) return;
    this.preview.clear();
    this.drawPath(this.preview, points, color, width, 0.85);
  }

  previewLine(from, to, color, width) {
    this.previewStroke([from, to], color, width);
  }

  previewPolygon(points, color, alpha = 1) {
    if (!this.preview) return;
    this.preview.clear();
    if (!points || points.length < 3) return;
    this.preview.moveTo(points[0][0], points[0][1]);
    for (let index = 1; index < points.length; index++) {
      this.preview.lineTo(points[index][0], points[index][1]);
    }
    this.preview.closePath();
    this.preview.fill({ color, alpha });
  }

  clearPreview() {
    this.preview?.clear();
  }

  destroy() {
    if (!this.app) return;
    this.app.destroy({ removeView: true }, { children: true, texture: true, textureSource: true });
    this.entries.clear();
    this.strokeGraphics = [];
    this.app = null;
  }
}
