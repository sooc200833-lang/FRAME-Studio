// Hands a rendered image from one workspace to another (3D Background Studio →
// Drawing Studio). A small separate IndexedDB keeps the drawing project store
// and its schema untouched. One pending item per slot; taking it removes it.

const DB_NAME = 'frame-handoff';
const STORE = 'items';

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run(mode, action) {
  return openDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    let result;
    const request = action(tx.objectStore(STORE));
    if (request) request.onsuccess = () => { result = request.result; };
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  }));
}

/** item: { blob, width, height, name } */
export function putHandoff(slot, item) {
  return run('readwrite', store => store.put({ ...item, createdAt: Date.now() }, slot));
}

/** Returns the pending item (or null) and removes it, in one transaction. */
export async function takeHandoff(slot, { maxAgeMs = 10 * 60 * 1000 } = {}) {
  if (typeof indexedDB === 'undefined') return null;
  let item = null;
  await run('readwrite', store => {
    const request = store.get(slot);
    request.onsuccess = () => {
      item = request.result || null;
      if (item) store.delete(slot);
    };
    return null;
  });
  // A stale hand-off (e.g. the drawing tab was never opened) is dropped.
  if (!item || Date.now() - (item.createdAt || 0) > maxAgeMs) return null;
  return item;
}

export const BACKGROUND_SLOT = 'background';
export const GUIDES_SLOT = 'perspective-guides';
/** Drawing → 3D studio: re-edit the scene behind a layer. */
export const EDIT_SLOT = 'edit-3d-layer';

/** Largest centred rectangle with the image's aspect ratio inside the canvas. */
export function containRect(imageWidth, imageHeight, canvasWidth, canvasHeight) {
  const scale = Math.min(canvasWidth / imageWidth, canvasHeight / imageHeight);
  const width = Math.round(imageWidth * scale);
  const height = Math.round(imageHeight * scale);
  return { x: Math.round((canvasWidth - width) / 2), y: Math.round((canvasHeight - height) / 2), width, height };
}
