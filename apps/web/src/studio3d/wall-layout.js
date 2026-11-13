// Wall layout helpers for the 3D Background Studio. Pure math on the scene
// document (no Three.js): which doors/windows cut which walls, and snapping
// walls together and openings into walls. Only walls/openings that are turned
// about the vertical axis take part; tilted ones are left alone.

import { OBJECT_TYPES } from './scene-document.js';

const OPENING_TYPES = new Set(['door', 'window']);
const LEVEL = 1e-3; // radians: "not tilted"
const ALIGN = 5 * Math.PI / 180; // an opening must face the wall within 5°
const EDGE = 0.01; // m: openings this close to the wall bottom become notches
const LINTEL = 0.02; // m of wall kept above an opening that reaches the top

const isLevel = item => Math.abs(item.rotation[0]) < LEVEL && Math.abs(item.rotation[2]) < LEVEL;

/** World size of an object (catalog size × scale). */
export function worldSize(item) {
  const base = OBJECT_TYPES[item.type].size;
  return base.map((value, index) => value * item.scale[index]);
}

/** World point → wall-local metres (x along the wall, y up, z through it). */
export function toWallLocal(wall, [px, py, pz]) {
  const yaw = wall.rotation[1];
  const dx = px - wall.position[0];
  const dz = pz - wall.position[2];
  return [dx * Math.cos(yaw) - dz * Math.sin(yaw), py - wall.position[1], dx * Math.sin(yaw) + dz * Math.cos(yaw)];
}

/** Wall-local metres → world point. */
export function fromWallLocal(wall, [x, y, z]) {
  const yaw = wall.rotation[1];
  return [wall.position[0] + x * Math.cos(yaw) + z * Math.sin(yaw), wall.position[1] + y, wall.position[2] - x * Math.sin(yaw) + z * Math.cos(yaw)];
}

/** Angle difference folded to [0, π/2]: 0 when parallel either way round. */
function facingDifference(a, b) {
  const d = Math.abs(((a - b) % Math.PI + Math.PI) % Math.PI);
  return Math.min(d, Math.PI - d);
}

const round = value => Math.round(value * 1000) / 1000;

/**
 * Openings that `wall` should have, as rectangles in the wall's *base*
 * geometry units (catalog size, centred; the wall's scale is applied by its
 * Group): [{ x, y, w, h, notch }]. `notch` openings reach the wall bottom (a
 * door) and are cut into the outline instead of being holes. Overlapping
 * openings after the first are ignored, so the shape stays valid.
 */
export function wallOpenings(doc, wall) {
  if (wall.type !== 'wall' || !isLevel(wall)) return [];
  const [baseW, baseH] = OBJECT_TYPES.wall.size;
  const [sx, sy] = wall.scale;
  const [wallW, wallH, wallD] = worldSize(wall);
  const accepted = [];
  for (const item of doc.objects) {
    if (!OPENING_TYPES.has(item.type) || !isLevel(item)) continue;
    if (facingDifference(item.rotation[1], wall.rotation[1]) > ALIGN) continue;
    const [lx, ly, lz] = toWallLocal(wall, item.position);
    if (Math.abs(lz) > wallD / 2 + 0.25) continue;
    const [ow, oh] = worldSize(item);
    let left = Math.max(lx - ow / 2, -wallW / 2);
    let right = Math.min(lx + ow / 2, wallW / 2);
    let bottom = Math.max(ly - oh / 2, -wallH / 2);
    let top = Math.min(ly + oh / 2, wallH / 2 - LINTEL);
    // Keep a sliver of wall at the sides so the outline stays one piece.
    left = Math.max(left, -wallW / 2 + LINTEL);
    right = Math.min(right, wallW / 2 - LINTEL);
    if (right - left < 0.05 || top - bottom < 0.05) continue;
    const notch = bottom - -wallH / 2 < EDGE;
    if (notch) bottom = -wallH / 2;
    const rect = { left, right, bottom, top };
    if (accepted.some(other => rect.left < other.right && rect.right > other.left && rect.bottom < other.top && rect.top > other.bottom)) continue;
    accepted.push({ ...rect, notch });
  }
  // Convert metres to base units (the Group's scale turns them back).
  const unitX = baseW / wallW * sx;
  const unitY = baseH / wallH * sy;
  return accepted
    .map(({ left, right, bottom, top, notch }) => ({
      x: round(((left + right) / 2) * unitX / sx),
      y: round(((bottom + top) / 2) * unitY / sy),
      w: round((right - left) * unitX / sx),
      h: round((top - bottom) * unitY / sy),
      notch,
    }))
    .sort((a, b) => a.x - b.x || a.y - b.y);
}

/** Stable key for "do this wall's openings differ?" */
export function openingsKey(openings) {
  return openings.map(o => `${o.x},${o.y},${o.w},${o.h},${o.notch ? 1 : 0}`).join(';');
}

/** The two ends of a level wall, on the floor plane: [[x, z], [x, z]]. */
export function wallEnds(wall) {
  const [width] = worldSize(wall);
  return [-width / 2, width / 2].map(x => {
    const [wx, , wz] = fromWallLocal(wall, [x, 0, 0]);
    return [wx, wz];
  });
}

/**
 * Snap a wall's end onto the nearest end of another wall within `tolerance`
 * metres. Returns `{ position }` to apply, or null when nothing is close.
 */
export function snapWall(doc, id, tolerance = 0.5) {
  const wall = doc.objects.find(item => item.id === id);
  if (!wall || wall.type !== 'wall' || !isLevel(wall)) return null;
  let best = null;
  for (const other of doc.objects) {
    if (other.id === id || other.type !== 'wall' || !isLevel(other)) continue;
    for (const [ex, ez] of wallEnds(wall)) {
      for (const [ox, oz] of wallEnds(other)) {
        const distance = Math.hypot(ox - ex, oz - ez);
        if (distance > 1e-6 && distance <= tolerance && (!best || distance < best.distance)) best = { distance, dx: ox - ex, dz: oz - ez };
      }
    }
  }
  if (!best) return null;
  return { position: [round(wall.position[0] + best.dx), wall.position[1], round(wall.position[2] + best.dz)] };
}

/**
 * Seat a door/window in the nearest level wall within `tolerance` metres of
 * its face: centred in the wall's thickness, turned to face the same way
 * (keeping which side it faces), doors standing on the wall's bottom.
 * Returns `{ position, rotation }` or null.
 */
export function snapOpening(doc, id, tolerance = 0.6) {
  const item = doc.objects.find(entry => entry.id === id);
  if (!item || !OPENING_TYPES.has(item.type) || !isLevel(item)) return null;
  const [, oh] = worldSize(item);
  let best = null;
  for (const wall of doc.objects) {
    if (wall.type !== 'wall' || !isLevel(wall)) continue;
    const [wallW, wallH] = worldSize(wall);
    const [lx, ly, lz] = toWallLocal(wall, item.position);
    if (Math.abs(lx) > wallW / 2 || Math.abs(lz) > tolerance) continue;
    if (!best || Math.abs(lz) < best.distance) best = { wall, lx, ly, distance: Math.abs(lz), wallH };
  }
  if (!best) return null;
  const { wall, lx, wallH } = best;
  const y = item.type === 'door' ? -wallH / 2 + oh / 2 : best.ly;
  const position = fromWallLocal(wall, [lx, y, 0]).map(round);
  // Face the same way as the wall, or the opposite way if that is closer.
  const flipped = Math.cos(item.rotation[1] - wall.rotation[1]) < 0;
  const yaw = wall.rotation[1] + (flipped ? Math.PI : 0);
  return { position, rotation: [0, round(Math.atan2(Math.sin(yaw), Math.cos(yaw))), 0] };
}
