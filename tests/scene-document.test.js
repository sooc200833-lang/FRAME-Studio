import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OBJECT_TYPE_IDS, SCENE_FORMAT, SCENE_PRESETS, addSceneObject, createSceneDocument, createSceneHistory,
  duplicateSceneObject, exportSize, parseSceneDocument, removeSceneObject, serializeScene, updateSceneObject,
} from '../apps/web/src/studio3d/scene-document.js';

test('every preset builds a valid scene that survives a JSON round trip', () => {
  for (const preset of Object.keys(SCENE_PRESETS)) {
    const doc = createSceneDocument(preset);
    assert.equal(doc.format, SCENE_FORMAT);
    assert.ok(doc.objects.length >= 1, preset);
    assert.ok(doc.objects.every(item => OBJECT_TYPE_IDS.includes(item.type)));
    assert.equal(new Set(doc.objects.map(item => item.id)).size, doc.objects.length, 'ids are unique');
    const { doc: parsed, dropped } = parseSceneDocument(serializeScene(doc));
    assert.equal(dropped, 0);
    assert.deepEqual(parsed, doc);
  }
});

test('unknown presets fall back to an empty scene', () => {
  assert.equal(createSceneDocument('castle').preset, 'empty');
});

test('edits return new documents and never mutate the old one', () => {
  const doc = createSceneDocument('empty');
  const before = structuredClone(doc);
  const { doc: added, id } = addSceneObject(doc, 'table');
  assert.deepEqual(doc, before);
  assert.equal(added.objects.at(-1).id, id);
  const moved = updateSceneObject(added, id, { position: [2, 0.4, 1], scale: [2, 1, 1] });
  assert.deepEqual(moved.objects.at(-1).position, [2, 0.4, 1]);
  assert.equal(added.objects.at(-1).position[0], 0);
  const { doc: copied, id: copyId } = duplicateSceneObject(moved, id);
  assert.notEqual(copyId, id);
  assert.deepEqual(copied.objects.at(-1).position, [2.5, 0.4, 1.5]);
  const removed = removeSceneObject(copied, id);
  assert.equal(removed.objects.some(item => item.id === id), false);
  assert.equal(removeSceneObject(removed, 'nope'), removed);
});

test('updates cannot change an object type or id, and values are clamped', () => {
  const { doc, id } = addSceneObject(createSceneDocument('empty'), 'box');
  const updated = updateSceneObject(doc, id, { type: 'sphere', id: 'hack', scale: [0, -3, 999], color: 'red' });
  const item = updated.objects.find(entry => entry.id === id);
  assert.equal(item.type, 'box');
  assert.deepEqual(item.scale, [1, 3, 50]);
  assert.match(item.color, /^#[0-9a-f]{6}$/);
});

test('parse rejects non-scenes and newer versions, drops unknown objects, fixes ids', () => {
  assert.throws(() => parseSceneDocument('{"hello":1}'), TypeError);
  assert.throws(() => parseSceneDocument({ format: SCENE_FORMAT, version: 99 }), RangeError);
  const { doc, dropped } = parseSceneDocument({
    format: SCENE_FORMAT,
    version: 1,
    objects: [
      { id: 'obj-4', type: 'box', position: [1, 2, 3] },
      { id: 'obj-4', type: 'chair' },
      { type: 'spaceship' },
      { type: 'wall', position: ['x', 2, null] },
    ],
    camera: { projection: 'fisheye', fov: 400 },
    render: { steps: 99, tone: 'yes' },
  });
  assert.equal(dropped, 1);
  assert.deepEqual(doc.objects.map(item => item.id), ['obj-4', 'obj-4-copy', 'obj-5']);
  assert.deepEqual(doc.objects[2].position, [0, 2, 0]);
  assert.equal(doc.camera.projection, 'perspective');
  assert.equal(doc.camera.fov, 100);
  assert.equal(doc.render.steps, 6);
  assert.equal(doc.render.tone, false);
  assert.ok(doc.nextId >= 5, 'new objects never reuse an existing id');
  const { id } = addSceneObject(doc, 'box');
  assert.equal(doc.objects.some(item => item.id === id), false);
});

test('export size keeps the ratio with the given long side', () => {
  assert.deepEqual(exportSize('4:3', 1200), { width: 1200, height: 900 });
  assert.deepEqual(exportSize('3:4', 1200), { width: 900, height: 1200 });
  assert.deepEqual(exportSize('16:9', 1920), { width: 1920, height: 1080 });
  assert.deepEqual(exportSize('bogus', 800), { width: 800, height: 600 });
});

test('history undoes and redoes whole documents', () => {
  const history = createSceneHistory(2);
  const a = createSceneDocument('empty');
  const { doc: b } = addSceneObject(a, 'box');
  const { doc: c } = addSceneObject(b, 'chair');
  history.record(a);
  history.record(b);
  assert.equal(history.undo(c), b);
  assert.equal(history.undo(b), a);
  assert.equal(history.undo(a), null);
  assert.equal(history.redo(a), b);
  history.record(b); // a new edit clears redo
  assert.equal(history.canRedo, false);
  const capped = createSceneHistory(2);
  capped.record(1); capped.record(2); capped.record(3);
  assert.equal(capped.undo(4), 3);
  assert.equal(capped.undo(3), 2);
  assert.equal(capped.undo(2), null, 'oldest entries are dropped at the limit');
});
