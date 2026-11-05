import './styles.css';
import { PixiStageRenderer } from './renderer.js';
import { applyScreentoneToCanvas } from './tone/screentone.js';
import { clientToCanvasPoint, parseCssTransformMatrix } from './viewport/coordinates.js';
import { applyBrushTexture, coalescedPointerEvents, createBrushOutline, createFrameScheduler, getBrushPreset, normalizePointerPressure, resolveBrushStrokeOptions, stabilizePoint } from './brush/brush-engine.js';
import { expandRegionMask, findConnectedRegion } from './fill/flood-fill.js';
import { animateLineStrokes, lineBoilPhase } from './line/line-boil.js';
import { activeFrame, addFrame, createTimeline, deleteFrame, frameAtTime, getOnionSkin, selectFrame, updateFrameCels, updateFrameStrokes } from './animation/timeline.js';
import { normalizeRasterCels } from './animation/frame-cels.js';
import { containsSelectionPoint, hitTestSelectionHandle, moveSelectionRect, normalizeSelectionRect, lineStrokeIntersectsPolygon, pointInPolygon, resizeSelectionRectFromHandle, resolveSelectionTargets, transformLineStrokes, transformPolygon, translatePolygon, getSelectionPreviewTransform, getPolygonBounds, getPolygonCentroid, hitTestPolygonTransformHandle, resizePolygonFromHandle } from './selection/selection.js';
import {
  createLineStroke,
  hitTestLineStrokes,
  translateLineStroke,
  updateLineStrokeStyle,
  projectPointToLineStroke,
  insertLineStrokePoint,
  removeLineStrokePoint,
  smoothLineStroke,
} from './line/line-engine.js';

const W = 1200;
const H = 900;
const host = document.getElementById('pixiHost');
const renderer = new PixiStageRenderer(W, H);

let inputSurface;
let tool = 'pen';
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
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = W;
  maskCanvas.height = H;
  const maskContext = maskCanvas.getContext('2d');
  maskContext.fillStyle = '#fff';
  maskContext.fillRect(0, 0, W, H);
  return { name, visible: true, opacity: 1, blendMode: 'normal', canvas, maskCanvas, maskEnabled: false, maskUndo: [], maskRedo: [], undo: [], redo: [] };
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
let selectedNodeIndex = null;
let nodeDragging = false;
let nodeMoveSnapshot = null;
let nodeEditEnabled = false;

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
    context.strokeStyle = stroke.color;
    context.lineWidth = stroke.width;
    context.stroke();
  }
  context.restore();
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
      maskedContext.drawImage(layer.canvas, 0, 0);
      maskedContext.globalCompositeOperation = 'destination-in';
      maskedContext.drawImage(layer.maskCanvas, 0, 0);
      context.drawImage(masked, 0, 0);
    } else {
      context.drawImage(layer.canvas, 0, 0);
    }
    context.restore();
  });
  drawVectorStrokes(context);
  return context;
}

function render(dirtyIndices = [], displayStrokes = vectorStrokes) {
  applyGroupState();
  if (!loadingFrame) updateFrameStrokes(timeline, timeline.activeFrameId, vectorStrokes);
  renderer.sync(layers, dirtyIndices, displayStrokes, selectedStrokeId, onionEnabled ? getOnionSkin(timeline) : [], selectionRect, selectionPolygon, selectedNodeIndex, nodeEditEnabled);
  document.getElementById('status').textContent = tool.toUpperCase();
  drawLayers();
  updateLayerInspector();
  updateLineInspector();
  drawTimeline();
}

function saveActiveFrame() {
  updateFrameStrokes(timeline, timeline.activeFrameId, vectorStrokes);
  updateFrameCels(timeline, timeline.activeFrameId, layers.map(layer => layer.canvas.toDataURL('image/png')));
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
  const decoded = await decodeRasterCels(normalizeRasterCels(frame?.cels, layers.length));
  if (token !== frameLoadToken) return;
  layers.forEach((layer, index) => {
    const context = layer.canvas.getContext('2d');
    context.clearRect(0, 0, W, H);
    if (decoded[index]) context.drawImage(decoded[index], 0, 0, W, H);
  });
  vectorStrokes.splice(0, vectorStrokes.length, ...(frame?.strokes || []).map(stroke => ({
    ...stroke,
    points: stroke.points.map(point => ({ x: point.x, y: point.y })),
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

const viewport = { scale: 1, rotation: 0 };

function applyViewport() {
  if (!inputSurface) return;
  inputSurface.style.transform = `rotate(${viewport.rotation}deg) scale(${viewport.scale})`;
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
    target.title = '다중 변형 대상에 포함';
    target.setAttribute('aria-label', layer.name + ' 다중 변형 대상');
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
    renderer.sync(layers, [], displayStrokes, selectedStrokeId, onionEnabled ? getOnionSkin(timeline) : [], selectionRect, selectionPolygon, selectedNodeIndex, nodeEditEnabled);
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
  if (nodeStatus) nodeStatus.textContent = `${stroke.points.length}개 노드${selectedNodeIndex === null ? '' : ` · ${selectedNodeIndex + 1}번 선택`}`;
  const removeNode = document.getElementById('deleteLineNode');
  if (removeNode) removeNode.disabled = selectedNodeIndex === null || selectedNodeIndex <= 0 || selectedNodeIndex >= stroke.points.length - 1;
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

function updateSelectionDragPreview(drag) {
  const isLassoTransform = drag?.originalPolygon?.length >= 3
    && ['lassoMove', 'lassoResize', 'lassoRotate'].includes(drag.mode);
  const isRectTransform = drag?.originalRect && ['move', 'resize', 'rotate'].includes(drag.mode);
  if (!drag?.sourceCanvas || (!isLassoTransform && !isRectTransform)) {
    if (drag) drag.previewCanvas = null;
    return;
  }

  const previewCanvas = drag.previewCanvas || document.createElement('canvas');
  if (previewCanvas.width !== W) previewCanvas.width = W;
  if (previewCanvas.height !== H) previewCanvas.height = H;
  const context = previewCanvas.getContext('2d');
  context.clearRect(0, 0, W, H);
  context.drawImage(layers[active].canvas, 0, 0);

  if (isLassoTransform) {
    const originalPolygon = drag.originalPolygon;
    context.save();
    context.beginPath();
    originalPolygon.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
    context.closePath();
    context.clip();
    context.clearRect(0, 0, W, H);
    context.restore();

    if (drag.mode === 'lassoMove') {
      const dx = selectionPolygon[0].x - originalPolygon[0].x;
      const dy = selectionPolygon[0].y - originalPolygon[0].y;
      context.drawImage(drag.sourceCanvas, dx, dy);
    } else if (drag.mode === 'lassoResize') {
      const originalBounds = getPolygonBounds(originalPolygon);
      const targetBounds = getPolygonBounds(selectionPolygon);
      if (originalBounds && targetBounds) {
        const scaleX = targetBounds.width / originalBounds.width;
        const scaleY = targetBounds.height / originalBounds.height;
        context.save();
        context.translate(targetBounds.x - originalBounds.x * scaleX, targetBounds.y - originalBounds.y * scaleY);
        context.scale(scaleX, scaleY);
        context.drawImage(drag.sourceCanvas, 0, 0);
        context.restore();
      }
    } else if (drag.mode === 'lassoRotate') {
      const center = getPolygonCentroid(originalPolygon);
      context.save();
      context.translate(center.x, center.y);
      context.rotate((drag.rotation || 0) * Math.PI / 180);
      context.translate(-center.x, -center.y);
      context.drawImage(drag.sourceCanvas, 0, 0);
      context.restore();
    }
  } else {
    const original = drag.originalRect;
    const transform = getSelectionPreviewTransform(original, selectionRect, drag.rotation || 0);
    context.clearRect(original.x, original.y, original.width, original.height);

    if (drag.mode === 'rotate') {
      context.save();
      context.translate(transform.center.x, transform.center.y);
      context.rotate(transform.rotationRadians);
      context.drawImage(drag.sourceCanvas, -original.width / 2, -original.height / 2, original.width, original.height);
      context.restore();
    } else if (selectionRect) {
      context.save();
      context.translate(selectionRect.x, selectionRect.y);
      context.scale(transform.scaleX, transform.scaleY);
      context.drawImage(drag.sourceCanvas, 0, 0, original.width, original.height);
      context.restore();
    }
  }

  drag.previewCanvas = previewCanvas;
  renderer.setLayerPreview(layers[active], previewCanvas);
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
  const center = polygon.reduce((sum, point) => ({
    x: sum.x + point.x / polygon.length,
    y: sum.y + point.y / polygon.length,
  }), { x: 0, y: 0 });
  const radians = angle * Math.PI / 180;

  // Prepare every layer before mutating any of them so all targets share
  // exactly the same transform origin and selection boundary.
  const prepared = targets.map(layer => {
    const before = layer.canvas.toDataURL('image/png');
    const source = document.createElement('canvas');
    source.width = W; source.height = H;
    const sourceContext = source.getContext('2d');
    sourceContext.save();
    sourceContext.beginPath();
    polygon.forEach((point, index) => index ? sourceContext.lineTo(point.x, point.y) : sourceContext.moveTo(point.x, point.y));
    sourceContext.closePath();
    sourceContext.clip();
    sourceContext.drawImage(layer.canvas, 0, 0);
    sourceContext.restore();

    const transformed = document.createElement('canvas');
    transformed.width = W; transformed.height = H;
    const transformedContext = transformed.getContext('2d');
    transformedContext.translate(center.x, center.y);
    transformedContext.rotate(radians);
    transformedContext.scale(scale, scale);
    transformedContext.drawImage(source, -center.x, -center.y);
    return { layer, transformed, before };
  });

  for (const { layer, transformed } of prepared) {
    save(layer);
    const context = layer.canvas.getContext('2d');
    context.save();
    context.beginPath();
    polygon.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
    context.closePath();
    context.clip();
    context.clearRect(0, 0, W, H);
    context.restore();
    context.drawImage(transformed, 0, 0);
  }
  if (hasSelectedVectors) {
    vectorStrokes.splice(0, vectorStrokes.length, ...transformedVectors);
    selectedStrokeId = null;
  }
  const vectorAfter = hasSelectedVectors ? lineSnapshot() : null;
  groupedTransformUndo = (targets.length > 1 || hasSelectedVectors) ? {
    entries: prepared.map(({ layer, before }) => ({ layer, before, after: layer.canvas.toDataURL('image/png') })),
    vectorBefore: hasSelectedVectors ? vectorBefore : null,
    vectorAfter,
  } : null;
  groupedTransformRedo = null;

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
    applyViewport();
  };
}

function bindControls() {
  document.getElementById('applyTone').onclick = applyMangaTone;
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
    if (selectionDrag?.previewCanvas) renderer.clearLayerPreview(layers[active]);
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
    if (source.maskCanvas) copy.maskCanvas.getContext('2d').drawImage(source.maskCanvas, 0, 0);
    copy.maskEnabled = source.maskEnabled;
    copy.groupId = source.groupId;
    layers.push(copy);
    active = layers.length - 1;
    saveActiveFrame();
    render(layers.map((_, index) => index));
  };

  document.getElementById('layerDelete').onclick = () => {
    if (layers.length <= 1) return;
    if (playbackActive) setPlaybackEnabled(false);
    saveActiveFrame();
    layers.splice(active, 1);
    timeline.frames.forEach(frame => frame.cels?.splice(active, 1));
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
    const point = position(event);

    if (tool === 'lasso') {
      down = true;
      const handle = selectionPolygon?.length >= 3
        ? hitTestPolygonTransformHandle(point, selectionPolygon)
        : null;
      const inside = selectionPolygon?.length >= 3 && pointInPolygon(point, selectionPolygon);
      if (handle || inside) {
        const sourceCanvas = document.createElement('canvas');
        sourceCanvas.width = W; sourceCanvas.height = H;
        const context = sourceCanvas.getContext('2d');
        context.save();
        context.beginPath();
        selectionPolygon.forEach((p, index) => index ? context.lineTo(p.x, p.y) : context.moveTo(p.x, p.y));
        context.closePath();
        context.clip();
        context.drawImage(layers[active].canvas, 0, 0);
        context.restore();
        const originalPolygon = selectionPolygon.map(p => ({ ...p }));
        const center = getPolygonCentroid(originalPolygon);
        const mode = handle === 'rotate' ? 'lassoRotate' : (handle ? 'lassoResize' : 'lassoMove');
        selectionDrag = {
          mode, handle, start: point, originalPolygon, sourceCanvas,
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
      const sourceCanvas = document.createElement('canvas');
      if (mode !== 'new' && existing) {
        sourceCanvas.width = Math.max(1, Math.ceil(existing.width));
        sourceCanvas.height = Math.max(1, Math.ceil(existing.height));
        sourceCanvas.getContext('2d').drawImage(layers[active].canvas, existing.x, existing.y, existing.width, existing.height, 0, 0, sourceCanvas.width, sourceCanvas.height);
      }
      selectionDrag = { mode, handle, start: point, originalRect: existing ? { ...existing } : null, sourceCanvas, startAngle: existing ? Math.atan2(point.y - (existing.y + existing.height / 2), point.x - (existing.x + existing.width / 2)) : 0 };
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
      if (nodeMode && selectedStroke() && hit?.id === selectedStrokeId) {
        const stroke = selectedStroke();
        let nearestIndex = -1;
        let nearestDistance = 14;
        stroke.points.forEach((node, index) => {
          const distance = Math.hypot(point.x - node.x, point.y - node.y);
          if (distance < nearestDistance) { nearestDistance = distance; nearestIndex = index; }
        });
        nodeMoveSnapshot = lineSnapshot();
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
        }
        nodeDragging = true;
        down = false;
        render();
        return;
      }
      selectedStrokeId = hit?.id || null;
      selectedNodeIndex = null;
      movingStroke = Boolean(hit);
      moveSnapshot = hit ? lineSnapshot() : null;
      moveChanged = false;
      last = point;
      render();
      return;
    }

    if (tool === 'vector') {
      down = true;
      drawingPoints = [point];
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

    if (tool === 'select' && nodeDragging && selectedNodeIndex !== null) {
      const stroke = selectedStroke();
      if (stroke?.points[selectedNodeIndex]) {
        const points = stroke.points.map(node => ({ x: node.x, y: node.y }));
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
        selectionPolygon = translatePolygon(
          transformPolygon(selectionDrag.originalPolygon, selectionDrag.rotation, 1),
          0, 0, { width: W, height: H },
        );
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
        renderer.clearLayerPreview(layers[active]);
        selectionPolygon = drag.originalPolygon
          ? drag.originalPolygon.map(point => ({ ...point }))
          : null;
        selectionDrag = null;
        down = false;
        render([active]);
        return;
      }
      const point = position(event);
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
          const layer = layers[active];
          save(layer);
          const context = layer.canvas.getContext('2d');
          context.save();
          context.beginPath();
          original.forEach((p, index) => index ? context.lineTo(p.x, p.y) : context.moveTo(p.x, p.y));
          context.closePath();
          context.clip();
          context.clearRect(0, 0, W, H);
          context.restore();
          context.drawImage(drag.sourceCanvas, dx, dy);
          saveActiveFrame();
          render([active]);
        }
      } else if (['lassoResize', 'lassoRotate'].includes(drag.mode) && selectionPolygon?.length) {
        const original = drag.originalPolygon;
        const layer = layers[active];
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
          save(layer);
          const context = layer.canvas.getContext('2d');
          context.save();
          context.beginPath();
          original.forEach((p, index) => index ? context.lineTo(p.x, p.y) : context.moveTo(p.x, p.y));
          context.closePath();
          context.clip();
          context.clearRect(0, 0, W, H);
          context.restore();

          if (drag.mode === 'lassoResize' && originalBounds && targetBounds) {
            const scaleX = targetBounds.width / originalBounds.width;
            const scaleY = targetBounds.height / originalBounds.height;
            context.save();
            context.translate(targetBounds.x - originalBounds.x * scaleX, targetBounds.y - originalBounds.y * scaleY);
            context.scale(scaleX, scaleY);
            context.drawImage(drag.sourceCanvas, 0, 0);
            context.restore();
          } else if (drag.mode === 'lassoRotate') {
            const center = getPolygonCentroid(original);
            context.save();
            context.translate(center.x, center.y);
            context.rotate((drag.rotation || 0) * Math.PI / 180);
            context.translate(-center.x, -center.y);
            context.drawImage(drag.sourceCanvas, 0, 0);
            context.restore();
          }
          saveActiveFrame();
          render([active]);
        }
      }
      renderer.clearLayerPreview(layers[active]);
      selectionDrag = null;
      down = false;
      render([active]);
      return;
    }

    if (tool === 'marquee' && down && selectionDrag) {
      if (event.type === 'pointercancel') {
        renderer.clearLayerPreview(layers[active]);
        selectionDrag = null;
        down = false;
        render([active]);
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
      if (drag.mode === 'rotate' && Math.abs(drag.rotation || 0) > 0.1 && drag.sourceCanvas && drag.originalRect) {
        const original = drag.originalRect;
        const center = { x: original.x + original.width / 2, y: original.y + original.height / 2 };
        const layer = layers[active];
        save(layer);
        const rotated = document.createElement('canvas');
        rotated.width = W; rotated.height = H;
        const context = rotated.getContext('2d');
        context.translate(center.x, center.y);
        context.rotate((drag.rotation || 0) * Math.PI / 180);
        context.drawImage(drag.sourceCanvas, -original.width / 2, -original.height / 2, original.width, original.height);
        const target = layer.canvas.getContext('2d');
        target.clearRect(original.x, original.y, original.width, original.height);
        target.drawImage(rotated, 0, 0);
        const polygon = [
          { x: original.x, y: original.y },
          { x: original.x + original.width, y: original.y },
          { x: original.x + original.width, y: original.y + original.height },
          { x: original.x, y: original.y + original.height },
        ];
        selectionRect = null;
        selectionPolygon = transformPolygon(polygon, drag.rotation, 1);
        saveActiveFrame();
      }
      if (drag.mode === 'move' || drag.mode === 'resize') {
        const source = drag.sourceCanvas;
        const original = drag.originalRect;
        const target = selectionRect;
        if (source && original && target && (Math.abs(target.x - original.x) > 0.5 || Math.abs(target.y - original.y) > 0.5 || Math.abs(target.width - original.width) > 0.5 || Math.abs(target.height - original.height) > 0.5)) {
          const layer = layers[active];
          save(layer);
          const context = layer.canvas.getContext('2d');
          context.clearRect(original.x, original.y, original.width, original.height);
          context.drawImage(source, target.x, target.y, target.width, target.height);
          saveActiveFrame();
        }
      }
      if (drag.mode === 'new' && (!selectionRect || selectionRect.width < 2 || selectionRect.height < 2)) selectionRect = null;
      renderer.clearLayerPreview(layers[active]);
      selectionDrag = null;
      down = false;
      render([active]);
      return;
    }

    if (tool === 'select' && nodeDragging && nodeMoveSnapshot) {
      commitLineHistory(nodeMoveSnapshot);
      nodeDragging = false;
      nodeMoveSnapshot = null;
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
      if (Math.hypot(point.x - previous.x, point.y - previous.y) > 0.1) drawingPoints.push(point);
      if (drawingPoints.length === 1) drawingPoints.push({ x: point.x + 0.1, y: point.y + 0.1 });
      commitLineHistory(lineSnapshot());
      const created = createLineStroke({
        id: 'line-' + nextLineId++,
        points: drawingPoints,
        color,
        width: size,
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
      stroke(lineStartPoint, point);
      renderer.clearPreview();
      render([active]);
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

async function start() {
  inputSurface = await renderer.init(host);
  bindControls();
  bindViewportControls();
  bindCanvasEvents();

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
