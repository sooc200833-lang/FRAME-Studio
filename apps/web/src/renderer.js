import { sampleLineStrokePath } from './line/line-engine.js';
import { buildVectorStrokeSegments } from './line/vector-rendering.js';
import { Application, Container, Graphics, Matrix, Sprite, Texture } from 'pixi.js';
import { applyBrushTexture } from './brush/brush-engine.js';
import { getVectorGraphicsCacheEntry, pruneVectorGraphicsCache } from './renderer/vector-graphics-cache.js';
import { getPolygonBounds, getPolygonTransformHandles } from './selection/selection.js';
import { createRendererInitOptions, initializeWithBackendFallback } from './renderer/renderer-options.js';
import { toPixiBrushBlendMode } from './brush/blend-modes.js';

export class PixiStageRenderer {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.app = null;
    this.background = null;
    this.preview = null;
    this.previewTextureCanvas = null;
    this.previewTextureContext = null;
    this.previewTexture = null;
    this.previewTextureSprite = null;
    this.entries = new Map();
    this.layerPreviews = new Map();
    this.strokeGraphics = [];
    this.vectorGraphicsCache = new Map();
    this.graphicsPool = [];
  }

  async init(host) {
    // A backend can pass capability detection but still fail while creating its
    // context/device. Retry independently and retain the last useful diagnostics.
    const initialized = await initializeWithBackendFallback(async backend => {
      const candidate = new Application();
      try {
        await candidate.init(createRendererInitOptions({
          width: this.width,
          height: this.height,
          devicePixelRatio: window.devicePixelRatio || 1,
          backend,
        }));
        return candidate;
      } catch (error) {
        console.warn(`FRAME Studio: ${backend} renderer initialization failed.`, error);
        try {
          candidate.destroy({ removeView: true }, { children: true, texture: true, textureSource: true });
        } catch {
          // Initialization may have failed before PixiJS had resources to destroy.
        }
        throw error;
      }
    });

    const app = initialized.value;
    this.rendererBackend = initialized.backend;
    this.app = app;
    app.canvas.className = 'pixi-canvas';
    app.canvas.setAttribute('aria-label', 'FRAME Studio drawing canvas');
    host.replaceChildren(app.canvas);

    this.background = new Graphics().rect(0, 0, this.width, this.height).fill(0xf4f0e8);
    this.preview = new Graphics();
    this.previewTextureCanvas = document.createElement('canvas');
    this.previewTextureCanvas.width = 1;
    this.previewTextureCanvas.height = 1;
    this.previewTextureContext = this.previewTextureCanvas.getContext('2d');
    this.previewTexture = Texture.from(this.previewTextureCanvas);
    this.previewTextureSprite = new Sprite(this.previewTexture);
    this.previewTextureSprite.visible = false;
    // Live stroke previews share one container so they can follow the active
    // layer's movement transform while painting on a moved layer.
    this.previewContainer = new Container();
    this.previewContainer.addChild(this.preview, this.previewTextureSprite);
    app.stage.addChild(this.background, this.previewContainer);
    return app.canvas;
  }

  drawPath(graphics, points, color, width, alpha = 1) {
    if (!points?.length) return;
    const path = sampleLineStrokePath(points);
    if (!path.points.length) return;
    graphics.moveTo(path.points[0].x, path.points[0].y);
    for (let index = 1; index < path.points.length; index++) {
      graphics.lineTo(path.points[index].x, path.points[index].y);
    }
    graphics.stroke({ color, width, alpha, cap: 'round', join: 'round' });
  }

  drawVectorStroke(graphics, stroke, pointsOverride = null, alphaOverride = 1) {
    const color = typeof stroke.color === 'number' ? stroke.color : Number.parseInt(stroke.color.slice(1), 16);
    for (const segment of buildVectorStrokeSegments(stroke, pointsOverride)) {
      if (segment.skip) continue;
      graphics.moveTo(segment.from.x, segment.from.y);
      graphics.lineTo(segment.to.x, segment.to.y);
      graphics.stroke({
        color,
        width: segment.width,
        alpha: segment.alpha * alphaOverride,
        cap: 'round',
        join: 'round',
      });
    }
  }

  acquireGraphics() {
    return this.graphicsPool.pop() || new Graphics();
  }

  releaseGraphics(graphics) {
    if (graphics.parent) graphics.parent.removeChild(graphics);
    graphics.clear();
    if (this.graphicsPool.length < 512) this.graphicsPool.push(graphics);
    else graphics.destroy();
  }

  sync(layers, dirtyIndices = [], strokes = [], selectedStrokeId = null, onionSkin = [], selectionRect = null, selectionPolygon = null, selectedNodeIndex = null, showNodeHandles = false, selectedBezierHandle = null, selectedBezierAnchor = null, showSelectedHighlight = true, selectedStrokeIds = new Set()) {
    const k = this.handleScale || 1;
    if (!this.app) return;

    // Rebuild transient overlays, but keep committed vector paths attached to their cache entries.
    for (const graphics of this.strokeGraphics) this.releaseGraphics(graphics);
    this.strokeGraphics = [];
    for (const entry of this.vectorGraphicsCache.values()) this.app.stage.removeChild(entry.graphics);

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
      setDisplayMatrix(entry.sprite, layer.renderMatrix);
      entry.sprite.blendMode = layer.renderBlendMode || layer.blendMode || 'normal';
      if (dirtyIndices.includes(index) || !entry.initialized) {
        const context = entry.displayCanvas.getContext('2d');
        context.clearRect(0, 0, this.width, this.height);
        context.globalCompositeOperation = 'source-over';
        context.drawImage(layer.presentationCanvas || layer.canvas, 0, 0);
        if (layer.maskEnabled && layer.maskCanvas) {
          context.globalCompositeOperation = 'destination-in';
          context.drawImage(layer.maskCanvas, 0, 0);
        }
        context.globalCompositeOperation = 'source-over';
        entry.texture.source.update();
        entry.initialized = true;
      }
      const previewCanvas = this.layerPreviews.get(layer);
      if (previewCanvas) this.refreshLayerEntry(layer, previewCanvas);
    });

    layers.forEach((layer, index) => {
      const sprite = this.entries.get(layer)?.sprite;
      if (sprite) this.app.stage.setChildIndex(sprite, 1 + index);
    });

    for (const ghost of onionSkin) {
      for (const stroke of ghost.strokes) {
        const graphics = this.acquireGraphics();
        this.drawVectorStroke(graphics, { ...stroke, color: ghost.tint }, null, ghost.alpha);
        this.app.stage.addChildAt(graphics, this.app.stage.children.length - 1);
        this.strokeGraphics.push(graphics);
      }
    }

    const activeStrokeIds = new Set();
    for (const stroke of strokes) {
      activeStrokeIds.add(stroke.id);
      const cached = getVectorGraphicsCacheEntry(
        this.vectorGraphicsCache,
        stroke,
        () => this.acquireGraphics(),
        (graphics, item) => {
          this.drawVectorStroke(graphics, item);
          for (const pass of item.motionPasses || []) this.drawVectorStroke(graphics, item, pass.points, pass.alpha);
        },
      );
      if (showSelectedHighlight && (stroke.id === selectedStrokeId || selectedStrokeIds.has(stroke.id))) {
        const highlight = this.acquireGraphics();
        this.drawVectorStroke(highlight, { ...stroke, color: '#e5b85c', width: stroke.width + 8, opacity: 1 }, null, 0.55);
        this.app.stage.addChildAt(highlight, this.app.stage.children.length - 1);
        this.strokeGraphics.push(highlight);
      }
      this.app.stage.addChildAt(cached.graphics, this.app.stage.children.length - 1);
      if (stroke.id === selectedStrokeId && showNodeHandles && stroke.bezierPath) {
        const handles = this.acquireGraphics();
        stroke.bezierPath.segments.forEach((segment, index) => {
          const start = stroke.bezierPath.anchors[index];
          const end = stroke.bezierPath.anchors[index + 1];
          const outSelected = selectedBezierHandle?.segmentIndex === index && selectedBezierHandle?.handle === 'out';
          const inSelected = selectedBezierHandle?.segmentIndex === index && selectedBezierHandle?.handle === 'in';
          handles.moveTo(start.x, start.y).lineTo(segment.control1.x, segment.control1.y);
          handles.moveTo(end.x, end.y).lineTo(segment.control2.x, segment.control2.y);
          handles.stroke({ color: 0x8b929e, width: 1.2 * k, alpha: 0.9 });
          handles.circle(segment.control1.x, segment.control1.y, (outSelected ? 7 : 5) * k)
            .fill(outSelected ? 0xe5b85c : 0x8ec5ff).stroke({ color: 0x24242a, width: 1.3 * k });
          handles.circle(segment.control2.x, segment.control2.y, (inSelected ? 7 : 5) * k)
            .fill(inSelected ? 0xe5b85c : 0x8ec5ff).stroke({ color: 0x24242a, width: 1.3 * k });
        });
        stroke.bezierPath.anchors.forEach((point, index) => {
          const selected = selectedBezierAnchor === index;
          const smooth = (stroke.bezierPath.anchorModes?.[index] || (index > 0 && index < stroke.bezierPath.anchors.length - 1 ? 'smooth' : 'corner')) === 'smooth';
          handles.circle(point.x, point.y, (selected ? 7 : 5) * k)
            .fill(selected ? 0xe5b85c : (smooth ? 0x9bcfff : 0xf8f6f0))
            .stroke({ color: 0x24242a, width: (selected ? 1.8 : 1.1) * k });
        });
        this.app.stage.addChildAt(handles, this.app.stage.children.length - 1);
        this.strokeGraphics.push(handles);
      } else if (stroke.id === selectedStrokeId && showNodeHandles) {
        const nodes = this.acquireGraphics();
        stroke.points.forEach((point, index) => {
          const selected = index === selectedNodeIndex;
          nodes.circle(point.x, point.y, (selected ? 7 : 5) * k)
            .fill(selected ? 0xe5b85c : 0xf8f6f0)
            .stroke({ color: selected ? 0x24242a : 0x6d7785, width: (selected ? 2 : 1.5) * k });
        });
        this.app.stage.addChildAt(nodes, this.app.stage.children.length - 1);
        this.strokeGraphics.push(nodes);
      }
    }

    pruneVectorGraphicsCache(this.vectorGraphicsCache, activeStrokeIds, graphics => this.releaseGraphics(graphics));

    if (selectionRect && selectionRect.width > 1 && selectionRect.height > 1) {
      const outline = this.acquireGraphics();
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
      const handles = [
        [left, top], [(left + right) / 2, top], [right, top],
        [right, (top + bottom) / 2], [right, bottom],
        [(left + right) / 2, bottom], [left, bottom], [left, (top + bottom) / 2],
      ];
      for (const [x, y] of handles) {
        outline.circle(x, y, 8).fill(0xf8fafc).stroke({ color: 0x268cff, width: 1.7 });
      }
      const rotateX = (left + right) / 2, rotateY = top - 36;
      outline.moveTo(rotateX, top).lineTo(rotateX, rotateY + 7);
      outline.stroke({ color: 0x268cff, width: 1.3, alpha: 0.9 });
      outline.circle(rotateX, rotateY, 9).fill(0xe5b85c).stroke({ color: 0x24242a, width: 1.5 });
      this.app.stage.addChildAt(outline, this.app.stage.children.length - 1);
      this.strokeGraphics.push(outline);
    }

    if (selectionPolygon && selectionPolygon.length > 2) {
      const outline = this.acquireGraphics();
      const drawDash = (from, to) => {
        const length = Math.hypot(to.x - from.x, to.y - from.y);
        const steps = Math.max(1, Math.ceil(length / 9));
        for (let index = 0; index < steps; index += 2) {
          const start = index / steps;
          const end = Math.min(1, (index + 1) / steps);
          outline.moveTo(from.x + (to.x - from.x) * start, from.y + (to.y - from.y) * start);
          outline.lineTo(from.x + (to.x - from.x) * end, from.y + (to.y - from.y) * end);
        }
      };
      for (let index = 0; index < selectionPolygon.length; index++) {
        drawDash(selectionPolygon[index], selectionPolygon[(index + 1) % selectionPolygon.length]);
      }
      outline.stroke({ color: 0x268cff, width: 1.7, alpha: 0.98 });

      const bounds = getPolygonBounds(selectionPolygon);
      const handles = getPolygonTransformHandles(selectionPolygon);
      if (bounds && handles.length) {
        const left = bounds.x, top = bounds.y;
        const right = left + bounds.width, bottom = top + bounds.height;
        drawDash({ x: left, y: top }, { x: right, y: top });
        drawDash({ x: right, y: top }, { x: right, y: bottom });
        drawDash({ x: right, y: bottom }, { x: left, y: bottom });
        drawDash({ x: left, y: bottom }, { x: left, y: top });
        const rotation = handles.find(handle => handle.id === 'rotate');
        if (rotation) {
          outline.moveTo(rotation.x, top).lineTo(rotation.x, rotation.y + 7);
          outline.stroke({ color: 0x268cff, width: 1.3, alpha: 0.9 });
        }
        for (const handle of handles) {
          const isRotation = handle.id === 'rotate';
          outline.circle(handle.x, handle.y, isRotation ? 9 : 8)
            .fill(isRotation ? 0xe5b85c : 0xf8fafc)
            .stroke({ color: isRotation ? 0x24242a : 0x268cff, width: isRotation ? 1.5 : 1.7 });
        }
      }

      this.app.stage.addChildAt(outline, this.app.stage.children.length - 1);
      this.strokeGraphics.push(outline);
    }

    this.app.stage.setChildIndex(this.previewContainer, this.app.stage.children.length - 1);
  }

  refreshLayerEntry(layer, sourceCanvas) {
    const entry = this.entries.get(layer);
    if (!entry || !sourceCanvas) return;
    const context = entry.displayCanvas.getContext('2d');
    context.clearRect(0, 0, this.width, this.height);
    context.globalCompositeOperation = 'source-over';
    context.drawImage(sourceCanvas, 0, 0);
    if (layer.maskEnabled && layer.maskCanvas) {
      context.globalCompositeOperation = 'destination-in';
      context.drawImage(layer.maskCanvas, 0, 0);
    }
    context.globalCompositeOperation = 'source-over';
    entry.texture.source.update();
  }

  setLayerPreview(layer, canvas) {
    if (!layer || !canvas) return;
    this.layerPreviews.set(layer, canvas);
  }

  clearLayerPreview(layer) {
    if (!layer) return;
    this.layerPreviews.delete(layer);
    this.refreshLayerEntry(layer, layer.presentationCanvas || layer.canvas);
  }

  previewStroke(points, color, width) {
    if (!this.preview || !points?.length) return;
    this.clearPreview();
    this.drawPath(this.preview, points, color, width, 0.85);
  }

  /** Live preview of a vector stroke with the same pressure widths as the committed line. */
  previewVectorStroke(stroke) {
    if (!this.preview || !stroke?.points?.length) return;
    this.clearPreview();
    this.drawVectorStroke(this.preview, stroke);
  }

  previewLine(from, to, color, width) {
    this.previewStroke([from, to], color, width);
  }

  previewPolygon(points, color, alpha = 1) {
    if (!this.preview) return;
    this.clearPreview();
    this.preview.clear();
    if (!points || points.length < 3) return;
    this.preview.moveTo(points[0][0], points[0][1]);
    for (let index = 1; index < points.length; index++) {
      this.preview.lineTo(points[index][0], points[index][1]);
    }
    this.preview.closePath();
    this.preview.fill({ color, alpha });
  }

  previewBrush(outline, color, alpha, samples, options = {}) {
    if (!this.previewTextureContext || !this.previewTexture) return;
    this.preview?.clear();
    const context = this.previewTextureContext;
    if (!Array.isArray(outline) || outline.length < 3) {
      this.previewTextureSprite.visible = false;
      return;
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const point of outline) {
      if (point[0] < minX) minX = point[0];
      if (point[0] > maxX) maxX = point[0];
      if (point[1] < minY) minY = point[1];
      if (point[1] > maxY) maxY = point[1];
    }
    const padding = 3;
    const left = Math.max(0, Math.floor(minX - padding));
    const top = Math.max(0, Math.floor(minY - padding));
    const right = Math.min(this.width, Math.ceil(maxX + padding));
    const bottom = Math.min(this.height, Math.ceil(maxY + padding));
    const canvasWidth = Math.max(1, right - left);
    const canvasHeight = Math.max(1, bottom - top);

    if (this.previewTextureCanvas.width !== canvasWidth) this.previewTextureCanvas.width = canvasWidth;
    if (this.previewTextureCanvas.height !== canvasHeight) this.previewTextureCanvas.height = canvasHeight;
    context.clearRect(0, 0, canvasWidth, canvasHeight);
    context.save();
    context.translate(-left, -top);
    context.globalAlpha = alpha;
    context.fillStyle = color;
    context.beginPath();
    context.moveTo(outline[0][0], outline[0][1]);
    for (let index = 1; index < outline.length; index++) context.lineTo(outline[index][0], outline[index][1]);
    context.closePath();
    context.fill();
    applyBrushTexture(context, outline, samples, options);
    context.restore();

    this.previewTextureSprite.blendMode = toPixiBrushBlendMode(options.blendMode);
    this.previewTextureSprite.x = left;
    this.previewTextureSprite.y = top;
    this.previewTextureSprite.width = canvasWidth;
    this.previewTextureSprite.height = canvasHeight;
    this.previewTexture.source.update();
    this.previewTextureSprite.visible = true;
  }

  /** Cheap per-frame update of layer movement during playback (no texture work). */
  updateLayerTransforms(layers) {
    for (const layer of layers) {
      const sprite = this.entries.get(layer)?.sprite;
      if (!sprite) continue;
      sprite.alpha = layer.renderOpacity ?? layer.opacity ?? 1;
      setDisplayMatrix(sprite, layer.renderMatrix);
    }
  }

  /** Canvas units per CSS pixel; node handles are sized in CSS pixels. */
  setHandleScale(unitsPerCssPixel = 1) {
    this.handleScale = Number.isFinite(unitsPerCssPixel) && unitsPerCssPixel > 0 ? unitsPerCssPixel : 1;
  }

  setPreviewMatrix(matrix = null) {
    if (this.previewContainer) setDisplayMatrix(this.previewContainer, matrix);
  }

  clearPreview() {
    this.preview?.clear();
    if (this.previewTextureContext && this.previewTextureSprite) {
      this.previewTextureContext.clearRect(0, 0, this.previewTextureCanvas.width, this.previewTextureCanvas.height);
      this.previewTexture.source.update();
      this.previewTextureSprite.visible = false;
      this.previewTextureSprite.blendMode = 'normal';
    }
  }

  destroy() {
    if (!this.app) return;
    for (const entry of this.vectorGraphicsCache.values()) entry.graphics.destroy();
    this.vectorGraphicsCache.clear();
    this.app.destroy({ removeView: true }, { children: true, texture: true, textureSource: true });
    this.entries.clear();
    this.layerPreviews.clear();
    this.strokeGraphics = [];
    for (const graphics of this.graphicsPool) graphics.destroy();
    this.graphicsPool = [];
    this.previewTexture = null;
    this.previewTextureCanvas = null;
    this.previewTextureContext = null;
    this.previewTextureSprite = null;
    this.app = null;
  }
}

const IDENTITY = [1, 0, 0, 1, 0, 0];

/** Applies an affine [a, b, c, d, e, f] matrix (or identity) to a display object. */
function setDisplayMatrix(displayObject, matrix) {
  const [a, b, c, d, e, f] = Array.isArray(matrix) && matrix.length === 6 ? matrix : IDENTITY;
  displayObject.setFromMatrix(new Matrix(a, b, c, d, e, f));
}
