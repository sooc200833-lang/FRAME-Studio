import './styles.css';
import { PixiStageRenderer } from './renderer.js';
import { applyScreentoneToCanvas } from './tone/screentone.js';
import { clientToCanvasPoint, parseCssTransformMatrix } from './viewport/coordinates.js';
import { applyBrushTexture, coalescedPointerEvents, createBrushOutline, createFrameScheduler, getBrushPreset, normalizePointerPressure, resolveBrushStrokeOptions, stabilizePoint } from './brush/brush-engine.js';
import { expandRegionMask, findConnectedRegion } from './fill/flood-fill.js';
import { animateLineStrokes, lineBoilPhase } from './line/line-boil.js';
import { activeFrame, addFrame, createTimeline, deleteFrame, frameAtTime, getOnionSkin, selectFrame, updateFrameCels, updateFrameStrokes, updateFrameTransformCels } from './animation/timeline.js';
import { normalizeRasterCels, normalizeRasterTransformCels } from './animation/frame-cels.js';
import { cloneRasterTransformRecords, composeRasterTransformStack, createTranslationMatrix, createRotationMatrix, rasterizeRasterTransformStack } from './selection/raster-transform.js';
import { containsSelectionPoint, hitTestSelectionHandle, moveSelectionRect, normalizeSelectionRect, lineStrokeIntersectsPolygon, pointInPolygon, resizeSelectionRectFromHandle, resolveSelectionTargets, transformLineStrokes, transformLineStrokesByMatrix, transformPolygon, translatePolygon, getSelectionPreviewTransform, getPolygonBounds, getPolygonCentroid, hitTestPolygonTransformHandle, resizePolygonFromHandle } from './selection/selection.js';
import { convertLegacyPointsToBezierPath } from './line/legacy-bezier-bridge.js';
import { insertBezierAnchor, moveBezierAnchor, moveBezierHandle, projectPointToBezierPath, removeBezierAnchor, sampleBezierPath, setBezierAnchorMode } from './line/bezier-path.js';

import {
  createLineStroke,
  hitTestLineStrokes,
  translateLineStroke,
  updateLineStrokeStyle,
  projectPointToLineStroke,
  insertLineStrokePoint,
  removeLineStrokePoint,
  smoothLineStroke,
  restoreLineStrokeSnapshot,
  lineStrokeSnapshotChanged,
} from './line/line-engine.js';

const W = 1200;
const H = 900;
const host = document.getElementById('pixiHost');
const renderer = new PixiStageRenderer(W, H);

let inputSurface;
let tool = 'vector';
let color = '#24242a';
let size = 7;
let brushPreset = 'ink';
let down = false;
let last = null;
let strokeSamples = [];
let strokeIsStylus = false;
let pressureEnabled = true;
let brushSmoothing = 0.28;
let brushOpacity = 1;
let pressureCurve = getBrushPreset('ink').pressureCurve;
let maskEditing = false;
let selectionRect = null;
let selectionPolygon = null;
let selectionDrag = null;
const selectedTransformLayers = new Set();
let groupedTransformUndo = null;
let groupedTransformRedo = null;
let lineStartPoint = null;
let drawingPoints = null;
let movingStroke = false;
let moveSnapshot = null;
let moveChanged = false;
let nextLineId = 1;
let nextRasterTransformId = 0;
let boilEnabled = false;
let boilStartedAt = 0;
let animationFrame = 0;
let lastAnimationPaint = 0;
let playbackActive = false;
let playbackStartedAt = 0;
let playbackStartOffset = 0;
let playbackRaf = 0;

const paletteGroups = {
  기본: ['#17171b','#45434a','#77727a','#b8b2aa','#dedbd4','#f5f0e8','#ffffff'],
  따뜻한색: ['#5b2028','#8f3037','#bd4145','#d94b52','#f07862','#f2a65a','#f2cf67','#9a6a50','#c08b68','#e3b9a0'],
  차가운색: ['#18324a','#244f70','#3c6c9e','#668bd0','#3f9b9c','#63c5c7','#6f8caa','#a9c4d6'],
  자연색: ['#263d32','#42664b','#4f8a62','#74b58b','#9b9b43','#b2a45a','#79644b','#a68c68'],
  파스텔: ['#f2c6c7','#f4d4b5','#f4e6a1','#d6e6b8','#bfe4df','#c7d9f4','#d7c8ed','#edcbe0'],
};
let activePaletteGroup = '기본';
const recentColors = [];
const defaultPaletteGroups = Object.fromEntries(Object.entries(paletteGroups).map(([name, colors]) => [name, [...colors]]));
const paletteStorageKey = 'frame-studio-color-palettes-v1';

try {
  const stored = JSON.parse(localStorage.getItem(paletteStorageKey) || 'null');
  if (stored && typeof stored === 'object') {
    for (const name of Object.keys(paletteGroups)) {
      if (Array.isArray(stored[name])) {
        paletteGroups[name] = stored[name].filter(value => /^#[0-9a-f]{6}$/i.test(value)).slice(0, 48);
      }
    }
  }
} catch {
  // Palette editing still works for this session when browser storage is unavailable.
}

function persistPaletteGroups() {
  try {
    localStorage.setItem(paletteStorageKey, JSON.stringify(paletteGroups));
  } catch {
    // Keep the current session usable if storage is blocked or full.
  }
}
const vectorStrokes = [];
const lineUndo = [];
const lineRedo = [];
const timeline = createTimeline({ fps: 12 });
let onionEnabled = true;
let loadingFrame = false;
let frameLoadToken = 0;

function makeLayer(name) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const presentationCanvas = document.createElement('canvas');
  presentationCanvas.width = W;
  presentationCanvas.height = H;
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = W;
  maskCanvas.height = H;
  const maskContext = maskCanvas.getContext('2d');
  maskContext.fillStyle = '#fff';
  maskContext.fillRect(0, 0, W, H);
  return {
    name, visible: true, opacity: 1, blendMode: 'normal',
    canvas, presentationCanvas, transformRecords: [],
    maskCanvas, maskEnabled: false, maskUndo: [], maskRedo: [], undo: [], redo: [],
  };
}

const layers = [makeLayer('면 / 톤'), makeLayer('선화')];
const layerGroups = [];
let active = 0;
let activeGroupId = null;

function groupFor(layer) { return layerGroups.find(group => group.id === layer.groupId) || null; }
function applyGroupState() {
  for (const layer of layers) {
    const group = groupFor(layer);
    layer.renderVisible = layer.visible && (!group || group.visible);
    layer.renderOpacity = (layer.opacity ?? 1) * (group?.opacity ?? 1);
    layer.renderBlendMode = group?.blendMode && group.blendMode !== 'normal' ? group.blendMode : (layer.blendMode || 'normal');
  }
}
let selectedStrokeId = null;
let showSelectedVectorHighlight = true;
let vectorBrushPreset = 'ink';
let vectorPressureCurve = 1;
let vectorMotionStyle = 'none';
let vectorMotionStrength = 3;
let selectedNodeIndex = null;
let nodeDragging = false;
let nodeMoveSnapshot = null;
let nodeDragChanged = false;
let nodeEditEnabled = false;
let selectedBezierHandle = null;
let selectedBezierAnchor = null;
let bezierHandleDrag = null;
let bezierAnchorDrag = null;

function rasterizeActiveLayerTransforms() {
  const layer = layers[active];
  if (!layer?.transformRecords?.length) return;
  const before = layer.canvas.toDataURL('image/png');
  const beforeTransforms = snapshotRuntimeTransformRecords(layer.transformRecords);
  save(layer);
  if (!rasterizeRasterTransformStack(layer)) return;
  groupedTransformUndo = {
    entries: [{
      layer,
      before,
      after: layer.canvas.toDataURL('image/png'),
      beforeTransforms,
      afterTransforms: [],
    }],
    vectorBefore: null,
    vectorAfter: null,
  };
  groupedTransformRedo = null;
  saveActiveFrame();
  render([active]);
}

function ensureEditableLayerAfterTransform() {
  const layer = layers[active];
  if (!layer?.transformRecords?.length) return false;
  const next = makeLayer(layer.name + ' · 편집');
  layers.push(next);
  active = layers.length - 1;
  selectedTransformLayers.clear();
  saveActiveFrame();
  render(layers.map((_, index) => index));
  return true;
}

function currentBrushPreset() { return getBrushPreset(brushPreset); }

function currentStrokeOptions(complete = false) {
  return resolveBrushStrokeOptions({
    size, stylus: strokeIsStylus, pressureEnabled, preset: brushPreset,
    pressureCurve, smoothing: currentBrushPreset().smoothing,
    streamline: brushSmoothing, complete,
  });
}

function normalizeHex(value) {
  return /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : '#24242a';
}

function setCurrentColor(value, { applyToSelectedLine = true, remember = true } = {}) {
  color = normalizeHex(value);
  const picker = document.getElementById('customColor');
  if (picker) picker.value = color;
  updateToneControls();
  const preview = document.getElementById('activeColorPreview');
  if (preview) preview.style.background = color;
  const hex = document.getElementById('activeColorHex');
  if (hex) hex.textContent = color.toUpperCase();
  if (remember) {
    const index = recentColors.indexOf(color);
    if (index >= 0) recentColors.splice(index, 1);
    recentColors.unshift(color);
    recentColors.length = Math.min(recentColors.length, 10);
    renderRecentPalette();
  }
  renderPaletteSwatches();
  if (applyToSelectedLine && selectedStroke()) applySelectedStyle({ color });
}

function renderPaletteCategories() {
  const host = document.getElementById('paletteCategories');
  if (!host) return;
  host.replaceChildren();
  Object.keys(paletteGroups).forEach(name => {
    const button = document.createElement('button');
    button.className = 'palette-category' + (name === activePaletteGroup ? ' active' : '');
    button.textContent = name;
    button.onclick = () => {
      activePaletteGroup = name;
      renderPaletteCategories();
      renderPaletteSwatches();
    };
    host.append(button);
  });
}

function renderPaletteSwatches() {
  const host = document.getElementById('palette');
  if (!host) return;
  host.replaceChildren();
  (paletteGroups[activePaletteGroup] || []).forEach(value => {
    const button = document.createElement('button');
    button.className = 'swatch' + (value === color ? ' selected' : '');
    button.style.background = value;
    button.title = value.toUpperCase();
    button.setAttribute('aria-label', value);
    button.onclick = () => setCurrentColor(value);
    host.append(button);
  });
}

function renderRecentPalette() {
  const host = document.getElementById('recentPalette');
  if (!host) return;
  host.replaceChildren();
  recentColors.forEach(value => {
    const button = document.createElement('button');
    button.className = 'swatch' + (value === color ? ' selected' : '');
    button.style.background = value;
    button.title = value.toUpperCase();
    button.setAttribute('aria-label', '최근 색상 ' + value);
    button.onclick = () => setCurrentColor(value);
    host.append(button);
  });
}

function addCurrentColorToPalette() {
  const colors = paletteGroups[activePaletteGroup];
  if (colors.includes(color)) return;
  colors.push(color);
  persistPaletteGroups();
  renderPaletteSwatches();
}

function selectInspectorPanel(panelId) {
  document.querySelectorAll('.panel-tab').forEach(button => {
    button.classList.toggle('active', button.dataset.panel === panelId);
  });
  document.querySelectorAll('.panel-content').forEach(panel => {
    panel.classList.toggle('active', panel.id === panelId);
  });
}

function selectedStroke() {
  return vectorStrokes.find(stroke => stroke.id === selectedStrokeId) || null;
}

function save(layer) {
  groupedTransformUndo = null;
  groupedTransformRedo = null;
  layer.undo.push(layer.canvas.toDataURL());
  if (layer.undo.length > 25) layer.undo.shift();
  layer.redo = [];
}

function restore(layer, stack, other) {
  if (!stack.length) return;
  other.push(layer.canvas.toDataURL());
  const image = new Image();
  image.onload = () => {
    const context = layer.canvas.getContext('2d');
    context.clearRect(0, 0, W, H);
    context.drawImage(image, 0, 0);
    render([active]);
  };
  image.src = stack.pop();
}

async function restoreGroupedTransform(record, direction) {
  if (!record) return;
  const key = direction === 'undo' ? 'before' : 'after';
  const entries = record.entries.filter(entry => layers.includes(entry.layer));
  const images = await Promise.all(entries.map(entry => new Promise(resolve => {
    const image = new Image();
    image.onload = () => resolve({ entry, image });
    image.onerror = () => resolve(null);
    image.src = entry[key];
  })));
  for (const item of images) {
    if (!item) continue;
    const { entry, image } = item;
    const context = entry.layer.canvas.getContext('2d');
    context.clearRect(0, 0, W, H);
    context.drawImage(image, 0, 0);
    const transformKey = direction === 'undo' ? 'beforeTransforms' : 'afterTransforms';
    entry.layer.transformRecords = snapshotRuntimeTransformRecords(entry[transformKey] || []);
    refreshLayerPresentation(entry.layer);
  }
  if (record.vectorBefore && record.vectorAfter) {
    const snapshot = direction === 'undo' ? record.vectorBefore : record.vectorAfter;
    const restored = JSON.parse(snapshot);
    vectorStrokes.splice(0, vectorStrokes.length, ...restored);
    selectedStrokeId = null;
  }
  saveActiveFrame();
  render(layers.map((_, index) => index));
}

function restoreMask(layer, stack, other) {
  if (!layer?.maskCanvas || !stack?.length) return;
  other.push(layer.maskCanvas.toDataURL());
  const image = new Image();
  image.onload = () => {
    const context = layer.maskCanvas.getContext('2d');
    context.clearRect(0, 0, W, H);
    context.drawImage(image, 0, 0);
    render([active]);
  };
  image.src = stack.pop();
}

function lineSnapshot() {
  return JSON.stringify(vectorStrokes);
}

function commitLineHistory(snapshot) {
  groupedTransformUndo = null;
  groupedTransformRedo = null;
  lineUndo.push(snapshot);
  if (lineUndo.length > 50) lineUndo.shift();
  lineRedo.length = 0;
}

function restoreLines(stack, other) {
  if (!stack.length) return;
  other.push(lineSnapshot());
  const restored = JSON.parse(stack.pop());
  vectorStrokes.splice(0, vectorStrokes.length, ...restored);
  if (!selectedStroke()) selectedStrokeId = null;
  render();
}

function drawVectorStrokes(context, strokes = vectorStrokes) {
  context.save();
  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (const stroke of strokes) {
    if (!stroke.points.length) continue;
    context.beginPath();
    if (stroke.bezierPath) {
      const sampled = sampleBezierPath(stroke.bezierPath).points;
      if (!sampled.length) continue;
      context.moveTo(sampled[0].x, sampled[0].y);
      for (let index = 1; index < sampled.length; index++) context.lineTo(sampled[index].x, sampled[index].y);
    } else {
      context.moveTo(stroke.points[0].x, stroke.points[0].y);
    if (stroke.points.length === 2) {
      context.lineTo(stroke.points[1].x, stroke.points[1].y);
    } else {
      for (let index = 1; index < stroke.points.length - 1; index++) {
        const current = stroke.points[index];
        const next = stroke.points[index + 1];
        context.quadraticCurveTo(current.x, current.y, (current.x + next.x) / 2, (current.y + next.y) / 2);
      }
      const lastPoint = stroke.points[stroke.points.length - 1];
      context.lineTo(lastPoint.x, lastPoint.y);
    }
    }
    context.strokeStyle = stroke.color;
    context.lineWidth = stroke.width;
    context.stroke();
  }
  context.restore();
}

function refreshLayerPresentation(layer) {
  if (!layer?.canvas || !layer?.presentationCanvas) return;
  composeRasterTransformStack(layer.canvas, layer.transformRecords || [], layer.presentationCanvas);
}

function composite() {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.fillStyle = '#f4f0e8';
  context.fillRect(0, 0, W, H);
  layers.forEach(layer => {
    if (!(layer.renderVisible ?? layer.visible)) return;
    context.save();
    context.globalAlpha = layer.renderOpacity ?? layer.opacity ?? 1;
    const blendMode = layer.renderBlendMode || layer.blendMode || 'normal';
    context.globalCompositeOperation = blendMode === 'add' ? 'lighter' : (blendMode === 'normal' ? 'source-over' : blendMode);
    if (layer.maskEnabled && layer.maskCanvas) {
      const masked = document.createElement('canvas');
      masked.width = W; masked.height = H;
      const maskedContext = masked.getContext('2d');
      maskedContext.drawImage(layer.presentationCanvas || layer.canvas, 0, 0);
      maskedContext.globalCompositeOperation = 'destination-in';
      maskedContext.drawImage(layer.maskCanvas, 0, 0);
      context.drawImage(masked, 0, 0);
    } else {
      context.drawImage(layer.presentationCanvas || layer.canvas, 0, 0);
    }
    context.restore();
  });
  drawVectorStrokes(context);
  return context;
}

function render(dirtyIndices = [], displayStrokes = vectorStrokes) {
  for (const index of dirtyIndices) {
    if (layers[index]) refreshLayerPresentation(layers[index]);
  }
  applyGroupState();
  if (!loadingFrame) updateFrameStrokes(timeline, timeline.activeFrameId, vectorStrokes);
  renderer.sync(layers, dirtyIndices, displayStrokes, selectedStrokeId, onionEnabled ? getOnionSkin(timeline) : [], selectionRect, selectionPolygon, selectedNodeIndex, nodeEditEnabled, selectedBezierHandle, selectedBezierAnchor, showSelectedVectorHighlight);
  document.getElementById('status').textContent = tool.toUpperCase();
  drawLayers();
  updateLayerInspector();
  updateLineInspector();
  drawTimeline();
}

function saveActiveFrame() {
  updateFrameStrokes(timeline, timeline.activeFrameId, vectorStrokes);
  updateFrameCels(timeline, timeline.activeFrameId, layers.map(layer => layer.canvas.toDataURL('image/png')));
  updateFrameTransformCels(timeline, timeline.activeFrameId, layers.map(layer => cloneRasterTransformRecords(layer.transformRecords || [])));
}

async function decodeRasterCels(cels) {
  return Promise.all(cels.map(source => new Promise(resolve => {
    if (!source) {
      resolve(null);
      return;
    }
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = source;
  })));
}

async function loadTimelineFrame(frameId, saveCurrent = true) {
  groupedTransformUndo = null;
  groupedTransformRedo = null;
  if (saveCurrent && !loadingFrame) saveActiveFrame();
  if (!selectFrame(timeline, frameId)) return;
  const token = ++frameLoadToken;
  loadingFrame = true;
  const frame = activeFrame(timeline);
  const [decoded, decodedTransformSources] = await Promise.all([
    decodeRasterCels(normalizeRasterCels(frame?.cels, layers.length)),
    Promise.all(normalizeRasterTransformCels(frame?.transformCels, layers.length).map(records =>
      decodeRasterCels(records.map(record => record.sourceDataUrl)),
    )),
  ]);
  if (token !== frameLoadToken) return;
  layers.forEach((layer, index) => {
    const context = layer.canvas.getContext('2d');
    context.clearRect(0, 0, W, H);
    if (decoded[index]) context.drawImage(decoded[index], 0, 0, W, H);
    const records = normalizeRasterTransformCels(frame?.transformCels, layers.length)[index] || [];
    layer.transformRecords = cloneRasterTransformRecords(records).map((record, recordIndex) => ({
      ...record,
      sourceCanvas: decodedTransformSources[index]?.[recordIndex] || null,
    })).filter(record => record.sourceCanvas);
    refreshLayerPresentation(layer);
  });
  vectorStrokes.splice(0, vectorStrokes.length, ...(frame?.strokes || []).map(stroke => ({
    ...stroke,
    points: stroke.points.map(point => ({ x: point.x, y: point.y })),
    ...(stroke.bezierPath ? { bezierPath: {
      ...stroke.bezierPath,
      anchorModes: stroke.bezierPath.anchorModes ? [...stroke.bezierPath.anchorModes] : stroke.bezierPath.anchors.map((_, index) => index > 0 && index < stroke.bezierPath.anchors.length - 1 ? 'smooth' : 'corner'),
      anchors: stroke.bezierPath.anchors.map(point => ({ ...point })),
      segments: stroke.bezierPath.segments.map(segment => ({ control1: { ...segment.control1 }, control2: { ...segment.control2 } })),
    } } : {}),
  })));
  selectedStrokeId = null;
  loadingFrame = false;
  render(layers.map((_, index) => index));
}

function drawTimeline() {
  const strip = document.getElementById('frameStrip');
  if (!strip) return;
  strip.replaceChildren();
  timeline.frames.forEach((frame, index) => {
    const button = document.createElement('button');
    button.className = 'frame-cell' + (frame.id === timeline.activeFrameId ? ' active' : '');
    button.textContent = String(index + 1).padStart(2, '0');
    button.title = `프레임 ${index + 1} · ${frame.strokes.length}개 선`;
    button.onclick = () => loadTimelineFrame(frame.id);
    strip.append(button);
  });
  const label = document.getElementById('frameCounter');
  if (label) label.textContent = `${timeline.frames.findIndex(frame => frame.id === timeline.activeFrameId) + 1} / ${timeline.frames.length}`;
}

function setPlaybackEnabled(enabled) {
  if (enabled && loadingFrame) return;
  playbackActive = enabled;
  const button = document.getElementById('playToggle');
  button.textContent = enabled ? 'Ⅱ 일시정지' : '▶ 재생';
  button.classList.toggle('active', enabled);

  if (enabled) {
    if (boilEnabled) setBoilEnabled(false);
    saveActiveFrame();
    const activeIndex = timeline.frames.findIndex(frame => frame.id === timeline.activeFrameId);
    playbackStartOffset = timeline.frames.slice(0, Math.max(0, activeIndex))
      .reduce((sum, frame) => sum + frame.durationMs, 0);
    playbackStartedAt = performance.now();
    if (!playbackRaf) playbackRaf = requestAnimationFrame(playbackTick);
  } else {
    if (playbackRaf) cancelAnimationFrame(playbackRaf);
    playbackRaf = 0;
    if (!loadingFrame) saveActiveFrame();
    render();
  }
}

function playbackTick(timestamp) {
  if (!playbackActive) {
    playbackRaf = 0;
    return;
  }
  const elapsed = timestamp - playbackStartedAt + playbackStartOffset;
  const frame = frameAtTime(timeline, elapsed);
  if (!loadingFrame && frame && frame.id !== timeline.activeFrameId) loadTimelineFrame(frame.id);
  playbackRaf = requestAnimationFrame(playbackTick);
}

function updateTimelineFPS(value) {
  const fps = Math.max(1, Math.min(60, Number(value) || 12));
  timeline.fps = fps;
  timeline.frames.forEach(frame => { frame.durationMs = 1000 / fps; });
  document.getElementById('fpsOut').value = fps + ' FPS';
}

const viewport = { scale: 1, rotation: 0, x: 0, y: 0 };
let panDrag = null;

function applyViewport() {
  if (!inputSurface) return;
  inputSurface.style.transform = `translate(${viewport.x}px, ${viewport.y}px) rotate(${viewport.rotation}deg) scale(${viewport.scale})`;
  document.getElementById('zoomLevel').value = Math.round(viewport.scale * 100) + '%';
}

function position(event) {
  const rect = inputSurface.getBoundingClientRect();
  const transform = getComputedStyle(inputSurface).transform;
  return clientToCanvasPoint(event, {
    rect,
    elementWidth: inputSurface.clientWidth || W,
    elementHeight: inputSurface.clientHeight || H,
    canvasWidth: W,
    canvasHeight: H,
    matrix: parseCssTransformMatrix(transform),
  });
}

function withBrushContext(draw, lineWidth = size) {
  const context = layers[active].canvas.getContext('2d');
  context.save();
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.lineWidth = lineWidth;
  context.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
  context.strokeStyle = color;
  context.beginPath();
  draw(context);
  context.stroke();
  context.restore();
}

function stroke(from, to, lineWidth = size) {
  withBrushContext(context => {
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
  }, lineWidth);
}

function parseHex(hex) {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function buildProtectionMask() {
  const protection = new Uint8Array(W * H);
  for (let index = active + 1; index < layers.length; index++) {
    const layer = layers[index];
    if (!(layer.renderVisible ?? layer.visible)) continue;
    const pixels = layer.canvas.getContext('2d').getImageData(0, 0, W, H).data;
    for (let point = 0; point < W * H; point++) {
      const alpha = pixels[point * 4 + 3];
      if (alpha > protection[point]) protection[point] = alpha;
    }
  }

  const vectorCanvas = document.createElement('canvas');
  vectorCanvas.width = W;
  vectorCanvas.height = H;
  const vectorContext = vectorCanvas.getContext('2d');
  vectorContext.strokeStyle = '#000';
  drawVectorStrokes(vectorContext);
  const vectorAlpha = vectorContext.getImageData(0, 0, W, H).data;
  for (let point = 0; point < W * H; point++) {
    const alpha = vectorAlpha[point * 4 + 3];
    if (alpha > protection[point]) protection[point] = alpha;
  }
  return protection;
}

function floodFill(x, y) {
  const source = composite().getImageData(0, 0, W, H).data;
  const rgb = parseHex(color);
  const result = findConnectedRegion({
    data: source,
    width: W,
    height: H,
    x,
    y,
    tolerance: Number(document.getElementById('tolerance').value),
  });

  if (!result.count) return;
  if (result.seed[0] === rgb[0] && result.seed[1] === rgb[1] && result.seed[2] === rgb[2]) return;

  const edgeMargin = Number(document.getElementById('edge').value);
  const protection = edgeMargin > 0 ? buildProtectionMask() : null;
  const fillMask = expandRegionMask(result.mask, W, H, edgeMargin, protection, 250);

  save(layers[active]);
  const context = layers[active].canvas.getContext('2d');
  const image = context.getImageData(0, 0, W, H);
  const output = image.data;
  for (let point = 0; point < fillMask.length; point++) {
    if (!fillMask[point]) continue;
    const pixel = point * 4;
    output[pixel] = rgb[0];
    output[pixel + 1] = rgb[1];
    output[pixel + 2] = rgb[2];
    output[pixel + 3] = 255;
  }
  context.putImageData(image, 0, 0);
}

function applyMangaTone() {
  if (playbackActive) setPlaybackEnabled(false);
  if (maskEditing) {
    document.getElementById('status').textContent = '마스크 편집 중에는 톤을 적용할 수 없습니다';
    return;
  }
  ensureEditableLayerAfterTransform();
  const layer = layers[active];
  const selection = selectionOutlinePolygon();
  const settings = {
    pattern: document.getElementById('tonePattern').value,
    spacing: Number(document.getElementById('toneSpacing').value),
    dotSize: Number(document.getElementById('toneDotSize').value),
    angle: Number(document.getElementById('toneAngle').value),
    opacity: Number(document.getElementById('toneOpacity').value),
    color,
  };
  save(layer);
  applyScreentoneToCanvas(layer.canvas, settings, selection);
  saveActiveFrame();
  render([active]);
}

function updateToneControls() {
  const values = [
    ['toneSpacing', 'toneSpacingOut', value => value + 'px'],
    ['toneDotSize', 'toneDotSizeOut', value => value + 'px'],
    ['toneAngle', 'toneAngleOut', value => value + '°'],
    ['toneOpacity', 'toneOpacityOut', value => value + '%'],
  ];
  for (const [inputId, outputId, format] of values) {
    const input = document.getElementById(inputId);
    const output = document.getElementById(outputId);
    if (input && output) output.value = format(input.value);
  }
  const chip = document.getElementById('toneColorChip');
  if (chip) chip.style.background = color;
}

function drawLayers() {
  const list = document.getElementById('layers');
  list.replaceChildren();
  layerGroups.forEach(group => {
    const item = document.createElement('div');
    item.className = 'layer-group' + (group.id === activeGroupId ? ' selected' : '');
    const visibility = document.createElement('button');
    visibility.textContent = group.visible ? '▣' : '□';
    visibility.setAttribute('aria-label', group.visible ? '그룹 숨기기' : '그룹 표시');
    visibility.onclick = event => { event.stopPropagation(); group.visible = !group.visible; render(); };
    const name = document.createElement('strong');
    name.textContent = '▾ ' + group.name;
    const count = document.createElement('small');
    count.textContent = layers.filter(layer => layer.groupId === group.id).length + '개';
    item.append(visibility, name, count);
    item.onclick = () => { activeGroupId = group.id; updateLayerInspector(); drawLayers(); };
    list.append(item);
    layers.forEach((layer, index) => {
      if (layer.groupId !== group.id) return;
      appendLayerRow(list, layer, index, true);
    });
  });
  layers.forEach((layer, index) => {
    if (layer.groupId) return;
    appendLayerRow(list, layer, index, false);
  });
}

function appendLayerRow(list, layer, index, nested) {
    const item = document.createElement('div');
    item.className = 'layer' + (index === active ? ' selected' : '') + (nested ? ' nested' : '');

    const visibility = document.createElement('button');
    visibility.textContent = layer.visible ? '◉' : '○';
    visibility.setAttribute('aria-label', layer.visible ? '레이어 숨기기' : '레이어 표시');
    visibility.onclick = () => {
      layer.visible = !layer.visible;
      render();
    };

    const target = document.createElement('input');
    target.type = 'checkbox';
    target.className = 'transform-layer-check';
    target.checked = selectedTransformLayers.has(layer);
    target.title = '선택 영역 드래그 변형에도 포함';
    target.setAttribute('aria-label', layer.name + ' 선택 영역 다중 변형 대상');
    target.onclick = event => event.stopPropagation();
    target.onchange = () => {
      if (target.checked) selectedTransformLayers.add(layer);
      else selectedTransformLayers.delete(layer);
    };

    const name = document.createElement('span');
    name.textContent = layer.name + (layer.maskEnabled ? ' · MASK' : '');
    item.append(visibility, target, name);
    item.onclick = event => {
      if (event.target !== visibility && event.target !== target) {
        active = index;
        activeGroupId = layer.groupId || null;
        maskEditing = false;
        document.getElementById('maskEdit')?.classList.remove('active');
        document.getElementById('maskState').textContent = '일반 그림 편집 중';
        updateLayerInspector();
        drawLayers();
      }
    };
    list.append(item);
}

function updateLayerInspector() {
  const layer = layers[active];
  if (!layer) return;
  const rasterizeButton = document.getElementById('rasterizeTransforms');
  if (rasterizeButton) {
    rasterizeButton.disabled = !(layer.transformRecords?.length);
    rasterizeButton.title = layer.transformRecords?.length
      ? '비파괴 변형을 픽셀로 확정합니다'
      : '확정할 비파괴 변형이 없습니다';
  }
  const group = layerGroups.find(item => item.id === activeGroupId) || groupFor(layer);
  const groupControls = document.getElementById('groupInspector');
  if (groupControls) {
    groupControls.hidden = !group;
    if (group) {
      document.getElementById('groupOpacity').value = Math.round(group.opacity * 100);
      document.getElementById('groupOpacityOut').value = Math.round(group.opacity * 100) + '%';
      document.getElementById('groupBlend').value = group.blendMode;
    }
  }
  const opacity = document.getElementById('layerOpacity');
  const opacityOut = document.getElementById('layerOpacityOut');
  const blend = document.getElementById('layerBlend');
  if (opacity && document.activeElement !== opacity) opacity.value = Math.round((layer.opacity ?? 1) * 100);
  if (opacityOut) opacityOut.value = Math.round((layer.opacity ?? 1) * 100) + '%';
  if (blend && document.activeElement !== blend) blend.value = layer.blendMode || 'normal';
  const remove = document.getElementById('layerDelete');
  if (remove) remove.disabled = layers.length <= 1;
}

function updateBoilOutputs() {
  document.getElementById('boilAmplitudeOut').value = document.getElementById('boilAmplitude').value + 'px';
  document.getElementById('boilFrequencyOut').value = Number(document.getElementById('boilFrequency').value).toFixed(2);
  document.getElementById('boilSpeedOut').value = Number(document.getElementById('boilSpeed').value).toFixed(1) + '×';
}

function animationTick(timestamp) {
  if (!boilEnabled) {
    animationFrame = 0;
    return;
  }
  if (timestamp - lastAnimationPaint >= 1000 / 30) {
    const elapsed = timestamp - boilStartedAt;
    const phase = lineBoilPhase(elapsed, Number(document.getElementById('boilSpeed').value));
    const displayStrokes = animateLineStrokes(vectorStrokes, {
      phase,
      amplitude: Number(document.getElementById('boilAmplitude').value),
      frequency: Number(document.getElementById('boilFrequency').value),
    });
    renderer.sync(layers, [], displayStrokes, selectedStrokeId, onionEnabled ? getOnionSkin(timeline) : [], selectionRect, selectionPolygon, selectedNodeIndex, nodeEditEnabled, null, null, showSelectedVectorHighlight);
    lastAnimationPaint = timestamp;
  }
  animationFrame = requestAnimationFrame(animationTick);
}

function setBoilEnabled(enabled) {
  boilEnabled = enabled;
  const button = document.getElementById('boilToggle');
  button.textContent = enabled ? '미리보기 중지' : 'Line Boil 미리보기';
  button.classList.toggle('active', enabled);
  if (enabled) {
    boilStartedAt = performance.now();
    lastAnimationPaint = 0;
    if (!animationFrame) animationFrame = requestAnimationFrame(animationTick);
  } else {
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    render();
  }
}

function updateLineInspector() {
  const stroke = selectedStroke();
  const panel = document.getElementById('lineTools');
  panel.hidden = !stroke;
  if (!stroke) {
    selectedNodeIndex = null;
    return;
  }
  document.getElementById('lineColor').value = stroke.color;
  document.getElementById('lineWidth').value = stroke.width;
  document.getElementById('lineWidthOut').value = stroke.width + 'px';
  const nodeStatus = document.getElementById('lineNodeStatus');
  if (nodeStatus) nodeStatus.textContent = stroke.bezierPath
    ? `${stroke.bezierPath.anchors.length}개 앵커 · ${stroke.bezierPath.segments.length * 2}개 핸들`
    : `${stroke.points.length}개 노드${selectedNodeIndex === null ? '' : ` · ${selectedNodeIndex + 1}번 선택`}`;
  const hasAnchor = Boolean(stroke.bezierPath && Number.isInteger(selectedBezierAnchor) && selectedBezierAnchor > 0 && selectedBezierAnchor < stroke.bezierPath.anchors.length - 1);
  const anchorModeButton = document.getElementById('toggleBezierAnchorMode');
  if (anchorModeButton) {
    const mode = hasAnchor ? (stroke.bezierPath.anchorModes?.[selectedBezierAnchor] || 'smooth') : 'corner';
    anchorModeButton.disabled = !hasAnchor;
    anchorModeButton.textContent = mode === 'smooth' ? '모서리 앵커로 변경' : '부드러운 앵커로 변경';
  }
  const removeAnchorButton = document.getElementById('deleteBezierAnchor');
  if (removeAnchorButton) removeAnchorButton.disabled = !hasAnchor;
  const removeNode = document.getElementById('deleteLineNode');
  if (removeNode) removeNode.disabled = Boolean(stroke.bezierPath) || selectedNodeIndex === null || selectedNodeIndex <= 0 || selectedNodeIndex >= stroke.points.length - 1;
}

function applySelectedStyle(changes) {
  const stroke = selectedStroke();
  if (!stroke) return;
  commitLineHistory(lineSnapshot());
  const index = vectorStrokes.findIndex(item => item.id === selectedStrokeId);
  vectorStrokes[index] = updateLineStrokeStyle(stroke, changes);
  render();
}

function selectionOutlinePolygon() {
  if (selectionPolygon?.length >= 3) return selectionPolygon.map(point => ({ ...point }));
  if (!selectionRect) return null;
  const { x, y, width, height } = selectionRect;
  return [
    { x, y }, { x: x + width, y },
    { x: x + width, y: y + height }, { x, y: y + height },
  ];
}

function snapshotRuntimeTransformRecords(records = []) {
  return (records || []).map(record => {
    const normalized = cloneRasterTransformRecords([record])[0];
    return normalized ? { ...normalized, sourceCanvas: record.sourceCanvas || null } : null;
  }).filter(Boolean);
}

function getSelectionDragSources(drag) {
  if (drag?.sources?.length) return drag.sources;
  if (drag?.sourceCanvas) {
    return [{ layer: layers[active], sourceCanvas: drag.sourceCanvas, previewCanvas: drag.previewCanvas, before: null, beforeTransforms: [] }];
  }
  return [];
}

function capturePolygonLayerSources(polygon) {
  const targets = resolveSelectionTargets(layers, selectedTransformLayers, layers[active]);
  return targets.map(layer => {
    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = W;
    sourceCanvas.height = H;
    const context = sourceCanvas.getContext('2d');
    context.save();
    context.beginPath();
    polygon.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
    context.closePath();
    context.clip();
    context.drawImage(layer.presentationCanvas || layer.canvas, 0, 0);
    context.restore();
    return {
      layer, sourceCanvas,
      before: layer.canvas.toDataURL('image/png'),
      beforeTransforms: snapshotRuntimeTransformRecords(layer.transformRecords),
      previewCanvas: null,
    };
  });
}

function captureRectLayerSources(rect) {
  return capturePolygonLayerSources([
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ]);
}

function getSelectionDragTransform(drag) {
  if (!drag) return null;
  if (drag.originalPolygon?.length >= 3) {
    const original = drag.originalPolygon;
    if (drag.mode === 'lassoMove' && selectionPolygon?.length) {
      return { clipPolygon: original, matrix: createTranslationMatrix(selectionPolygon[0].x - original[0].x, selectionPolygon[0].y - original[0].y) };
    }
    if (drag.mode === 'lassoResize' && selectionPolygon?.length) {
      const from = getPolygonBounds(original), to = getPolygonBounds(selectionPolygon);
      if (!from || !to || from.width <= 0 || from.height <= 0) return null;
      const sx = to.width / from.width, sy = to.height / from.height;
      return { clipPolygon: original, matrix: [sx, 0, 0, sy, to.x - from.x * sx, to.y - from.y * sy] };
    }
    if (drag.mode === 'lassoRotate') return { clipPolygon: original, matrix: createRotationMatrix(drag.rotation || 0, getPolygonCentroid(original)) };
  }
  if (drag.originalRect) {
    const original = drag.originalRect;
    const clipPolygon = [
      { x: original.x, y: original.y }, { x: original.x + original.width, y: original.y },
      { x: original.x + original.width, y: original.y + original.height }, { x: original.x, y: original.y + original.height },
    ];
    if (drag.mode === 'rotate') return { clipPolygon, matrix: createRotationMatrix(drag.rotation || 0, { x: original.x + original.width / 2, y: original.y + original.height / 2 }) };
    if ((drag.mode === 'move' || drag.mode === 'resize') && selectionRect && original.width > 0 && original.height > 0) {
      const sx = selectionRect.width / original.width, sy = selectionRect.height / original.height;
      return { clipPolygon, matrix: [sx, 0, 0, sy, selectionRect.x - original.x * sx, selectionRect.y - original.y * sy] };
    }
  }
  return null;
}

function clearSelectionDragPreviews(drag) {
  for (const source of getSelectionDragSources(drag)) renderer.clearLayerPreview(source.layer);
}

function recordSelectionDragCommit(sources) {
  const entries = sources.map(source => ({
    layer: source.layer,
    before: source.before,
    after: source.layer.canvas.toDataURL('image/png'),
    beforeTransforms: snapshotRuntimeTransformRecords(source.beforeTransforms),
    afterTransforms: snapshotRuntimeTransformRecords(source.layer.transformRecords),
  }));
  groupedTransformUndo = entries.length ? { entries, vectorBefore: null, vectorAfter: null } : null;
  groupedTransformRedo = null;
  saveActiveFrame();
}

function commitSelectionDragSources(drag, getTransform) {
  const sources = getSelectionDragSources(drag);
  const transform = getTransform?.();
  if ((!sources.length && !drag?.vectorBefore) || !transform?.matrix || !transform.clipPolygon?.length) return;
  for (const source of sources) {
    save(source.layer);
    source.layer.transformRecords = [...(source.layer.transformRecords || []), {
      id: 'raster-transform-' + (++nextRasterTransformId),
      sourceDataUrl: source.sourceCanvas.toDataURL('image/png'),
      clipPolygon: transform.clipPolygon.map(point => ({ x: point.x, y: point.y })),
      matrix: [...transform.matrix],
      sourceCanvas: source.sourceCanvas,
    }];
    refreshLayerPresentation(source.layer);
  }
  recordSelectionDragCommit(sources);
  if (drag.vectorBefore) {
    groupedTransformUndo = groupedTransformUndo || { entries: [], vectorBefore: null, vectorAfter: null };
    groupedTransformUndo.vectorBefore = drag.vectorBefore;
    groupedTransformUndo.vectorAfter = lineSnapshot();
  }
  render(sources.map(source => layers.indexOf(source.layer)).filter(index => index >= 0));
}

function updateSelectionDragPreview(drag) {
  const sources = getSelectionDragSources(drag);
  const transform = getSelectionDragTransform(drag);
  if ((!sources.length && !drag?.vectorBefore) || !transform?.matrix) return;
  if (drag.vectorBefore) {
    const previewStrokes = transformLineStrokesByMatrix(drag.vectorBefore, transform.clipPolygon, transform.matrix);
    vectorStrokes.splice(0, vectorStrokes.length, ...previewStrokes);
  }
  for (const source of sources) {
    const previewCanvas = source.previewCanvas || document.createElement('canvas');
    composeRasterTransformStack(source.layer.presentationCanvas || source.layer.canvas, [{
      id: 'selection-preview',
      sourceDataUrl: 'data:image/png;base64,AA==',
      clipPolygon: transform.clipPolygon,
      matrix: transform.matrix,
      sourceCanvas: source.sourceCanvas,
    }], previewCanvas);
    source.previewCanvas = previewCanvas;
    renderer.setLayerPreview(source.layer, previewCanvas);
  }
  const activeSource = sources.find(source => source.layer === layers[active]) || sources[0];
  drag.previewCanvas = activeSource.previewCanvas;
}


function applySelectionTransform() {
  const polygon = selectionOutlinePolygon();
  if (!polygon) return;
  const angle = Number(document.getElementById('selectionAngle').value);
  const scale = Number(document.getElementById('selectionScale').value) / 100;
  if (!Number.isFinite(angle) || !Number.isFinite(scale) || scale <= 0) return;
  if (playbackActive) setPlaybackEnabled(false);

  const targets = resolveSelectionTargets(layers, selectedTransformLayers, layers[active]);
  if (!targets.length) return;

  const transformedPolygon = transformPolygon(polygon, angle, scale);
  const vectorBefore = lineSnapshot();
  const hasSelectedVectors = vectorStrokes.some(stroke => lineStrokeIntersectsPolygon(stroke, polygon));
  const transformedVectors = hasSelectedVectors
    ? transformLineStrokes(vectorStrokes, polygon, angle, scale)
    : null;
  const center = getPolygonCentroid(polygon);
  const radians = angle * Math.PI / 180;
  const cosine = Math.cos(radians) * scale;
  const sine = Math.sin(radians) * scale;
  const matrix = [
    cosine, sine, -sine, cosine,
    center.x - cosine * center.x + sine * center.y,
    center.y - sine * center.x - cosine * center.y,
  ];
  const sources = targets.map(layer => {
    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = W;
    sourceCanvas.height = H;
    const context = sourceCanvas.getContext('2d');
    context.save();
    context.beginPath();
    polygon.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
    context.closePath();
    context.clip();
    context.drawImage(layer.presentationCanvas || layer.canvas, 0, 0);
    context.restore();
    return {
      layer,
      sourceCanvas,
      before: layer.canvas.toDataURL('image/png'),
      beforeTransforms: snapshotRuntimeTransformRecords(layer.transformRecords),
      previewCanvas: null,
    };
  });

  if (hasSelectedVectors) {
    vectorStrokes.splice(0, vectorStrokes.length, ...transformedVectors);
    selectedStrokeId = null;
  }
  const vectorAfter = hasSelectedVectors ? lineSnapshot() : null;
  commitSelectionDragSources({ sources }, () => ({ clipPolygon: polygon, matrix }));
  if (groupedTransformUndo && hasSelectedVectors) {
    groupedTransformUndo.vectorBefore = vectorBefore;
    groupedTransformUndo.vectorAfter = vectorAfter;
  }

  selectionRect = null;
  selectionPolygon = transformedPolygon;
  document.getElementById('selectionAngle').value = '0';
  document.getElementById('selectionAngleOut').value = '0°';
  document.getElementById('selectionScale').value = '100';
  document.getElementById('selectionScaleOut').value = '100%';
  saveActiveFrame();
  render(layers.map((_, index) => index));
}

function bindViewportControls() {
  document.getElementById('zoomIn').onclick = () => {
    viewport.scale = Math.min(4, Number((viewport.scale * 1.2).toFixed(3)));
    applyViewport();
  };
  document.getElementById('zoomOut').onclick = () => {
    viewport.scale = Math.max(0.25, Number((viewport.scale / 1.2).toFixed(3)));
    applyViewport();
  };
  document.getElementById('rotateCanvas').onclick = () => {
    viewport.rotation = (viewport.rotation + 15) % 360;
    applyViewport();
  };
  document.getElementById('resetViewport').onclick = () => {
    viewport.scale = 1;
    viewport.rotation = 0;
    viewport.x = 0;
    viewport.y = 0;
    applyViewport();
  };
}

function bindControls() {
  document.getElementById('applyTone').onclick = applyMangaTone;
  document.getElementById('vectorBrushPreset').onchange = event => { vectorBrushPreset = event.target.value; };
  document.getElementById('vectorPressureCurve').oninput = event => { vectorPressureCurve = Number(event.target.value) / 100; document.getElementById('vectorPressureCurveOut').value = vectorPressureCurve.toFixed(2); };
  document.getElementById('vectorMotionStyle').onchange = event => { vectorMotionStyle = event.target.value; };
  document.getElementById('vectorMotionStrength').oninput = event => { vectorMotionStrength = Number(event.target.value); document.getElementById('vectorMotionStrengthOut').value = vectorMotionStrength + 'px'; };
  document.getElementById('selectedOutlineToggle').onchange = event => { showSelectedVectorHighlight = event.target.checked; render(); };
  ['toneSpacing', 'toneDotSize', 'toneAngle', 'toneOpacity'].forEach(id => {
    document.getElementById(id).oninput = updateToneControls;
  });
  document.getElementById('tonePattern').onchange = updateToneControls;

  document.querySelectorAll('[data-tool]').forEach(button => {
    button.onclick = () => {
      if (boilEnabled) setBoilEnabled(false);
      tool = button.dataset.tool;
      if (maskEditing && tool !== 'pen' && tool !== 'eraser') {
        maskEditing = false;
        document.getElementById('maskEdit').classList.remove('active');
        document.getElementById('maskState').textContent = '일반 그림 편집 중';
      }
      document.querySelectorAll('[data-tool]').forEach(item => {
        item.classList.toggle('active', item === button);
      });
      renderer.clearPreview();
      render();
    };
  });

  document.getElementById('selectionDeselect').onclick = () => {
    if (selectionDrag) clearSelectionDragPreviews(selectionDrag);
    selectionRect = null;
    selectionPolygon = null;
    selectionDrag = null;
    down = false;
    render();
  };

  document.getElementById('selectionAngle').oninput = event => {
    document.getElementById('selectionAngleOut').value = event.target.value + '°';
  };
  document.getElementById('selectionScale').oninput = event => {
    document.getElementById('selectionScaleOut').value = event.target.value + '%';
  };
  document.getElementById('selectionTransform').onclick = applySelectionTransform;

  document.getElementById('groupAdd').onclick = () => {
    const id = 'group-' + (layerGroups.length + 1);
    layerGroups.push({ id, name: '그룹 ' + (layerGroups.length + 1), visible: true, opacity: 1, blendMode: 'normal' });
    layers[active].groupId = id;
    activeGroupId = id;
    render();
  };
  document.getElementById('layerToGroup').onclick = () => {
    if (!activeGroupId || !layerGroups.some(group => group.id === activeGroupId)) return;
    layers[active].groupId = activeGroupId;
    render();
  };
  document.getElementById('layerOutGroup').onclick = () => {
    delete layers[active].groupId;
    render();
  };
  document.getElementById('groupRemove').onclick = () => {
    const group = layerGroups.find(item => item.id === activeGroupId);
    if (!group) return;
    layers.forEach(layer => { if (layer.groupId === group.id) delete layer.groupId; });
    layerGroups.splice(layerGroups.indexOf(group), 1);
    activeGroupId = null;
    render();
  };
  document.getElementById('groupOpacity').oninput = event => {
    const group = layerGroups.find(item => item.id === activeGroupId);
    if (!group) return;
    group.opacity = Number(event.target.value) / 100;
    document.getElementById('groupOpacityOut').value = event.target.value + '%';
    render();
  };
  document.getElementById('groupBlend').onchange = event => {
    const group = layerGroups.find(item => item.id === activeGroupId);
    if (!group) return;
    group.blendMode = event.target.value;
    render();
  };

  document.getElementById('addLayer').onclick = () => {
    if (playbackActive) setPlaybackEnabled(false);
    layers.push(makeLayer('레이어 ' + (layers.length + 1)));
    active = layers.length - 1;
    saveActiveFrame();
    render(layers.map((_, index) => index));
  };

  document.getElementById('maskAdd').onclick = () => {
    const layer = layers[active];
    if (!layer.maskCanvas) {
      layer.maskCanvas = document.createElement('canvas');
      layer.maskCanvas.width = W; layer.maskCanvas.height = H;
      const context = layer.maskCanvas.getContext('2d');
      context.fillStyle = '#fff'; context.fillRect(0, 0, W, H);
      layer.maskUndo = []; layer.maskRedo = [];
    }
    layer.maskEnabled = true;
    maskEditing = false;
    document.getElementById('maskEdit').classList.remove('active');
    render(layers.map((_, index) => index));
  };
  document.getElementById('maskEdit').onclick = event => {
    const layer = layers[active];
    if (!layer.maskCanvas || !layer.maskEnabled) return;
    maskEditing = !maskEditing;
    event.currentTarget.classList.toggle('active', maskEditing);
    document.getElementById('maskState').textContent = maskEditing ? '마스크 편집 중 · 검정=숨김 / 흰색=표시' : '일반 그림 편집 중';
  };

  document.getElementById('layerDuplicate').onclick = () => {
    if (playbackActive) setPlaybackEnabled(false);
    const source = layers[active];
    const copy = makeLayer(source.name + ' 복사본');
    copy.opacity = source.opacity ?? 1;
    copy.blendMode = source.blendMode || 'normal';
    copy.canvas.getContext('2d').drawImage(source.canvas, 0, 0);
    copy.transformRecords = snapshotRuntimeTransformRecords(source.transformRecords);
    refreshLayerPresentation(copy);
    if (source.maskCanvas) copy.maskCanvas.getContext('2d').drawImage(source.maskCanvas, 0, 0);
    copy.maskEnabled = source.maskEnabled;
    copy.groupId = source.groupId;
    layers.push(copy);
    active = layers.length - 1;
    saveActiveFrame();
    render(layers.map((_, index) => index));
  };

  document.getElementById('rasterizeTransforms').onclick = rasterizeActiveLayerTransforms;

  document.getElementById('layerDelete').onclick = () => {
    if (layers.length <= 1) return;
    if (playbackActive) setPlaybackEnabled(false);
    saveActiveFrame();
    timeline.frames.forEach(frame => {
      frame.cels = normalizeRasterCels(frame.cels, layers.length);
      frame.transformCels = normalizeRasterTransformCels(frame.transformCels, layers.length);
      frame.cels.splice(active, 1);
      frame.transformCels.splice(active, 1);
    });
    layers.splice(active, 1);
    active = Math.min(active, layers.length - 1);
    saveActiveFrame();
    render(layers.map((_, index) => index));
  };

  document.getElementById('layerOpacity').oninput = event => {
    layers[active].opacity = Number(event.target.value) / 100;
    document.getElementById('layerOpacityOut').value = event.target.value + '%';
    render();
  };
  document.getElementById('layerBlend').onchange = event => {
    layers[active].blendMode = event.target.value;
    render();
  };

  document.getElementById('clear').onclick = () => {
    const layer = layers[active];
    if (maskEditing && layer.maskCanvas) {
      layer.maskUndo.push(layer.maskCanvas.toDataURL());
      if (layer.maskUndo.length > 25) layer.maskUndo.shift();
      layer.maskRedo = [];
      const context = layer.maskCanvas.getContext('2d');
      context.clearRect(0, 0, W, H);
      context.fillStyle = '#fff';
      context.fillRect(0, 0, W, H);
    } else if (layer.transformRecords?.length) {
      const before = layer.canvas.toDataURL('image/png');
      const beforeTransforms = snapshotRuntimeTransformRecords(layer.transformRecords);
      save(layer);
      layer.canvas.getContext('2d').clearRect(0, 0, W, H);
      layer.transformRecords = [];
      groupedTransformUndo = {
        entries: [{
          layer,
          before,
          after: layer.canvas.toDataURL('image/png'),
          beforeTransforms,
          afterTransforms: [],
        }],
        vectorBefore: null,
        vectorAfter: null,
      };
      groupedTransformRedo = null;
      saveActiveFrame();
    } else {
      save(layer);
      layer.canvas.getContext('2d').clearRect(0, 0, W, H);
    }
    render([active]);
  };

  document.getElementById('undo').onclick = () => {
    if (maskEditing) restoreMask(layers[active], layers[active].maskUndo, layers[active].maskRedo);
    else if (groupedTransformUndo) {
      const record = groupedTransformUndo;
      groupedTransformUndo = null;
      groupedTransformRedo = record;
      for (const entry of record.entries) {
        if (!layers.includes(entry.layer)) continue;
        entry.layer.redo.push(entry.layer.canvas.toDataURL('image/png'));
        if (entry.layer.undo.length) entry.layer.undo.pop();
      }
      restoreGroupedTransform(record, 'undo');
    } else if ((tool === 'vector' || tool === 'select') && lineUndo.length) restoreLines(lineUndo, lineRedo);
    else restore(layers[active], layers[active].undo, layers[active].redo);
  };
  document.getElementById('redo').onclick = () => {
    if (maskEditing) restoreMask(layers[active], layers[active].maskRedo, layers[active].maskUndo);
    else if (groupedTransformRedo) {
      const record = groupedTransformRedo;
      groupedTransformRedo = null;
      groupedTransformUndo = record;
      for (const entry of record.entries) {
        if (!layers.includes(entry.layer)) continue;
        entry.layer.undo.push(entry.layer.canvas.toDataURL('image/png'));
        if (entry.layer.redo.length) entry.layer.redo.pop();
      }
      restoreGroupedTransform(record, 'redo');
    } else if ((tool === 'vector' || tool === 'select') && lineRedo.length) restoreLines(lineRedo, lineUndo);
    else restore(layers[active], layers[active].redo, layers[active].undo);
  };

  document.getElementById('toggle').onclick = () => {
    const hidden = document.getElementById('inspector').classList.toggle('hidden');
    document.querySelector('.workspace').classList.toggle('inspector-collapsed', hidden);
  };
  document.getElementById('inspectorClose').onclick = () => {
    document.getElementById('inspector').classList.add('hidden');
    document.querySelector('.workspace').classList.add('inspector-collapsed');
  };
  document.querySelectorAll('.panel-tab').forEach(button => {
    button.onclick = () => selectInspectorPanel(button.dataset.panel);
  });
  document.getElementById('export').onclick = () => {
    const output = composite().canvas;
    output.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'frame-studio.png';
      anchor.click();
      URL.revokeObjectURL(url);
    });
  };

  document.getElementById('brushPreset').onchange = event => {
    brushPreset = event.target.value;
    pressureCurve = currentBrushPreset().pressureCurve;
    document.getElementById('pressureCurve').value = String(Math.round(pressureCurve * 100));
    document.getElementById('pressureCurveOut').value = pressureCurve.toFixed(2);
  };
  document.getElementById('brushOpacity').oninput = event => {
    brushOpacity = Number(event.target.value) / 100;
    document.getElementById('brushOpacityOut').value = event.target.value + '%';
  };
  document.getElementById('pressureCurve').oninput = event => {
    pressureCurve = Number(event.target.value) / 100;
    document.getElementById('pressureCurveOut').value = pressureCurve.toFixed(2);
  };
  const sizeInput = document.getElementById('size');
  const sizeOutput = document.getElementById('sizeOut');
  const sizePresets = document.getElementById('sizePresets');
  const presetSizes = [2, 4, 7, 12, 20, 32, 48, 72];
  const updateSize = value => {
    size = Math.max(1, Math.min(100, Number(value) || 1));
    sizeInput.value = String(size);
    sizeOutput.textContent = size + ' px';
    sizePresets.querySelectorAll('button').forEach(button => {
      button.classList.toggle('active', Number(button.dataset.size) === size);
    });
  };
  presetSizes.forEach(value => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.size = String(value);
    button.textContent = value;
    button.title = value + ' px';
    button.onclick = () => updateSize(value);
    sizePresets.append(button);
  });
  sizeInput.oninput = event => updateSize(event.target.value);
  updateSize(size);
  document.getElementById('pressureEnabled').onchange = event => {
    pressureEnabled = event.target.checked;
  };
  document.getElementById('brushSmoothing').oninput = event => {
    brushSmoothing = Number(event.target.value) / 100;
    document.getElementById('brushSmoothingOut').value = event.target.value + '%';
  };
  document.getElementById('tolerance').oninput = event => {
    document.getElementById('tolOut').value = event.target.value;
  };
  document.getElementById('edge').oninput = event => {
    document.getElementById('edgeOut').value = event.target.value + 'px';
  };

  document.getElementById('boilToggle').onclick = () => setBoilEnabled(!boilEnabled);
  for (const id of ['boilAmplitude', 'boilFrequency', 'boilSpeed']) {
    document.getElementById(id).oninput = updateBoilOutputs;
  }
  updateBoilOutputs();

  document.getElementById('playToggle').onclick = () => setPlaybackEnabled(!playbackActive);
  document.getElementById('fps').oninput = event => updateTimelineFPS(event.target.value);
  updateTimelineFPS(document.getElementById('fps').value);

  document.getElementById('frameAdd').onclick = () => {
    if (playbackActive) setPlaybackEnabled(false);
    saveActiveFrame();
    const frame = addFrame(timeline);
    loadTimelineFrame(frame.id, false);
  };
  document.getElementById('frameDuplicate').onclick = () => {
    if (playbackActive) setPlaybackEnabled(false);
    saveActiveFrame();
    const frame = addFrame(timeline, { duplicate: true });
    loadTimelineFrame(frame.id, false);
  };
  document.getElementById('frameDelete').onclick = () => {
    if (playbackActive) setPlaybackEnabled(false);
    const current = timeline.activeFrameId;
    saveActiveFrame();
    if (deleteFrame(timeline, current)) loadTimelineFrame(timeline.activeFrameId, false);
  };
  document.getElementById('onionToggle').onclick = event => {
    onionEnabled = !onionEnabled;
    event.currentTarget.classList.toggle('active', onionEnabled);
    event.currentTarget.textContent = onionEnabled ? '어니언 ON' : '어니언 OFF';
    render();
  };

  document.getElementById('nodeEditToggle').onchange = event => {
    nodeEditEnabled = event.target.checked;
    selectedNodeIndex = null;
    selectedBezierHandle = null;
    selectedBezierAnchor = null;
    const stroke = selectedStroke();
    if (nodeEditEnabled && stroke && !stroke.bezierPath) {
      commitLineHistory(lineSnapshot());
      const index = vectorStrokes.findIndex(item => item.id === selectedStrokeId);
      vectorStrokes[index] = { ...stroke, bezierPath: convertLegacyPointsToBezierPath(stroke.points, stroke.id) };
    }
    render();
  };
  document.getElementById('deleteBezierAnchor').onclick = () => {
    const stroke = selectedStroke();
    if (!stroke?.bezierPath || !Number.isInteger(selectedBezierAnchor)) return;
    const anchorIndex = selectedBezierAnchor;
    const nextPath = removeBezierAnchor(stroke.bezierPath, anchorIndex);
    if (nextPath === stroke.bezierPath) return;
    commitLineHistory(lineSnapshot());
    const index = vectorStrokes.findIndex(item => item.id === selectedStrokeId);
    vectorStrokes[index] = { ...stroke, bezierPath: nextPath };
    selectedBezierAnchor = nextPath.anchors.length > 2
      ? Math.max(1, Math.min(anchorIndex - 1, nextPath.anchors.length - 2))
      : null;
    selectedBezierHandle = null;
    render();
  };
  document.getElementById('toggleBezierAnchorMode').onclick = () => {
    const stroke = selectedStroke();
    if (!stroke?.bezierPath || !Number.isInteger(selectedBezierAnchor)) return;
    const current = stroke.bezierPath.anchorModes?.[selectedBezierAnchor] || 'corner';
    commitLineHistory(lineSnapshot());
    const index = vectorStrokes.findIndex(item => item.id === selectedStrokeId);
    vectorStrokes[index] = {
      ...stroke,
      bezierPath: setBezierAnchorMode(stroke.bezierPath, selectedBezierAnchor, current === 'smooth' ? 'corner' : 'smooth'),
    };
    render();
  };
  document.getElementById('lineColor').oninput = event => applySelectedStyle({ color: event.target.value });
  document.getElementById('lineWidth').oninput = event => {
    document.getElementById('lineWidthOut').value = event.target.value + 'px';
    applySelectedStyle({ width: Number(event.target.value) });
  };
  document.getElementById('deleteLine').onclick = () => {
    if (!selectedStroke()) return;
    commitLineHistory(lineSnapshot());
    const index = vectorStrokes.findIndex(item => item.id === selectedStrokeId);
    vectorStrokes.splice(index, 1);
    selectedStrokeId = null;
    selectedNodeIndex = null;
    render();
  };
  document.getElementById('deleteLineNode').onclick = () => {
    const stroke = selectedStroke();
    if (!stroke || selectedNodeIndex === null) return;
    const next = removeLineStrokePoint(stroke, selectedNodeIndex);
    if (next === stroke) return;
    commitLineHistory(lineSnapshot());
    const index = vectorStrokes.findIndex(item => item.id === selectedStrokeId);
    vectorStrokes[index] = next;
    selectedNodeIndex = Math.min(selectedNodeIndex, next.points.length - 2);
    render();
  };
  document.getElementById('smoothLine').onclick = () => {
    const stroke = selectedStroke();
    if (!stroke || stroke.points.length < 3) return;
    commitLineHistory(lineSnapshot());
    const index = vectorStrokes.findIndex(item => item.id === selectedStrokeId);
    vectorStrokes[index] = smoothLineStroke(stroke, 5, 0.5);
    selectedNodeIndex = null;
    render();
  };

  const customColor = document.getElementById('customColor');
  customColor.oninput = event => setCurrentColor(event.target.value);
  document.getElementById('addPaletteColor').onclick = addCurrentColorToPalette;
  document.getElementById('resetPalette').onclick = () => {
    for (const name of Object.keys(defaultPaletteGroups)) paletteGroups[name] = [...defaultPaletteGroups[name]];
    activePaletteGroup = '기본';
    persistPaletteGroups();
    renderPaletteCategories();
    renderPaletteSwatches();
  };
  renderPaletteCategories();
  setCurrentColor(color, { remember: true });
}

function bindCanvasEvents() {
  const drawBrushPreview = () => {
    if (!strokeSamples.length) return;
    const outline = createBrushOutline(strokeSamples, currentStrokeOptions(true));
    if (!maskEditing && tool === 'pen') {
      renderer.previewBrush(outline, color, currentBrushPreset().opacity * brushOpacity, strokeSamples, { preset: brushPreset, size, color });
    } else {
      renderer.previewPolygon(outline, maskEditing ? (tool === 'eraser' ? 0xffffff : 0x171719) : 0xf4f0e8, 0.9);
    }
  };
  const brushPreviewScheduler = createFrameScheduler(drawBrushPreview);

  inputSurface.addEventListener('pointerdown', event => {
    if (event.button !== 0 || loadingFrame) return;
    if (playbackActive) setPlaybackEnabled(false);
    if (boilEnabled) setBoilEnabled(false);
    inputSurface.setPointerCapture(event.pointerId);
    if (['pen', 'eraser', 'line', 'fill'].includes(tool)) ensureEditableLayerAfterTransform();
    const point = position(event);

    if (tool === 'lasso') {
      down = true;
      const handle = selectionPolygon?.length >= 3
        ? hitTestPolygonTransformHandle(point, selectionPolygon)
        : null;
      const inside = selectionPolygon?.length >= 3 && pointInPolygon(point, selectionPolygon);
      if (handle || inside) {
        const originalPolygon = selectionPolygon.map(p => ({ ...p }));
        const sources = capturePolygonLayerSources(originalPolygon);
        const activeSource = sources.find(source => source.layer === layers[active]) || sources[0];
        const center = getPolygonCentroid(originalPolygon);
        const mode = handle === 'rotate' ? 'lassoRotate' : (handle ? 'lassoResize' : 'lassoMove');
        selectionDrag = {
          mode, handle, start: point, originalPolygon, sources, vectorBefore: lineSnapshot(),
          sourceCanvas: activeSource?.sourceCanvas,
          startAngle: Math.atan2(point.y - center.y, point.x - center.x),
          rotation: 0,
        };
      } else {
        selectionRect = null;
        selectionPolygon = [point];
        selectionDrag = { mode: 'lassoNew', start: point };
      }
      return;
    }

    if (tool === 'marquee') {
      down = true;
      const existing = selectionRect;
      let mode = 'new';
      let handle = null;
      if (existing) {
        handle = hitTestSelectionHandle(point, existing);
        if (handle === 'rotate') mode = 'rotate';
        else if (handle) mode = 'resize';
        else if (containsSelectionPoint(existing, point)) mode = 'move';
      }
      const sources = mode !== 'new' && existing ? captureRectLayerSources(existing) : [];
      const activeSource = sources.find(source => source.layer === layers[active]) || sources[0];
      selectionDrag = {
        mode, handle, start: point, originalRect: existing ? { ...existing } : null,
        sources, sourceCanvas: activeSource?.sourceCanvas, vectorBefore: lineSnapshot(),
        startAngle: existing ? Math.atan2(point.y - (existing.y + existing.height / 2), point.x - (existing.x + existing.width / 2)) : 0,
      };
      if (mode === 'new') {
        selectionPolygon = null;
        selectionRect = normalizeSelectionRect(point, point);
      }
      return;
    }

    if (tool === 'fill') {
      floodFill(point.x, point.y);
      render([active]);
      return;
    }

    if (tool === 'select') {
      const hit = hitTestLineStrokes(vectorStrokes, point, 9);
      const nodeMode = nodeEditEnabled;
      if (nodeMode && selectedStroke() && selectedStrokeId && (hit?.id === selectedStrokeId || (!hit && selectedStroke().bezierPath))) {
        const stroke = selectedStroke();
        const path = stroke.bezierPath || convertLegacyPointsToBezierPath(stroke.points, stroke.id);
        let nearestAnchor = -1, anchorDistance = 15;
        path.anchors.forEach((anchor, anchorIndex) => {
          const nextDistance = Math.hypot(point.x - anchor.x, point.y - anchor.y);
          if (nextDistance < anchorDistance) { anchorDistance = nextDistance; nearestAnchor = anchorIndex; }
        });
        if (nearestAnchor >= 0) {
          nodeMoveSnapshot = lineSnapshot();
          nodeDragChanged = !stroke.bezierPath;
          const index = vectorStrokes.findIndex(item => item.id === selectedStrokeId);
          vectorStrokes[index] = { ...stroke, bezierPath: path };
          selectedBezierAnchor = nearestAnchor;
          selectedBezierHandle = null;
          bezierAnchorDrag = { anchorIndex: nearestAnchor };
          nodeDragging = true;
          down = false;
          render();
          return;
        }
        let nearest = null, distance = 17;
        path.segments.forEach((segment, segmentIndex) => {
          [['out', segment.control1], ['in', segment.control2]].forEach(([handle, control]) => {
            const nextDistance = Math.hypot(point.x - control.x, point.y - control.y);
            if (nextDistance < distance) { distance = nextDistance; nearest = { segmentIndex, handle }; }
          });
        });
        if (nearest) {
          nodeMoveSnapshot = lineSnapshot();
          nodeDragChanged = !stroke.bezierPath;
          const index = vectorStrokes.findIndex(item => item.id === selectedStrokeId);
          vectorStrokes[index] = { ...stroke, bezierPath: path };
          selectedBezierHandle = nearest;
          bezierHandleDrag = { ...nearest };
          nodeDragging = true;
          down = false;
          render();
          return;
        }
        if (stroke.bezierPath) {
          const projection = projectPointToBezierPath(path, point);
          if (projection && projection.distance <= Math.max(18, stroke.width / 2 + 8)) {
            nodeMoveSnapshot = lineSnapshot();
            const index = vectorStrokes.findIndex(item => item.id === selectedStrokeId);
            const nextPath = insertBezierAnchor(path, projection.segmentIndex, projection.t);
            vectorStrokes[index] = { ...stroke, bezierPath: nextPath };
            selectedBezierAnchor = projection.segmentIndex + 1;
            selectedBezierHandle = null;
            bezierAnchorDrag = { anchorIndex: selectedBezierAnchor };
            nodeDragChanged = true;
            nodeDragging = true;
            down = false;
            render();
            return;
          }
          return;
        }
        let nearestIndex = -1;
        let nearestDistance = 14;
        stroke.points.forEach((node, index) => {
          const distance = Math.hypot(point.x - node.x, point.y - node.y);
          if (distance < nearestDistance) { nearestDistance = distance; nearestIndex = index; }
        });
        nodeMoveSnapshot = lineSnapshot();
        nodeDragChanged = false;
        if (nearestIndex >= 0) {
          selectedNodeIndex = nearestIndex;
        } else {
          const projection = projectPointToLineStroke(stroke, point);
          if (!projection || projection.distance > 18) {
            nodeMoveSnapshot = null;
            return;
          }
          const index = vectorStrokes.findIndex(item => item.id === selectedStrokeId);
          vectorStrokes[index] = insertLineStrokePoint(stroke, point);
          selectedNodeIndex = projection.segmentIndex + 1;
          nodeDragChanged = true;
        }
        nodeDragging = true;
        down = false;
        render();
        return;
      }
      selectedStrokeId = hit?.id || null;
      selectedNodeIndex = null;
      selectedBezierHandle = null;
      selectedBezierAnchor = null;
      const newlySelected = selectedStroke();
      if (nodeEditEnabled && newlySelected && !newlySelected.bezierPath) {
        commitLineHistory(lineSnapshot());
        const index = vectorStrokes.findIndex(item => item.id === selectedStrokeId);
        vectorStrokes[index] = { ...newlySelected, bezierPath: convertLegacyPointsToBezierPath(newlySelected.points, newlySelected.id) };
      }
      movingStroke = Boolean(hit);
      moveSnapshot = hit ? lineSnapshot() : null;
      moveChanged = false;
      last = point;
      render();
      return;
    }

    if (tool === 'vector') {
      down = true;
      drawingPoints = [{ ...point, pressure: event.pointerType === 'pen' ? normalizePointerPressure(event, true) : 0.5 }];
      renderer.previewStroke(drawingPoints, Number.parseInt(color.slice(1), 16), size);
      return;
    }

    down = true;
    lineStartPoint = last = point;
    strokeIsStylus = event.pointerType === 'pen';
    strokeSamples = (tool === 'pen' || tool === 'eraser')
      ? [{ ...point, pressure: normalizePointerPressure(event, pressureEnabled) }]
      : [];
    if (!maskEditing) save(layers[active]);
    if (tool === 'pen' || tool === 'eraser') drawBrushPreview();
  });

  inputSurface.addEventListener('pointermove', event => {
    const point = position(event);

    if (tool === 'select' && bezierAnchorDrag) {
      const stroke = selectedStroke();
      if (stroke?.bezierPath) {
        const index = vectorStrokes.findIndex(item => item.id === selectedStrokeId);
        vectorStrokes[index] = {
          ...stroke,
          bezierPath: moveBezierAnchor(stroke.bezierPath, bezierAnchorDrag.anchorIndex, point),
        };
        nodeDragChanged = true;
        render();
      }
      return;
    }

    if (tool === 'select' && bezierHandleDrag) {
      const stroke = selectedStroke();
      if (stroke?.bezierPath) {
        const index = vectorStrokes.findIndex(item => item.id === selectedStrokeId);
        vectorStrokes[index] = {
          ...stroke,
          bezierPath: moveBezierHandle(stroke.bezierPath, bezierHandleDrag.segmentIndex, bezierHandleDrag.handle, point, { mirrorOpposite: event.shiftKey || (document.getElementById('linkBezierHandles')?.checked ? true : undefined) }),
        };
        nodeDragChanged = true;
        render();
      }
      return;
    }

    if (tool === 'select' && nodeDragging && selectedNodeIndex !== null) {
      const stroke = selectedStroke();
      if (stroke?.points[selectedNodeIndex]) {
        const points = stroke.points.map(node => ({ x: node.x, y: node.y }));
        const previous = points[selectedNodeIndex];
        if (previous.x !== point.x || previous.y !== point.y) nodeDragChanged = true;
        points[selectedNodeIndex] = { x: point.x, y: point.y };
        const index = vectorStrokes.findIndex(item => item.id === selectedStrokeId);
        vectorStrokes[index] = { ...stroke, points };
        render();
      }
      return;
    }

    if (tool === 'select' && movingStroke && down === false && moveSnapshot) {
      const dx = point.x - last.x;
      const dy = point.y - last.y;
      if (dx !== 0 || dy !== 0) {
        const index = vectorStrokes.findIndex(item => item.id === selectedStrokeId);
        if (index >= 0) {
          vectorStrokes[index] = translateLineStroke(vectorStrokes[index], dx, dy);
          moveChanged = true;
          last = point;
          render();
        }
      }
      return;
    }

    if (tool === 'lasso' && down && selectionDrag) {
      if (selectionDrag.mode === 'lassoNew') {
        const points = selectionPolygon;
        const previous = points[points.length - 1];
        if (Math.hypot(point.x - previous.x, point.y - previous.y) >= 2.5) points.push(point);
      } else if (selectionDrag.mode === 'lassoMove') {
        selectionPolygon = translatePolygon(
          selectionDrag.originalPolygon,
          point.x - selectionDrag.start.x,
          point.y - selectionDrag.start.y,
          { width: W, height: H },
        );
        updateSelectionDragPreview(selectionDrag);
      } else if (selectionDrag.mode === 'lassoResize') {
        selectionPolygon = resizePolygonFromHandle(
          selectionDrag.originalPolygon, selectionDrag.handle, point, { width: W, height: H },
        );
        updateSelectionDragPreview(selectionDrag);
      } else if (selectionDrag.mode === 'lassoRotate') {
        const center = getPolygonCentroid(selectionDrag.originalPolygon);
        const currentAngle = Math.atan2(point.y - center.y, point.x - center.x);
        selectionDrag.rotation = (currentAngle - selectionDrag.startAngle) * 180 / Math.PI;
        selectionPolygon = transformPolygon(selectionDrag.originalPolygon, selectionDrag.rotation, 1);
        updateSelectionDragPreview(selectionDrag);
      }
      render();
      return;
    }

    if (tool === 'marquee' && down && selectionDrag) {
      if (selectionDrag.mode === 'new') {
        selectionRect = normalizeSelectionRect(selectionDrag.start, point);
      } else if (selectionDrag.mode === 'move') {
        selectionRect = moveSelectionRect(selectionDrag.originalRect, point.x - selectionDrag.start.x, point.y - selectionDrag.start.y, { width: W, height: H });
      } else if (selectionDrag.mode === 'resize') {
        selectionRect = resizeSelectionRectFromHandle(selectionDrag.originalRect, selectionDrag.handle, point, { width: W, height: H });
      } else if (selectionDrag.mode === 'rotate') {
        const original = selectionDrag.originalRect;
        const center = { x: original.x + original.width / 2, y: original.y + original.height / 2 };
        const currentAngle = Math.atan2(point.y - center.y, point.x - center.x);
        selectionDrag.rotation = (currentAngle - selectionDrag.startAngle) * 180 / Math.PI;
        const originalPolygon = [
          { x: original.x, y: original.y },
          { x: original.x + original.width, y: original.y },
          { x: original.x + original.width, y: original.y + original.height },
          { x: original.x, y: original.y + original.height },
        ];
        selectionRect = null;
        selectionPolygon = transformPolygon(originalPolygon, selectionDrag.rotation, 1);
      }
      if (selectionDrag.mode !== 'new') updateSelectionDragPreview(selectionDrag);
      render();
      return;
    }

    if (!down) return;

    if (tool === 'vector') {
      const previous = drawingPoints[drawingPoints.length - 1];
      if (Math.hypot(point.x - previous.x, point.y - previous.y) >= 1.25) {
        drawingPoints.push(point);
        renderer.previewStroke(drawingPoints, Number.parseInt(color.slice(1), 16), size);
      }
      return;
    }

    if (tool === 'line') {
      renderer.previewLine(lineStartPoint, point, Number.parseInt(color.slice(1), 16), size);
      return;
    }

    if (tool === 'pen' || tool === 'eraser') {
      const samples = coalescedPointerEvents(event);
      for (const sample of samples) {
        const rawPoint = position(sample);
        const smoothPoint = stabilizePoint(last, rawPoint, brushSmoothing);
        strokeSamples.push({
          ...smoothPoint,
          pressure: normalizePointerPressure(sample, pressureEnabled),
        });
        last = smoothPoint;
      }
      // Pointer events can arrive faster than the display refresh rate. Keep
      // every coalesced sample, but rebuild the full outline only once per frame.
      brushPreviewScheduler.schedule();
    }
  });

  const end = event => {
    if (tool === 'lasso' && down && selectionDrag) {
      const drag = selectionDrag;
      if (event.type === 'pointercancel') {
        clearSelectionDragPreviews(drag);
        if (drag.vectorBefore) vectorStrokes.splice(0, vectorStrokes.length, ...drag.vectorBefore);
        selectionPolygon = drag.originalPolygon
          ? drag.originalPolygon.map(point => ({ ...point }))
          : null;
        selectionDrag = null;
        down = false;
        render(layers.map((_, index) => index));
        return;
      }
      const point = position(event);
      if (drag.mode === 'lassoMove') {
        selectionPolygon = translatePolygon(
          drag.originalPolygon,
          point.x - drag.start.x,
          point.y - drag.start.y,
          { width: W, height: H },
        );
      } else if (drag.mode === 'lassoResize') {
        selectionPolygon = resizePolygonFromHandle(
          drag.originalPolygon, drag.handle, point, { width: W, height: H },
        );
      } else if (drag.mode === 'lassoRotate') {
        const center = getPolygonCentroid(drag.originalPolygon);
        const currentAngle = Math.atan2(point.y - center.y, point.x - center.x);
        drag.rotation = (currentAngle - drag.startAngle) * 180 / Math.PI;
        selectionPolygon = transformPolygon(drag.originalPolygon, drag.rotation, 1);
      }
      if (drag.mode !== 'lassoNew') updateSelectionDragPreview(drag);
      if (drag.mode === 'lassoNew') {
        const lastPoint = selectionPolygon?.at(-1);
        if (lastPoint && Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y) > 0.1) {
          selectionPolygon.push(point);
        }
        if (!selectionPolygon || selectionPolygon.length < 3) selectionPolygon = null;
      } else if (drag.mode === 'lassoMove' && selectionPolygon?.length) {
        const original = drag.originalPolygon;
        const dx = selectionPolygon[0].x - original[0].x;
        const dy = selectionPolygon[0].y - original[0].y;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
          commitSelectionDragSources(drag, () => getSelectionDragTransform(drag))
        }
      } else if (['lassoResize', 'lassoRotate'].includes(drag.mode) && selectionPolygon?.length) {
        const original = drag.originalPolygon;
        const originalBounds = getPolygonBounds(original);
        const targetBounds = getPolygonBounds(selectionPolygon);
        const changed = drag.mode === 'lassoRotate'
          ? Math.abs(drag.rotation || 0) > 0.1
          : originalBounds && targetBounds && (
            Math.abs(originalBounds.x - targetBounds.x) > 0.5
            || Math.abs(originalBounds.y - targetBounds.y) > 0.5
            || Math.abs(originalBounds.width - targetBounds.width) > 0.5
            || Math.abs(originalBounds.height - targetBounds.height) > 0.5
          );
        if (changed) {
          commitSelectionDragSources(drag, () => getSelectionDragTransform(drag))
        }
      }
      clearSelectionDragPreviews(drag);
      selectionDrag = null;
      down = false;
      render(layers.map((_, index) => index));
      return;
    }

    if (tool === 'marquee' && down && selectionDrag) {
      if (event.type === 'pointercancel') {
        clearSelectionDragPreviews(selectionDrag);
        if (selectionDrag.vectorBefore) vectorStrokes.splice(0, vectorStrokes.length, ...selectionDrag.vectorBefore);
        selectionDrag = null;
        down = false;
        render(layers.map((_, index) => index));
        return;
      }
      const point = position(event);
      const drag = selectionDrag;
      if (drag.mode === 'new') selectionRect = normalizeSelectionRect(drag.start, point);
      else if (drag.mode === 'move') selectionRect = moveSelectionRect(drag.originalRect, point.x - drag.start.x, point.y - drag.start.y, { width: W, height: H });
      else if (drag.mode === 'resize') selectionRect = resizeSelectionRectFromHandle(drag.originalRect, drag.handle, point, { width: W, height: H });
      else if (drag.mode === 'rotate') {
        const original = drag.originalRect;
        const center = { x: original.x + original.width / 2, y: original.y + original.height / 2 };
        const currentAngle = Math.atan2(point.y - center.y, point.x - center.x);
        drag.rotation = (currentAngle - drag.startAngle) * 180 / Math.PI;
      }
      if (drag.mode === 'rotate' && Math.abs(drag.rotation || 0) <= 0.1) {
        selectionRect = { ...drag.originalRect };
        selectionPolygon = null;
      }
      if (drag.mode !== 'new') updateSelectionDragPreview(drag);
      if (drag.mode === 'rotate' && Math.abs(drag.rotation || 0) > 0.1 && drag.originalRect) {
        const original = drag.originalRect;
        const center = { x: original.x + original.width / 2, y: original.y + original.height / 2 };
        commitSelectionDragSources(drag, () => getSelectionDragTransform(drag))
        const polygon = [
          { x: original.x, y: original.y },
          { x: original.x + original.width, y: original.y },
          { x: original.x + original.width, y: original.y + original.height },
          { x: original.x, y: original.y + original.height },
        ];
        selectionRect = null;
        selectionPolygon = transformPolygon(polygon, drag.rotation, 1);
      }
      if (drag.mode === 'move' || drag.mode === 'resize') {
        const original = drag.originalRect;
        const target = selectionRect;
        if (original && target && (
          Math.abs(target.x - original.x) > 0.5
          || Math.abs(target.y - original.y) > 0.5
          || Math.abs(target.width - original.width) > 0.5
          || Math.abs(target.height - original.height) > 0.5
        )) {
          commitSelectionDragSources(drag, () => getSelectionDragTransform(drag))
        }
      }
      if (drag.mode === 'new' && (!selectionRect || selectionRect.width < 2 || selectionRect.height < 2)) selectionRect = null;
      clearSelectionDragPreviews(drag);
      selectionDrag = null;
      down = false;
      render(layers.map((_, index) => index));
      return;
    }

    if (tool === 'select' && (bezierHandleDrag || bezierAnchorDrag) && nodeMoveSnapshot) {
      if (event.type === 'pointercancel') {
        restoreLineStrokeSnapshot(vectorStrokes, nodeMoveSnapshot);
        selectedBezierHandle = null;
        selectedBezierAnchor = null;
      } else if (nodeDragChanged && lineStrokeSnapshotChanged(vectorStrokes, nodeMoveSnapshot)) {
        commitLineHistory(nodeMoveSnapshot);
      }
      bezierHandleDrag = null;
      bezierAnchorDrag = null;
      nodeDragging = false;
      nodeMoveSnapshot = null;
      nodeDragChanged = false;
      down = false;
      render();
      return;
    }

    if (tool === 'select' && nodeDragging && nodeMoveSnapshot) {
      if (event.type === 'pointercancel') {
        restoreLineStrokeSnapshot(vectorStrokes, nodeMoveSnapshot);
        selectedNodeIndex = null;
      } else if (nodeDragChanged && lineStrokeSnapshotChanged(vectorStrokes, nodeMoveSnapshot)) {
        commitLineHistory(nodeMoveSnapshot);
      }
      nodeDragging = false;
      nodeMoveSnapshot = null;
      nodeDragChanged = false;
      down = false;
      render();
      return;
    }

    if (tool === 'select' && movingStroke && moveSnapshot) {
      if (moveChanged) commitLineHistory(moveSnapshot);
      movingStroke = false;
      moveSnapshot = null;
      moveChanged = false;
      down = false;
      render();
      return;
    }

    if (tool === 'pen' || tool === 'eraser') brushPreviewScheduler.cancel();
    if (!down) return;
    const point = position(event);

    if (tool === 'vector') {
      const previous = drawingPoints[drawingPoints.length - 1];
      if (Math.hypot(point.x - previous.x, point.y - previous.y) > 0.1) drawingPoints.push({ ...point, pressure: event.pointerType === 'pen' ? normalizePointerPressure(event, true) : 0.5 });
      if (drawingPoints.length === 1) drawingPoints.push({ x: point.x + 0.1, y: point.y + 0.1 });
      commitLineHistory(lineSnapshot());
      const created = createLineStroke({
        id: 'line-' + nextLineId++,
        points: drawingPoints,
        color,
        width: size,
        brushPreset: vectorBrushPreset,
        pressureCurve: vectorPressureCurve,
        motionStyle: vectorMotionStyle,
        motionStrength: vectorMotionStrength,
      });
      vectorStrokes.push(created);
      selectedStrokeId = created.id;
      drawingPoints = null;
      renderer.clearPreview();
      down = false;
      render();
      return;
    }

    if (tool === 'line') {
      commitLineHistory(lineSnapshot());
      const created = createLineStroke({ id: 'line-' + nextLineId++, points: [{ ...lineStartPoint, pressure: 0.5 }, { ...point, pressure: 0.5 }], color, width: size, brushPreset: vectorBrushPreset, pressureCurve: vectorPressureCurve, motionStyle: vectorMotionStyle, motionStrength: vectorMotionStrength });
      vectorStrokes.push(created);
      selectedStrokeId = created.id;
      renderer.clearPreview();
      down = false;
      render();
    } else if (tool === 'pen' || tool === 'eraser') {
      const finalPressure = strokeIsStylus && Number(event.pressure) > 0
        ? normalizePointerPressure(event, pressureEnabled)
        : (strokeSamples.at(-1)?.pressure ?? 0.5);
      const finalPoint = strokeSamples.at(-1);
      if (!finalPoint || Math.hypot(point.x - finalPoint.x, point.y - finalPoint.y) > 0.1) {
        strokeSamples.push({ ...point, pressure: finalPressure });
      }
      const outline = createBrushOutline(strokeSamples, currentStrokeOptions(true));
      if (outline.length >= 3) {
        const targetLayer = layers[active];
        const drawingMask = maskEditing && targetLayer.maskEnabled && targetLayer.maskCanvas;
        const context = (drawingMask ? targetLayer.maskCanvas : targetLayer.canvas).getContext('2d');
        if (drawingMask) {
          targetLayer.maskUndo.push(targetLayer.maskCanvas.toDataURL());
          if (targetLayer.maskUndo.length > 25) targetLayer.maskUndo.shift();
          targetLayer.maskRedo = [];
        }
        context.save();
        context.globalCompositeOperation = drawingMask ? (tool === 'eraser' ? 'source-over' : 'destination-out') : (tool === 'eraser' ? 'destination-out' : 'source-over');
        context.globalAlpha = drawingMask ? 1 : (tool === 'eraser' ? 1 : currentBrushPreset().opacity * brushOpacity);
        context.fillStyle = drawingMask ? '#fff' : color;
        context.beginPath();
        context.moveTo(outline[0][0], outline[0][1]);
        for (let index = 1; index < outline.length; index++) {
          context.lineTo(outline[index][0], outline[index][1]);
        }
        context.closePath();
        context.fill();
        if (!drawingMask && tool === 'pen') {
          applyBrushTexture(context, outline, strokeSamples, { preset: brushPreset, size, color, opacity: currentBrushPreset().opacity * brushOpacity });
        }
        context.restore();
      }
      strokeSamples = [];
      strokeIsStylus = false;
      renderer.clearPreview();
      render([active]);
    }
    down = false;
  };

  inputSurface.addEventListener('pointerup', end);
  inputSurface.addEventListener('pointercancel', end);
}

function bindKeyboardShortcuts() {
  window.addEventListener('keydown', event => {
    const target = event.target;
    const isTextEntry = target instanceof HTMLElement && (
      target.isContentEditable
      || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
    );
    if (isTextEntry || event.altKey || event.ctrlKey || event.metaKey) return;

    if ((event.key === 'Delete' || event.key === 'Backspace')
      && nodeEditEnabled
      && Number.isInteger(selectedBezierAnchor)) {
      const deleteButton = document.getElementById('deleteBezierAnchor');
      if (deleteButton && !deleteButton.disabled) {
        event.preventDefault();
        deleteButton.click();
      }
      return;
    }

    if (event.key === 'Escape' && (selectedBezierAnchor !== null || selectedBezierHandle !== null)) {
      selectedBezierAnchor = null;
      selectedBezierHandle = null;
      render();
    }
  });
}

async function start() {
  inputSurface = await renderer.init(host);
  bindControls();
  bindViewportControls();
  bindCanvasEvents();
  bindKeyboardShortcuts();

  const lineContext = layers[1].canvas.getContext('2d');
  lineContext.strokeStyle = '#24242a';
  lineContext.lineWidth = 12;
  lineContext.lineJoin = 'round';
  lineContext.beginPath();
  lineContext.arc(600, 280, 130, 0, Math.PI * 2);
  lineContext.stroke();
  lineContext.beginPath();
  lineContext.moveTo(470, 520);
  lineContext.lineTo(730, 520);
  lineContext.lineTo(730, 760);
  lineContext.lineTo(470, 760);
  lineContext.closePath();
  lineContext.stroke();

  updateFrameCels(timeline, timeline.activeFrameId, layers.map(layer => layer.canvas.toDataURL('image/png')));
  render([0, 1]);
}

start().catch(error => {
  console.error('FRAME Studio renderer failed to initialize:', error);
  host.textContent = '렌더러를 시작하지 못했습니다. WebGL을 지원하는 최신 브라우저에서 다시 시도해 주세요.';
  host.classList.add('error');
});
