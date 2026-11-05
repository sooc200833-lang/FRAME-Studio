import { Application, Graphics, Sprite, Texture } from 'pixi.js';

/**
 * GPU presentation layer for FRAME Studio.
 * Painting data remains in ordinary canvases so the fill engine and document
 * format do not depend on PixiJS.
 */
export class PixiStageRenderer {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.app = null;
    this.background = null;
    this.preview = null;
    this.entries = new Map();
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

    this.background = new Graphics()
      .rect(0, 0, this.width, this.height)
      .fill(0xf4f0e8);
    this.preview = new Graphics();
    app.stage.addChild(this.background, this.preview);
    return app.canvas;
  }

  sync(layers, dirtyIndices = []) {
    if (!this.app) return;

    layers.forEach((layer, index) => {
      let entry = this.entries.get(layer);
      if (!entry) {
        const texture = Texture.from(layer.canvas);
        const sprite = new Sprite(texture);
        sprite.width = this.width;
        sprite.height = this.height;
        entry = { texture, sprite };
        this.entries.set(layer, entry);
        // Insert paint layers above the background and below the preview.
        this.app.stage.addChildAt(sprite, this.app.stage.children.length - 1);
      }

      entry.sprite.visible = layer.visible;
      if (dirtyIndices.includes(index)) {
        entry.texture.source.update();
      }
    });

    // Keep the preview above every paint layer.
    this.app.stage.setChildIndex(this.preview, this.app.stage.children.length - 1);
  }

  previewLine(from, to, color, width) {
    if (!this.preview) return;
    this.preview.clear();
    this.preview
      .moveTo(from.x, from.y)
      .lineTo(to.x, to.y)
      .stroke({ color, width, cap: 'round' });
  }

  clearPreview() {
    this.preview?.clear();
  }

  destroy() {
    if (!this.app) return;
    this.app.destroy({ removeView: true }, { children: true, texture: true, textureSource: true });
    this.entries.clear();
    this.app = null;
  }
}
