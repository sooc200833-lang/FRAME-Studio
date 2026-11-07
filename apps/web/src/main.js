import './styles.css';
import { PixiStageRenderer } from './renderer.js';
import { applyScreentoneToCanvas } from './tone/screentone.js';
import { canvasUnitsPerCssPixel, clientToCanvasPoint, parseCssTransformMatrix } from './viewport/coordinates.js';
import { classifyMultiTouchTap, pinchViewport, snapViewportRotation } from './viewport/gestures.js';
import { hexToHsv, hsvToHex, sampleImageDataColor } from './color/color-utils.js';
import { applyBrushTexture, coalescedPointerEvents, createBrushOutline, createFrameScheduler, getBrushPreset, normalizePointerPressure, resolveBrushStrokeOptions, stabilizePoint } from './brush/brush-engine.js';
import { createSmudgeSession } from './brush/smudge-engine.js';
import { normalizeBrushBlendMode } from './brush/blend-modes.js';
import { expandRegionMask, findConnectedRegion } from './fill/flood-fill.js';
import { animateLineStrokes, lineBoilPhase } from './line/line-boil.js';
import { buildProjectDocument, parseProjectDocument, referencedImageKeys } from './document/project-format.js';
import { isProjectStorageAvailable, listProjects, loadImageDataUrls, loadProjectRecord, getMeta, requestPersistentStorage, saveProjectRecord, setMeta } from './document/project-store.js';
import { clipAt, createTimelineDocument, deleteClip, duplicateTrack, ensureClipAt, ensureTrack, insertClipAfter, neighborClipStart, normalizeHold, setClipHold, timelineLength } from './animation/tracks.js';
import { applyMatrix, evaluateMotionTrack, invertMatrix, isIdentityMotion, keyframeAt, motionMatrix, removeKeyframe, setKeyframe } from './animation/motion.js';
import { cloneRasterTransformRecords, composeRasterTransformStack, createTranslationMatrix, createRotationMatrix, rasterizeRasterTransformStack } from './selection/raster-transform.js';
import { containsSelectionPoint, hitTestSelectionHandle, moveSelectionRect, normalizeSelectionRect, lineStrokeIntersectsPolygon, pointInPolygon, resizeSelectionRectFromHandle, resolveSelectionTargets, transformLineStrokes, transformLineStrokesByMatrix, transformPolygon, translatePolygon, getSelectionPreviewTransform, getPolygonBounds, getPolygonCentroid, hitTestPolygonTransformHandle, resizePolygonFromHandle } from './selection/selection.js';
import { convertLegacyPointsToBezierPath } from './line/legacy-bezier-bridge.js';
import { estimateVectorMousePressure, getVectorBrushPreset, normalizeStrokeWidthProfile } from './line/vector-brush.js';
import { buildVectorStrokeSegments } from './line/vector-rendering.js';
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
let brushBlendMode = 'source-over';
let smudgeStrength = 0.62;
let smudgeSpacing = 0.22;
let smudgeSession = null;
let smudgeOriginalData = null;
let smudgeUndoBefore = null;
let smudgeRedoBefore = null;
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
let playbackStartTick = 0;
// Fractional playhead while playing, so movement keyframes animate smoothly
// even while a held drawing stays on screen.
let playbackTickPosition = null;
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
// Multi-track timeline: one track per raster layer plus the shared vector
// track. `loadedClips` remembers which clip each live layer canvas (and the
// live vectorStrokes array) currently holds.
const timeline = createTimelineDocument({ fps: 12 });
const VECTOR_TRACK = 'vector';
const loadedClips = new Map();
let activeTrackId = null;
let nextLayerId = 1;
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
    id: 'layer-' + nextLayerId++,
    name, visible: true, opacity: 1, blendMode: 'normal',
    canvas, presentationCanvas, transformRecords: [], motionTrack: [],
    maskCanvas, maskEnabled: false, maskUndo: [], maskRedo: [], undo: [], redo: [],
  };
}

const layers = [makeLayer('면 / 톤'), makeLayer('선화')];
const layerGroups = [];
let active = 0;
let activeGroupId = null;

function groupFor(layer) { return layerGroups.find(group => group.id === layer.groupId) || null; }
function applyGroupState() {
  const tick = playbackActive && playbackTickPosition !== null ? playbackTickPosition : timeline.playhead;
  for (const layer of layers) {
    const group = groupFor(layer);
    // Movement keyframes are evaluated at the playhead and applied as a
    // presentation transform; the layer's canvas pixels stay untouched.
    const motion = evaluateMotionTrack(layer.motionTrack, tick);
    layer.renderMotion = motion;
    layer.renderMatrix = isIdentityMotion({ ...motion, opacity: 1 }) ? null : motionMatrix(motion, W, H);
    layer.renderVisible = layer.visible && (!group || group.visible);
    layer.renderOpacity = (layer.opacity ?? 1) * (group?.opacity ?? 1) * motion.opacity;
    layer.renderBlendMode = group?.blendMode && group.blendMode !== 'normal' ? group.blendMode : (layer.blendMode || 'normal');
  }
}
let selectedStrokeId = null;
const selectedStrokeIds = new Set();
let showSelectedVectorHighlight = true;
let vectorBrushPreset = 'ink';
let vectorPressureCurve = 1;
let lastVectorSampleTime = 0;
let vectorBrushOpacity = 1;
let vectorPressureProfile = [1, 1, 1, 1, 1];
let pressureProfileDrag = false;
let lineStyleEditSnapshot = null;
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
  const swatch = document.getElementById('colorButtonSwatch');
  if (swatch) swatch.style.background = color;
  syncHsvPicker();
  if (remember) {
    const index = recentColors.indexOf(color);
    if (index >= 0) recentColors.splice(index, 1);
    recentColors.unshift(color);
    recentColors.length = Math.min(recentColors.length, 10);
    renderRecentPalette();
  }
  renderPaletteSwatches();
  if (applyToSelectedLine && (selectedStrokeId || selectedStrokeIds.size)) applySelectedStyle({ color });
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


function selectedStroke() {
  return vectorStrokes.find(stroke => stroke.id === selectedStrokeId) || null;
}

function inspectorStroke() {
  return selectedStroke() || vectorStrokes.find(stroke => selectedStrokeIds.has(stroke.id)) || null;
}

function beginLineStyleEdit() {
  if (!lineStyleEditSnapshot && (selectedStrokeId || selectedStrokeIds.size)) lineStyleEditSnapshot = lineSnapshot();
}

function finishLineStyleEdit() {
  if (!lineStyleEditSnapshot) return;
  if (lineStrokeSnapshotChanged(vectorStrokes, lineStyleEditSnapshot)) commitLineHistory(lineStyleEditSnapshot);
  lineStyleEditSnapshot = null;
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
    context.save();
    for (const segment of buildVectorStrokeSegments(stroke)) {
      if (segment.skip) continue;
      context.globalAlpha *= segment.alpha;
      context.strokeStyle = stroke.color;
      context.lineWidth = segment.width;
      context.beginPath();
      context.moveTo(segment.from.x, segment.from.y);
      context.lineTo(segment.to.x, segment.to.y);
      context.stroke();
    }
    context.restore();
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
    if (layer.renderMatrix) context.transform(...layer.renderMatrix);
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

function boiledStrokes(timestamp = performance.now()) {
  return animateLineStrokes(vectorStrokes, {
    phase: lineBoilPhase(timestamp - boilStartedAt, Number(document.getElementById('boilSpeed').value)),
    amplitude: Number(document.getElementById('boilAmplitude').value),
    frequency: Number(document.getElementById('boilFrequency').value),
  });
}

function render(dirtyIndices = [], displayStrokes = boilEnabled ? boiledStrokes() : vectorStrokes) {
  for (const index of dirtyIndices) {
    if (layers[index]) refreshLayerPresentation(layers[index]);
  }
  applyGroupState();
  if (!loadingFrame) persistVectorClip();
  renderer.setHandleScale(cssToCanvasUnits(1));
  renderer.sync(layers, dirtyIndices, displayStrokes, selectedStrokeId, onionEnabled ? vectorOnionSkin() : [], selectionRect, selectionPolygon, selectedNodeIndex, nodeEditEnabled, selectedBezierHandle, selectedBezierAnchor, showSelectedVectorHighlight, selectedStrokeIds);
  renderer.setPreviewMatrix(paintsInLayerSpace() ? layers[active].renderMatrix : null);
  syncMotionUi();
  document.getElementById('status').textContent = TOOL_LABELS[tool] || tool.toUpperCase();
  drawLayers();
  updateLayerInspector();
  updateLineInspector();
  drawTimeline();
  scheduleFrameThumbnail();
  scheduleAutosave();
}

function cloneLineStroke(stroke) {
  return {
    ...stroke,
    points: stroke.points.map(point => ({ ...point })),
    ...(Array.isArray(stroke.pressureProfile) ? { pressureProfile: [...stroke.pressureProfile] } : {}),
    ...(stroke.bezierPath ? { bezierPath: {
      ...stroke.bezierPath,
      anchorModes: stroke.bezierPath.anchorModes ? [...stroke.bezierPath.anchorModes] : stroke.bezierPath.anchors.map((_, index) => index > 0 && index < stroke.bezierPath.anchors.length - 1 ? 'smooth' : 'corner'),
      anchors: stroke.bezierPath.anchors.map(point => ({ ...point })),
      segments: stroke.bezierPath.segments.map(segment => ({ control1: { ...segment.control1 }, control2: { ...segment.control2 } })),
    } } : {}),
  };
}

function layerTrack(layer) {
  return ensureTrack(timeline, layer.id);
}

function vectorTrack() {
  return ensureTrack(timeline, VECTOR_TRACK, { vector: true });
}

function currentTrackId() {
  return activeTrackId === VECTOR_TRACK ? VECTOR_TRACK : layers[active]?.id;
}

function currentTrack() {
  return currentTrackId() === VECTOR_TRACK ? vectorTrack() : layerTrack(layers[active]);
}

function trackLabel(trackId) {
  return trackId === VECTOR_TRACK ? '벡터 선' : (layers.find(layer => layer.id === trackId)?.name || '레이어');
}

function loadedClip(trackId) {
  const clipId = loadedClips.get(trackId);
  return timeline.tracks[trackId]?.clips.find(clip => clip.id === clipId) || null;
}

function persistVectorClip() {
  const clip = loadedClip(VECTOR_TRACK);
  if (clip) clip.strokes = vectorStrokes.map(cloneLineStroke);
}

/**
 * Called before an edit: makes sure the edited track has a clip at the
 * playhead (creating one past the track end) and that it is the loaded clip.
 */
function ensureEditableClip(kind) {
  const isVector = kind === 'vector';
  const track = isVector ? vectorTrack() : layerTrack(layers[active]);
  const trackId = isVector ? VECTOR_TRACK : layers[active].id;
  activeTrackId = isVector ? VECTOR_TRACK : null;
  if (loadedClip(trackId)) return;
  const found = ensureClipAt(timeline, track, timeline.playhead, isVector ? { strokes: [] } : {});
  loadedClips.set(trackId, found.clip.id);
}

function saveActiveFrame() {
  for (const layer of layers) {
    let clip = loadedClip(layer.id);
    if (!clip) {
      // A newly created layer adopts its blank clip at the playhead.
      const found = clipAt(layerTrack(layer), timeline.playhead);
      if (!found || found.clip.cel) continue;
      loadedClips.set(layer.id, found.clip.id);
      clip = found.clip;
    }
    clip.cel = layer.canvas.toDataURL('image/png');
    clip.transformCel = cloneRasterTransformRecords(layer.transformRecords || []);
  }
  persistVectorClip();
}

// Decoded images are cached per clip and reused while the clip's data URL is
// unchanged, so playback does not re-decode held drawings.
const clipImageCache = new WeakMap();

function decodeImage(source) {
  return new Promise(resolve => {
    if (!source) { resolve(null); return; }
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = source;
  });
}

function decodeClip(clip) {
  if (!clip) return Promise.resolve({ image: null, transformSources: [] });
  const cached = clipImageCache.get(clip);
  if (cached && cached.cel === clip.cel && cached.transformCel === clip.transformCel) return cached.promise;
  const promise = Promise.all([
    decodeImage(clip.cel),
    Promise.all((clip.transformCel || []).map(record => decodeImage(record.sourceDataUrl))),
  ]).then(([image, transformSources]) => ({ image, transformSources }));
  clipImageCache.set(clip, { cel: clip.cel, transformCel: clip.transformCel, promise });
  return promise;
}

/** Loads, for every track, the clip under the playhead into the live canvases. */
async function syncClipsToPlayhead({ save = true } = {}) {
  if (save && !loadingFrame) saveActiveFrame();
  const tick = timeline.playhead;
  const changes = [];
  for (const layer of layers) {
    const clip = clipAt(layerTrack(layer), tick)?.clip || null;
    if (loadedClips.has(layer.id) && loadedClips.get(layer.id) === (clip?.id || null)) continue;
    changes.push({ layer, clip });
  }
  const vectorClip = clipAt(vectorTrack(), tick)?.clip || null;
  const vectorChanged = !loadedClips.has(VECTOR_TRACK) || loadedClips.get(VECTOR_TRACK) !== (vectorClip?.id || null);
  if (!changes.length && !vectorChanged) {
    render();
    return;
  }
  groupedTransformUndo = null;
  groupedTransformRedo = null;
  const token = ++frameLoadToken;
  loadingFrame = true;
  const decoded = await Promise.all(changes.map(change => decodeClip(change.clip)));
  if (token !== frameLoadToken) return;
  changes.forEach(({ layer, clip }, index) => {
    const context = layer.canvas.getContext('2d');
    context.clearRect(0, 0, W, H);
    if (decoded[index].image) context.drawImage(decoded[index].image, 0, 0, W, H);
    layer.transformRecords = cloneRasterTransformRecords(clip?.transformCel || []).map((record, recordIndex) => ({
      ...record,
      sourceCanvas: decoded[index].transformSources[recordIndex] || null,
    })).filter(record => record.sourceCanvas);
    refreshLayerPresentation(layer);
    // Pixel undo snapshots belong to the previous clip; never replay them here.
    layer.undo = [];
    layer.redo = [];
    loadedClips.set(layer.id, clip?.id || null);
  });
  if (vectorChanged) {
    vectorStrokes.splice(0, vectorStrokes.length, ...(vectorClip?.strokes || []).map(cloneLineStroke));
    loadedClips.set(VECTOR_TRACK, vectorClip?.id || null);
    lineUndo.length = 0;
    lineRedo.length = 0;
    selectedStrokeId = null;
    selectedStrokeIds.clear();
  }
  loadingFrame = false;
  render(changes.map(change => layers.indexOf(change.layer)));
}

function vectorOnionSkin(opacity = 0.22) {
  const track = vectorTrack();
  const found = clipAt(track, timeline.playhead);
  if (!found) return [];
  const result = [];
  const previous = track.clips[found.index - 1];
  const next = track.clips[found.index + 1];
  if (previous?.strokes?.length) result.push({ side: 'previous', tint: 0x55aaff, alpha: opacity, strokes: previous.strokes });
  if (next?.strokes?.length) result.push({ side: 'next', tint: 0xff6b8a, alpha: opacity, strokes: next.strokes });
  return result;
}

function timelineTickWidth() {
  return window.innerWidth <= 820 ? 30 : 40;
}

const TRACK_LABEL_WIDTH = 86;

function timelineRows() {
  // Vector lines are drawn above every raster layer, so their track is first;
  // raster tracks follow top layer first, like the layers panel.
  return [{ trackId: VECTOR_TRACK, track: vectorTrack(), layerIndex: -1 }]
    .concat(layers.map((layer, index) => ({ trackId: layer.id, track: layerTrack(layer), layerIndex: index })).reverse());
}

function drawTimeline() {
  const strip = document.getElementById('frameStrip');
  if (!strip) return;
  const tickWidth = timelineTickWidth();
  const ticks = timelineLength(timeline);
  const grid = document.createElement('div');
  grid.className = 'lane';
  grid.style.width = (TRACK_LABEL_WIDTH + (ticks + 3) * tickWidth) + 'px';
  grid.style.setProperty('--tick', tickWidth + 'px');
  grid.style.setProperty('--label', TRACK_LABEL_WIDTH + 'px');

  const ruler = document.createElement('div');
  ruler.className = 'tick-ruler';
  const corner = document.createElement('span');
  corner.className = 'ruler-corner';
  ruler.append(corner);
  for (let tick = 0; tick < ticks + 3; tick++) {
    const mark = document.createElement('span');
    mark.className = 'tick-mark' + (tick % 4 === 0 ? ' major' : '') + (tick >= ticks ? ' beyond' : '');
    mark.style.left = (TRACK_LABEL_WIDTH + tick * tickWidth) + 'px';
    if (tick % 4 === 0) mark.textContent = String(tick + 1);
    ruler.append(mark);
  }
  grid.append(ruler);

  const currentId = currentTrackId();
  let activeCell = null;
  for (const { trackId, track, layerIndex } of timelineRows()) {
    const row = document.createElement('div');
    row.className = 'track-row' + (trackId === currentId ? ' active' : '');
    row.dataset.trackId = trackId;
    const label = document.createElement('button');
    label.className = 'track-name';
    label.textContent = trackLabel(trackId);
    label.title = trackLabel(trackId) + ' 트랙 선택';
    label.onclick = () => selectTrack(trackId);
    row.append(label);
    let cursor = 0;
    track.clips.forEach((clip, index) => {
      const hold = normalizeHold(clip.hold);
      const cell = document.createElement('div');
      const isCurrent = trackId === currentId && timeline.playhead >= cursor && timeline.playhead < cursor + hold;
      const empty = trackId === VECTOR_TRACK ? !clip.strokes?.length : !clip.cel;
      cell.className = 'frame-cell' + (isCurrent ? ' active' : '') + (empty && !clipThumbnails.has(clip.id) ? ' empty' : '');
      cell.dataset.clipId = clip.id;
      cell.style.left = (TRACK_LABEL_WIDTH + cursor * tickWidth) + 'px';
      cell.style.width = (hold * tickWidth - 3) + 'px';
      const text = document.createElement('span');
      text.textContent = hold > 1 ? `${index + 1} · ${hold}` : String(index + 1);
      cell.append(text);
      cell.title = `${trackLabel(trackId)} · 그림 ${index + 1} · ${hold}프레임`;
      applyClipThumbnail(cell, clip.id);
      if (isCurrent) {
        const grip = document.createElement('span');
        grip.className = 'hold-grip';
        grip.title = '끌어서 그림 길이 조절';
        cell.append(grip);
        activeCell = cell;
      }
      row.append(cell);
      cursor += hold;
    });
    if (layerIndex === active) {
      for (const keyframe of layers[active]?.motionTrack || []) {
        const diamond = document.createElement('i');
        diamond.className = 'key-diamond';
        diamond.title = `움직임 키프레임 · 프레임 ${keyframe.tick + 1}`;
        diamond.style.left = (TRACK_LABEL_WIDTH + (keyframe.tick + 0.5) * tickWidth) + 'px';
        row.append(diamond);
      }
    }
    grid.append(row);
  }

  const playhead = document.createElement('div');
  playhead.className = 'playhead';
  grid.append(playhead);
  strip.replaceChildren(grid);
  positionPlayhead();

  const activeKey = `${currentId}:${activeCell?.dataset.clipId}`;
  if (activeCell && strip.dataset.activeKey !== activeKey) {
    strip.dataset.activeKey = activeKey;
    activeCell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  const holdOut = document.getElementById('holdOut');
  const found = clipAt(currentTrack(), timeline.playhead);
  if (holdOut) holdOut.textContent = found ? normalizeHold(found.clip.hold) + '프레임' : '—';
}

function selectTrack(trackId) {
  activeTrackId = trackId === VECTOR_TRACK ? VECTOR_TRACK : null;
  const index = layers.findIndex(layer => layer.id === trackId);
  if (index >= 0) active = index;
  render();
}

function positionPlayhead() {
  const tick = playbackActive && playbackTickPosition !== null ? playbackTickPosition : timeline.playhead;
  const playhead = document.querySelector('#frameStrip .playhead');
  if (playhead) playhead.style.left = (TRACK_LABEL_WIDTH + (Math.floor(tick) + 0.5) * timelineTickWidth()) + 'px';
  const label = document.getElementById('frameCounter');
  if (label) label.textContent = `${Math.floor(tick) + 1} / ${timelineLength(timeline)}`;
}

function seekToTick(tick) {
  if (playbackActive) setPlaybackEnabled(false);
  if (loadingFrame) return;
  // Allow one tick past the end so a new drawing can be started there.
  timeline.playhead = Math.max(0, Math.min(timelineLength(timeline), Math.floor(tick)));
  syncClipsToPlayhead();
}

function changeActiveHold(hold) {
  const found = clipAt(currentTrack(), timeline.playhead);
  if (!found) return;
  if (playbackActive) setPlaybackEnabled(false);
  saveActiveFrame();
  setClipHold(currentTrack(), found.clip.id, hold);
  // Keep the playhead on the clip that was resized.
  timeline.playhead = Math.min(timeline.playhead, found.start + normalizeHold(hold) - 1);
  syncClipsToPlayhead({ save: false });
}

function setPlaybackEnabled(enabled) {
  if (enabled && loadingFrame) return;
  playbackActive = enabled;
  const button = document.getElementById('playToggle');
  button.querySelector('use')?.setAttribute('href', enabled ? '#i-pause' : '#i-play');
  button.setAttribute('aria-label', enabled ? '일시정지' : '재생');
  button.title = enabled ? '일시정지' : '재생';
  button.classList.toggle('active', enabled);

  if (enabled) {
    saveActiveFrame();
    playbackStartTick = timeline.playhead;
    playbackTickPosition = timeline.playhead;
    playbackStartedAt = performance.now();
    if (!playbackRaf) playbackRaf = requestAnimationFrame(playbackTick);
  } else {
    if (playbackRaf) cancelAnimationFrame(playbackRaf);
    playbackRaf = 0;
    playbackTickPosition = null;
    if (!loadingFrame) saveActiveFrame();
    render();
  }
}

function playbackTick(timestamp) {
  if (!playbackActive) {
    playbackRaf = 0;
    return;
  }
  const total = timelineLength(timeline);
  const position = (playbackStartTick + Math.max(0, timestamp - playbackStartedAt) * timeline.fps / 1000) % total;
  playbackTickPosition = position;
  const tick = Math.floor(position);
  if (tick !== timeline.playhead && !loadingFrame) {
    timeline.playhead = tick;
    // Nothing is edited during playback, so clips are not re-saved per tick.
    syncClipsToPlayhead({ save: false });
  } else if (layers.some(layer => layer.motionTrack?.length)) {
    applyGroupState();
    renderer.updateLayerTransforms(layers);
  }
  positionPlayhead();
  playbackRaf = requestAnimationFrame(playbackTick);
}

function updateTimelineFPS(value) {
  if (playbackActive && playbackTickPosition !== null) {
    playbackStartTick = playbackTickPosition;
    playbackStartedAt = performance.now();
  }
  const fps = Math.max(1, Math.min(60, Number(value) || 12));
  timeline.fps = fps;
  document.getElementById('fpsOut').value = fps + ' FPS';
}

const viewport = { scale: 1, rotation: 0, x: 0, y: 0 };
let panDrag = null;
let shapeKind = 'rectangle';

function applyViewport() {
  if (!inputSurface) return;
  inputSurface.style.transform = `translate(${viewport.x}px, ${viewport.y}px) rotate(${viewport.rotation}deg) scale(${viewport.scale})`;
  document.getElementById('zoomLevel').textContent = Math.round(viewport.scale * 100) + '%';
  // Node handles are sized in screen pixels, so redraw them when the zoom changes.
  if (tool === 'select' && nodeEditEnabled && selectedStrokeId && !playbackActive) render();
}

// Raster painting tools draw into the active layer's own pixel space, so when
// that layer is moved by keyframes the pointer is mapped through the inverse
// movement transform.
// Converts an on-screen size (CSS px) to canvas units at the current zoom, so
// vector node handles and their hit targets keep a constant physical size.
function cssToCanvasUnits(cssPixels) {
  return cssPixels * canvasUnitsPerCssPixel(inputSurface?.clientWidth, W, viewport.scale);
}

function paintsInLayerSpace() {
  return ['pen', 'eraser', 'smudge'].includes(tool) && Boolean(layers[active]?.renderMatrix);
}

function position(event) {
  const point = stagePosition(event);
  return paintsInLayerSpace() ? applyMatrix(invertMatrix(layers[active].renderMatrix), point) : point;
}

function stagePosition(event) {
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
  if (layers[active]?.renderMatrix) {
    showToast('움직임이 적용된 레이어에는 아직 채우기를 쓸 수 없어요');
    return;
  }
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
  ensureEditableClip('raster');
  const layer = layers[active];
  const selection = selectionOutlinePolygon();
  const settings = {
    pattern: document.getElementById('tonePattern').value,
    spacing: Number(document.getElementById('toneSpacing').value),
    coverage: Number(document.getElementById('toneCoverage').value),
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
    ['toneCoverage', 'toneCoverageOut', value => value + '%'],
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
    // Topmost layer first, like a stack seen from above.
    for (let index = layers.length - 1; index >= 0; index--) {
      if (layers[index].groupId === group.id) appendLayerRow(list, layers[index], index, true);
    }
  });
  for (let index = layers.length - 1; index >= 0; index--) {
    if (!layers[index].groupId) appendLayerRow(list, layers[index], index, false);
  }
}

// Swaps a layer with its nearest neighbour in the same group (or among
// ungrouped layers). Animation drawings follow automatically because tracks
// are keyed by layer id, not by stack position.
function neighbourLayerIndex(index, direction) {
  const groupId = layers[index]?.groupId || null;
  for (let target = index + direction; target >= 0 && target < layers.length; target += direction) {
    if ((layers[target].groupId || null) === groupId) return target;
  }
  return -1;
}

function moveLayer(index, direction) {
  const target = neighbourLayerIndex(index, direction);
  if (target < 0) return;
  if (playbackActive) setPlaybackEnabled(false);
  [layers[index], layers[target]] = [layers[target], layers[index]];
  if (active === index) active = target;
  else if (active === target) active = index;
  render(layers.map((_, layerIndex) => layerIndex));
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

    const thumbnail = document.createElement('canvas');
    thumbnail.className = 'layer-thumbnail';
    thumbnail.width = 48;
    thumbnail.height = 36;
    thumbnail.setAttribute('aria-hidden', 'true');
    const thumbnailContext = thumbnail.getContext('2d');
    thumbnailContext.fillStyle = '#f4f0e8';
    thumbnailContext.fillRect(0, 0, 48, 36);
    thumbnailContext.drawImage(layer.presentationCanvas || layer.canvas, 0, 0, 48, 36);

    const name = document.createElement('span');
    name.className = 'layer-name';
    name.textContent = layer.name + (layer.maskEnabled ? ' · MASK' : '');

    const order = document.createElement('span');
    order.className = 'layer-order';
    const makeOrderButton = (label, title, direction) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.title = title;
      button.setAttribute('aria-label', `${layer.name} ${title}`);
      button.disabled = neighbourLayerIndex(index, direction) < 0;
      button.onclick = event => { event.stopPropagation(); moveLayer(index, direction); };
      return button;
    };
    // The list shows the top layer first, so "up" means a higher stack index.
    order.append(makeOrderButton('↑', '위로 이동', 1), makeOrderButton('↓', '아래로 이동', -1));
    item.append(visibility, target, thumbnail, name, order);
    item.onclick = event => {
      if (event.target !== visibility && event.target !== target) {
        active = index;
        activeTrackId = null;
        activeGroupId = layer.groupId || null;
        maskEditing = false;
        document.getElementById('maskEdit')?.classList.remove('active');
        document.getElementById('maskState').textContent = '일반 그림 편집 중';
        updateLayerInspector();
        drawLayers();
        drawTimeline();
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
    const displayStrokes = boiledStrokes(timestamp);
    renderer.sync(layers, [], displayStrokes, selectedStrokeId, onionEnabled ? vectorOnionSkin() : [], selectionRect, selectionPolygon, selectedNodeIndex, nodeEditEnabled, null, null, showSelectedVectorHighlight, selectedStrokeIds);
    lastAnimationPaint = timestamp;
  }
  animationFrame = requestAnimationFrame(animationTick);
}

function setBoilEnabled(enabled) {
  boilEnabled = enabled;
  const button = document.getElementById('boilToggle');
  button.textContent = enabled ? '선 흔들림 끄기' : '선 흔들림 켜기';
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

function drawPressureProfileEditor(profile = null) {
  const canvas = document.getElementById('vectorPressureProfile');
  if (!canvas) return;
  const context = canvas.getContext('2d');
  const width = canvas.width, height = canvas.height, pad = 14;
  const values = Array.isArray(profile) && profile.length ? profile : [1, 1, 1, 1, 1];
  const xAt = index => pad + (width - pad * 2) * index / 4;
  const yAt = value => pad + (height - pad * 2) * (1 - (value - 0.1) / 2.1);
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#202126';
  context.fillRect(0, 0, width, height);
  context.strokeStyle = '#ffffff18';
  context.lineWidth = 1;
  for (const value of [0.5, 1, 1.5, 2]) {
    context.beginPath(); context.moveTo(pad, yAt(value)); context.lineTo(width - pad, yAt(value)); context.stroke();
  }
  context.strokeStyle = '#7e9fc9';
  context.lineWidth = 2.5;
  context.beginPath();
  values.forEach((value, index) => {
    if (index === 0) context.moveTo(xAt(index), yAt(value));
    else context.lineTo(xAt(index), yAt(value));
  });
  context.stroke();
  values.forEach((value, index) => {
    context.beginPath(); context.arc(xAt(index), yAt(value), 4.5, 0, Math.PI * 2);
    context.fillStyle = '#e6c27a'; context.fill();
    context.strokeStyle = '#202126'; context.lineWidth = 1.5; context.stroke();
  });
}

function updateLineInspector() {
  const stroke = inspectorStroke();
  const panel = document.getElementById('lineTools');
  panel.hidden = !stroke;
  if (!stroke) {
    selectedNodeIndex = null;
    return;
  }
  const selectedCount = selectedStrokeIds.size || 1;
  vectorBrushPreset = stroke.brushPreset || 'ink';
  vectorBrushOpacity = stroke.opacity ?? getVectorBrushPreset(vectorBrushPreset).opacity;
  vectorPressureCurve = stroke.pressureCurve || 1;
  vectorPressureProfile = normalizeStrokeWidthProfile(stroke.pressureProfile);
  vectorMotionStyle = stroke.motionStyle || 'none';
  vectorMotionStrength = stroke.motionStrength ?? 3;
  const lineColor = document.getElementById('lineColor');
  const lineWidth = document.getElementById('lineWidth');
  if (document.activeElement !== lineColor) lineColor.value = stroke.color;
  if (document.activeElement !== lineWidth) lineWidth.value = stroke.width;
  if (document.activeElement !== document.getElementById('vectorBrushPreset')) document.getElementById('vectorBrushPreset').value = stroke.brushPreset || 'ink';
  if (document.activeElement !== document.getElementById('vectorBrushOpacity')) document.getElementById('vectorBrushOpacity').value = Math.round((stroke.opacity ?? 1) * 100);
  document.getElementById('vectorBrushOpacityOut').value = Math.round((stroke.opacity ?? 1) * 100) + '%';
  if (document.activeElement !== document.getElementById('vectorPressureCurve')) document.getElementById('vectorPressureCurve').value = Math.round((stroke.pressureCurve || 1) * 100);
  document.getElementById('vectorPressureCurveOut').value = (stroke.pressureCurve || 1).toFixed(2);
  drawPressureProfileEditor(stroke.pressureProfile);
  if (document.activeElement !== document.getElementById('vectorMotionStyle')) document.getElementById('vectorMotionStyle').value = stroke.motionStyle || 'none';
  if (document.activeElement !== document.getElementById('vectorMotionStrength')) document.getElementById('vectorMotionStrength').value = stroke.motionStrength ?? 3;
  document.getElementById('vectorMotionStrengthOut').value = (stroke.motionStrength ?? 3) + 'px';
  if (document.activeElement !== lineWidth) lineWidth.value = stroke.width;
  document.getElementById('lineWidthOut').value = stroke.width + 'px';
  const nodeStatus = document.getElementById('lineNodeStatus');
  if (nodeStatus) {
    nodeStatus.textContent = stroke.bezierPath
      ? `${stroke.bezierPath.anchors.length}개 앵커 · ${stroke.bezierPath.segments.length * 2}개 핸들`
      : `${stroke.points.length}개 노드${selectedNodeIndex === null ? '' : ` · ${selectedNodeIndex + 1}번 선택`}`;
    if (selectedCount > 1) nodeStatus.textContent += ` · ${selectedCount}개 선택, 스타일 일괄 적용`;
  }
  const nodeEditToggle = document.getElementById('nodeEditToggle');
  const smoothButton = document.getElementById('smoothLine');
  if (nodeEditToggle) {
    nodeEditToggle.disabled = selectedCount > 1;
    if (selectedCount > 1) {
      nodeEditToggle.checked = false;
      nodeEditEnabled = false;
    }
  }
  if (smoothButton) smoothButton.disabled = selectedCount > 1;
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
  if (removeNode) removeNode.disabled = selectedCount > 1 || Boolean(stroke.bezierPath) || selectedNodeIndex === null || selectedNodeIndex <= 0 || selectedNodeIndex >= stroke.points.length - 1;
}

function applySelectedStyle(changes, recordHistory = true) {
  const ids = selectedStrokeIds.size ? selectedStrokeIds : new Set(selectedStrokeId ? [selectedStrokeId] : []);
  if (!ids.size) return;
  if (recordHistory) commitLineHistory(lineSnapshot());
  for (let index = 0; index < vectorStrokes.length; index++) {
    if (ids.has(vectorStrokes[index].id)) vectorStrokes[index] = updateLineStrokeStyle(vectorStrokes[index], changes);
  }
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
  document.getElementById('vectorBrushPreset').onchange = event => { vectorBrushPreset = event.target.value; if (selectedStrokeIds.size || selectedStrokeId) applySelectedStyle({ brushPreset: vectorBrushPreset, opacity: vectorBrushOpacity }); };
  document.getElementById('shapeKind').onchange = event => { shapeKind = event.target.value; };
  const pressureCurveInput = document.getElementById('vectorPressureCurve');
  pressureCurveInput.addEventListener('pointerdown', beginLineStyleEdit);
  pressureCurveInput.addEventListener('pointerup', finishLineStyleEdit);
  pressureCurveInput.addEventListener('pointercancel', finishLineStyleEdit);
  pressureCurveInput.addEventListener('change', finishLineStyleEdit);
  pressureCurveInput.oninput = event => { vectorPressureCurve = Number(event.target.value) / 100; document.getElementById('vectorPressureCurveOut').value = vectorPressureCurve.toFixed(2); if (selectedStrokeIds.size || selectedStrokeId) { beginLineStyleEdit(); applySelectedStyle({ pressureCurve: vectorPressureCurve }, false); } };
  const profileCanvas = document.getElementById('vectorPressureProfile');
  const updateProfileFromPointer = event => {
    const rect = profileCanvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * (profileCanvas.width / rect.width);
    const y = (event.clientY - rect.top) * (profileCanvas.height / rect.height);
    const pad = 14;
    const progress = Math.max(0, Math.min(1, (x - pad) / (profileCanvas.width - pad * 2)));
    const value = Math.max(0.1, Math.min(2.2, 2.2 - ((y - pad) / (profileCanvas.height - pad * 2)) * 2.1));
    const profile = normalizeStrokeWidthProfile(inspectorStroke()?.pressureProfile || vectorPressureProfile);
    const index = Math.max(0, Math.min(4, Math.round(progress * 4)));
    profile[index] = value;
    vectorPressureProfile = profile;
    applySelectedStyle({ pressureProfile: profile }, false);
  };
  profileCanvas.addEventListener('pointerdown', event => {
    if (!inspectorStroke()) return;
    beginLineStyleEdit();
    pressureProfileDrag = true;
    profileCanvas.setPointerCapture(event.pointerId);
    updateProfileFromPointer(event);
  });
  profileCanvas.addEventListener('pointermove', event => { if (pressureProfileDrag) updateProfileFromPointer(event); });
  const finishProfileDrag = () => { pressureProfileDrag = false; finishLineStyleEdit(); };
  profileCanvas.addEventListener('pointerup', finishProfileDrag);
  profileCanvas.addEventListener('pointercancel', finishProfileDrag);
  document.getElementById('vectorMotionStyle').onchange = event => { vectorMotionStyle = event.target.value; if (selectedStrokeIds.size || selectedStrokeId) applySelectedStyle({ motionStyle: vectorMotionStyle }); };
  const opacityInput = document.getElementById('vectorBrushOpacity');
  opacityInput.addEventListener('pointerdown', beginLineStyleEdit);
  opacityInput.addEventListener('pointerup', finishLineStyleEdit);
  opacityInput.addEventListener('pointercancel', finishLineStyleEdit);
  opacityInput.addEventListener('change', finishLineStyleEdit);
  opacityInput.oninput = event => { vectorBrushOpacity = Number(event.target.value) / 100; document.getElementById('vectorBrushOpacityOut').value = event.target.value + '%'; if (selectedStrokeIds.size || selectedStrokeId) { beginLineStyleEdit(); applySelectedStyle({ opacity: vectorBrushOpacity }, false); } };
  const motionStrengthInput = document.getElementById('vectorMotionStrength');
  motionStrengthInput.addEventListener('pointerdown', beginLineStyleEdit);
  motionStrengthInput.addEventListener('pointerup', finishLineStyleEdit);
  motionStrengthInput.addEventListener('pointercancel', finishLineStyleEdit);
  motionStrengthInput.addEventListener('change', finishLineStyleEdit);
  motionStrengthInput.oninput = event => { vectorMotionStrength = Number(event.target.value); document.getElementById('vectorMotionStrengthOut').value = vectorMotionStrength + 'px'; if (selectedStrokeIds.size || selectedStrokeId) { beginLineStyleEdit(); applySelectedStyle({ motionStrength: vectorMotionStrength }, false); } };
  document.getElementById('selectedOutlineToggle').onchange = event => { showSelectedVectorHighlight = event.target.checked; render(); };
  ['toneSpacing', 'toneCoverage', 'toneAngle', 'toneOpacity'].forEach(id => {
    document.getElementById(id).oninput = updateToneControls;
  });
  document.getElementById('tonePattern').onchange = updateToneControls;

  document.querySelectorAll('[data-tool]').forEach(button => {
    button.addEventListener('click', () => {
      const wasActive = button.classList.contains('active');
      if (!wasActive || button.dataset.tool !== tool) setTool(button.dataset.tool);
      else if (button.dataset.popover) togglePopover(button.dataset.popover, button);
    });
  });

  document.getElementById('selectionDeselect').onclick = () => {
    if (selectionDrag) clearSelectionDragPreviews(selectionDrag);
    selectionRect = null;
    selectionPolygon = null;
    selectedStrokeIds.clear();
    selectedStrokeId = null;
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
    copy.motionTrack = (source.motionTrack || []).map(keyframe => ({ ...keyframe }));
    // The copy gets its own track with the same drawings and timing.
    saveActiveFrame();
    const copyTrack = duplicateTrack(timeline, layerTrack(source), copy.id);
    const copyClip = clipAt(copyTrack, timeline.playhead)?.clip;
    if (copyClip) loadedClips.set(copy.id, copyClip.id);
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
    const [removed] = layers.splice(active, 1);
    delete timeline.tracks[removed.id];
    loadedClips.delete(removed.id);
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
    if (motionEditing) { restoreMotion(motionUndo, motionRedo); return; }
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
    if (motionEditing) { restoreMotion(motionRedo, motionUndo); return; }
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
  document.getElementById('brushBlendMode').onchange = event => {
    brushBlendMode = normalizeBrushBlendMode(event.target.value);
  };
  document.getElementById('smudgeStrength').oninput = event => {
    smudgeStrength = Number(event.target.value) / 100;
    document.getElementById('smudgeStrengthOut').value = event.target.value + '%';
  };
  document.getElementById('smudgeSpacing').oninput = event => {
    smudgeSpacing = Number(event.target.value) / 100;
    document.getElementById('smudgeSpacingOut').value = event.target.value + '%';
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

  // Drawing buttons act on the selected track only; other tracks keep their timing.
  const insertDrawing = duplicate => {
    if (playbackActive) setPlaybackEnabled(false);
    if (loadingFrame) return;
    saveActiveFrame();
    const track = currentTrack();
    const source = clipAt(track, timeline.playhead)?.clip;
    const { clip, start } = insertClipAfter(timeline, track, timeline.playhead, {
      duplicate,
      blank: track.id === VECTOR_TRACK ? { strokes: [] } : {},
    });
    if (duplicate && source && clipThumbnails.has(source.id)) clipThumbnails.set(clip.id, clipThumbnails.get(source.id));
    timeline.playhead = start;
    syncClipsToPlayhead({ save: false });
  };
  document.getElementById('frameAdd').onclick = () => insertDrawing(false);
  document.getElementById('frameDuplicate').onclick = () => insertDrawing(true);
  document.getElementById('frameDelete').onclick = () => {
    if (playbackActive) setPlaybackEnabled(false);
    if (loadingFrame) return;
    const track = currentTrack();
    const found = clipAt(track, timeline.playhead);
    if (!found) return;
    saveActiveFrame();
    const clipsBefore = track.clips.slice();
    const playheadBefore = timeline.playhead;
    if (!deleteClip(track, found.clip.id)) {
      showToast('트랙에는 그림이 하나 이상 있어야 해요');
      return;
    }
    timeline.playhead = Math.min(found.start, timelineLength(timeline) - 1);
    syncClipsToPlayhead({ save: false });
    showToast('그림을 삭제했어요', {
      label: '되돌리기',
      run: () => {
        if (playbackActive) setPlaybackEnabled(false);
        saveActiveFrame();
        track.clips = clipsBefore;
        timeline.playhead = playheadBefore;
        syncClipsToPlayhead({ save: false });
      },
    });
  };
  document.getElementById('onionToggle').onclick = event => {
    onionEnabled = !onionEnabled;
    event.currentTarget.classList.toggle('active', onionEnabled);
    event.currentTarget.querySelector('span').textContent = onionEnabled ? '어니언 ON' : '어니언 OFF';
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
  document.getElementById('lineColor').onchange = event => applySelectedStyle({ color: event.target.value });
  const lineWidthInput = document.getElementById('lineWidth');
  lineWidthInput.addEventListener('pointerdown', beginLineStyleEdit);
  lineWidthInput.addEventListener('pointerup', finishLineStyleEdit);
  lineWidthInput.addEventListener('pointercancel', finishLineStyleEdit);
  lineWidthInput.addEventListener('change', finishLineStyleEdit);
  lineWidthInput.oninput = event => {
    document.getElementById('lineWidthOut').value = event.target.value + 'px';
    beginLineStyleEdit();
    applySelectedStyle({ width: Number(event.target.value) }, false);
  };
  document.getElementById('deleteLine').onclick = () => {
    const ids = selectedStrokeIds.size ? new Set(selectedStrokeIds) : new Set(selectedStrokeId ? [selectedStrokeId] : []);
    if (!ids.size) return;
    commitLineHistory(lineSnapshot());
    for (let index = vectorStrokes.length - 1; index >= 0; index--) {
      if (ids.has(vectorStrokes[index].id)) vectorStrokes.splice(index, 1);
    }
    selectedStrokeId = null;
    selectedStrokeIds.clear();
    selectedNodeIndex = null;
    selectedBezierAnchor = null;
    selectedBezierHandle = null;
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

// ───────────────────────── Workspace UI (top bar, popovers, sidebar) ─────────────────────────

const TOOL_HOST_BUTTONS = { pen: 'paintTool', vector: 'paintTool', marquee: 'selectTool', lasso: 'selectTool', line: 'shapeTool', shape: 'shapeTool' };
const TOOL_LABELS = { vector: '벡터 브러시', pen: '래스터 브러시', smudge: '스머지', eraser: '지우개', marquee: '사각형 선택', lasso: '올가미 선택', select: '벡터 변형', fill: '채우기', line: '직선', shape: '도형', hand: '손 도구' };
let openPopoverId = null;
let eyedropperArmed = false;
let toastTimer = 0;

function showToast(message, action = null) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.hidden = true;
  toast.textContent = message;
  toast.classList.toggle('has-action', Boolean(action));
  if (action) {
    const button = document.createElement('button');
    button.textContent = action.label;
    button.onclick = () => {
      toast.hidden = true;
      action.run();
    };
    toast.append(button);
  }
  // Restart the CSS animation on every toast.
  void toast.offsetWidth;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, action ? 5000 : 950);
}

function closePopovers() {
  document.querySelectorAll('.popover').forEach(popover => { popover.hidden = true; });
  document.querySelectorAll('[data-popover]').forEach(button => button.classList.remove('open'));
  openPopoverId = null;
}

function togglePopover(id, anchor) {
  const wasOpen = openPopoverId === id;
  closePopovers();
  if (wasOpen) return;
  const popover = document.getElementById(id);
  if (!popover) return;
  popover.hidden = false;
  anchor?.classList.add('open');
  openPopoverId = id;
  if (id === 'colorPopover') drawSvPicker();
  if (id === 'brushPopover') syncBrushUi();
}

function setTool(name) {
  if (boilEnabled) setBoilEnabled(false);
  tool = name;
  if (maskEditing && tool !== 'pen' && tool !== 'eraser' && tool !== 'smudge') {
    maskEditing = false;
    document.getElementById('maskEdit').classList.remove('active');
    document.getElementById('maskState').textContent = '일반 그림 편집 중';
  }
  if (tool === 'vector' || tool === 'pen') {
    // Leaving the transform tool: drop the vector selection so brush and color
    // changes apply to the next stroke instead of an old line.
    selectedStrokeId = null;
    selectedStrokeIds.clear();
  }
  setEyedropperArmed(false);
  if (motionEditing) setMotionEditing(false);
  const hostId = TOOL_HOST_BUTTONS[name];
  if (hostId) document.getElementById(hostId).dataset.tool = name;
  document.querySelectorAll('.topbar [data-tool]').forEach(item => {
    item.classList.toggle('active', item.dataset.tool === name);
  });
  document.querySelectorAll('[data-set-tool]').forEach(item => {
    item.classList.toggle('active', item.dataset.setTool === name);
  });
  syncBrushUi();
  renderer.clearPreview();
  render();
}

function paintMode() {
  return document.getElementById('paintTool')?.dataset.tool === 'pen' ? 'raster' : 'vector';
}

function syncBrushUi() {
  const mode = paintMode();
  const brushPopover = document.getElementById('brushPopover');
  if (brushPopover) brushPopover.dataset.mode = mode;
  document.querySelectorAll('#brushPopover .brush-card').forEach(card => {
    const current = card.dataset.brushKind === 'vector' ? vectorBrushPreset : brushPreset;
    card.classList.toggle('active', card.dataset.brushKind === mode && card.dataset.brush === current);
  });
  document.querySelectorAll('#eraserPopover .brush-card').forEach(card => {
    card.classList.toggle('active', card.dataset.brush === brushPreset);
  });
  const sideOpacity = document.getElementById('sideOpacity');
  if (sideOpacity) {
    const value = Math.round((sidebarOpacityTarget() === 'vector' ? vectorBrushOpacity : brushOpacity) * 100);
    sideOpacity.value = String(value);
    document.getElementById('sideOpacityOut').textContent = value + '%';
  }
}

function sidebarOpacityTarget() {
  if (tool === 'vector' || tool === 'line' || tool === 'shape' || tool === 'select') return 'vector';
  if (tool === 'pen') return 'raster';
  return paintMode();
}

function setEyedropperArmed(armed) {
  eyedropperArmed = armed;
  document.getElementById('eyedropper')?.classList.toggle('active', armed);
  document.querySelector('.stage')?.classList.toggle('picking', armed);
}

function pickColorAt(point) {
  const radius = 2;
  const x0 = Math.max(0, Math.round(point.x) - radius);
  const y0 = Math.max(0, Math.round(point.y) - radius);
  const width = Math.min(W, Math.round(point.x) + radius + 1) - x0;
  const height = Math.min(H, Math.round(point.y) + radius + 1) - y0;
  if (width <= 0 || height <= 0) return false;
  const image = composite().getImageData(x0, y0, width, height);
  const picked = sampleImageDataColor(image.data, width, height, Math.round(point.x) - x0, Math.round(point.y) - y0, { radius });
  if (!picked) return false;
  setCurrentColor(picked, { applyToSelectedLine: false });
  showToast('색상 ' + picked.toUpperCase());
  return true;
}

// HSV picker state is kept separately from the hex color so hue survives when
// saturation or value reaches zero.
const hsvState = { h: 0, s: 0, v: 0 };

function syncHsvPicker() {
  if (hsvToHex(hsvState.h, hsvState.s, hsvState.v) !== color) {
    const next = hexToHsv(color);
    if (next.s > 0 && next.v > 0) hsvState.h = next.h;
    hsvState.s = next.s;
    hsvState.v = next.v;
  }
  const hue = document.getElementById('colorHue');
  if (hue) hue.value = String(Math.round(hsvState.h) % 360);
  drawSvPicker();
}

function drawSvPicker() {
  const canvas = document.getElementById('colorSV');
  if (!canvas || !canvas.clientWidth) return;
  const ratio = window.devicePixelRatio || 1;
  const width = Math.round(canvas.clientWidth * ratio);
  const height = Math.round(canvas.clientHeight * ratio);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext('2d');
  context.fillStyle = hsvToHex(hsvState.h, 1, 1);
  context.fillRect(0, 0, width, height);
  const white = context.createLinearGradient(0, 0, width, 0);
  white.addColorStop(0, '#fff');
  white.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = white;
  context.fillRect(0, 0, width, height);
  const black = context.createLinearGradient(0, 0, 0, height);
  black.addColorStop(0, 'rgba(0,0,0,0)');
  black.addColorStop(1, '#000');
  context.fillStyle = black;
  context.fillRect(0, 0, width, height);
  const x = hsvState.s * width;
  const y = (1 - hsvState.v) * height;
  context.lineWidth = 3 * ratio;
  context.strokeStyle = '#fff';
  context.beginPath();
  context.arc(x, y, 9 * ratio, 0, Math.PI * 2);
  context.stroke();
  context.lineWidth = 1 * ratio;
  context.strokeStyle = 'rgba(0,0,0,.55)';
  context.beginPath();
  context.arc(x, y, 11 * ratio, 0, Math.PI * 2);
  context.stroke();
}

function bindHsvPicker() {
  const canvas = document.getElementById('colorSV');
  const hue = document.getElementById('colorHue');
  let dragging = false;
  const update = (event, remember) => {
    const rect = canvas.getBoundingClientRect();
    hsvState.s = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    hsvState.v = 1 - Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
    setCurrentColor(hsvToHex(hsvState.h, hsvState.s, hsvState.v), { remember });
  };
  canvas.addEventListener('pointerdown', event => {
    dragging = true;
    canvas.setPointerCapture(event.pointerId);
    update(event, false);
  });
  canvas.addEventListener('pointermove', event => { if (dragging) update(event, false); });
  const finish = event => {
    if (!dragging) return;
    dragging = false;
    update(event, true);
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', () => { dragging = false; });
  hue.addEventListener('input', () => {
    hsvState.h = Number(hue.value) || 0;
    setCurrentColor(hsvToHex(hsvState.h, hsvState.s, hsvState.v), { remember: false });
  });
  hue.addEventListener('change', () => setCurrentColor(color, { remember: true }));
}

// Frame thumbnails are generated from the composited active frame after edits
// settle, so they include vector lines (which are not stored in raster cels).
const clipThumbnails = new Map();
let thumbnailTimer = 0;

function scheduleFrameThumbnail() {
  clearTimeout(thumbnailTimer);
  thumbnailTimer = setTimeout(() => {
    if (loadingFrame || playbackActive || down) return;
    const make = draw => {
      const thumbnail = document.createElement('canvas');
      thumbnail.width = 96;
      thumbnail.height = 72;
      const context = thumbnail.getContext('2d');
      context.fillStyle = '#f4f0e8';
      context.fillRect(0, 0, 96, 72);
      context.save();
      context.scale(96 / W, 72 / H);
      draw(context);
      context.restore();
      return thumbnail.toDataURL('image/jpeg', 0.7);
    };
    for (const layer of layers) {
      const clip = loadedClip(layer.id);
      if (clip) clipThumbnails.set(clip.id, make(context => context.drawImage(layer.presentationCanvas || layer.canvas, 0, 0)));
    }
    const vectorClip = loadedClip(VECTOR_TRACK);
    if (vectorClip) clipThumbnails.set(vectorClip.id, make(context => drawVectorStrokes(context)));
    document.querySelectorAll('#frameStrip .frame-cell').forEach(cell => applyClipThumbnail(cell, cell.dataset.clipId));
  }, 380);
}

function applyClipThumbnail(cell, clipId) {
  const source = clipThumbnails.get(clipId);
  cell.classList.toggle('has-thumb', Boolean(source));
  if (source) cell.classList.remove('empty');
  cell.style.backgroundImage = source ? `url("${source}")` : '';
}

function stepFrame(offset) {
  const tick = neighborClipStart(currentTrack(), timeline.playhead, offset);
  if (tick !== null) seekToTick(tick);
}

function bindTimelineScrub() {
  const strip = document.getElementById('frameStrip');
  let scrubbing = false;
  let holdDrag = null;
  const tickFromEvent = event => {
    const lane = strip.querySelector('.lane');
    if (!lane) return 0;
    return Math.floor((event.clientX - lane.getBoundingClientRect().left - TRACK_LABEL_WIDTH) / timelineTickWidth());
  };
  strip.addEventListener('pointerdown', event => {
    const grip = event.target.closest('.hold-grip');
    if (grip) {
      // Drag the active drawing's right edge to change how long it is held.
      event.stopPropagation();
      event.preventDefault();
      const found = clipAt(currentTrack(), timeline.playhead);
      if (!found) return;
      const cell = grip.closest('.frame-cell');
      const hold = normalizeHold(found.clip.hold);
      holdDrag = { pointerId: event.pointerId, startX: event.clientX, startHold: hold, hold, cell, moved: false };
      strip.setPointerCapture(event.pointerId);
      if (playbackActive) setPlaybackEnabled(false);
      return;
    }
    // Fingers scroll the strip natively (a tap still seeks via click); pen and
    // mouse drags scrub the playhead.
    if (event.pointerType === 'touch' || !event.target.closest('.lane') || event.target.closest('.track-name')) return;
    scrubbing = true;
    strip.setPointerCapture(event.pointerId);
    selectRowFromEvent(event);
    seekToTick(tickFromEvent(event));
  });
  strip.addEventListener('pointermove', event => {
    if (holdDrag?.pointerId === event.pointerId) {
      const hold = Math.max(1, holdDrag.startHold + Math.round((event.clientX - holdDrag.startX) / timelineTickWidth()));
      holdDrag.moved = holdDrag.moved || Math.abs(event.clientX - holdDrag.startX) > 3;
      if (hold !== holdDrag.hold) {
        holdDrag.hold = hold;
        holdDrag.cell.style.width = (hold * timelineTickWidth() - 3) + 'px';
        holdDrag.cell.querySelector('span').textContent = hold + '프레임';
      }
      return;
    }
    if (!scrubbing || loadingFrame) return;
    const tick = tickFromEvent(event);
    if (tick !== timeline.playhead) seekToTick(tick);
  });
  const selectRowFromEvent = event => {
    const row = event.target.closest('.track-row');
    if (!row || row.dataset.trackId === currentTrackId()) return false;
    activeTrackId = row.dataset.trackId === VECTOR_TRACK ? VECTOR_TRACK : null;
    const index = layers.findIndex(layer => layer.id === row.dataset.trackId);
    if (index >= 0) active = index;
    return true;
  };
  const stop = event => {
    if (holdDrag?.pointerId === event.pointerId) {
      const drag = holdDrag;
      holdDrag = null;
      // Swallow the click that follows a grip drag.
      strip.dataset.suppressClick = '1';
      setTimeout(() => { delete strip.dataset.suppressClick; }, 0);
      if (event.type === 'pointerup' && drag.hold !== drag.startHold) changeActiveHold(drag.hold);
      else render();
      return;
    }
    scrubbing = false;
  };
  strip.addEventListener('pointerup', stop);
  strip.addEventListener('pointercancel', stop);
  strip.addEventListener('click', event => {
    if (strip.dataset.suppressClick || event.target.closest('.hold-grip') || event.target.closest('.track-name') || !event.target.closest('.lane')) return;
    const tick = tickFromEvent(event);
    const rowChanged = selectRowFromEvent(event);
    if (tick !== timeline.playhead || playbackActive) seekToTick(tick);
    else if (rowChanged) render();
  });
}

function bindWorkspaceUi() {
  document.querySelectorAll('[data-popover]:not([data-tool])').forEach(button => {
    button.addEventListener('click', () => togglePopover(button.dataset.popover, button));
  });
  document.querySelectorAll('.topbar [data-tool]').forEach(button => {
    // Runs before the shared tool handler: switching tools closes any popover.
    button.addEventListener('pointerdown', () => {
      if (!button.classList.contains('active') && openPopoverId) closePopovers();
    });
  });
  document.querySelectorAll('[data-set-tool]').forEach(button => {
    button.addEventListener('click', () => setTool(button.dataset.setTool));
  });
  // Tapping outside an open popover closes it. A tap on the canvas only closes
  // the popover and does not also start a stroke.
  document.addEventListener('pointerdown', event => {
    if (!openPopoverId) return;
    const target = event.target;
    if (target.closest('.popover') || target.closest('[data-popover]')) return;
    // The movement panel stays open while scrubbing frames, and while
    // dragging the layer on the canvas in movement-edit mode.
    if (openPopoverId === 'motionPopover' && (target.closest('.timeline') || (motionEditing && target.closest('#canvasWrap')))) return;
    closePopovers();
    if (target.closest('#canvasWrap')) {
      event.stopPropagation();
      event.preventDefault();
    }
  }, true);

  document.querySelectorAll('.brush-card').forEach(card => {
    card.addEventListener('click', () => {
      const name = card.dataset.brush;
      if (card.dataset.brushKind === 'vector') {
        vectorBrushPreset = name;
        document.getElementById('vectorBrushPreset').value = name;
        if (!card.closest('#eraserPopover')) setTool('vector');
      } else {
        const select = document.getElementById('brushPreset');
        select.value = name;
        select.dispatchEvent(new Event('change'));
        if (!card.closest('#eraserPopover')) setTool('pen');
      }
      syncBrushUi();
    });
  });

  const sideOpacity = document.getElementById('sideOpacity');
  sideOpacity.addEventListener('input', () => {
    const target = document.getElementById(sidebarOpacityTarget() === 'vector' ? 'vectorBrushOpacity' : 'brushOpacity');
    target.value = sideOpacity.value;
    target.dispatchEvent(new Event('input'));
    document.getElementById('sideOpacityOut').textContent = sideOpacity.value + '%';
  });
  ['vectorBrushOpacity', 'brushOpacity'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => syncBrushUi());
  });
  document.getElementById('brushPreset').addEventListener('change', () => syncBrushUi());
  document.getElementById('vectorBrushPreset').addEventListener('change', () => syncBrushUi());

  document.getElementById('eyedropper').onclick = () => setEyedropperArmed(!eyedropperArmed);
  document.getElementById('zoomLevel').onclick = () => document.getElementById('resetViewport').click();
  const currentHold = () => normalizeHold(clipAt(currentTrack(), timeline.playhead)?.clip.hold);
  document.getElementById('holdMinus').onclick = () => changeActiveHold(currentHold() - 1);
  document.getElementById('holdPlus').onclick = () => changeActiveHold(currentHold() + 1);
  document.getElementById('framePrev').onclick = () => stepFrame(-1);
  document.getElementById('frameNext').onclick = () => stepFrame(1);
  bindTimelineScrub();
  bindHsvPicker();
  bindMotionControls();
  syncBrushUi();
  syncHsvPicker();
}

// ───────────────────────── Layer movement keyframes ─────────────────────────

let motionEditing = false;
let motionUndo = [];
let motionRedo = [];
let motionSliderEdit = null;
const MOTION_FIELDS = [
  { id: 'motionX', key: 'x', toInput: value => value, fromInput: value => value, format: value => Math.round(value) + 'px' },
  { id: 'motionY', key: 'y', toInput: value => value, fromInput: value => value, format: value => Math.round(value) + 'px' },
  { id: 'motionRotation', key: 'rotation', toInput: value => value, fromInput: value => value, format: value => Math.round(value) + '°' },
  { id: 'motionScale', key: 'scale', toInput: value => value * 100, fromInput: value => value / 100, format: value => Math.round(value * 100) + '%' },
  { id: 'motionOpacity', key: 'opacity', toInput: value => value * 100, fromInput: value => value / 100, format: value => Math.round(value * 100) + '%' },
];

function currentLayerMotion(layer = layers[active]) {
  return evaluateMotionTrack(layer?.motionTrack, timeline.playhead);
}

function pushMotionHistory(layer, before, after) {
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  motionUndo.push({ layer, before, after });
  if (motionUndo.length > 60) motionUndo.shift();
  motionRedo = [];
}

function commitMotionTrack(layer, nextTrack) {
  const before = layer.motionTrack || [];
  layer.motionTrack = nextTrack;
  pushMotionHistory(layer, before, nextTrack);
  render();
}

function restoreMotion(from, to) {
  const entry = from.pop();
  if (!entry || !layers.includes(entry.layer)) { render(); return; }
  entry.layer.motionTrack = entry.before;
  to.push({ layer: entry.layer, before: entry.after, after: entry.before });
  showToast('움직임 ' + (from === motionUndo ? '실행 취소' : '다시 실행'));
  render();
}

function setMotionEditing(enabled) {
  motionEditing = enabled;
  if (enabled && playbackActive) setPlaybackEnabled(false);
  const toggle = document.getElementById('motionEditToggle');
  toggle.classList.toggle('active', enabled);
  toggle.textContent = enabled ? '캔버스 끌기로 움직이는 중 · 끄기' : '캔버스에서 끌어 움직이기';
  document.getElementById('motionButton').classList.toggle('active', enabled);
  document.querySelector('.stage')?.classList.toggle('motion-editing', enabled);
  render();
}

function syncMotionUi() {
  const layer = layers[active];
  const popover = document.getElementById('motionPopover');
  if (!layer || !popover) return;
  document.getElementById('motionLayerName').textContent = layer.name;
  const motion = layer.renderMotion || currentLayerMotion(layer);
  for (const field of MOTION_FIELDS) {
    if (motionSliderEdit?.id === field.id) continue;
    document.getElementById(field.id).value = String(field.toInput(motion[field.key]));
    document.getElementById(field.id + 'Out').textContent = field.format(motion[field.key]);
  }
  const keyframe = keyframeAt(layer.motionTrack, timeline.playhead);
  const keyCount = layer.motionTrack?.length || 0;
  document.getElementById('motionEasing').value = keyframe?.easing || 'easeInOut';
  document.getElementById('motionEasing').disabled = !keyframe;
  document.getElementById('motionKeyDelete').disabled = !keyframe;
  document.getElementById('motionClear').disabled = !keyCount;
  document.getElementById('motionKeyInfo').textContent = keyframe
    ? `지금 프레임에 키프레임이 있어요 · 전체 ${keyCount}개`
    : keyCount
      ? '지금 프레임은 키프레임 사이라 자동으로 이어져요 · 값을 바꾸면 키프레임이 생겨요'
      : '값을 바꾸거나 캔버스를 끌면 현재 프레임에 키프레임이 생겨요';
}

function bindMotionControls() {
  document.getElementById('motionEditToggle').onclick = () => setMotionEditing(!motionEditing);
  for (const field of MOTION_FIELDS) {
    const input = document.getElementById(field.id);
    input.addEventListener('input', () => {
      const layer = layers[active];
      if (!motionSliderEdit) motionSliderEdit = { id: field.id, layer, before: layer.motionTrack || [] };
      const value = field.fromInput(Number(input.value));
      layer.motionTrack = setKeyframe(motionSliderEdit.before, timeline.playhead, { ...currentLayerMotionFrom(motionSliderEdit.before), [field.key]: value });
      document.getElementById(field.id + 'Out').textContent = field.format(value);
      render();
    });
    input.addEventListener('change', () => {
      if (!motionSliderEdit) return;
      pushMotionHistory(motionSliderEdit.layer, motionSliderEdit.before, motionSliderEdit.layer.motionTrack);
      motionSliderEdit = null;
      render();
    });
  }
  document.getElementById('motionEasing').onchange = event => {
    const layer = layers[active];
    if (!keyframeAt(layer.motionTrack, timeline.playhead)) return;
    commitMotionTrack(layer, setKeyframe(layer.motionTrack, timeline.playhead, {}, event.target.value));
  };
  document.getElementById('motionKeyAdd').onclick = () => {
    const layer = layers[active];
    commitMotionTrack(layer, setKeyframe(layer.motionTrack, timeline.playhead, currentLayerMotion(layer)));
  };
  document.getElementById('motionKeyDelete').onclick = () => {
    const layer = layers[active];
    commitMotionTrack(layer, removeKeyframe(layer.motionTrack, timeline.playhead));
  };
  document.getElementById('motionClear').onclick = () => {
    commitMotionTrack(layers[active], []);
  };
}

function currentLayerMotionFrom(track) {
  return evaluateMotionTrack(track, timeline.playhead);
}

// Builds the in-progress vector line with the current brush so the live
// preview shows the same pressure widths, taper and opacity as the result.
function previewVectorDrawing() {
  if (!drawingPoints?.length) return;
  const points = drawingPoints.length > 1 ? drawingPoints : [drawingPoints[0], { ...drawingPoints[0], x: drawingPoints[0].x + 0.1 }];
  renderer.previewVectorStroke(createLineStroke({
    id: 'preview-line',
    points,
    color,
    width: size,
    brushPreset: vectorBrushPreset,
    pressureCurve: vectorPressureCurve,
    opacity: vectorBrushOpacity,
    pressureProfile: vectorPressureProfile,
  }));
}

function createShapePoints(kind, start, end) {
  const left = Math.min(start.x, end.x), right = Math.max(start.x, end.x);
  const top = Math.min(start.y, end.y), bottom = Math.max(start.y, end.y);
  if (kind === 'ellipse') {
    const cx = (left + right) / 2, cy = (top + bottom) / 2;
    const rx = Math.max(0.5, (right - left) / 2), ry = Math.max(0.5, (bottom - top) / 2);
    return Array.from({ length: 49 }, (_, index) => {
      const angle = index / 48 * Math.PI * 2;
      return { x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry };
    });
  }
  return [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }, { x: left, y: top }];
}

function selectVectorStrokesInPolygon(polygon) {
  selectedStrokeIds.clear();
  if (!polygon || polygon.length < 3) { selectedStrokeId = null; return; }
  for (const stroke of vectorStrokes) {
    if (lineStrokeIntersectsPolygon(stroke, polygon)) selectedStrokeIds.add(stroke.id);
  }
  selectedStrokeId = [...selectedStrokeIds].at(-1) || null;
}

function bindCanvasEvents() {
  const drawBrushPreview = () => {
    if (!strokeSamples.length) return;
    const outline = createBrushOutline(strokeSamples, currentStrokeOptions(true));
    if (!maskEditing && tool === 'pen') {
      renderer.previewBrush(outline, color, currentBrushPreset().opacity * brushOpacity, strokeSamples, { preset: brushPreset, size, color, blendMode: brushBlendMode });
    } else {
      renderer.previewPolygon(outline, maskEditing ? (tool === 'eraser' ? 0xffffff : 0x171719) : 0xf4f0e8, 0.9);
    }
  };
  const brushPreviewScheduler = createFrameScheduler(drawBrushPreview);
  const smudgeRenderScheduler = createFrameScheduler(() => {
    if (!smudgeSession) return;
    const context = layers[active].canvas.getContext('2d');
    context.putImageData(smudgeSession.imageData, 0, 0);
    render([active]);
  });

  // ── Multi-touch gestures and eyedropper ──
  // These listeners are registered before the drawing listeners so they can
  // swallow events (stopImmediatePropagation) once a gesture takes over.
  const touches = new Map();
  let gesture = null;
  let motionDrag = null;
  const startMotionDrag = event => {
    if (playbackActive) setPlaybackEnabled(false);
    const layer = layers[active];
    motionDrag = { pointerId: event.pointerId, layer, before: layer.motionTrack || [], start: stagePosition(event), motion: currentLayerMotion(layer), moved: false };
    try { inputSurface.setPointerCapture(event.pointerId); } catch { /* pointer already released */ }
  };
  const revertMotionDrag = () => {
    if (!motionDrag) return;
    motionDrag.layer.motionTrack = motionDrag.before;
    motionDrag = null;
    render();
  };
  let pendingTouchFill = null;
  const firstTwoTouches = () => [...touches.values()].slice(0, 2).map(touch => ({ x: touch.x, y: touch.y }));
  const cancelActiveInput = event => {
    if (!down && !panDrag) return;
    end({ type: 'pointercancel', pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, pressure: 0, button: 0 });
  };
  inputSurface.addEventListener('pointerdown', event => {
    if (eyedropperArmed && event.button === 0) {
      event.stopImmediatePropagation();
      pickColorAt(stagePosition(event));
      setEyedropperArmed(false);
      return;
    }
    if (motionEditing && event.button === 0 && event.pointerType !== 'touch' && !loadingFrame) {
      event.stopImmediatePropagation();
      startMotionDrag(event);
      return;
    }
    if (event.pointerType !== 'touch') return;
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY });
    if (motionEditing && touches.size === 1 && !loadingFrame) {
      event.stopImmediatePropagation();
      startMotionDrag(event);
      return;
    }
    if (touches.size === 1 && tool === 'fill') {
      // Defer touch fills until release so the first finger of a two-finger
      // undo tap does not fill a region first.
      pendingTouchFill = { pointerId: event.pointerId, point: position(event) };
      event.stopImmediatePropagation();
      return;
    }
    if (touches.size < 2) return;
    event.stopImmediatePropagation();
    pendingTouchFill = null;
    try { inputSurface.setPointerCapture(event.pointerId); } catch { /* pointer already released */ }
    if (!gesture) {
      revertMotionDrag();
      cancelActiveInput(event);
      gesture = { fingers: touches.size, startedAt: performance.now(), maxTravel: 0, last: firstTwoTouches() };
    } else {
      gesture.fingers = Math.max(gesture.fingers, touches.size);
      gesture.last = firstTwoTouches();
    }
  });
  inputSurface.addEventListener('pointermove', event => {
    if (motionDrag?.pointerId === event.pointerId && !gesture) {
      event.stopImmediatePropagation();
      const point = stagePosition(event);
      const dx = point.x - motionDrag.start.x;
      const dy = point.y - motionDrag.start.y;
      if (!motionDrag.moved && Math.hypot(dx, dy) < 1) return;
      motionDrag.moved = true;
      motionDrag.layer.motionTrack = setKeyframe(motionDrag.before, timeline.playhead, {
        ...motionDrag.motion, x: motionDrag.motion.x + dx, y: motionDrag.motion.y + dy,
      });
      render();
    }
    const touch = touches.get(event.pointerId);
    if (!touch) return;
    touch.x = event.clientX;
    touch.y = event.clientY;
    if (pendingTouchFill?.pointerId === event.pointerId && Math.hypot(touch.x - touch.startX, touch.y - touch.startY) > 14) pendingTouchFill = null;
    if (!gesture) return;
    event.stopImmediatePropagation();
    gesture.maxTravel = Math.max(gesture.maxTravel, Math.hypot(touch.x - touch.startX, touch.y - touch.startY));
    if (touches.size < 2) return;
    const current = firstTwoTouches();
    const rect = inputSurface.getBoundingClientRect();
    const next = pinchViewport(viewport, gesture.last, current, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    Object.assign(viewport, next);
    applyViewport();
    gesture.last = current;
  });
  const releaseTouch = event => {
    if (motionDrag?.pointerId === event.pointerId) {
      event.stopImmediatePropagation();
      if (event.type === 'pointercancel') revertMotionDrag();
      else {
        if (motionDrag.moved) pushMotionHistory(motionDrag.layer, motionDrag.before, motionDrag.layer.motionTrack);
        motionDrag = null;
        render();
      }
    }
    if (!touches.has(event.pointerId)) return;
    touches.delete(event.pointerId);
    if (pendingTouchFill?.pointerId === event.pointerId) {
      const fill = pendingTouchFill;
      pendingTouchFill = null;
      event.stopImmediatePropagation();
      if (event.type === 'pointerup' && !gesture && !loadingFrame) {
        if (playbackActive) setPlaybackEnabled(false);
        ensureEditableLayerAfterTransform();
        ensureEditableClip('raster');
        floodFill(fill.point.x, fill.point.y);
        render([active]);
      }
      return;
    }
    if (!gesture) return;
    event.stopImmediatePropagation();
    if (touches.size >= 2) {
      gesture.last = firstTwoTouches();
      return;
    }
    if (touches.size === 1) return;
    const shortcut = classifyMultiTouchTap({
      fingers: gesture.fingers,
      durationMs: performance.now() - gesture.startedAt,
      maxTravel: gesture.maxTravel,
    });
    gesture = null;
    if (shortcut) {
      document.getElementById(shortcut).click();
      showToast(shortcut === 'undo' ? '실행 취소' : '다시 실행');
    } else {
      viewport.rotation = snapViewportRotation(viewport.rotation);
      applyViewport();
    }
  };
  inputSurface.addEventListener('pointerup', releaseTouch);
  inputSurface.addEventListener('pointercancel', releaseTouch);

  inputSurface.addEventListener('pointerdown', event => {
    if (event.button !== 0 || loadingFrame) return;
    if (playbackActive) setPlaybackEnabled(false);
    if (boilEnabled) setBoilEnabled(false);
    try { inputSurface.setPointerCapture(event.pointerId); } catch { /* pointer already released */ }
    if (['pen', 'eraser', 'smudge', 'line', 'fill'].includes(tool)) ensureEditableLayerAfterTransform();
    if (['pen', 'eraser', 'smudge', 'fill'].includes(tool)) ensureEditableClip('raster');
    if (['vector', 'line', 'shape'].includes(tool)) ensureEditableClip('vector');
    const point = position(event);

    if (tool === 'hand') {
      panDrag = { clientX: event.clientX, clientY: event.clientY, x: viewport.x, y: viewport.y };
      down = true;
      return;
    }

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
        let nearestAnchor = -1, anchorDistance = cssToCanvasUnits(20);
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
        let nearest = null, distance = cssToCanvasUnits(20);
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
          if (projection && projection.distance <= Math.max(cssToCanvasUnits(18), stroke.width / 2 + cssToCanvasUnits(8))) {
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
        let nearestDistance = cssToCanvasUnits(20);
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
          if (!projection || projection.distance > cssToCanvasUnits(18)) {
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
      if (event.shiftKey) {
        if (hit) {
          if (selectedStrokeIds.has(hit.id)) selectedStrokeIds.delete(hit.id);
          else selectedStrokeIds.add(hit.id);
        }
        selectedStrokeId = hit?.id || [...selectedStrokeIds].at(-1) || null;
        render();
        return;
      }
      selectedStrokeIds.clear();
      if (hit) selectedStrokeIds.add(hit.id);
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
      lastVectorSampleTime = Number(event.timeStamp) || 0;
      drawingPoints = [{ ...point, pressure: event.pointerType === 'pen' ? normalizePointerPressure(event, pressureEnabled) : 0.5 }];
      previewVectorDrawing();
      return;
    }

    if (tool === 'smudge') {
      const targetLayer = layers[active];
      smudgeUndoBefore = targetLayer.undo.slice();
      smudgeRedoBefore = targetLayer.redo.slice();
      save(targetLayer);
      const context = targetLayer.canvas.getContext('2d', { willReadFrequently: true });
      const imageData = context.getImageData(0, 0, W, H);
      smudgeOriginalData = new Uint8ClampedArray(imageData.data);
      smudgeSession = createSmudgeSession(imageData, {
        size,
        strength: smudgeStrength,
        spacing: smudgeSpacing,
      });
      smudgeSession.addPoint({
        ...point,
        pressure: normalizePointerPressure(event, pressureEnabled),
      });
      down = true;
      lineStartPoint = last = point;
      strokeIsStylus = event.pointerType === 'pen';
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
    if (panDrag) {
      viewport.x = panDrag.x + event.clientX - panDrag.clientX;
      viewport.y = panDrag.y + event.clientY - panDrag.clientY;
      applyViewport();
      return;
    }
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
        const points = stroke.points.map(node => ({ ...node }));
        const previous = points[selectedNodeIndex];
        if (previous.x !== point.x || previous.y !== point.y) nodeDragChanged = true;
        points[selectedNodeIndex] = { ...previous, x: point.x, y: point.y };
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

    if (tool === 'shape') {
      const points = createShapePoints(shapeKind, lineStartPoint, point);
      drawingPoints = points;
      renderer.previewStroke(points, Number.parseInt(color.slice(1), 16), size);
      return;
    }

    if (tool === 'vector') {
      for (const sample of coalescedPointerEvents(event)) {
        const samplePoint = position(sample);
        const previous = drawingPoints[drawingPoints.length - 1];
        const sampleTime = Number(sample.timeStamp ?? event.timeStamp) || lastVectorSampleTime + 16;
        if (Math.hypot(samplePoint.x - previous.x, samplePoint.y - previous.y) >= 1.25) {
          const pressure = sample.pointerType === 'pen'
            ? normalizePointerPressure(sample, pressureEnabled)
            : estimateVectorMousePressure(previous, samplePoint, sampleTime - lastVectorSampleTime, size);
          drawingPoints.push({ ...samplePoint, pressure });
          lastVectorSampleTime = sampleTime;
        }
      }
      previewVectorDrawing();
      return;
    }

    if (tool === 'line') {
      renderer.previewLine(lineStartPoint, point, Number.parseInt(color.slice(1), 16), size);
      return;
    }

    if (tool === 'smudge' && smudgeSession) {
      let touched = 0;
      for (const sample of coalescedPointerEvents(event)) {
        const rawPoint = position(sample);
        const smoothPoint = stabilizePoint(last, rawPoint, brushSmoothing);
        touched += smudgeSession.addPoint({
          ...smoothPoint,
          pressure: normalizePointerPressure(sample, pressureEnabled),
        });
        last = smoothPoint;
      }
      if (touched > 0) smudgeRenderScheduler.schedule();
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
    if (panDrag) { panDrag = null; down = false; return; }
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
      if (drag.mode === 'lassoNew') selectVectorStrokesInPolygon(selectionPolygon);
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
      if (drag.mode === 'new' && selectionRect) {
        const rect = selectionRect;
        selectVectorStrokesInPolygon([{ x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y }, { x: rect.x + rect.width, y: rect.y + rect.height }, { x: rect.x, y: rect.y + rect.height }]);
      }
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

    if (tool === 'smudge' && smudgeSession) {
      smudgeRenderScheduler.cancel();
      const targetLayer = layers[active];
      const context = targetLayer.canvas.getContext('2d');
      if (event.type === 'pointercancel') {
        smudgeSession.imageData.data.set(smudgeOriginalData);
        context.putImageData(smudgeSession.imageData, 0, 0);
        targetLayer.undo = smudgeUndoBefore || [];
        targetLayer.redo = smudgeRedoBefore || [];
      } else {
        smudgeSession.addPoint({
          ...point,
          pressure: normalizePointerPressure(event, pressureEnabled),
        });
        smudgeSession.flush();
        context.putImageData(smudgeSession.imageData, 0, 0);
        if (smudgeSession.dabCount === 0) {
          targetLayer.undo = smudgeUndoBefore || [];
          targetLayer.redo = smudgeRedoBefore || [];
        }
      }
      smudgeSession = null;
      smudgeOriginalData = null;
      smudgeUndoBefore = null;
      smudgeRedoBefore = null;
      strokeIsStylus = false;
      down = false;
      render([active]);
      return;
    }

    if (event.type === 'pointercancel' && ['shape', 'line', 'vector', 'pen', 'eraser'].includes(tool)) {
      // The system (palm rejection) or a multi-finger gesture cancelled the
      // stroke: discard it instead of committing a partial line, and drop the
      // undo snapshot that pointerdown recorded for raster tools.
      if (tool !== 'vector' && !maskEditing) layers[active].undo.pop();
      strokeSamples = [];
      strokeIsStylus = false;
      drawingPoints = null;
      lineStartPoint = null;
      renderer.clearPreview();
      down = false;
      render([active]);
      return;
    }

    if (tool === 'shape') {
      const points = createShapePoints(shapeKind, lineStartPoint, point);
      commitLineHistory(lineSnapshot());
      const created = createLineStroke({ id: 'line-' + nextLineId++, points: points.map(p => ({ ...p, pressure: 0.5 })), color, width: size, brushPreset: vectorBrushPreset, pressureCurve: vectorPressureCurve, opacity: vectorBrushOpacity, pressureProfile: vectorPressureProfile, motionStyle: vectorMotionStyle, motionStrength: vectorMotionStrength });
      vectorStrokes.push(created);
      selectedStrokeId = created.id;
      selectedStrokeIds.clear(); selectedStrokeIds.add(created.id);
      renderer.clearPreview(); drawingPoints = null; down = false; render(); return;
    }

    if (tool === 'vector') {
      const previous = drawingPoints[drawingPoints.length - 1];
      if (Math.hypot(point.x - previous.x, point.y - previous.y) > 0.1) drawingPoints.push({ ...point, pressure: event.pointerType === 'pen' ? normalizePointerPressure(event, pressureEnabled) : 0.5 });
      if (drawingPoints.length === 1) drawingPoints.push({ x: point.x + 0.1, y: point.y + 0.1 });
      commitLineHistory(lineSnapshot());
      const created = createLineStroke({
        id: 'line-' + nextLineId++,
        points: drawingPoints,
        color,
        width: size,
        brushPreset: vectorBrushPreset,
        pressureCurve: vectorPressureCurve,
        opacity: vectorBrushOpacity,
        pressureProfile: vectorPressureProfile,
        motionStyle: vectorMotionStyle,
        motionStrength: vectorMotionStrength,
      });
      vectorStrokes.push(created);
      // Freehand drawing should not leave the new line selected; otherwise the
      // next brush/color change would silently restyle the line just drawn.
      selectedStrokeId = null;
      selectedStrokeIds.clear();
      drawingPoints = null;
      renderer.clearPreview();
      down = false;
      render();
      return;
    }

    if (tool === 'line') {
      commitLineHistory(lineSnapshot());
      const created = createLineStroke({ id: 'line-' + nextLineId++, points: [{ ...lineStartPoint, pressure: 0.5 }, { ...point, pressure: 0.5 }], color, width: size, brushPreset: vectorBrushPreset, pressureCurve: vectorPressureCurve, opacity: vectorBrushOpacity, pressureProfile: vectorPressureProfile, motionStyle: vectorMotionStyle, motionStrength: vectorMotionStrength });
      vectorStrokes.push(created);
      selectedStrokeId = created.id;
      selectedStrokeIds.clear(); selectedStrokeIds.add(created.id);
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
        context.globalCompositeOperation = drawingMask
          ? (tool === 'eraser' ? 'source-over' : 'destination-out')
          : (tool === 'eraser' ? 'destination-out' : normalizeBrushBlendMode(brushBlendMode));
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
    if (isTextEntry) return;
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      document.getElementById(event.shiftKey ? 'redo' : 'undo').click();
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) return;

    const shortcutTools = { b: paintMode() === 'raster' ? 'pen' : 'vector', s: 'smudge', e: 'eraser', v: 'select', h: 'hand', g: 'fill' };
    const key = event.key.toLowerCase();
    if (shortcutTools[key] && !down) {
      event.preventDefault();
      closePopovers();
      setTool(shortcutTools[key]);
      return;
    }
    if (key === 'i' && !down) {
      setEyedropperArmed(!eyedropperArmed);
      return;
    }
    if ((event.key === '[' || event.key === ']') && !down) {
      const sizeInput = document.getElementById('size');
      const step = Math.max(1, Math.round(size * 0.12));
      sizeInput.value = String(size + (event.key === ']' ? step : -step));
      sizeInput.dispatchEvent(new Event('input'));
      return;
    }
    if (event.key === ' ' && !down) {
      event.preventDefault();
      setPlaybackEnabled(!playbackActive);
      return;
    }
    if (event.key === 'Escape' && openPopoverId) {
      closePopovers();
      return;
    }
    if (event.key === 'Escape' && motionEditing) {
      setMotionEditing(false);
      return;
    }
    if ((event.key === ',' || event.key === '.') && !down) {
      seekToTick(timeline.playhead + (event.key === '.' ? 1 : -1));
      return;
    }
    if (key === 'm' && !down) {
      setMotionEditing(!motionEditing);
      return;
    }

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

// ───────────────────────── Project saving (IndexedDB) ─────────────────────────

const AUTOSAVE_DELAY_MS = 1500;
let project = { id: newProjectId(), name: '제목 없음', createdAt: new Date().toISOString() };
let savedImageRefs = new Map();
let autosaveTimer = 0;
let saveInFlight = null;
let saveQueued = false;
let storageReady = false;
let projectBusy = false;

function newProjectId() {
  return 'project-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

function setSaveStatus(text, state = 'idle') {
  const status = document.getElementById('saveStatus');
  if (!status) return;
  status.textContent = text;
  status.dataset.state = state;
}

function scheduleAutosave() {
  if (!storageReady || projectBusy) return;
  clearTimeout(autosaveTimer);
  setSaveStatus('저장 대기 중', 'pending');
  autosaveTimer = setTimeout(() => saveProjectNow(), AUTOSAVE_DELAY_MS);
}

function projectThumbnail() {
  const thumbnail = document.createElement('canvas');
  thumbnail.width = 160;
  thumbnail.height = 120;
  thumbnail.getContext('2d').drawImage(composite().canvas, 0, 0, 160, 120);
  return thumbnail.toDataURL('image/jpeg', 0.7);
}

async function saveProjectNow() {
  if (!storageReady || projectBusy) return;
  clearTimeout(autosaveTimer);
  if (saveInFlight) {
    saveQueued = true;
    return saveInFlight;
  }
  // Never snapshot in the middle of a stroke, a clip load or playback.
  if (loadingFrame || down || playbackActive) {
    autosaveTimer = setTimeout(() => saveProjectNow(), AUTOSAVE_DELAY_MS);
    return;
  }
  saveActiveFrame();
  const { doc, images } = buildProjectDocument({
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
    width: W,
    height: H,
    layers: layers.map(layer => ({ ...layer, maskDataUrl: layer.maskEnabled ? layer.maskCanvas.toDataURL('image/png') : null })),
    groups: layerGroups,
    timeline,
    active,
    activeTrackId,
    nextLayerId,
    thumbnail: projectThumbnail(),
  });
  const writeImages = images.filter(image => savedImageRefs.get(image.key) !== image.dataUrl);
  const referenced = referencedImageKeys(doc);
  const deleteKeys = [...savedImageRefs.keys()].filter(key => !referenced.has(key));
  setSaveStatus('저장 중…', 'saving');
  saveInFlight = saveProjectRecord(doc, { writeImages, deleteKeys })
    .then(() => {
      writeImages.forEach(image => savedImageRefs.set(image.key, image.dataUrl));
      deleteKeys.forEach(key => savedImageRefs.delete(key));
      const time = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
      setSaveStatus(`자동 저장됨 · ${time}`, 'saved');
    })
    .catch(error => {
      console.error('Project save failed:', error);
      const quota = error?.name === 'QuotaExceededError';
      setSaveStatus(quota ? '저장 공간이 부족해요' : '저장하지 못했어요', 'error');
      showToast(quota ? '저장 공간이 부족해서 저장하지 못했어요' : '작품을 저장하지 못했어요. 잠시 후 다시 시도해요');
    })
    .finally(() => {
      saveInFlight = null;
      if (saveQueued) {
        saveQueued = false;
        scheduleAutosave();
      }
    });
  return saveInFlight;
}

function freshLayerState() {
  return [
    { id: 'layer-1', name: '면 / 톤', visible: true, opacity: 1, blendMode: 'normal', groupId: null, maskEnabled: false, maskImage: null, motionTrack: [] },
    { id: 'layer-2', name: '선화', visible: true, opacity: 1, blendMode: 'normal', groupId: null, maskEnabled: false, maskImage: null, motionTrack: [] },
  ];
}

/** Replaces the whole editing state with a parsed project (or a blank one). */
async function applyProjectState(parsed, imageData = new Map()) {
  if (playbackActive) setPlaybackEnabled(false);
  if (boilEnabled) setBoilEnabled(false);
  frameLoadToken++;
  loadingFrame = false;
  const masks = await Promise.all(parsed.layers.map(saved => (saved.maskEnabled && saved.maskImage && imageData.get(saved.maskImage)
    ? decodeImage(imageData.get(saved.maskImage))
    : Promise.resolve(null))));
  layers.splice(0, layers.length, ...parsed.layers.map((saved, index) => {
    const layer = makeLayer(saved.name);
    Object.assign(layer, {
      id: saved.id,
      visible: saved.visible,
      opacity: saved.opacity,
      blendMode: saved.blendMode,
      groupId: saved.groupId,
      maskEnabled: saved.maskEnabled,
      motionTrack: saved.motionTrack.map(keyframe => ({ ...keyframe })),
    });
    if (masks[index]) {
      const context = layer.maskCanvas.getContext('2d');
      context.clearRect(0, 0, W, H);
      context.drawImage(masks[index], 0, 0, W, H);
    }
    return layer;
  }));
  nextLayerId = parsed.nextLayerId;
  layerGroups.splice(0, layerGroups.length, ...parsed.groups.map(group => ({ ...group })));
  timeline.tracks = {};
  for (const [trackId, track] of Object.entries(parsed.tracks)) {
    timeline.tracks[trackId] = {
      id: trackId,
      clips: track.clips.map(clip => ({
        id: clip.id,
        hold: clip.hold,
        cel: clip.celImage ? imageData.get(clip.celImage) || null : null,
        transformCel: clip.transformCel,
        ...(clip.strokes ? { strokes: clip.strokes } : {}),
      })),
    };
  }
  timeline.fps = parsed.fps;
  timeline.nextClipId = parsed.nextClipId;
  timeline.playhead = parsed.playhead;
  active = parsed.active;
  activeTrackId = parsed.activeTrackId;
  activeGroupId = null;
  maskEditing = false;
  selectedStrokeId = null;
  selectedStrokeIds.clear();
  selectedTransformLayers.clear();
  lineUndo.length = 0;
  lineRedo.length = 0;
  motionUndo = [];
  motionRedo = [];
  clipThumbnails.clear();
  loadedClips.clear();
  vectorStrokes.length = 0;
  document.getElementById('fps').value = String(parsed.fps);
  updateTimelineFPS(parsed.fps);
  savedImageRefs = new Map();
  for (const [key, dataUrl] of imageData) if (dataUrl) savedImageRefs.set(key, dataUrl);
  vectorTrack();
  for (const layer of layers) layerTrack(layer);
  await syncClipsToPlayhead({ save: false });
  updateProjectUi();
}

async function openProject(id) {
  const record = await loadProjectRecord(id);
  if (!record?.doc) throw new Error('작품을 찾지 못했어요');
  const parsed = parseProjectDocument(record.doc, { width: W, height: H });
  const imageData = await loadImageDataUrls(referencedImageKeys(parsed));
  project = { id: parsed.id || id, name: parsed.name, createdAt: parsed.createdAt || new Date().toISOString() };
  await applyProjectState(parsed, imageData);
  await setMeta('lastProjectId', project.id);
}

async function switchProject(task) {
  if (projectBusy) return;
  await saveProjectNow();
  projectBusy = true;
  try {
    await task();
  } catch (error) {
    console.error(error);
    showToast(error instanceof Error ? error.message : '작품을 열지 못했어요');
  } finally {
    projectBusy = false;
    render(layers.map((_, index) => index));
    await saveProjectNow();
  }
}

async function startNewProject() {
  await switchProject(async () => {
    project = { id: newProjectId(), name: '제목 없음', createdAt: new Date().toISOString() };
    await applyProjectState({
      fps: 12, playhead: 0, nextClipId: 1, nextLayerId: 3, active: 0, activeTrackId: null,
      groups: [], layers: freshLayerState(), tracks: {},
    });
    showToast('새 작품을 시작했어요');
  });
}

function updateProjectUi() {
  const nameInput = document.getElementById('projectName');
  if (nameInput && document.activeElement !== nameInput) nameInput.value = project.name;
}

async function refreshProjectList() {
  const list = document.getElementById('projectList');
  if (!list || !storageReady) return;
  const projects = await listProjects().catch(() => []);
  list.replaceChildren(...projects.map(item => {
    const button = document.createElement('button');
    button.className = 'project-item' + (item.id === project.id ? ' current' : '');
    button.disabled = item.id === project.id;
    const thumb = document.createElement('span');
    thumb.className = 'project-thumb';
    if (item.thumbnail) thumb.style.backgroundImage = `url("${item.thumbnail}")`;
    const label = document.createElement('span');
    label.className = 'project-label';
    const name = document.createElement('strong');
    name.textContent = item.name || '제목 없음';
    const time = document.createElement('small');
    time.textContent = item.id === project.id ? '지금 작업 중' : new Date(item.updatedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    label.append(name, time);
    button.append(thumb, label);
    button.onclick = () => switchProject(async () => {
      await openProject(item.id);
      closePopovers();
      showToast(`'${project.name}' 작품을 열었어요`);
    });
    return button;
  }));
}

function bindProjectControls() {
  const nameInput = document.getElementById('projectName');
  nameInput.addEventListener('input', () => {
    project.name = nameInput.value.trim() || '제목 없음';
    scheduleAutosave();
  });
  document.getElementById('newProject').onclick = () => {
    startNewProject().then(() => refreshProjectList());
  };
  document.querySelector('[data-popover="actionsPopover"]')?.addEventListener('click', () => refreshProjectList());
  // iPad Safari may kill a background tab without unload events; hidden is the last reliable moment.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveProjectNow();
  });
  window.addEventListener('pagehide', () => saveProjectNow());
}

async function restoreOrCreateProject() {
  if (!isProjectStorageAvailable()) {
    setSaveStatus('이 브라우저에서는 자동 저장을 쓸 수 없어요', 'error');
    return false;
  }
  try {
    const lastId = await getMeta('lastProjectId');
    storageReady = true;
    requestPersistentStorage();
    if (!lastId) return false;
    projectBusy = true;
    await openProject(lastId);
    setSaveStatus('저장된 작업을 불러왔어요', 'saved');
    showToast(`'${project.name}' 작업을 이어서 해요`);
    return true;
  } catch (error) {
    console.error('Project restore failed:', error);
    storageReady = isProjectStorageAvailable();
    showToast('지난 작업을 불러오지 못해서 새 작품으로 시작해요');
    project = { id: newProjectId(), name: '제목 없음', createdAt: new Date().toISOString() };
    return false;
  } finally {
    projectBusy = false;
  }
}

async function start() {
  inputSurface = await renderer.init(host);
  bindControls();
  bindWorkspaceUi();
  bindViewportControls();
  bindCanvasEvents();
  bindKeyboardShortcuts();
  bindProjectControls();

  vectorTrack();
  for (const layer of layers) loadedClips.set(layer.id, clipAt(layerTrack(layer), 0).clip.id);
  loadedClips.set(VECTOR_TRACK, clipAt(vectorTrack(), 0).clip.id);
  saveActiveFrame();
  render(layers.map((_, index) => index));
  updateProjectUi();
  const restored = await restoreOrCreateProject();
  if (!restored) render(layers.map((_, index) => index));
}

start().catch(error => {
  console.error('FRAME Studio renderer failed to initialize:', error);
  const message = error instanceof Error ? error.message : String(error);
  host.replaceChildren();
  const heading = document.createElement('strong');
  heading.textContent = '캔버스를 시작하지 못했습니다.';
  const detail = document.createElement('p');
  detail.textContent = '이 브라우저에서 사용 가능한 그래픽 렌더러를 초기화하지 못했습니다.';
  const diagnostic = document.createElement('code');
  diagnostic.textContent = message.slice(0, 240);
  host.append(heading, detail, diagnostic);
  host.title = message;
  host.classList.add('error');
});
