import './styles.css';
import { PixiStageRenderer } from './renderer.js';
import { coalescedPointerEvents, createBrushOutline, getBrushPreset, normalizePointerPressure, stabilizePoint } from './brush/brush-engine.js';
import { expandRegionMask, findConnectedRegion } from './fill/flood-fill.js';
import { animateLineStrokes, lineBoilPhase } from './line/line-boil.js';
import { activeFrame, addFrame, createTimeline, deleteFrame, frameAtTime, getOnionSkin, selectFrame, updateFrameCels, updateFrameStrokes } from './animation/timeline.js';
import { normalizeRasterCels } from './animation/frame-cels.js';
import { containsSelectionPoint, moveSelectionRect, normalizeSelectionRect, pointInPolygon, resizeSelectionRect, translatePolygon } from './selection/selection.js';
import {
  createLineStroke,
  hitTestLineStrokes,
  translateLineStroke,
  updateLineStrokeStyle,
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
let maskEditing = false;
let selectionRect = null;
let selectionPolygon = null;
let selectionDrag = null;
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

const palette = ['#17171b','#45434a','#77727a','#b8b2aa','#f5f0e8','#ffffff','#8f3037','#d94b52','#f07862','#f2a65a','#f2cf67','#9b9b43','#4f8a62','#74b58b','#3f9b9c','#63c5c7','#3c6c9e','#668bd0','#8c70bd','#b48bd0','#d58eb7','#9a6a50','#c08b68','#e3b9a0'];
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

function currentBrushPreset() { return getBrushPreset(brushPreset); }

function selectedStroke() {
  return vectorStrokes.find(stroke => stroke.id === selectedStrokeId) || null;
}

function save(layer) {
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
  renderer.sync(layers, dirtyIndices, displayStrokes, selectedStrokeId, onionEnabled ? getOnionSkin(timeline) : [], selectionRect, selectionPolygon);
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

function position(event) {
  const rect = inputSurface.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(W - 1, Math.floor((event.clientX - rect.left) * W / rect.width))),
    y: Math.max(0, Math.min(H - 1, Math.floor((event.clientY - rect.top) * H / rect.height))),
  };
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

    const name = document.createElement('span');
    name.textContent = layer.name + (layer.maskEnabled ? ' · MASK' : '');
    item.append(visibility, name);
    item.onclick = event => {
      if (event.target !== visibility) {
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
    renderer.sync(layers, [], displayStrokes, selectedStrokeId, onionEnabled ? getOnionSkin(timeline) : [], selectionRect, selectionPolygon);
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
  if (!stroke) return;
  document.getElementById('lineColor').value = stroke.color;
  document.getElementById('lineWidth').value = stroke.width;
  document.getElementById('lineWidthOut').value = stroke.width + 'px';
}

function applySelectedStyle(changes) {
  const stroke = selectedStroke();
  if (!stroke) return;
  commitLineHistory(lineSnapshot());
  const index = vectorStrokes.findIndex(item => item.id === selectedStrokeId);
  vectorStrokes[index] = updateLineStrokeStyle(stroke, changes);
  render();
}

function bindControls() {
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
    selectionRect = null;
    selectionPolygon = null;
    selectionDrag = null;
    down = false;
    render();
  };

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
    else if ((tool === 'vector' || tool === 'select') && lineUndo.length) restoreLines(lineUndo, lineRedo);
    else restore(layers[active], layers[active].undo, layers[active].redo);
  };
  document.getElementById('redo').onclick = () => {
    if (maskEditing) restoreMask(layers[active], layers[active].maskRedo, layers[active].maskUndo);
    else if ((tool === 'vector' || tool === 'select') && lineRedo.length) restoreLines(lineRedo, lineUndo);
    else restore(layers[active], layers[active].redo, layers[active].undo);
  };

  document.getElementById('toggle').onclick = () => {
    document.getElementById('inspector').classList.toggle('hidden');
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

  document.getElementById('brushPreset').onchange = event => { brushPreset = event.target.value; };
  document.getElementById('size').oninput = event => {
    size = Number(event.target.value);
    document.getElementById('sizeOut').value = size + 'px';
  };
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
    render();
  };

  const paletteElement = document.getElementById('palette');
  const customColor = document.getElementById('customColor');
  customColor.value = color;
  customColor.oninput = event => {
    color = event.target.value;
    paletteElement.querySelectorAll('button').forEach(item => item.classList.remove('selected'));
    if (selectedStroke()) applySelectedStyle({ color });
  };
  palette.forEach(value => {
    const button = document.createElement('button');
    button.className = 'swatch';
    button.style.background = value;
    button.setAttribute('aria-label', value);
    button.onclick = () => {
      color = value;
      customColor.value = value;
      paletteElement.querySelectorAll('button').forEach(item => {
        item.classList.toggle('selected', item === button);
      });
      if (selectedStroke()) applySelectedStyle({ color: value });
    };
    paletteElement.append(button);
    if (value === color) button.classList.add('selected');
  });
}

function bindCanvasEvents() {
  inputSurface.addEventListener('pointerdown', event => {
    if (event.button !== 0 || loadingFrame) return;
    if (playbackActive) setPlaybackEnabled(false);
    if (boilEnabled) setBoilEnabled(false);
    inputSurface.setPointerCapture(event.pointerId);
    const point = position(event);

    if (tool === 'lasso') {
      down = true;
      if (selectionPolygon && pointInPolygon(point, selectionPolygon)) {
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
        selectionDrag = { mode: 'lassoMove', start: point, originalPolygon: selectionPolygon.map(p => ({ ...p })), sourceCanvas };
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
      if (existing && containsSelectionPoint(existing, point)) {
        const handle = Math.hypot(point.x - (existing.x + existing.width), point.y - (existing.y + existing.height)) <= 14;
        mode = handle ? 'resize' : 'move';
      }
      const sourceCanvas = document.createElement('canvas');
      if (mode !== 'new' && existing) {
        sourceCanvas.width = Math.max(1, Math.ceil(existing.width));
        sourceCanvas.height = Math.max(1, Math.ceil(existing.height));
        sourceCanvas.getContext('2d').drawImage(layers[active].canvas, existing.x, existing.y, existing.width, existing.height, 0, 0, sourceCanvas.width, sourceCanvas.height);
      }
      selectionDrag = { mode, start: point, originalRect: existing ? { ...existing } : null, sourceCanvas };
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
      selectedStrokeId = hit?.id || null;
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
    if (tool === 'pen' || tool === 'eraser') {
      const outline = createBrushOutline(strokeSamples, {
        size, stylus: strokeIsStylus, pressureEnabled,
        preset: brushPreset,
        complete: false,
      });
      renderer.previewPolygon(outline, maskEditing ? (tool === 'eraser' ? 0xffffff : 0x171719) : (tool === 'eraser' ? 0xf4f0e8 : Number.parseInt(color.slice(1), 16)), maskEditing || tool === 'eraser' ? 0.9 : currentBrushPreset().opacity);
    }
  });

  inputSurface.addEventListener('pointermove', event => {
    const point = position(event);

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
        selectionPolygon = translatePolygon(selectionDrag.originalPolygon, point.x - selectionDrag.start.x, point.y - selectionDrag.start.y, { width: W, height: H });
      }
      render();
      return;
    }

    if (tool === 'lasso' && down && selectionDrag) {
      const point = position(event);
      const drag = selectionDrag;
      if (drag.mode === 'lassoNew') {
        const lastPoint = selectionPolygon[selectionPolygon.length - 1];
        if (Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y) > 1) selectionPolygon.push(point);
        if (selectionPolygon.length < 3) selectionPolygon = null;
      } else if (drag.mode === 'lassoMove') {
        const moved = selectionPolygon;
        const original = drag.originalPolygon;
        const dx = moved[0].x - original[0].x;
        const dy = moved[0].y - original[0].y;
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
        }
      }
      selectionDrag = null;
      down = false;
      render([active]);
      return;
    }

    if (tool === 'marquee' && down && selectionDrag) {
      if (selectionDrag.mode === 'new') {
        selectionRect = normalizeSelectionRect(selectionDrag.start, point);
      } else if (selectionDrag.mode === 'move') {
        selectionRect = moveSelectionRect(selectionDrag.originalRect, point.x - selectionDrag.start.x, point.y - selectionDrag.start.y, { width: W, height: H });
      } else if (selectionDrag.mode === 'resize') {
        selectionRect = resizeSelectionRect(selectionDrag.originalRect, point, { width: W, height: H });
      }
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
      const profile = currentBrushPreset();
      const outline = createBrushOutline(strokeSamples, {
        size, stylus: strokeIsStylus, pressureEnabled,
        preset: brushPreset,
        smoothing: profile.smoothing,
        streamline: brushSmoothing,
        complete: false,
      });
      renderer.previewPolygon(outline, maskEditing ? (tool === 'eraser' ? 0xffffff : 0x171719) : (tool === 'eraser' ? 0xf4f0e8 : Number.parseInt(color.slice(1), 16)), maskEditing || tool === 'eraser' ? 0.9 : currentBrushPreset().opacity);
    }
  });

  const end = event => {
    if (tool === 'marquee' && down && selectionDrag) {
      const point = position(event);
      const drag = selectionDrag;
      if (drag.mode === 'new') selectionRect = normalizeSelectionRect(drag.start, point);
      else if (drag.mode === 'move') selectionRect = moveSelectionRect(drag.originalRect, point.x - drag.start.x, point.y - drag.start.y, { width: W, height: H });
      else if (drag.mode === 'resize') selectionRect = resizeSelectionRect(drag.originalRect, point, { width: W, height: H });
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
        }
      }
      if (drag.mode === 'new' && (!selectionRect || selectionRect.width < 2 || selectionRect.height < 2)) selectionRect = null;
      selectionDrag = null;
      down = false;
      render([active]);
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
      const outline = createBrushOutline(strokeSamples, {
        size, stylus: strokeIsStylus, pressureEnabled,
        preset: brushPreset,
        complete: true,
      });
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
        context.globalAlpha = drawingMask ? 1 : (tool === 'eraser' ? 1 : currentBrushPreset().opacity);
        context.fillStyle = drawingMask ? '#fff' : color;
        context.beginPath();
        context.moveTo(outline[0][0], outline[0][1]);
        for (let index = 1; index < outline.length; index++) {
          context.lineTo(outline[index][0], outline[index][1]);
        }
        context.closePath();
        context.fill();
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
