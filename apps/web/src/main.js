import './styles.css';
import { PixiStageRenderer } from './renderer.js';
import { expandRegionMask, findConnectedRegion } from './fill/flood-fill.js';
import { animateLineStrokes, lineBoilPhase } from './line/line-boil.js';
import { activeFrame, addFrame, createTimeline, deleteFrame, frameAtTime, getOnionSkin, selectFrame, updateFrameCels, updateFrameStrokes } from './animation/timeline.js';
import { normalizeRasterCels } from './animation/frame-cels.js';
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
let down = false;
let last = null;
let strokeCursor = null;
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
  return { name, visible: true, opacity: 1, blendMode: 'normal', canvas, undo: [], redo: [] };
}

const layers = [makeLayer('면 / 톤'), makeLayer('선화')];
let active = 0;
let selectedStrokeId = null;

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
    if (!layer.visible) return;
    context.save();
    context.globalAlpha = layer.opacity ?? 1;
    context.globalCompositeOperation = layer.blendMode === 'add' ? 'lighter' : (layer.blendMode === 'normal' || !layer.blendMode ? 'source-over' : layer.blendMode);
    context.drawImage(layer.canvas, 0, 0);
    context.restore();
  });
  drawVectorStrokes(context);
  return context;
}

function render(dirtyIndices = [], displayStrokes = vectorStrokes) {
  if (!loadingFrame) updateFrameStrokes(timeline, timeline.activeFrameId, vectorStrokes);
  renderer.sync(layers, dirtyIndices, displayStrokes, selectedStrokeId, onionEnabled ? getOnionSkin(timeline) : []);
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

function withBrushContext(draw) {
  const context = layers[active].canvas.getContext('2d');
  context.save();
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.lineWidth = size;
  context.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
  context.strokeStyle = color;
  context.beginPath();
  draw(context);
  context.stroke();
  context.restore();
}

function stroke(from, to) {
  withBrushContext(context => {
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
  });
}

function strokeCurve(from, control, to) {
  withBrushContext(context => {
    context.moveTo(from.x, from.y);
    context.quadraticCurveTo(control.x, control.y, to.x, to.y);
  });
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
    if (!layer.visible) continue;
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

  layers.forEach((layer, index) => {
    const item = document.createElement('div');
    item.className = 'layer' + (index === active ? ' selected' : '');

    const visibility = document.createElement('button');
    visibility.textContent = layer.visible ? '◉' : '○';
    visibility.setAttribute('aria-label', layer.visible ? '레이어 숨기기' : '레이어 표시');
    visibility.onclick = () => {
      layer.visible = !layer.visible;
      render();
    };

    const name = document.createElement('span');
    name.textContent = layer.name;
    item.append(visibility, name);
    item.onclick = event => {
      if (event.target !== visibility) {
        active = index;
        drawLayers();
      }
    };
    list.append(item);
  });
}

function updateLayerInspector() {
  const layer = layers[active];
  if (!layer) return;
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
    renderer.sync(layers, [], displayStrokes, selectedStrokeId, onionEnabled ? getOnionSkin(timeline) : []);
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
      document.querySelectorAll('[data-tool]').forEach(item => {
        item.classList.toggle('active', item === button);
      });
      renderer.clearPreview();
      render();
    };
  });

  document.getElementById('addLayer').onclick = () => {
    if (playbackActive) setPlaybackEnabled(false);
    layers.push(makeLayer('레이어 ' + (layers.length + 1)));
    active = layers.length - 1;
    saveActiveFrame();
    render(layers.map((_, index) => index));
  };

  document.getElementById('layerDuplicate').onclick = () => {
    if (playbackActive) setPlaybackEnabled(false);
    const source = layers[active];
    const copy = makeLayer(source.name + ' 복사본');
    copy.opacity = source.opacity ?? 1;
    copy.blendMode = source.blendMode || 'normal';
    copy.canvas.getContext('2d').drawImage(source.canvas, 0, 0);
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
    save(layers[active]);
    layers[active].canvas.getContext('2d').clearRect(0, 0, W, H);
    render([active]);
  };

  document.getElementById('undo').onclick = () => {
    if ((tool === 'vector' || tool === 'select') && lineUndo.length) restoreLines(lineUndo, lineRedo);
    else restore(layers[active], layers[active].undo, layers[active].redo);
  };
  document.getElementById('redo').onclick = () => {
    if ((tool === 'vector' || tool === 'select') && lineRedo.length) restoreLines(lineRedo, lineUndo);
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

  document.getElementById('size').oninput = event => {
    size = Number(event.target.value);
    document.getElementById('sizeOut').value = size + 'px';
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
    strokeCursor = point;
    save(layers[active]);
    if (tool === 'pen' || tool === 'eraser') {
      stroke(point, { x: point.x + 0.01, y: point.y + 0.01 });
      render([active]);
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
    } else if (tool === 'pen' || tool === 'eraser') {
      const midpoint = { x: (last.x + point.x) / 2, y: (last.y + point.y) / 2 };
      strokeCurve(strokeCursor || last, last, midpoint);
      strokeCursor = midpoint;
      render([active]);
    }
    last = point;
  });

  const end = event => {
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
      strokeCurve(strokeCursor || last, last, point);
      render([active]);
    }
    strokeCursor = null;
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
