// 3D Background Studio — editor glue: Three.js scene, camera, gizmo, panels,
// saving and exporting. The scene document (scene-document.js) is the source
// of truth; the Three.js objects are rebuilt from it.

import {
  AmbientLight, Color, DataTexture, DirectionalLight, GridHelper, HemisphereLight, MeshBasicMaterial, MeshLambertMaterial,
  MeshToonMaterial, NearestFilter, OrthographicCamera, PerspectiveCamera, Raycaster, RedFormat, Scene, Vector2, Vector3,
  WebGLRenderTarget, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { BACKGROUND_SLOT, putHandoff } from '../handoff/handoff-store.js';
import { applyTransform, buildSceneObject } from './builders.js';
import { MangaRenderer } from './manga-renderer.js';
import {
  EXPORT_RATIOS, OBJECT_TYPES, SCENE_PRESETS, addSceneObject, createSceneDocument, createSceneHistory, duplicateSceneObject,
  exportSize, parseSceneDocument, removeSceneObject, serializeScene, updateSceneObject,
} from './scene-document.js';

const STORAGE_KEY = 'frame-3d-scene-v1';
const RAD = Math.PI / 180;
const $ = id => document.getElementById(id);

// ── State ────────────────────────────────────────────────────────────────────

let doc = loadStoredScene();
const history = createSceneHistory();
let selectedId = null;
let needsRender = true;
let saveTimer = 0;
// Slider values while dragging; committed (with undo) on release. Documents
// are shared with the undo history, so they are never mutated in place.
let liveRender = {};
const objectsById = new Map();

// ── Three.js setup ───────────────────────────────────────────────────────────

const frame = $('viewportFrame');
const renderer = new WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.autoClear = false;
frame.append(renderer.domElement);

const manga = new MangaRenderer(renderer);
const scene = new Scene();
const overlay = new Scene();
scene.add(new HemisphereLight(0xffffff, 0x8a8478, 1.6));
scene.add(new AmbientLight(0xffffff, 0.35));
const sun = new DirectionalLight(0xffffff, 2.4);
sun.position.set(-6, 10, 7);
scene.add(sun);

const grid = new GridHelper(40, 40, 0x8c8678, 0xc9c3b6);
grid.position.y = -0.01; // just under floors, so floors hide it
overlay.add(grid);

const perspective = new PerspectiveCamera(50, 4 / 3, 0.1, 400);
const orthographic = new OrthographicCamera(-5, 5, 4, -4, 0.1, 400);
let camera = perspective;

const orbit = new OrbitControls(perspective, renderer.domElement);
orbit.enableDamping = false;
orbit.addEventListener('change', () => { syncOrthoFromPerspective(); requestRender(); });
orbit.addEventListener('end', () => storeCamera());

const gizmo = new TransformControls(perspective, renderer.domElement);
gizmo.setSize(1.1);
overlay.add(gizmo.getHelper());
let gizmoBefore = null;
gizmo.addEventListener('dragging-changed', event => {
  orbit.enabled = !event.value;
  if (event.value) gizmoBefore = doc;
  else if (gizmoBefore && selectedId) {
    const group = objectsById.get(selectedId);
    const next = updateSceneObject(doc, selectedId, {
      position: group.position.toArray(),
      rotation: [group.rotation.x, group.rotation.y, group.rotation.z],
      scale: group.scale.toArray(),
    });
    const before = gizmoBefore;
    gizmoBefore = null;
    commit(next, { before });
  }
});
gizmo.addEventListener('objectChange', () => { renderSelectionPanel(); requestRender(); });
gizmo.addEventListener('change', requestRender);

const depthOnly = new MeshBasicMaterial({ colorWrite: false });
const toonMaps = new Map();

function toonGradient(steps) {
  if (toonMaps.has(steps)) return toonMaps.get(steps);
  const data = new Uint8Array(steps);
  for (let index = 0; index < steps; index++) data[index] = Math.round(70 + 185 * index / (steps - 1));
  const texture = new DataTexture(data, steps, 1, RedFormat);
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.needsUpdate = true;
  toonMaps.set(steps, texture);
  return texture;
}

function makeMaterial(color) {
  return doc.render.toon
    ? new MeshToonMaterial({ color: new Color(color), gradientMap: toonGradient(doc.render.steps) })
    : new MeshLambertMaterial({ color: new Color(color) });
}

function materialOf(group) {
  return group.children[0]?.material;
}

function disposeObject(group) {
  materialOf(group)?.dispose();
  scene.remove(group);
}

/** Brings the Three.js scene in line with `doc`. */
function syncScene({ rebuildMaterials = false } = {}) {
  const ids = new Set(doc.objects.map(item => item.id));
  for (const [id, group] of objectsById) {
    if (!ids.has(id)) { disposeObject(group); objectsById.delete(id); }
  }
  for (const item of doc.objects) {
    let group = objectsById.get(item.id);
    // Ids restart in every new scene, so the same id can now be a different
    // type: rebuild instead of reusing the old shape.
    if (group && (rebuildMaterials || group.userData.type !== item.type)) {
      disposeObject(group);
      objectsById.delete(item.id);
      group = null;
    }
    if (!group) {
      group = buildSceneObject(item, makeMaterial(item.color));
      objectsById.set(item.id, group);
      scene.add(group);
    } else {
      applyTransform(group, item);
      const material = materialOf(group);
      if (material && `#${material.color.getHexString()}` !== item.color) material.color.set(item.color);
    }
  }
  if (selectedId && !ids.has(selectedId)) selectedId = null;
  attachGizmo();
  requestRender();
}

// ── Cameras ──────────────────────────────────────────────────────────────────

function viewDistance() {
  return perspective.position.distanceTo(orbit.target);
}

/** Keeps the orthographic camera framing what the perspective camera sees at the target. */
function syncOrthoFromPerspective() {
  const halfHeight = viewDistance() * Math.tan((perspective.fov * RAD) / 2);
  const aspect = perspective.aspect;
  orthographic.left = -halfHeight * aspect;
  orthographic.right = halfHeight * aspect;
  orthographic.top = halfHeight;
  orthographic.bottom = -halfHeight;
  orthographic.position.copy(perspective.position);
  orthographic.quaternion.copy(perspective.quaternion);
  orthographic.updateProjectionMatrix();
}

function applyCamera() {
  const settings = doc.camera;
  perspective.fov = settings.fov;
  perspective.position.fromArray(settings.position);
  orbit.target.fromArray(settings.target);
  perspective.updateProjectionMatrix();
  orbit.update();
  camera = settings.projection === 'orthographic' ? orthographic : perspective;
  gizmo.camera = camera;
  syncOrthoFromPerspective();
  requestRender();
}

function storeCamera() {
  doc = {
    ...doc,
    camera: {
      ...doc.camera,
      position: perspective.position.toArray().map(value => Number(value.toFixed(4))),
      target: orbit.target.toArray().map(value => Number(value.toFixed(4))),
    },
  };
  scheduleSave();
}

function setView(kind) {
  const distance = Math.max(4, viewDistance());
  const target = orbit.target.clone();
  const directions = { front: new Vector3(0, 0, 1), side: new Vector3(1, 0, 0), top: new Vector3(0, 1, 0.0001) };
  if (kind === 'reset') {
    const fresh = createSceneDocument(doc.preset).camera;
    doc = { ...doc, camera: { ...doc.camera, position: fresh.position, target: fresh.target } };
    applyCamera();
  } else {
    perspective.position.copy(target).addScaledVector(directions[kind].normalize(), distance);
    orbit.update();
    syncOrthoFromPerspective();
    storeCamera();
  }
  requestRender();
}

// ── Layout ───────────────────────────────────────────────────────────────────

/** The viewport keeps the export ratio, so what you see is what you export. */
function layout() {
  const stage = $('stageArea');
  const [rw, rh] = EXPORT_RATIOS[doc.camera.ratio];
  const available = stage.getBoundingClientRect();
  const width = Math.max(120, Math.min(available.width, available.height * rw / rh));
  const height = width * rh / rw;
  frame.style.width = `${Math.floor(width)}px`;
  frame.style.height = `${Math.floor(height)}px`;
  renderer.setSize(Math.floor(width), Math.floor(height));
  const pixelRatio = renderer.getPixelRatio();
  manga.setSize(Math.floor(width * pixelRatio), Math.floor(height * pixelRatio));
  perspective.aspect = rw / rh;
  perspective.updateProjectionMatrix();
  syncOrthoFromPerspective();
  requestRender();
}

// ── Rendering ────────────────────────────────────────────────────────────────

function requestRender() {
  needsRender = true;
}

function renderOptions(extra = {}) {
  return { ...doc.render, ...liveRender, transparent: false, ...extra };
}

function draw() {
  renderer.setRenderTarget(null);
  renderer.clear();
  manga.render(scene, camera, renderOptions({ pixelScale: renderer.getPixelRatio() }));
  // Grid and gizmo go on top, depth-tested against the scene but without ink.
  renderer.clearDepth();
  const previous = scene.overrideMaterial;
  scene.overrideMaterial = depthOnly;
  renderer.render(scene, camera);
  scene.overrideMaterial = previous;
  renderer.render(overlay, camera);
}

function loop() {
  if (needsRender) {
    needsRender = false;
    draw();
  }
  requestAnimationFrame(loop);
}

/** Renders the scene at export size and returns a PNG Blob (no grid, no gizmo). */
async function renderPng({ longSide, transparent }) {
  const maxSize = renderer.capabilities.maxTextureSize || 4096;
  const { width, height } = exportSize(doc.camera.ratio, Math.min(longSide, maxSize));
  const target = new WebGLRenderTarget(width, height);
  const viewportWidth = manga.material.uniforms.resolution.value.x;
  manga.setSize(width, height);
  manga.render(scene, camera, renderOptions({ transparent, pixelScale: width / Math.max(1, viewportWidth) * renderer.getPixelRatio() }), target);
  const pixels = new Uint8Array(width * height * 4);
  renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
  target.dispose();
  layout();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  const image = context.createImageData(width, height);
  const rowBytes = width * 4;
  for (let row = 0; row < height; row++) {
    // WebGL rows start at the bottom.
    image.data.set(pixels.subarray((height - 1 - row) * rowBytes, (height - row) * rowBytes), row * rowBytes);
  }
  context.putImageData(image, 0, 0);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  return { blob, width, height };
}

// ── Document changes ─────────────────────────────────────────────────────────

function commit(next, { before = doc, record = true, rebuildMaterials = false } = {}) {
  if (next === before && !rebuildMaterials) return;
  if (record) history.record(before);
  doc = next;
  syncScene({ rebuildMaterials });
  renderPanels();
  scheduleSave();
}

function select(id) {
  selectedId = id;
  attachGizmo();
  renderPanels();
  requestRender();
}

function attachGizmo() {
  const group = selectedId ? objectsById.get(selectedId) : null;
  if (group) gizmo.attach(group);
  else gizmo.detach();
}

function undo() {
  const previous = history.undo(doc);
  if (!previous) return;
  doc = previous;
  applyAfterHistory();
}

function redo() {
  const next = history.redo(doc);
  if (!next) return;
  doc = next;
  applyAfterHistory();
}

function applyAfterHistory() {
  syncScene({ rebuildMaterials: true });
  applyCamera();
  layout();
  renderPanels();
  scheduleSave();
}

// ── Saving ───────────────────────────────────────────────────────────────────

function loadStoredScene() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return parseSceneDocument(stored).doc;
  } catch (error) {
    console.warn('Stored 3D scene could not be read:', error);
  }
  return createSceneDocument('room');
}

function scheduleSave() {
  setSaveState('저장 대기 중');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 600);
}

function saveNow() {
  clearTimeout(saveTimer);
  try {
    localStorage.setItem(STORAGE_KEY, serializeScene(doc));
    setSaveState('이 브라우저에 저장됨');
  } catch (error) {
    console.error('3D scene save failed:', error);
    setSaveState('저장하지 못했어요');
  }
}

function setSaveState(text) {
  $('saveState').textContent = text;
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function fileBase() {
  return (doc.name || '3D 배경').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60);
}

let toastTimer = 0;
function toast(message) {
  const element = $('toast3d');
  element.textContent = message;
  element.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { element.hidden = true; }, 2600);
}

// ── Panels ───────────────────────────────────────────────────────────────────

function buildAddButtons() {
  const host = $('addObjects');
  const groups = new Map();
  for (const [type, info] of Object.entries(OBJECT_TYPES)) {
    if (!groups.has(info.group)) groups.set(info.group, []);
    groups.get(info.group).push([type, info]);
  }
  host.replaceChildren(...[...groups].map(([name, items]) => {
    const section = document.createElement('div');
    section.className = 'add-group';
    const title = document.createElement('h3');
    title.textContent = name;
    const buttons = document.createElement('div');
    buttons.className = 'button-grid';
    for (const [type, info] of items) {
      const button = document.createElement('button');
      button.textContent = info.label;
      button.dataset.add = type;
      button.onclick = () => {
        // New objects land on the floor in front of the view target.
        const target = orbit.target;
        const { doc: next, id } = addSceneObject(doc, type, { position: [Number(target.x.toFixed(2)), OBJECT_TYPES[type].size[1] / 2, Number(target.z.toFixed(2))] });
        commit(next);
        select(id);
      };
      buttons.append(button);
    }
    section.append(title, buttons);
    return section;
  }));
}

function renderObjectList() {
  const list = $('objectList');
  if (!doc.objects.length) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = '오브젝트가 없어요. 위에서 추가해 보세요.';
    list.replaceChildren(empty);
    return;
  }
  const counts = {};
  list.replaceChildren(...doc.objects.map(item => {
    counts[item.type] = (counts[item.type] || 0) + 1;
    const button = document.createElement('button');
    button.className = 'object-item' + (item.id === selectedId ? ' selected' : '');
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = item.color;
    const label = document.createElement('span');
    label.textContent = `${OBJECT_TYPES[item.type].label} ${counts[item.type]}`;
    button.append(swatch, label);
    button.onclick = () => select(item.id === selectedId ? null : item.id);
    return button;
  }));
}

const TRANSFORM_FIELDS = [
  ['posX', 'position', 0, 1], ['posY', 'position', 1, 1], ['posZ', 'position', 2, 1],
  ['rotX', 'rotation', 0, RAD], ['rotY', 'rotation', 1, RAD], ['rotZ', 'rotation', 2, RAD],
  ['sclX', 'scale', 0, 1], ['sclY', 'scale', 1, 1], ['sclZ', 'scale', 2, 1],
];

function renderSelectionPanel() {
  const item = doc.objects.find(entry => entry.id === selectedId);
  $('selectionPanel').hidden = !item;
  $('selectionEmpty').hidden = Boolean(item);
  if (!item) return;
  const group = objectsById.get(item.id);
  const live = {
    position: group.position.toArray(),
    rotation: [group.rotation.x, group.rotation.y, group.rotation.z],
    scale: group.scale.toArray(),
  };
  $('selectionName').textContent = OBJECT_TYPES[item.type].label;
  for (const [id, key, index, unit] of TRANSFORM_FIELDS) {
    const input = $(id);
    if (document.activeElement !== input) input.value = Number((live[key][index] / unit).toFixed(unit === 1 ? 2 : 1));
  }
  if (document.activeElement !== $('objColor')) $('objColor').value = item.color;
}

function renderSettingsPanel() {
  const { camera: cam, render } = doc;
  $('sceneName').value = doc.name;
  $('projection').value = cam.projection;
  $('fov').value = cam.fov;
  $('fovOut').value = `${Math.round(cam.fov)}°`;
  $('fov').disabled = cam.projection === 'orthographic';
  $('ratio').value = cam.ratio;
  $('toon').checked = render.toon;
  $('steps').value = String(render.steps);
  $('steps').disabled = !render.toon;
  $('ink').checked = render.ink;
  $('inkWidth').value = render.inkWidth;
  $('inkWidthOut').value = `${render.inkWidth}px`;
  $('inkDepth').value = Math.round(render.inkDepth * 100);
  $('inkWidth').disabled = $('inkDepth').disabled = !render.ink;
  $('tone').checked = render.tone;
  $('toneSize').value = render.toneSize;
  $('toneSizeOut').value = `${render.toneSize}px`;
  $('toneSize').disabled = !render.tone;
  $('undo3d').disabled = !history.canUndo;
  $('redo3d').disabled = !history.canRedo;
  for (const button of document.querySelectorAll('[data-mode]')) button.classList.toggle('active', button.dataset.mode === gizmo.mode);
}

function renderPanels() {
  renderObjectList();
  renderSelectionPanel();
  renderSettingsPanel();
}

function changeRender(patch, { rebuildMaterials = false } = {}) {
  liveRender = {};
  commit({ ...doc, render: { ...doc.render, ...patch } }, { rebuildMaterials });
}

function changeCamera(patch) {
  const before = doc;
  doc = { ...doc, camera: { ...doc.camera, ...patch } };
  history.record(before);
  applyCamera();
  layout();
  renderPanels();
  scheduleSave();
}

// ── Events ───────────────────────────────────────────────────────────────────

function bindControls() {
  for (const button of document.querySelectorAll('[data-preset]')) {
    button.onclick = () => {
      const preset = button.dataset.preset;
      if (button.dataset.armed !== 'true') {
        // Replacing the scene is undoable, but ask once so a stray tap is harmless.
        for (const other of document.querySelectorAll('[data-preset]')) delete other.dataset.armed;
        button.dataset.armed = 'true';
        button.textContent = '새로 시작?';
        setTimeout(() => { delete button.dataset.armed; button.textContent = SCENE_PRESETS[preset]; }, 2500);
        return;
      }
      delete button.dataset.armed;
      button.textContent = SCENE_PRESETS[preset];
      selectedId = null;
      const fresh = createSceneDocument(preset);
      commit({ ...fresh, render: doc.render, camera: { ...fresh.camera, projection: doc.camera.projection, ratio: doc.camera.ratio, fov: doc.camera.fov } });
      applyCamera();
      layout();
      toast(`${SCENE_PRESETS[preset]} 장면으로 새로 시작했어요 · 되돌리기 가능`);
    };
  }

  for (const button of document.querySelectorAll('[data-mode]')) {
    button.onclick = () => { gizmo.setMode(button.dataset.mode); renderSettingsPanel(); requestRender(); };
  }
  $('snap').onchange = event => {
    const on = event.target.checked;
    gizmo.setTranslationSnap(on ? 0.25 : null);
    gizmo.setRotationSnap(on ? 15 * RAD : null);
    gizmo.setScaleSnap(on ? 0.1 : null);
  };
  $('gridToggle').onchange = event => { grid.visible = event.target.checked; requestRender(); };
  for (const button of document.querySelectorAll('[data-view]')) button.onclick = () => setView(button.dataset.view);

  for (const [id, key, index, unit] of TRANSFORM_FIELDS) {
    $(id).onchange = event => {
      const item = doc.objects.find(entry => entry.id === selectedId);
      const value = Number(event.target.value);
      if (!item || !Number.isFinite(value)) return;
      const vector = [...item[key]];
      vector[index] = value * unit;
      commit(updateSceneObject(doc, item.id, { [key]: vector }));
    };
  }
  $('objColor').onchange = event => { if (selectedId) commit(updateSceneObject(doc, selectedId, { color: event.target.value })); };
  $('objColor').oninput = event => {
    const group = selectedId && objectsById.get(selectedId);
    if (group) { materialOf(group).color.set(event.target.value); requestRender(); }
  };
  $('duplicateObject').onclick = () => {
    if (!selectedId) return;
    const { doc: next, id } = duplicateSceneObject(doc, selectedId);
    commit(next);
    select(id);
  };
  $('deleteObject').onclick = () => deleteSelected();

  $('sceneName').onchange = event => commit({ ...doc, name: event.target.value.trim().slice(0, 80) || '3D 배경' });
  $('projection').onchange = event => changeCamera({ projection: event.target.value });
  $('fov').oninput = event => { perspective.fov = Number(event.target.value); perspective.updateProjectionMatrix(); syncOrthoFromPerspective(); $('fovOut').value = `${event.target.value}°`; requestRender(); };
  $('fov').onchange = event => changeCamera({ fov: Number(event.target.value) });
  $('ratio').onchange = event => changeCamera({ ratio: event.target.value });

  $('toon').onchange = event => changeRender({ toon: event.target.checked }, { rebuildMaterials: true });
  $('steps').onchange = event => changeRender({ steps: Number(event.target.value) }, { rebuildMaterials: true });
  $('ink').onchange = event => changeRender({ ink: event.target.checked });
  $('inkWidth').oninput = event => { $('inkWidthOut').value = `${event.target.value}px`; liveRender.inkWidth = Number(event.target.value); requestRender(); };
  $('inkWidth').onchange = event => changeRender({ inkWidth: Number(event.target.value) });
  $('inkDepth').oninput = event => { liveRender.inkDepth = Number(event.target.value) / 100; requestRender(); };
  $('inkDepth').onchange = event => changeRender({ inkDepth: Number(event.target.value) / 100 });
  $('tone').onchange = event => changeRender({ tone: event.target.checked });
  $('toneSize').oninput = event => { $('toneSizeOut').value = `${event.target.value}px`; liveRender.toneSize = Number(event.target.value); requestRender(); };
  $('toneSize').onchange = event => changeRender({ toneSize: Number(event.target.value) });

  $('undo3d').onclick = undo;
  $('redo3d').onclick = redo;

  $('saveSceneFile').onclick = () => {
    saveNow();
    download(new Blob([serializeScene(doc)], { type: 'application/json' }), `${fileBase()}.frame3d.json`);
  };
  $('openSceneFile').onchange = async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const { doc: opened, dropped } = parseSceneDocument(await file.text());
      selectedId = null;
      commit(opened);
      applyCamera();
      layout();
      toast(dropped ? `장면을 열었어요 (알 수 없는 오브젝트 ${dropped}개는 뺐어요)` : '장면을 열었어요');
    } catch (error) {
      console.error('Scene file could not be opened:', error);
      toast(error instanceof TypeError || error instanceof RangeError ? error.message : '장면 파일을 열지 못했어요');
    }
  };
  $('exportPng').onclick = async () => {
    const button = $('exportPng');
    button.disabled = true;
    try {
      const { blob, width, height } = await renderPng({ longSide: Number($('exportSize').value), transparent: $('transparent').checked });
      download(blob, `${fileBase()}.png`);
      toast(`PNG를 저장했어요 · ${width}×${height}`);
    } catch (error) {
      console.error('PNG export failed:', error);
      toast('PNG를 만들지 못했어요');
    } finally {
      button.disabled = false;
    }
  };
  $('sendToDrawing').onclick = async () => {
    const button = $('sendToDrawing');
    button.disabled = true;
    try {
      saveNow();
      // The drawing canvas is 1200×900; render at that long side.
      const { blob, width, height } = await renderPng({ longSide: 1200, transparent: $('transparent').checked });
      await putHandoff(BACKGROUND_SLOT, { blob, width, height, name: doc.name });
      window.location.href = './drawing.html';
    } catch (error) {
      console.error('Hand-off to drawing failed:', error);
      toast('그리기 화면으로 보내지 못했어요');
      button.disabled = false;
    }
  };

  // Tap (not drag) on the viewport selects the object under the finger.
  const raycaster = new Raycaster();
  const pointer = new Vector2();
  let downAt = null;
  renderer.domElement.addEventListener('pointerdown', event => { downAt = { x: event.clientX, y: event.clientY }; });
  renderer.domElement.addEventListener('pointerup', event => {
    if (!downAt || gizmo.dragging) { downAt = null; return; }
    const moved = Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y);
    downAt = null;
    if (moved > 6) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects([...objectsById.values()], true)[0];
    select(hit?.object.userData.sceneId || null);
  });

  window.addEventListener('keydown', event => {
    const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName);
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return; }
    if (mod && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); return; }
    if (typing) return;
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelected(); }
    else if (event.key === 'Escape') select(null);
    else if (event.key === 'w') { gizmo.setMode('translate'); renderSettingsPanel(); }
    else if (event.key === 'e') { gizmo.setMode('rotate'); renderSettingsPanel(); }
    else if (event.key === 'r') { gizmo.setMode('scale'); renderSettingsPanel(); }
  });
  window.addEventListener('resize', layout);
  new ResizeObserver(layout).observe($('stageArea'));
  window.addEventListener('pagehide', saveNow);
}

function deleteSelected() {
  if (!selectedId) return;
  const id = selectedId;
  selectedId = null;
  commit(removeSceneObject(doc, id));
  toast('오브젝트를 지웠어요 · 되돌리기 가능');
}

// ── Start ────────────────────────────────────────────────────────────────────

buildAddButtons();
bindControls();
syncScene();
applyCamera();
layout();
renderPanels();
setSaveState('이 브라우저에 저장됨');
loop();
// For browser tests and debugging only.
window.__frame3d = { get doc() { return doc; }, select, renderPng };
