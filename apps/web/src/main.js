import './styles.css';
import { PixiStageRenderer } from './renderer.js';
import { expandRegionMask, findConnectedRegion } from './fill/flood-fill.js';

const W = 1200;
const H = 900;
const buffer = document.getElementById('artboardBuffer');
const host = document.getElementById('pixiHost');
const renderer = new PixiStageRenderer(W, H);

let inputSurface;
let tool = 'pen';
let color = '#24242a';
let size = 7;
let down = false;
let last = null;
let start = null;

const palette = ['#24242a', '#ffffff', '#e95d4f', '#e8b64f', '#6c9c85', '#6f86c9', '#b78bc7'];

function makeLayer(name) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  return { name, visible: true, canvas, undo: [], redo: [] };
}

const layers = [makeLayer('면 / 톤'), makeLayer('선화')];
let active = 0;

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

function composite() {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.fillStyle = '#f4f0e8';
  context.fillRect(0, 0, W, H);
  layers.forEach(layer => {
    if (layer.visible) context.drawImage(layer.canvas, 0, 0);
  });
  return context;
}

function render(dirtyIndices = []) {
  renderer.sync(layers, dirtyIndices);
  document.getElementById('status').textContent = tool.toUpperCase();
  drawLayers();
}

function position(event) {
  const rect = inputSurface.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(W - 1, Math.floor((event.clientX - rect.left) * W / rect.width))),
    y: Math.max(0, Math.min(H - 1, Math.floor((event.clientY - rect.top) * H / rect.height))),
  };
}

function stroke(from, to) {
  const context = layers[active].canvas.getContext('2d');
  context.save();
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.lineWidth = size;
  context.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
  context.strokeStyle = color;
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.lineTo(to.x, to.y);
  context.stroke();
  context.restore();
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

function bindControls() {
  document.querySelectorAll('[data-tool]').forEach(button => {
    button.onclick = () => {
      tool = button.dataset.tool;
      document.querySelectorAll('[data-tool]').forEach(item => {
        item.classList.toggle('active', item === button);
      });
      renderer.clearPreview();
      render();
    };
  });

  document.getElementById('addLayer').onclick = () => {
    layers.push(makeLayer('레이어 ' + (layers.length + 1)));
    active = layers.length - 1;
    render([active]);
  };

  document.getElementById('clear').onclick = () => {
    save(layers[active]);
    layers[active].canvas.getContext('2d').clearRect(0, 0, W, H);
    render([active]);
  };

  document.getElementById('undo').onclick = () => {
    restore(layers[active], layers[active].undo, layers[active].redo);
  };
  document.getElementById('redo').onclick = () => {
    restore(layers[active], layers[active].redo, layers[active].undo);
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

  const paletteElement = document.getElementById('palette');
  palette.forEach(value => {
    const button = document.createElement('button');
    button.className = 'swatch';
    button.style.background = value;
    button.setAttribute('aria-label', value);
    button.onclick = () => {
      color = value;
      paletteElement.querySelectorAll('button').forEach(item => {
        item.classList.toggle('selected', item === button);
      });
    };
    paletteElement.append(button);
    if (value === color) button.classList.add('selected');
  });
}

function bindCanvasEvents() {
  inputSurface.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    inputSurface.setPointerCapture(event.pointerId);
    const point = position(event);

    if (tool === 'fill') {
      floodFill(point.x, point.y);
      render([active]);
      return;
    }

    down = true;
    start = last = point;
    save(layers[active]);

    if (tool === 'pen' || tool === 'eraser') {
      stroke(point, { x: point.x + 0.01, y: point.y + 0.01 });
      render([active]);
    }
  });

  inputSurface.addEventListener('pointermove', event => {
    if (!down) return;
    const point = position(event);

    if (tool === 'line') {
      renderer.previewLine(start, point, Number.parseInt(color.slice(1), 16), size);
    } else if (tool === 'pen' || tool === 'eraser') {
      stroke(last, point);
      render([active]);
    }
    last = point;
  });

  const end = event => {
    if (!down) return;
    const point = position(event);
    if (tool === 'line') {
      stroke(start, point);
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

  // Sample line art stays on its own upper layer; paint starts on the lower layer.
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

  render([0, 1]);
}

start().catch(error => {
  console.error('FRAME Studio renderer failed to initialize:', error);
  host.textContent = '렌더러를 시작하지 못했습니다. WebGL을 지원하는 최신 브라우저에서 다시 시도해 주세요.';
  host.classList.add('error');
});
