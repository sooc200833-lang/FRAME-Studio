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
    for (let index = 1; index < points.length; index++) {
      graphics.lineTo(points[index].x, points[index].y);
    }
    graphics.stroke({ color, width, alpha, cap: 'round', join: 'round' });
  }

  sync(layers, dirtyIndices = [], strokes = [], selectedStrokeId = null, onionSkin = []) {
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
        const texture = Texture.from(layer.canvas);
        const sprite = new Sprite(texture);
        sprite.width = this.width;
        sprite.height = this.height;
        entry = { texture, sprite };
        this.entries.set(layer, entry);
        this.app.stage.addChildAt(sprite, this.app.stage.children.length - 1);
      }

      entry.sprite.visible = layer.visible;
      if (dirtyIndices.includes(index)) entry.texture.source.update();
    });

    for (const ghost of onionSkin) {\n      for (const stroke of ghost.strokes) {\n        const graphics = new Graphics();\n        this.drawPath(graphics, stroke.points, ghost.tint, stroke.width, ghost.alpha);\n        this.app.stage.addChildAt(graphics, this.app.stage.children.length - 1);\n        this.strokeGraphics.push(graphics);\n      }\n    }\n\n    for (const stroke of strokes) {
      const graphics = new Graphics();
      if (stroke.id === selectedStrokeId) {
        this.drawPath(graphics, stroke.points, 0xe5b85c, stroke.width + 8, 0.55);
      }
      this.drawPath(graphics, stroke.points, Number.parseInt(stroke.color.slice(1), 16), stroke.width);
      this.app.stage.addChildAt(graphics, this.app.stage.children.length - 1);
      this.strokeGraphics.push(graphics);
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
