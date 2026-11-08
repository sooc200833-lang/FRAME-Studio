// FRAME Studio project document format. Pure data, no DOM or storage.
//
// A saved project is one JSON document plus a set of images stored by key.
// Images (clip cels and layer masks) are kept out of the JSON so unchanged
// drawings do not have to be rewritten on every save.

export const PROJECT_FORMAT = 'frame-studio-project';
export const PROJECT_VERSION = 2;

const finite = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const text = (value, fallback = '') => (typeof value === 'string' ? value : fallback);

export function clipImageKey(projectId, clipId) {
  return `${projectId}/clip/${clipId}`;
}

export function maskImageKey(projectId, layerId) {
  return `${projectId}/mask/${layerId}`;
}

/**
 * Builds the JSON document and the list of images it references.
 * `images` entries are `{ key, dataUrl }`; callers decide which to (re)write.
 */
export function buildProjectDocument({
  id, name, createdAt, updatedAt = new Date().toISOString(), width, height,
  layers = [], groups = [], timeline, active = 0, activeTrackId = null, nextLayerId = 1, thumbnail = null,
}) {
  const images = [];
  const docLayers = layers.map(layer => {
    let maskImage = null;
    if (layer.maskEnabled && layer.maskDataUrl) {
      maskImage = maskImageKey(id, layer.id);
      images.push({ key: maskImage, dataUrl: layer.maskDataUrl });
    }
    return {
      id: layer.id,
      name: text(layer.name, '레이어'),
      visible: layer.visible !== false,
      opacity: finite(layer.opacity, 1),
      blendMode: text(layer.blendMode, 'normal'),
      groupId: layer.groupId || null,
      maskEnabled: Boolean(layer.maskEnabled),
      maskImage,
      motionTrack: (layer.motionTrack || []).map(keyframe => ({ ...keyframe })),
    };
  });
  const tracks = {};
  for (const [trackId, track] of Object.entries(timeline?.tracks || {})) {
    tracks[trackId] = {
      clips: (track.clips || []).map(clip => {
        let celImage = null;
        if (clip.cel) {
          celImage = clipImageKey(id, clip.id);
          images.push({ key: celImage, dataUrl: clip.cel });
        }
        return {
          id: clip.id,
          hold: finite(clip.hold, 1),
          celImage,
          transformCel: Array.isArray(clip.transformCel) ? clip.transformCel : [],
          ...(Array.isArray(clip.strokes) ? { strokes: clip.strokes } : {}),
        };
      }),
    };
  }
  return {
    doc: {
      format: PROJECT_FORMAT,
      version: PROJECT_VERSION,
      id,
      name: text(name, '제목 없음'),
      createdAt: createdAt || updatedAt,
      updatedAt,
      canvas: { width, height },
      fps: finite(timeline?.fps, 12),
      playhead: Math.max(0, Math.floor(finite(timeline?.playhead, 0))),
      nextClipId: Math.max(1, Math.floor(finite(timeline?.nextClipId, 1))),
      nextLayerId: Math.max(1, Math.floor(finite(nextLayerId, 1))),
      active: Math.max(0, Math.floor(finite(active, 0))),
      activeTrackId: activeTrackId || null,
      groups: groups.map(group => ({ ...group })),
      layers: docLayers,
      tracks,
      thumbnail: typeof thumbnail === 'string' ? thumbnail : null,
    },
    images,
  };
}

/**
 * v1 → v2: vector lines used to live in one shared 'vector' track drawn above
 * all layers. In v2 every layer track holds its own lines, so the old vector
 * track becomes a new top layer named "벡터 선" with the same timing.
 */
function migrateV1VectorTrack(doc) {
  const tracks = { ...(doc.tracks || {}) };
  const vector = tracks.vector;
  delete tracks.vector;
  const hasLines = (vector?.clips || []).some(clip => Array.isArray(clip?.strokes) && clip.strokes.length);
  if (!hasLines) return { ...doc, tracks };
  const layers = Array.isArray(doc.layers) ? [...doc.layers] : [];
  const highest = Math.max(0, ...layers.map(layer => Number(/^layer-(\d+)$/.exec(layer?.id || '')?.[1]) || 0));
  const id = `layer-${highest + 1}`;
  layers.push({ id, name: '벡터 선', visible: true, opacity: 1, blendMode: 'normal', groupId: null, maskEnabled: false, maskImage: null, motionTrack: [] });
  tracks[id] = vector;
  return { ...doc, layers, tracks, nextLayerId: Math.max(Number(doc.nextLayerId) || 1, highest + 2), activeTrackId: null };
}

/** Upgrades older documents to the current version. */
export function migrateProjectDocument(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('프로젝트 데이터가 비어 있어요');
  if (raw.format !== PROJECT_FORMAT) throw new Error('FRAME Studio 프로젝트가 아니에요');
  const version = Math.floor(finite(raw.version, 0));
  if (version > PROJECT_VERSION) throw new Error('더 새로운 버전에서 만든 프로젝트예요');
  let doc = { ...raw };
  if (version < 2) doc = migrateV1VectorTrack(doc);
  return { ...doc, version: PROJECT_VERSION };
}

/**
 * Validates and normalizes a stored document. Unknown or broken parts are
 * dropped rather than failing the whole project, but the document must have
 * at least one layer and matching canvas size.
 */
export function parseProjectDocument(raw, { width, height } = {}) {
  const doc = migrateProjectDocument(raw);
  if (width && height && (doc.canvas?.width !== width || doc.canvas?.height !== height)) {
    throw new Error('캔버스 크기가 달라서 불러올 수 없어요');
  }
  const layers = (Array.isArray(doc.layers) ? doc.layers : [])
    .filter(layer => layer && typeof layer.id === 'string')
    .map(layer => ({
      id: layer.id,
      name: text(layer.name, '레이어'),
      visible: layer.visible !== false,
      opacity: Math.min(1, Math.max(0, finite(layer.opacity, 1))),
      blendMode: text(layer.blendMode, 'normal'),
      groupId: typeof layer.groupId === 'string' ? layer.groupId : null,
      maskEnabled: Boolean(layer.maskEnabled),
      maskImage: typeof layer.maskImage === 'string' ? layer.maskImage : null,
      motionTrack: Array.isArray(layer.motionTrack) ? layer.motionTrack.filter(keyframe => keyframe && Number.isFinite(Number(keyframe.tick))) : [],
    }));
  if (!layers.length) throw new Error('레이어가 없는 프로젝트예요');
  const groups = (Array.isArray(doc.groups) ? doc.groups : []).filter(group => group && typeof group.id === 'string');
  const groupIds = new Set(groups.map(group => group.id));
  layers.forEach(layer => { if (layer.groupId && !groupIds.has(layer.groupId)) layer.groupId = null; });

  const tracks = {};
  for (const [trackId, track] of Object.entries(doc.tracks && typeof doc.tracks === 'object' ? doc.tracks : {})) {
    const clips = (Array.isArray(track?.clips) ? track.clips : [])
      .filter(clip => clip && typeof clip.id === 'string')
      .map(clip => ({
        id: clip.id,
        hold: Math.max(1, Math.floor(finite(clip.hold, 1))),
        celImage: typeof clip.celImage === 'string' ? clip.celImage : null,
        transformCel: Array.isArray(clip.transformCel) ? clip.transformCel : [],
        ...(Array.isArray(clip.strokes) ? { strokes: clip.strokes } : {}),
      }));
    // Tracks belong to layers; a track without its layer is dropped.
    if (clips.length && layers.some(layer => layer.id === trackId)) tracks[trackId] = { id: trackId, clips };
  }
  // Clip ids must stay unique after restore, so the counter is kept above every saved id.
  const highestClip = Math.max(0, ...Object.values(tracks).flatMap(track => track.clips)
    .map(clip => Number(/^clip-(\d+)$/.exec(clip.id)?.[1]) || 0));
  const highestLayer = Math.max(0, ...layers.map(layer => Number(/^layer-(\d+)$/.exec(layer.id)?.[1]) || 0));

  return {
    id: text(doc.id),
    name: text(doc.name, '제목 없음'),
    createdAt: text(doc.createdAt),
    updatedAt: text(doc.updatedAt),
    fps: Math.min(60, Math.max(1, finite(doc.fps, 12))),
    playhead: Math.max(0, Math.floor(finite(doc.playhead, 0))),
    nextClipId: Math.max(highestClip + 1, Math.floor(finite(doc.nextClipId, 1))),
    nextLayerId: Math.max(highestLayer + 1, Math.floor(finite(doc.nextLayerId, 1))),
    active: Math.min(layers.length - 1, Math.max(0, Math.floor(finite(doc.active, 0)))),
    activeTrackId: doc.activeTrackId === 'vector' ? 'vector' : null,
    groups,
    layers,
    tracks,
    thumbnail: typeof doc.thumbnail === 'string' ? doc.thumbnail : null,
  };
}

/** Image keys referenced by a parsed or built document. */
export function referencedImageKeys(doc) {
  const keys = new Set();
  for (const layer of doc.layers || []) if (layer.maskImage) keys.add(layer.maskImage);
  for (const track of Object.values(doc.tracks || {})) {
    for (const clip of track.clips || []) if (clip.celImage) keys.add(clip.celImage);
  }
  return keys;
}

/**
 * Returns a copy of a saved project document under a new id (for "duplicate").
 * Image keys are project-scoped, so every key is remapped; `keyMap` maps the
 * old key to the new one so the caller can copy the stored images.
 */
export function retargetProjectDocument(doc, newId, { name, now = new Date().toISOString() } = {}) {
  if (!doc || typeof doc !== 'object') throw new TypeError('doc must be a project document');
  if (typeof newId !== 'string' || !newId) throw new TypeError('newId must be a non-empty string');
  const keyMap = new Map();
  const remap = (oldKey, newKey) => {
    if (!oldKey) return null;
    keyMap.set(oldKey, newKey);
    return newKey;
  };
  const copy = structuredClone(doc);
  copy.id = newId;
  copy.name = text(name, `${text(doc.name, '제목 없음')} 사본`);
  copy.createdAt = now;
  copy.updatedAt = now;
  for (const layer of copy.layers || []) {
    layer.maskImage = remap(layer.maskImage, maskImageKey(newId, layer.id));
  }
  for (const track of Object.values(copy.tracks || {})) {
    for (const clip of track.clips || []) clip.celImage = remap(clip.celImage, clipImageKey(newId, clip.id));
  }
  return { doc: copy, keyMap };
}

/** Name for a duplicate that doesn't clash with existing names: "A 사본", "A 사본 2", … */
export function duplicateProjectName(name, existingNames = []) {
  const base = `${text(name, '제목 없음').trim() || '제목 없음'} 사본`;
  const taken = new Set(existingNames);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
}
