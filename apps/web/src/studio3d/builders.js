// Builds Three.js objects for scene-document types. Each builder returns a
// Group whose shapes fill the type's base `size`, centred on the origin, so
// position/rotation/scale from the document apply the same way to every type.

import { BoxGeometry, ConeGeometry, CylinderGeometry, ExtrudeGeometry, Group, Mesh, Path, Shape, SphereGeometry } from 'three';
import { OBJECT_TYPES } from './scene-document.js';

// Geometries are shared by every object of a type.
const unitBox = new BoxGeometry(1, 1, 1);
const unitCylinder = new CylinderGeometry(0.5, 0.5, 1, 20);
const unitSphere = new SphereGeometry(0.5, 28, 18);
const unitCone = new ConeGeometry(0.5, 1, 18);

function part(geometry, material, [x, y, z], [w, h, d]) {
  const mesh = new Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.scale.set(w, h, d);
  return mesh;
}

const BUILDERS = {
  box: (m, [w, h, d]) => [part(unitBox, m, [0, 0, 0], [w, h, d])],
  floor: (m, [w, h, d]) => [part(unitBox, m, [0, 0, 0], [w, h, d])],
  road: (m, [w, h, d]) => [part(unitBox, m, [0, 0, 0], [w, h, d])],
  wall: (m, [w, h, d]) => [part(unitBox, m, [0, 0, 0], [w, h, d])],
  sphere: (m, [w, h, d]) => [part(unitSphere, m, [0, 0, 0], [w, h, d])],
  column: (m, [w, h, d]) => [
    part(unitCylinder, m, [0, 0, 0], [w * 0.8, h * 0.92, d * 0.8]),
    part(unitBox, m, [0, -h * 0.48, 0], [w, h * 0.04, d]),
    part(unitBox, m, [0, h * 0.48, 0], [w, h * 0.04, d]),
  ],
  stairs: (m, [w, h, d]) => {
    const steps = 6;
    return Array.from({ length: steps }, (_, index) => {
      const stepH = h * (index + 1) / steps;
      return part(unitBox, m, [0, -h / 2 + stepH / 2, d / 2 - (index + 0.5) * d / steps], [w, stepH, d / steps]);
    });
  },
  door: (m, [w, h, d]) => [
    part(unitBox, m, [0, 0, 0], [w * 0.86, h * 0.95, d * 0.5]),
    part(unitBox, m, [-w * 0.46, 0, 0], [w * 0.08, h, d]),
    part(unitBox, m, [w * 0.46, 0, 0], [w * 0.08, h, d]),
    part(unitBox, m, [0, h * 0.48, 0], [w, h * 0.04, d]),
    part(unitSphere, m, [w * 0.3, -h * 0.02, d * 0.35], [0.08, 0.08, 0.08]),
  ],
  window: (m, [w, h, d]) => [
    part(unitBox, m, [0, h * 0.47, 0], [w, h * 0.06, d]),
    part(unitBox, m, [0, -h * 0.47, 0], [w * 1.08, h * 0.06, d * 1.6]),
    part(unitBox, m, [-w * 0.47, 0, 0], [w * 0.06, h, d]),
    part(unitBox, m, [w * 0.47, 0, 0], [w * 0.06, h, d]),
    part(unitBox, m, [0, 0, 0], [w * 0.04, h, d * 0.6]),
    part(unitBox, m, [0, 0, 0], [w, h * 0.04, d * 0.6]),
  ],
  table: (m, [w, h, d]) => {
    const top = h * 0.08;
    const legs = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => part(unitBox, m, [sx * w * 0.44, -top / 2, sz * d * 0.4], [w * 0.06, h - top, w * 0.06]));
    return [part(unitBox, m, [0, h / 2 - top / 2, 0], [w, top, d]), ...legs];
  },
  chair: (m, [w, h, d]) => {
    const seatY = -h / 2 + h * 0.48;
    const legs = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => part(unitBox, m, [sx * w * 0.42, (-h / 2 + seatY) / 2, sz * d * 0.42], [w * 0.08, seatY + h / 2, d * 0.08]));
    return [
      part(unitBox, m, [0, seatY, 0], [w, h * 0.06, d]),
      part(unitBox, m, [0, (seatY + h / 2) / 2, -d * 0.46], [w, h / 2 - seatY, d * 0.08]),
      ...legs,
    ];
  },
  shelf: (m, [w, h, d]) => {
    const parts = [
      part(unitBox, m, [-w / 2 + 0.02, 0, 0], [0.04, h, d]),
      part(unitBox, m, [w / 2 - 0.02, 0, 0], [0.04, h, d]),
      part(unitBox, m, [0, 0, -d / 2 + 0.01], [w, h, 0.02]),
    ];
    for (let index = 0; index <= 4; index++) parts.push(part(unitBox, m, [0, -h / 2 + index * h / 4 + 0.02, 0], [w, 0.04, d]));
    return parts;
  },
  bed: (m, [w, h, d]) => [
    part(unitBox, m, [0, -h * 0.2, 0], [w, h * 0.6, d]),
    part(unitBox, m, [0, h * 0.2, 0.02], [w * 0.96, h * 0.25, d * 0.94]),
    part(unitBox, m, [0, h * 0.35, -d * 0.36], [w * 0.7, h * 0.18, d * 0.18]),
    part(unitBox, m, [0, h * 0.05, -d / 2 + 0.04], [w, h * 1.1, 0.08]),
  ],
  building: (m, [w, h, d]) => {
    const parts = [part(unitBox, m, [0, 0, 0], [w, h, d])];
    // Window rows on the two street-facing sides read as perspective guides.
    const floors = Math.max(2, Math.round(h / 3));
    for (let floor = 0; floor < floors; floor++) {
      const y = -h / 2 + (floor + 0.6) * h / floors;
      for (const side of [-1, 1]) {
        parts.push(part(unitBox, m, [side * (w / 2 + 0.06), y, 0], [0.12, h / floors * 0.35, d * 0.8]));
      }
      parts.push(part(unitBox, m, [0, y, d / 2 + 0.06], [w * 0.8, h / floors * 0.35, 0.12]));
    }
    return parts;
  },
  streetLamp: (m, [w, h]) => [
    part(unitCylinder, m, [0, -h * 0.05, 0], [w * 0.4, h * 0.9, w * 0.4]),
    part(unitBox, m, [w * 0.6, h * 0.42, 0], [w * 1.4, w * 0.12, w * 0.12]),
    part(unitBox, m, [w * 1.2, h * 0.37, 0], [w * 0.5, w * 0.25, w * 0.4]),
    part(unitCylinder, m, [0, -h * 0.48, 0], [w, h * 0.04, w]),
  ],
  sofa: (m, [w, h, d]) => [
    part(unitBox, m, [0, -h * 0.275, 0], [w, h * 0.45, d]),
    part(unitBox, m, [0, h * 0.225, -d * 0.375], [w, h * 0.55, d * 0.25]),
    part(unitBox, m, [-w * 0.45, h * 0.1, 0.02], [w * 0.1, h * 0.3, d * 0.96]),
    part(unitBox, m, [w * 0.45, h * 0.1, 0.02], [w * 0.1, h * 0.3, d * 0.96]),
  ],
  monitor: (m, [w, h, d]) => [
    part(unitBox, m, [0, h * 0.125, 0], [w, h * 0.75, d * 0.15]),
    part(unitBox, m, [0, -h * 0.35, 0], [w * 0.08, h * 0.25, d * 0.15]),
    part(unitBox, m, [0, -h * 0.475, 0], [w * 0.5, h * 0.05, d]),
  ],
  plant: (m, [w, h, d]) => [
    part(unitCylinder, m, [0, -h * 0.35, 0], [w * 0.7, h * 0.3, d * 0.7]),
    part(unitSphere, m, [0, h * 0.12, 0], [w, h * 0.6, d]),
    part(unitCone, m, [0, h * 0.35, 0], [w * 0.6, h * 0.3, d * 0.6]),
  ],
  blackboard: (m, [w, h, d]) => [
    part(unitBox, m, [0, 0, 0], [w, h, d * 0.5]),
    part(unitBox, m, [0, h * 0.47, d * 0.3], [w, h * 0.06, d * 1.1]),
    part(unitBox, m, [0, -h * 0.47, d * 0.45], [w, h * 0.06, d * 1.4]),
    part(unitBox, m, [-w * 0.495, 0, d * 0.2], [w * 0.01, h, d * 0.9]),
    part(unitBox, m, [w * 0.495, 0, d * 0.2], [w * 0.01, h, d * 0.9]),
  ],
  schoolDesk: (m, size) => {
    const [w, h, d] = size;
    return [...BUILDERS.table(m, size), part(unitBox, m, [0, h * 0.3, 0], [w * 0.86, h * 0.03, d * 0.8])];
  },
  locker: (m, [w, h, d]) => [
    part(unitBox, m, [0, 0, 0], [w, h, d]),
    ...[-1, 0, 1].map(col => part(unitBox, m, [col * w / 3, 0, d / 2 + 0.01], [w / 3 - 0.03, h * 0.96, 0.02])),
    ...[-1, 0, 1].map(col => part(unitBox, m, [col * w / 3 + w * 0.1, h * 0.05, d / 2 + 0.03], [0.02, 0.1, 0.02])),
  ],
  counter: (m, [w, h, d]) => [
    part(unitBox, m, [0, -h * 0.03, 0], [w, h * 0.94, d]),
    part(unitBox, m, [0, h * 0.47, 0], [w * 1.04, h * 0.06, d * 1.12]),
  ],
  shopShelf: (m, size) => BUILDERS.shelf(m, size),
  stool: (m, [w, h, d]) => [
    part(unitCylinder, m, [0, h * 0.46, 0], [w, h * 0.08, d]),
    part(unitCylinder, m, [0, -h * 0.02, 0], [w * 0.15, h * 0.88, d * 0.15]),
    part(unitCylinder, m, [0, -h * 0.48, 0], [w * 0.8, h * 0.04, d * 0.8]),
  ],
  sign: (m, [w, h, d]) => [
    part(unitBox, m, [0, 0, 0], [w, h, d]),
    part(unitBox, m, [0, 0, d * 0.55], [w * 0.92, h * 0.76, d * 0.2]),
  ],
  awning: (m, [w, h, d]) => [
    part(unitBox, m, [0, h * 0.42, 0], [w, h * 0.16, d]),
    part(unitBox, m, [0, -h * 0.15, d / 2 - 0.015], [w, h * 0.7, 0.03]),
    part(unitBox, m, [-w / 2 + 0.015, h * 0.1, 0], [0.03, h * 0.5, d]),
    part(unitBox, m, [w / 2 - 0.015, h * 0.1, 0], [0.03, h * 0.5, d]),
  ],
  vendingMachine: (m, [w, h, d]) => [
    part(unitBox, m, [0, 0, 0], [w, h, d]),
    part(unitBox, m, [-w * 0.13, h * 0.15, d / 2 + 0.015], [w * 0.62, h * 0.5, 0.03]),
    part(unitBox, m, [-w * 0.13, -h * 0.32, d / 2 + 0.015], [w * 0.62, h * 0.1, 0.03]),
    part(unitBox, m, [w * 0.34, h * 0.1, d / 2 + 0.015], [w * 0.16, h * 0.3, 0.03]),
  ],
  utilityPole: (m, [w, h]) => [
    part(unitCylinder, m, [0, 0, 0], [w * 0.3, h, w * 0.3]),
    part(unitBox, m, [0, h * 0.43, 0], [w * 2, w * 0.14, w * 0.14]),
    part(unitBox, m, [0, h * 0.36, 0], [w * 1.5, w * 0.12, w * 0.12]),
    part(unitCylinder, m, [w * 0.42, h * 0.26, 0], [w * 0.55, h * 0.1, w * 0.55]),
  ],
  fence: (m, [w, h, d]) => {
    const parts = [
      part(unitBox, m, [0, h / 2 - 0.03, 0], [w, 0.06, d]),
      part(unitBox, m, [0, -h * 0.35, 0], [w, 0.04, d * 0.6]),
    ];
    const posts = 13;
    for (let index = 0; index < posts; index++) {
      const major = index % 4 === 0;
      parts.push(part(unitBox, m, [-w / 2 + index * w / (posts - 1), major ? 0 : -h * 0.03, 0], [major ? 0.05 : 0.025, major ? h : h * 0.9, major ? d : d * 0.4]));
    }
    return parts;
  },
  bench: (m, [w, h, d]) => [
    part(unitBox, m, [0, 0, d * 0.05], [w, h * 0.08, d * 0.85]),
    part(unitBox, m, [0, h * 0.33, -d * 0.44], [w, h * 0.34, d * 0.1]),
    part(unitBox, m, [-w * 0.4, -h * 0.25, 0], [w * 0.05, h * 0.5, d * 0.9]),
    part(unitBox, m, [w * 0.4, -h * 0.25, 0], [w * 0.05, h * 0.5, d * 0.9]),
    part(unitBox, m, [-w * 0.4, h * 0.2, -d * 0.44], [w * 0.05, h * 0.4, d * 0.1]),
    part(unitBox, m, [w * 0.4, h * 0.2, -d * 0.44], [w * 0.05, h * 0.4, d * 0.1]),
  ],
  crosswalk: (m, [w, h, d]) => Array.from({ length: 6 }, (_, index) => part(unitBox, m, [-w / 2 + (2 * index + 0.5) * w / 11, 0, 0], [w / 11, h, d])),
  tree: (m, [w, h, d]) => [
    part(unitCylinder, m, [0, -h * 0.3, 0], [w * 0.12, h * 0.4, d * 0.12]),
    part(unitCone, m, [0, h * 0.05, 0], [w, h * 0.55, d]),
    part(unitCone, m, [0, h * 0.3, 0], [w * 0.75, h * 0.4, d * 0.75]),
  ],
};

/**
 * A wall slab with openings (see wallOpenings): notches are cut into the
 * outline from the bottom edge, other openings are holes. Units are the wall's
 * base size; the geometry belongs to this wall only.
 */
export function wallWithOpenings(material, [w, h, d], openings) {
  const shape = new Shape();
  shape.moveTo(-w / 2, -h / 2);
  const notches = openings.filter(o => o.notch).sort((a, b) => a.x - b.x);
  for (const o of notches) {
    shape.lineTo(o.x - o.w / 2, -h / 2);
    shape.lineTo(o.x - o.w / 2, o.y + o.h / 2);
    shape.lineTo(o.x + o.w / 2, o.y + o.h / 2);
    shape.lineTo(o.x + o.w / 2, -h / 2);
  }
  shape.lineTo(w / 2, -h / 2);
  shape.lineTo(w / 2, h / 2);
  shape.lineTo(-w / 2, h / 2);
  shape.closePath();
  for (const o of openings.filter(entry => !entry.notch)) {
    const hole = new Path();
    hole.moveTo(o.x - o.w / 2, o.y - o.h / 2);
    hole.lineTo(o.x - o.w / 2, o.y + o.h / 2);
    hole.lineTo(o.x + o.w / 2, o.y + o.h / 2);
    hole.lineTo(o.x + o.w / 2, o.y - o.h / 2);
    hole.closePath();
    shape.holes.push(hole);
  }
  const geometry = new ExtrudeGeometry(shape, { depth: d, bevelEnabled: false, curveSegments: 1 });
  geometry.translate(0, 0, -d / 2);
  const mesh = new Mesh(geometry, material);
  mesh.userData.ownGeometry = true;
  return [mesh];
}

/**
 * A Group for `item` with the given material; userData.sceneId links it back
 * to the document. Walls with `openings` get holes/notches.
 */
export function buildSceneObject(item, material, { openings = [] } = {}) {
  const type = OBJECT_TYPES[item.type];
  const group = new Group();
  const meshes = item.type === 'wall' && openings.length
    ? wallWithOpenings(material, type.size, openings)
    : BUILDERS[item.type](material, type.size);
  for (const mesh of meshes) {
    mesh.userData.sceneId = item.id;
    group.add(mesh);
  }
  group.userData.sceneId = item.id;
  group.userData.type = item.type;
  applyTransform(group, item);
  return group;
}

export function applyTransform(object3d, item) {
  object3d.position.fromArray(item.position);
  object3d.rotation.set(item.rotation[0], item.rotation[1], item.rotation[2]);
  object3d.scale.fromArray(item.scale);
}

export const BUILDER_TYPES = Object.freeze(Object.keys(BUILDERS));
