// IndexedDB storage for FRAME Studio projects (browser only).
//
// Stores:
//   projects: { id, name, updatedAt, thumbnail, doc }  (doc = project JSON)
//   images:   Blob values keyed by image key (clip cels, layer masks)
//   meta:     small values such as the last opened project id

const DB_NAME = 'frame-studio';
const DB_VERSION = 1;
let dbPromise = null;

export function isProjectStorageAvailable() {
  return typeof indexedDB !== 'undefined';
}

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error('저장이 취소됐어요'));
    tx.onerror = () => reject(tx.error);
  });
}

export function openProjectDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const open = indexedDB.open(DB_NAME, DB_VERSION);
      open.onupgradeneeded = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('images')) db.createObjectStore('images');
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
      open.onblocked = () => reject(new Error('다른 탭이 저장소를 사용 중이에요'));
    }).catch(error => {
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}

export async function dataUrlToBlob(dataUrl) {
  const response = await fetch(dataUrl);
  return response.blob();
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Writes the project document, new/changed images and removes images that
 * are no longer referenced, all in one transaction.
 */
export async function saveProjectRecord(doc, { writeImages = [], deleteKeys = [] } = {}) {
  // Blob conversion happens before the transaction: IndexedDB transactions
  // auto-commit when they wait on unrelated promises.
  const blobs = await Promise.all(writeImages.map(async image => ({ key: image.key, blob: await dataUrlToBlob(image.dataUrl) })));
  const db = await openProjectDb();
  const tx = db.transaction(['projects', 'images', 'meta'], 'readwrite');
  const done = transactionDone(tx);
  tx.objectStore('projects').put({ id: doc.id, name: doc.name, updatedAt: doc.updatedAt, thumbnail: doc.thumbnail, doc });
  for (const { key, blob } of blobs) tx.objectStore('images').put(blob, key);
  for (const key of deleteKeys) tx.objectStore('images').delete(key);
  tx.objectStore('meta').put(doc.id, 'lastProjectId');
  await done;
}

export async function loadProjectRecord(id) {
  const db = await openProjectDb();
  return request(db.transaction('projects').objectStore('projects').get(id));
}

export async function loadImageDataUrls(keys) {
  const db = await openProjectDb();
  const store = db.transaction('images').objectStore('images');
  const blobs = await Promise.all([...keys].map(key => request(store.get(key)).then(blob => [key, blob])));
  const entries = await Promise.all(blobs.map(async ([key, blob]) => [key, blob ? await blobToDataUrl(blob) : null]));
  return new Map(entries);
}

export async function listProjects() {
  const db = await openProjectDb();
  const records = await request(db.transaction('projects').objectStore('projects').getAll());
  return records
    .map(record => ({ id: record.id, name: record.name, updatedAt: record.updatedAt, thumbnail: record.thumbnail }))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

/** Every stored image key that belongs to a project (keys are `${projectId}/…`). */
function projectImageRange(id) {
  return IDBKeyRange.bound(`${id}/`, `${id}/\uffff`);
}

/**
 * Copies a saved project under a new id. `retarget(doc)` must return
 * `{ doc, keyMap }` (see retargetProjectDocument). Images are copied as Blobs.
 */
export async function duplicateProjectRecord(id, retarget) {
  const db = await openProjectDb();
  const read = db.transaction(['projects', 'images']);
  const record = await request(read.objectStore('projects').get(id));
  if (!record?.doc) throw new Error('작품을 찾지 못했어요');
  const { doc, keyMap } = retarget(record.doc);
  const images = read.objectStore('images');
  const blobs = await Promise.all([...keyMap].map(([from, to]) => request(images.get(from)).then(blob => [to, blob])));
  const tx = db.transaction(['projects', 'images'], 'readwrite');
  const done = transactionDone(tx);
  tx.objectStore('projects').put({ id: doc.id, name: doc.name, updatedAt: doc.updatedAt, thumbnail: record.thumbnail, doc });
  for (const [key, blob] of blobs) if (blob) tx.objectStore('images').put(blob, key);
  await done;
  return doc;
}

/**
 * Deletes a project and all its images. Returns a snapshot that
 * restoreProjectSnapshot can put back (for "undo delete").
 */
export async function deleteProjectRecord(id) {
  const db = await openProjectDb();
  const tx = db.transaction(['projects', 'images', 'meta'], 'readwrite');
  const done = transactionDone(tx);
  const projects = tx.objectStore('projects');
  const images = tx.objectStore('images');
  const range = projectImageRange(id);
  const [record, keys, blobs, lastId] = await Promise.all([
    request(projects.get(id)),
    request(images.getAllKeys(range)),
    request(images.getAll(range)),
    request(tx.objectStore('meta').get('lastProjectId')),
  ]);
  projects.delete(id);
  images.delete(range);
  if (lastId === id) tx.objectStore('meta').delete('lastProjectId');
  await done;
  return { record, images: keys.map((key, index) => [key, blobs[index]]) };
}

export async function restoreProjectSnapshot(snapshot) {
  if (!snapshot?.record) return;
  const db = await openProjectDb();
  const tx = db.transaction(['projects', 'images'], 'readwrite');
  const done = transactionDone(tx);
  tx.objectStore('projects').put(snapshot.record);
  for (const [key, blob] of snapshot.images) tx.objectStore('images').put(blob, key);
  await done;
}

export async function getMeta(key) {
  const db = await openProjectDb();
  return request(db.transaction('meta').objectStore('meta').get(key));
}

export async function setMeta(key, value) {
  const db = await openProjectDb();
  const tx = db.transaction('meta', 'readwrite');
  const done = transactionDone(tx);
  tx.objectStore('meta').put(value, key);
  await done;
}

/** Asks the browser not to evict saved projects (Safari may clear site data otherwise). */
export async function requestPersistentStorage() {
  try {
    return Boolean(await navigator.storage?.persist?.());
  } catch {
    return false;
  }
}
