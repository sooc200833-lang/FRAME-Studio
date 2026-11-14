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
  // Webtoon background set.
  sofa: { label: '소파', group: '가구', size: [1.8, 0.8, 0.85], color: '#b8a999' },
  monitor: { label: '모니터', group: '가구', size: [0.55, 0.42, 0.2], color: '#3a3a40' },
  plant: { label: '화분', group: '가구', size: [0.45, 1, 0.45], color: '#8fa383' },
  blackboard: { label: '칠판', group: '학교', size: [3.6, 1.2, 0.08], color: '#4a5a52' },
  schoolDesk: { label: '학생 책상', group: '학교', size: [0.65, 0.72, 0.45], color: '#c8ad88' },
  locker: { label: '사물함', group: '학교', size: [0.9, 1.8, 0.45], color: '#b9c0c4' },
  counter: { label: '카운터', group: '가게', size: [2.4, 1, 0.6], color: '#cbb89d' },
  shopShelf: { label: '진열대', group: '가게', size: [1.2, 1.6, 0.45], color: '#d9d4c7' },
  stool: { label: '스툴', group: '가게', size: [0.38, 0.7, 0.38], color: '#a88f70' },
  sign: { label: '간판', group: '가게', size: [1.2, 0.5, 0.1], color: '#e6dfcf' },
  awning: { label: '차양', group: '가게', size: [3, 0.5, 1.2], color: '#c9b7a0' },
  vendingMachine: { label: '자판기', group: '가게', size: [1, 1.85, 0.75], color: '#d5d9dc' },
  utilityPole: { label: '전봇대', group: '거리', size: [0.6, 7, 0.6], color: '#8a857d' },
  fence: { label: '난간', group: '거리', size: [3, 1.1, 0.08], color: '#6f6b66' },
  bench: { label: '벤치', group: '거리', size: [1.6, 0.85, 0.55], color: '#a88f70' },
  crosswalk: { label: '횡단보도', group: '거리', size: [4, 0.02, 3], color: '#f0ede6' },
});

export const OBJECT_TYPE_IDS = Object.freeze(Object.keys(OBJECT_TYPES));

export const SCENE_PRESETS = Object.freeze({
  room: '방',
  corridor: '복도',
  street: '거리',
  classroom: '교실',
  cafe: '카페',
  storefront: '가게 앞',
  rooftop: '옥상',
  alley: '골목',
  office: '사무실',
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
    case 'classroom': {
      const items = [
        object('floor', [0, -0.05, 0], { scale: [1.25, 1, 1] }),
        object('wall', [0, 1.5, -4], { scale: [2.5, 1, 1] }),
        object('wall', [-5, 1.5, 0], { rotation: [0, 90 * RAD, 0], scale: [2, 1, 1] }),
        object('window', [-5, 1.7, -2], { rotation: [0, 90 * RAD, 0] }),
        object('window', [-5, 1.7, 0], { rotation: [0, 90 * RAD, 0] }),
        object('window', [-5, 1.7, 2], { rotation: [0, 90 * RAD, 0] }),
        object('blackboard', [0, 1.7, -3.88]),
        object('table', [0, 0.375, -2.7]),
        object('locker', [4.3, 0.9, -3.7]),
      ];
      for (const z of [-0.8, 0.6, 2]) {
        for (const x of [-2.4, -0.8, 0.8, 2.4]) {
          items.push(object('schoolDesk', [x, 0.36, z]));
          items.push(object('chair', [x, 0.475, z + 0.5], { rotation: [0, 180 * RAD, 0], scale: [0.85, 0.9, 0.85] }));
        }
      }
      return items;
    }
    case 'cafe':
      return [
        object('floor', [0, -0.05, 0]),
        object('wall', [0, 1.5, -4], { scale: [2, 1, 1] }),
        object('wall', [-4, 1.5, 0], { rotation: [0, 90 * RAD, 0], scale: [2, 1, 1] }),
        object('window', [-4, 1.6, 0.6], { rotation: [0, 90 * RAD, 0], scale: [2.6, 1.4, 1] }),
        object('counter', [1.6, 0.5, -2.6]),
        object('shopShelf', [1.6, 0.8, -3.7], { scale: [1.8, 1, 1] }),
        object('sign', [1.6, 2.5, -3.9], { scale: [1.6, 1, 1], color: '#8a6f55' }),
        object('stool', [0.9, 0.35, -1.9]),
        object('stool', [1.6, 0.35, -1.9]),
        object('stool', [2.3, 0.35, -1.9]),
        object('table', [-2.4, 0.375, -1], { scale: [0.6, 1, 1] }),
        object('chair', [-2.4, 0.475, -0.2], { rotation: [0, 180 * RAD, 0] }),
        object('chair', [-2.4, 0.475, -1.8]),
        object('table', [-2.4, 0.375, 2], { scale: [0.6, 1, 1] }),
        object('chair', [-2.4, 0.475, 2.8], { rotation: [0, 180 * RAD, 0] }),
        object('chair', [-2.4, 0.475, 1.2]),
        object('plant', [3.5, 0.5, -3.4]),
        object('plant', [-3.5, 0.5, -3.4], { scale: [1.2, 1.3, 1.2] }),
      ];
    case 'storefront':
      return [
        object('road', [0, -0.025, 5.5], { rotation: [0, 90 * RAD, 0] }),
        object('floor', [0, 0.05, 0.5], { scale: [1.75, 1, 0.375], color: '#bdb6a9' }),
        object('box', [0, 3, -4], { scale: [12, 6, 6], color: '#e3ddd2' }),
        object('awning', [0, 2.75, -0.4], { scale: [1.7, 1, 1] }),
        object('sign', [0, 3.9, -0.93], { scale: [3.2, 1.3, 1], color: '#8a6f55' }),
        object('door', [0, 1.15, -0.95]),
        object('window', [-2.5, 1.6, -0.95], { scale: [1.6, 1.3, 1] }),
        object('window', [2.5, 1.6, -0.95], { scale: [1.6, 1.3, 1] }),
        object('vendingMachine', [4.9, 1.025, -0.55]),
        object('bench', [-4.8, 0.525, -0.6]),
        object('plant', [1.1, 0.6, -0.6]),
        object('utilityPole', [6.4, 3.5, 1.5]),
        object('streetLamp', [-6.2, 2.2, 1.6]),
        object('crosswalk', [3, 0.03, 5.5], { rotation: [0, 90 * RAD, 0], scale: [1.6, 1, 1] }),
      ];
    case 'rooftop':
      return [
        object('floor', [0, -0.05, 0], { scale: [1.5, 1, 1.25], color: '#bdb6a9' }),
        object('fence', [0, 0.55, -5], { scale: [4, 1, 1] }),
        object('fence', [-6, 0.55, 0], { rotation: [0, 90 * RAD, 0], scale: [3.33, 1, 1] }),
        object('fence', [6, 0.55, 0], { rotation: [0, 90 * RAD, 0], scale: [3.33, 1, 1] }),
        object('box', [4, 1.3, 2.8], { scale: [3, 2.6, 3], color: '#d7d1c6' }),
        object('door', [2.48, 1.05, 2.8], { rotation: [0, 90 * RAD, 0] }),
        object('box', [-4.6, 0.35, -3.2], { scale: [1.2, 0.7, 0.9], color: '#b9c0c4' }),
        object('bench', [-1.5, 0.425, -4.2]),
        object('building', [-12, 6.75, -19], { scale: [1, 1.5, 1] }),
        object('building', [-1, 4.5, -23]),
        object('building', [10, 9, -21], { scale: [1.2, 2, 1.2] }),
        object('utilityPole', [-7.5, 3.5, -7]),
      ];
    case 'alley':
      return [
        object('floor', [0, -0.05, -8], { scale: [0.45, 1, 3], color: '#9a968f' }),
        object('wall', [-1.8, 1.8, -8], { rotation: [0, 90 * RAD, 0], scale: [6, 1.2, 1] }),
        object('wall', [1.8, 1.8, -8], { rotation: [0, 90 * RAD, 0], scale: [6, 1.2, 1] }),
        object('building', [-4.9, 4.5, -5]),
        object('building', [4.9, 5.4, -12], { scale: [1, 1.2, 1] }),
        object('window', [-1.8, 1.9, -3], { rotation: [0, 90 * RAD, 0] }),
        object('door', [1.8, 1.05, -9], { rotation: [0, 90 * RAD, 0] }),
        object('sign', [1.68, 2.6, -6], { rotation: [0, -90 * RAD, 0] }),
        object('vendingMachine', [-1.3, 0.925, -7], { rotation: [0, 90 * RAD, 0] }),
        object('utilityPole', [1.35, 3.5, -4]),
        object('utilityPole', [-1.35, 3.5, -14]),
        object('plant', [1.4, 0.5, -1.5]),
        object('box', [-1.25, 0.3, -11], { scale: [0.6, 0.6, 0.6], color: '#b59c7c' }),
        object('box', [-1.2, 0.25, -11.8], { scale: [0.5, 0.5, 0.5], color: '#b59c7c' }),
      ];
    case 'office': {
      const items = [
        object('floor', [0, -0.05, 0]),
        object('wall', [0, 1.5, -4], { scale: [2, 1, 1] }),
        object('wall', [-4, 1.5, 0], { rotation: [0, 90 * RAD, 0], scale: [2, 1, 1] }),
        object('window', [-1.8, 1.7, -4], { scale: [1.5, 1.2, 1] }),
        object('window', [1.2, 1.7, -4], { scale: [1.5, 1.2, 1] }),
        object('door', [-4, 1.05, 3], { rotation: [0, 90 * RAD, 0] }),
        object('shelf', [-3.72, 0.95, -2.2], { rotation: [0, 90 * RAD, 0] }),
        object('locker', [-3.7, 0.9, 0.6], { rotation: [0, 90 * RAD, 0] }),
        object('plant', [3.5, 0.5, -3.5]),
        object('sofa', [3.4, 0.4, 2.4], { rotation: [0, -90 * RAD, 0] }),
      ];
      for (const [x, z] of [[-1.2, -1.8], [1.2, -1.8], [-1.2, 0.8], [1.2, 0.8]]) {
        items.push(object('table', [x, 0.375, z]));
        items.push(object('monitor', [x, 0.96, z - 0.18]));
        items.push(object('chair', [x, 0.475, z + 0.75], { rotation: [0, 180 * RAD, 0] }));
      }
      return items;
    }
    default:
      return [object('floor', [0, -0.05, 0], { scale: [1.5, 1, 1.5] })];
  }
}

function presetCamera(preset) {
  if (preset === 'corridor') return { ...DEFAULT_CAMERA, position: [0, 1.6, 3.5], target: [0, 1.4, -6] };
  const views = {
    classroom: { position: [4.4, 1.5, 4.8], target: [-1, 1.2, -2] },
    cafe: { position: [5.2, 1.6, 5.6], target: [-0.2, 1, -1.5] },
    storefront: { fov: 55, position: [-5.5, 1.6, 8.5], target: [1, 2.2, -1] },
    rooftop: { position: [-5, 1.7, 7.5], target: [2, 1.5, -4] },
    alley: { position: [0.3, 1.5, 3.2], target: [0, 1.8, -8] },
    office: { position: [6, 3.2, 7.5], target: [0, 0.9, -0.6] },
  };
  if (views[preset]) return { ...DEFAULT_CAMERA, ...views[preset] };
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
