// 3D Background Studio — scene document. Pure data, no Three.js, no DOM.
//
// A scene is a versioned JSON document: objects are a type from OBJECT_TYPES
// plus a transform and a color. Geometry is rebuilt from the type when the
// scene is opened, so a saved scene stays small and portable.

export const SCENE_FORMAT = 'frame-3d-scene';
export const SCENE_VERSION = 1;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finite = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const vec3 = (value, fallback) => (Array.isArray(value) && value.length === 3
  ? value.map((item, index) => finite(item, fallback[index]))
  : [...fallback]);

/**
 * Object catalog. `size` is the base box (width, height, depth in meters) the
 * builder fits the shape into; scale multiplies it. Labels are Korean UI text.
 */
export const OBJECT_TYPES = Object.freeze({
  box: { label: '상자', group: '기본', size: [1, 1, 1], color: '#d9d4c7' },
  sphere: { label: '구', group: '기본', size: [1, 1, 1], color: '#d9d4c7' },
  column: { label: '기둥', group: '기본', size: [0.5, 3, 0.5], color: '#cfcac0' },
  stairs: { label: '계단', group: '기본', size: [1.6, 1.5, 2.4], color: '#cfcac0' },
  wall: { label: '벽', group: '구조', size: [4, 3, 0.15], color: '#ebe6dc' },
  floor: { label: '바닥', group: '구조', size: [8, 0.1, 8], color: '#c9c2b4' },
  door: { label: '문', group: '구조', size: [0.9, 2.1, 0.12], color: '#a8977f' },
  window: { label: '창문', group: '구조', size: [1.4, 1.2, 0.12], color: '#e9eef2' },
  table: { label: '책상', group: '가구', size: [1.4, 0.75, 0.8], color: '#b59c7c' },
  chair: { label: '의자', group: '가구', size: [0.5, 0.95, 0.5], color: '#a88f70' },
  shelf: { label: '책장', group: '가구', size: [1.2, 1.9, 0.4], color: '#b59c7c' },
  bed: { label: '침대', group: '가구', size: [1.1, 0.55, 2.1], color: '#e3ddd2' },
  building: { label: '건물', group: '거리', size: [6, 9, 6], color: '#d7d1c6' },
  streetLamp: { label: '가로등', group: '거리', size: [0.4, 4.2, 0.4], color: '#5d5a55' },
  tree: { label: '나무', group: '거리', size: [2, 4.5, 2], color: '#9aa58f' },
  road: { label: '도로', group: '거리', size: [7, 0.05, 30], color: '#8d8a85' },
});

export const OBJECT_TYPE_IDS = Object.freeze(Object.keys(OBJECT_TYPES));

export const SCENE_PRESETS = Object.freeze({
  room: '방',
  corridor: '복도',
  street: '거리',
  empty: '빈 공간',
});

export const EXPORT_RATIOS = Object.freeze({
  '4:3': [4, 3],
  '3:4': [3, 4],
  '16:9': [16, 9],
  '1:1': [1, 1],
});

const DEFAULT_RENDER = Object.freeze({ toon: true, steps: 4, ink: true, inkWidth: 1.5, inkDepth: 0.5, tone: false, toneSize: 6 });
const DEFAULT_CAMERA = Object.freeze({ projection: 'perspective', fov: 50, position: [7, 5, 9], target: [0, 1.2, 0], zoom: 1, ratio: '4:3' });
const RAD = Math.PI / 180;

function object(type, position, { rotation = [0, 0, 0], scale = [1, 1, 1], color } = {}) {
  return { type, position, rotation, scale, color: color || OBJECT_TYPES[type].color };
}

function presetObjects(preset) {
  switch (preset) {
    case 'room':
      return [
        object('floor', [0, -0.05, 0]),
        object('wall', [0, 1.5, -4], { scale: [2, 1, 1] }),
        object('wall', [-4, 1.5, 0], { rotation: [0, 90 * RAD, 0], scale: [2, 1, 1] }),
        object('window', [0.8, 1.6, -3.9]),
        object('door', [-3.9, 1.05, 2], { rotation: [0, 90 * RAD, 0] }),
        object('table', [0.6, 0.375, -1.5]),
        object('chair', [0.6, 0.475, -0.6], { rotation: [0, 180 * RAD, 0] }),
        object('shelf', [-3.2, 0.95, -2.5], { rotation: [0, 90 * RAD, 0] }),
        object('bed', [2.6, 0.275, -2.4]),
      ];
    case 'corridor':
      return [
        object('floor', [0, -0.05, -6], { scale: [0.4, 1, 2.5] }),
        object('wall', [-1.6, 1.5, -6], { rotation: [0, 90 * RAD, 0], scale: [5, 1, 1] }),
        object('wall', [1.6, 1.5, -6], { rotation: [0, 90 * RAD, 0], scale: [5, 1, 1] }),
        object('door', [-1.52, 1.05, -2], { rotation: [0, 90 * RAD, 0] }),
        object('door', [1.52, 1.05, -6], { rotation: [0, -90 * RAD, 0] }),
        object('window', [-1.52, 1.6, -10], { rotation: [0, 90 * RAD, 0] }),
        object('column', [-1.3, 1.5, -4]),
        object('column', [1.3, 1.5, -8]),
      ];
    case 'street':
      // Road 7 m wide, 3 m sidewalks, building fronts on the sidewalk edge.
      return [
        object('road', [0, -0.025, -8]),
        object('floor', [-5, 0.05, -8], { scale: [0.375, 1, 3.75], color: '#bdb6a9' }),
        object('floor', [5, 0.05, -8], { scale: [0.375, 1, 3.75], color: '#bdb6a9' }),
        object('building', [-9.5, 4.5, 2]),
        object('building', [-9.5, 6, -6], { scale: [1, 1.35, 1] }),
        object('building', [-9.5, 3.6, -14], { scale: [1, 0.8, 1] }),
        object('building', [9.5, 3.6, 0], { scale: [1, 0.8, 1] }),
        object('building', [9.5, 5.4, -8], { scale: [1, 1.2, 1] }),
        object('building', [9.5, 4.5, -16]),
        object('streetLamp', [-4, 2.1, 0]),
        object('streetLamp', [4, 2.1, -10], { rotation: [0, 180 * RAD, 0] }),
        object('tree', [-4.6, 2.25, -6]),
      ];
    default:
      return [object('floor', [0, -0.05, 0], { scale: [1.5, 1, 1.5] })];
  }
}

function presetCamera(preset) {
  if (preset === 'corridor') return { ...DEFAULT_CAMERA, position: [0, 1.6, 3.5], target: [0, 1.4, -6] };
  if (preset === 'street') return { ...DEFAULT_CAMERA, fov: 55, position: [1.2, 1.6, 9], target: [0, 2.4, -12] };
  return { ...DEFAULT_CAMERA, position: [...DEFAULT_CAMERA.position], target: [...DEFAULT_CAMERA.target] };
}

export function createSceneDocument(preset = 'room', { name } = {}) {
  const safePreset = SCENE_PRESETS[preset] ? preset : 'empty';
  const objects = presetObjects(safePreset).map((item, index) => ({ id: `obj-${index + 1}`, ...item }));
  return {
    format: SCENE_FORMAT,
    version: SCENE_VERSION,
    name: name || `${SCENE_PRESETS[safePreset]} 배경`,
    preset: safePreset,
    camera: presetCamera(safePreset),
    render: { ...DEFAULT_RENDER },
    objects,
    nextId: objects.length + 1,
  };
}

function normalizeObject(raw, fallbackId) {
  if (!raw || !OBJECT_TYPES[raw.type]) return null;
  const scale = vec3(raw.scale, [1, 1, 1]).map(value => clamp(Math.abs(value) || 1, 0.05, 50));
  const color = typeof raw.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color.toLowerCase() : OBJECT_TYPES[raw.type].color;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : fallbackId,
    type: raw.type,
    position: vec3(raw.position, [0, 0, 0]).map(value => clamp(value, -500, 500)),
    rotation: vec3(raw.rotation, [0, 0, 0]),
    scale,
    color,
  };
}

/**
 * Validates and normalizes a scene from storage or a user file. Unknown object
 * types are dropped (and counted), numbers are clamped, ids are made unique.
 * Throws on a document that isn't a scene at all.
 */
export function parseSceneDocument(input) {
  const raw = typeof input === 'string' ? JSON.parse(input) : input;
  if (!raw || typeof raw !== 'object' || raw.format !== SCENE_FORMAT) throw new TypeError('FRAME 3D 장면 파일이 아니에요');
  if (Number(raw.version) > SCENE_VERSION) throw new RangeError('더 새로운 버전에서 만든 장면이에요');
  const seen = new Set();
  let dropped = 0;
  const objects = [];
  for (const item of Array.isArray(raw.objects) ? raw.objects : []) {
    const normalized = normalizeObject(item, null);
    if (!normalized) { dropped++; continue; }
    if (normalized.id) {
      while (seen.has(normalized.id)) normalized.id = `${normalized.id}-copy`;
      seen.add(normalized.id);
    }
    objects.push(normalized);
  }
  // Objects without an id get fresh ones after the highest existing number.
  const idNumber = id => Number(/^obj-(\d+)/.exec(id || '')?.[1] || 0);
  let next = Math.max(0, ...objects.map(item => idNumber(item.id))) + 1;
  for (const item of objects) if (!item.id) item.id = `obj-${next++}`;
  const numericIds = objects.map(item => idNumber(item.id));
  const camera = raw.camera || {};
  const render = raw.render || {};
  return {
    doc: {
      format: SCENE_FORMAT,
      version: SCENE_VERSION,
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 80) : '3D 배경',
      preset: SCENE_PRESETS[raw.preset] ? raw.preset : 'empty',
      camera: {
        projection: camera.projection === 'orthographic' ? 'orthographic' : 'perspective',
        fov: clamp(finite(camera.fov, DEFAULT_CAMERA.fov), 15, 100),
        position: vec3(camera.position, DEFAULT_CAMERA.position),
        target: vec3(camera.target, DEFAULT_CAMERA.target),
        zoom: clamp(finite(camera.zoom, 1), 0.05, 40),
        ratio: EXPORT_RATIOS[camera.ratio] ? camera.ratio : DEFAULT_CAMERA.ratio,
      },
      render: {
        toon: render.toon !== false,
        steps: clamp(Math.round(finite(render.steps, DEFAULT_RENDER.steps)), 2, 6),
        ink: render.ink !== false,
        inkWidth: clamp(finite(render.inkWidth, DEFAULT_RENDER.inkWidth), 0.5, 5),
        inkDepth: clamp(finite(render.inkDepth, DEFAULT_RENDER.inkDepth), 0, 1),
        tone: render.tone === true,
        toneSize: clamp(finite(render.toneSize, DEFAULT_RENDER.toneSize), 3, 16),
      },
      objects,
      nextId: Math.max(finite(raw.nextId, 1), ...numericIds.map(id => id + 1), objects.length + 1),
    },
    dropped,
  };
}

export function serializeScene(doc) {
  return JSON.stringify(doc, null, 2);
}

// ── Edits: each returns a new document, so undo can keep old ones. ──────────

export function addSceneObject(doc, type, { position = [0, OBJECT_TYPES[type]?.size[1] / 2 || 0, 0] } = {}) {
  if (!OBJECT_TYPES[type]) throw new RangeError(`unknown object type: ${type}`);
  const id = `obj-${doc.nextId}`;
  const created = { id, ...object(type, [...position]) };
  return { doc: { ...doc, objects: [...doc.objects, created], nextId: doc.nextId + 1 }, id };
}

export function updateSceneObject(doc, id, patch) {
  let found = false;
  const objects = doc.objects.map(item => {
    if (item.id !== id) return item;
    found = true;
    return normalizeObject({ ...item, ...patch, id: item.id, type: item.type }, item.id);
  });
  return found ? { ...doc, objects } : doc;
}

export function removeSceneObject(doc, id) {
  const objects = doc.objects.filter(item => item.id !== id);
  return objects.length === doc.objects.length ? doc : { ...doc, objects };
}

export function duplicateSceneObject(doc, id, offset = [0.5, 0, 0.5]) {
  const source = doc.objects.find(item => item.id === id);
  if (!source) return { doc, id: null };
  const copyId = `obj-${doc.nextId}`;
  const copy = { ...structuredClone(source), id: copyId, position: source.position.map((value, index) => value + offset[index]) };
  return { doc: { ...doc, objects: [...doc.objects, copy], nextId: doc.nextId + 1 }, id: copyId };
}

/** Pixel size for an export: the long side is `longSide`, the ratio comes from the scene. */
export function exportSize(ratio, longSide = 2400) {
  const [rw, rh] = EXPORT_RATIOS[ratio] || EXPORT_RATIOS['4:3'];
  const side = clamp(Math.round(longSide), 256, 8192);
  return rw >= rh
    ? { width: side, height: Math.round(side * rh / rw) }
    : { width: Math.round(side * rw / rh), height: side };
}

/** Bounded undo history of whole documents (they are small). */
export function createSceneHistory(limit = 80) {
  const undo = [];
  const redo = [];
  return {
    record(previous) {
      undo.push(previous);
      if (undo.length > limit) undo.shift();
      redo.length = 0;
    },
    undo(current) {
      if (!undo.length) return null;
      redo.push(current);
      return undo.pop();
    },
    redo(current) {
      if (!redo.length) return null;
      undo.push(current);
      return redo.pop();
    },
    clear() { undo.length = 0; redo.length = 0; },
    get canUndo() { return undo.length > 0; },
    get canRedo() { return redo.length > 0; },
  };
}
