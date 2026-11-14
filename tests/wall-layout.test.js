import test from 'node:test';
import assert from 'node:assert/strict';
import { addSceneObject, createSceneDocument, updateSceneObject } from '../apps/web/src/studio3d/scene-document.js';
import { fromWallLocal, openingsKey, snapOpening, snapWall, toWallLocal, wallEnds, wallOpenings } from '../apps/web/src/studio3d/wall-layout.js';

const RAD = Math.PI / 180;
const near = (actual, expected, eps = 1e-6) => assert.ok(Math.abs(actual - expected) <= eps, `${actual} ≈ ${expected}`);
const wallsOf = doc => doc.objects.filter(item => item.type === 'wall');

test('wall-local coordinates round-trip at any yaw', () => {
  const wall = { position: [2, 1.5, -3], rotation: [0, 37 * RAD, 0], scale: [1, 1, 1], type: 'wall' };
  const point = [4.2, 0.7, 1.1];
  fromWallLocal(wall, toWallLocal(wall, point)).forEach((value, index) => near(value, point[index]));
  // Local +x runs along the wall.
  const [x, , z] = toWallLocal({ ...wall, rotation: [0, 0, 0] }, [3, 0, -3]);
  near(x, 1); near(z, 0);
});

test('room preset: the door notches its wall and the window cuts a hole', () => {
  const doc = createSceneDocument('room');
  const [back, side] = wallsOf(doc);
  const windowHoles = wallOpenings(doc, back);
  assert.equal(windowHoles.length, 1);
  assert.equal(windowHoles[0].notch, false);
  // Window is 1.4 m wide on a wall scaled ×2 → 0.7 base units wide.
  near(windowHoles[0].w, 0.7, 1e-3);
  near(windowHoles[0].x, 0.4, 1e-3);
  const doorCuts = wallOpenings(doc, side);
  assert.equal(doorCuts.length, 1);
  assert.equal(doorCuts[0].notch, true, 'a door standing on the floor becomes a notch');
  near(doorCuts[0].y - doorCuts[0].h / 2, -1.5, 1e-3);
});

test('openings ignore walls they do not face or touch, and tilted walls', () => {
  let doc = createSceneDocument('empty');
  let wallId; let windowId;
  ({ doc, id: wallId } = addSceneObject(doc, 'wall', { position: [0, 1.5, 0] }));
  ({ doc, id: windowId } = addSceneObject(doc, 'window', { position: [0, 1.5, 0] }));
  const wall = () => doc.objects.find(item => item.id === wallId);
  assert.equal(wallOpenings(doc, wall()).length, 1);
  doc = updateSceneObject(doc, windowId, { rotation: [0, 45 * RAD, 0] });
  assert.equal(wallOpenings(doc, wall()).length, 0, 'turned 45° away');
  doc = updateSceneObject(doc, windowId, { rotation: [0, 180 * RAD, 0] });
  assert.equal(wallOpenings(doc, wall()).length, 1, 'facing the other way still cuts');
  doc = updateSceneObject(doc, windowId, { position: [0, 1.5, 1.5] });
  assert.equal(wallOpenings(doc, wall()).length, 0, 'too far in front');
  doc = updateSceneObject(doc, windowId, { position: [0, 1.5, 0] });
  doc = updateSceneObject(doc, wallId, { rotation: [10 * RAD, 0, 0] });
  assert.equal(wallOpenings(doc, wall()).length, 0, 'tilted walls are left alone');
});

test('overlapping openings keep only the first; the key changes with openings', () => {
  let doc = createSceneDocument('empty');
  let wallId;
  ({ doc, id: wallId } = addSceneObject(doc, 'wall', { position: [0, 1.5, 0] }));
  ({ doc } = addSceneObject(doc, 'window', { position: [0, 1.5, 0] }));
  const wall = () => doc.objects.find(item => item.id === wallId);
  const before = openingsKey(wallOpenings(doc, wall()));
  ({ doc } = addSceneObject(doc, 'window', { position: [0.3, 1.4, 0] }));
  assert.equal(wallOpenings(doc, wall()).length, 1);
  ({ doc } = addSceneObject(doc, 'window', { position: [-1.4, 1.5, 0] }));
  assert.equal(wallOpenings(doc, wall()).length, 2);
  assert.notEqual(openingsKey(wallOpenings(doc, wall())), before);
});

test('openings never reach the wall sides or top', () => {
  let doc = createSceneDocument('empty');
  let wallId;
  ({ doc, id: wallId } = addSceneObject(doc, 'wall', { position: [0, 1.5, 0] }));
  ({ doc } = addSceneObject(doc, 'window', { position: [1.8, 2.9, 0] }));
  const [hole] = wallOpenings(doc, doc.objects.find(item => item.id === wallId));
  assert.ok(hole.x + hole.w / 2 < 2 && hole.y + hole.h / 2 < 1.5, JSON.stringify(hole));
});

test('snapWall joins a nearby wall end and ignores far ones', () => {
  let doc = createSceneDocument('empty');
  let a; let b;
  ({ doc, id: a } = addSceneObject(doc, 'wall', { position: [0, 1.5, 0] }));
  ({ doc, id: b } = addSceneObject(doc, 'wall', { position: [2.3, 1.5, 2.2] }));
  doc = updateSceneObject(doc, b, { rotation: [0, 90 * RAD, 0] });
  const patch = snapWall(doc, b);
  assert.ok(patch);
  const snapped = updateSceneObject(doc, b, patch);
  const ends = wallEnds(snapped.objects.find(item => item.id === b));
  const target = wallEnds(snapped.objects.find(item => item.id === a))[1];
  assert.ok(ends.some(([x, z]) => Math.hypot(x - target[0], z - target[1]) < 1e-3));
  doc = updateSceneObject(doc, b, { position: [6, 1.5, 6] });
  assert.equal(snapWall(doc, b), null);
});

test('snapOpening seats a door in the wall, standing on the floor, facing along it', () => {
  let doc = createSceneDocument('empty');
  let wallId; let doorId;
  ({ doc, id: wallId } = addSceneObject(doc, 'wall', { position: [0, 1.5, -2] }));
  doc = updateSceneObject(doc, wallId, { rotation: [0, 30 * RAD, 0] });
  ({ doc, id: doorId } = addSceneObject(doc, 'door', { position: [0.4, 1.4, -1.6] }));
  doc = updateSceneObject(doc, doorId, { rotation: [0, 20 * RAD, 0] });
  const patch = snapOpening(doc, doorId);
  assert.ok(patch);
  const wall = doc.objects.find(item => item.id === wallId);
  const [, ly, lz] = toWallLocal(wall, patch.position);
  near(lz, 0, 1e-3);
  near(ly - 2.1 / 2, -1.5, 1e-3); // door bottom on the wall bottom
  near(patch.rotation[1], 30 * RAD, 1e-3);
  // It now cuts its wall.
  const seated = updateSceneObject(doc, doorId, patch);
  assert.equal(wallOpenings(seated, seated.objects.find(item => item.id === wallId))[0].notch, true);
  // Too far from any wall: no snap.
  assert.equal(snapOpening(updateSceneObject(doc, doorId, { position: [0, 1, 4] }), doorId), null);
});
