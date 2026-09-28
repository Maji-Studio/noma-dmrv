import * as THREE from 'three';
import { PALETTE, box, cylinder, beam, mesh, bulkBag } from './model-kit';
const HALF_TURN = Math.PI / 2;
const PIPE_RADIUS = 0.11;
const RAIL_RADIUS = 0.035;
const REACTOR_LENGTH = 7.4;
const REACTOR_RADIUS = 1.18;
const REACTOR_CENTER_Y = 2.85;
const MIXER_LENGTH = 4.8;
const HELIX_TURNS = 7;
const HELIX_SEGMENTS = 112;
type Point = THREE.Vector3Tuple;
function surface(parent: THREE.Group, corners: Point[], color: string) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(corners.flat(), 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.computeVertexNormals();
    const panel = mesh(parent, geometry, [0, 0, 0], color);
    panel.material = Array.isArray(panel.material)
        ? panel.material.map((material) => material.clone())
        : panel.material.clone();
    const materials = Array.isArray(panel.material) ? panel.material : [panel.material];
    materials.forEach((material) => { material.side = THREE.DoubleSide; });
    return panel;
}
function hopper(parent: THREE.Group, position: Point, width: number, depth: number, color: string) {
    const group = new THREE.Group();
    group.position.set(...position);
    parent.add(group);
    const top = 1.35;
    const throat = 0.32;
    const corners: Point[] = [[-width / 2, top, -depth / 2], [width / 2, top, -depth / 2], [width / 2, top, depth / 2], [-width / 2, top, depth / 2]];
    const bottom: Point[] = [[-throat, 0, -throat], [throat, 0, -throat], [throat, 0, throat], [-throat, 0, throat]];
    corners.forEach((corner, index) => {
        const next = (index + 1) % corners.length;
        surface(group, [bottom[index], bottom[next], corners[next], corner], PALETTE.paper);
        beam(group, corner, corners[next], 0.055, PALETTE.rose);
    });
    box(group, [0, 1.08, 0], [width * 0.72, 0.05, depth * 0.72], color);
    for (const x of [-width / 2, width / 2]) {
        for (const z of [-depth / 2, depth / 2]) {
            beam(group, [x, -position[1] + 0.15, z], [x, 1.1, z], 0.065, PALETTE.ink);
        }
    }
    return group;
}
function pipe(parent: THREE.Group, points: Point[], color: string = PALETTE.paper) {
    points.slice(1).forEach((point, index) => beam(parent, points[index], point, PIPE_RADIUS, color));
    points.slice(1, -1).forEach((point) => mesh(parent, new THREE.SphereGeometry(PIPE_RADIUS, 10, 8), point, color));
}
function conveyor(parent: THREE.Group, from: Point, to: Point, width: number) {
    const start = new THREE.Vector3(...from);
    const end = new THREE.Vector3(...to);
    const delta = end.clone().sub(start);
    const midpoint = start.clone().add(end).multiplyScalar(0.5);
    const belt = box(parent, midpoint.toArray(), [width, 0.13, delta.length()], PALETTE.ink);
    belt.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), delta.clone().normalize());
    const perpendicular = new THREE.Vector3(delta.z, 0, -delta.x).normalize();
    for (const side of [-1, 1]) {
        const offset = perpendicular.clone().multiplyScalar(width * 0.55 * side);
        beam(parent, start.clone().add(offset).toArray(), end.clone().add(offset).toArray(), 0.07, PALETTE.rose);
    }
    for (let index = 1; index < 9; index++) {
        const center = start.clone().lerp(end, index / 9);
        center.y += 0.06;
        const offset = perpendicular.clone().multiplyScalar(width * 0.44);
        beam(parent, center.clone().sub(offset).toArray(), center.clone().add(offset).toArray(), 0.03, PALETTE.pale);
    }
    beam(parent, [midpoint.x, 0.15, midpoint.z], midpoint.toArray(), 0.07, PALETTE.ink);
}
export function createReactor(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'Enclosed continuous pyrolysis reactor';
    box(group, [0, 0.1, 0], [12.5, 0.2, 8.7], PALETTE.pale);
    // Horizontal sealed retort and its structural saddles.
    cylinder(group, [0, REACTOR_CENTER_Y, 0], REACTOR_RADIUS, REACTOR_LENGTH, PALETTE.paper, [0, 0, HALF_TURN]);
    for (const x of [-2.8, -1.4, 0, 1.4, 2.8]) {
        cylinder(group, [x, REACTOR_CENTER_Y, 0], REACTOR_RADIUS + 0.045, x === 0 ? .6 : .13, x === 0 ? PALETTE.orange : PALETTE.rose, [0, 0, HALF_TURN]);
    }
    for (const x of [-2.7, 2.7]) {
        box(group, [x, 1.35, 0], [0.35, 1.95, 1.5], PALETTE.paper);
        box(group, [x, 0.32, 0], [1, 0.18, 2.1], PALETTE.ink);
        for (const z of [-0.68, 0.68])
            beam(group, [x, 0.4, z], [x, 2.45, z], 0.09, PALETTE.rose);
    }
    // Bolted pressure doors remain closed; no combustion is exposed.
    for (const x of [-3.76, 3.76]) {
        cylinder(group, [x, REACTOR_CENTER_Y, 0], 1.02, 0.16, PALETTE.pale, [0, 0, HALF_TURN]);
        for (let bolt = 0; bolt < 12; bolt++) {
            const angle = bolt * Math.PI / 6;
            cylinder(group, [x * 1.025, REACTOR_CENTER_Y + Math.sin(angle) * 0.88, Math.cos(angle) * 0.88], 0.055, 0.07, PALETTE.ink, [0, 0, HALF_TURN]);
        }
    }
    hopper(group, [-4.8, 3.3, -0.1], 2.0, 1.9, PALETTE.compost);
    pipe(group, [[-4.8, 3.3, -0.1], [-4.8, 2.85, -0.1], [-3.7, 2.85, -0.1]]);
    cylinder(group, [-5.38, 2.85, -0.1], 0.28, 0.62, PALETTE.orange, [0, 0, HALF_TURN]);
    box(group, [-5.4, 2.48, -0.1], [0.8, 0.13, 0.7], PALETTE.ink);
    // Insulated gas recirculation circuit and tall capped flue.
    pipe(group, [[-2.8, 3.75, 0], [-2.8, 4.8, 0], [2.4, 4.8, 0], [2.4, 3.85, 0]]);
    cylinder(group, [2.45, 4.9, -1.45], 0.34, 5.6, PALETTE.paper);
    cylinder(group, [2.45, 7.65, -1.45], 0.49, 0.12, PALETTE.ink);
    cylinder(group, [2.45, 5.8, -1.45], 0.355, 0.22, PALETTE.orange);
    pipe(group, [[1.45, 4.8, 0], [1.45, 4.8, -1.45], [2.45, 4.8, -1.45]]);
    for (const y of [3.1, 4.2, 5.3, 6.4])
        box(group, [2.78, y, -1.45], [0.08, 0.06, 0.62], PALETTE.ink);
    // Front maintenance catwalk, open railings, readable stair treads.
    box(group, [0, 1.45, 1.85], [7.3, 0.15, 1.15], PALETTE.paper);
    for (const x of [-3.5, -1.8, 0, 1.8, 3.5]) {
        beam(group, [x, 0.23, 2.24], [x, 2.48, 2.24], RAIL_RADIUS, PALETTE.ink);
    }
    for (const y of [1.93, 2.46])
        beam(group, [-3.5, y, 2.24], [3.5, y, 2.24], RAIL_RADIUS, PALETTE.ink);
    for (let step = 0; step < 7; step++) {
        box(group, [-2.85, 0.3 + step * 0.18, 4.05 - step * 0.25], [1, 0.12, 0.31], PALETTE.paper);
    }
    for (const x of [-3.35, -2.35]) {
        beam(group, [x, 0.24, 4.17], [x, 1.5, 2.44], 0.06, PALETTE.ink);
        beam(group, [x, 1.2, 4.17], [x, 2.48, 2.44], RAIL_RADIUS, PALETTE.ink);
        for (const t of [0, 0.5, 1])
            beam(group, [x, 0.24 + t * 1.26, 4.17 - t * 1.73], [x, 1.2 + t * 1.28, 4.17 - t * 1.73], RAIL_RADIUS, PALETTE.ink);
    }
    box(group, [0.7, 2.25, 2.05], [0.85, 0.75, 0.24], PALETTE.paper);
    box(group, [0.7, 2.37, 2.19], [0.52, 0.22, 0.03], PALETTE.ink);
    for (const x of [0.48, 0.72, 0.96])
        cylinder(group, [x, 2.06, 2.2], 0.05, 0.03, PALETTE.orange, [HALF_TURN, 0, 0]);
    // Water-jacketed char cooling screw and sealed discharge.
    cylinder(group, [4.5, 1.35, 0], 0.43, 2.8, PALETTE.paper, [0, 0, HALF_TURN]);
    pipe(group, [[3.72, 2.6, 0], [3.72, 1.35, 0]]);
    for (const x of [3.5, 4.1, 4.7, 5.3])
        cylinder(group, [x, 1.35, 0], 0.46, 0.07, PALETTE.rose, [0, 0, HALF_TURN]);
    box(group, [4.7, 0.65, 0], [0.2, 1.0, 0.9], PALETTE.ink);
    pipe(group, [[5.7, 1.35, 0], [5.7, 0.72, 0]]);
    box(group, [5.7, 0.36, 0], [0.8, 0.4, 0.85], PALETTE.ink);
    return group;
}
export function createMixer(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'Twin-feed biochar and compost mixer with bagging station';
    box(group, [0, 0.1, 0], [10.8, 0.2, 9.8], PALETTE.pale);
    hopper(group, [-3.3, 1.9, -3.15], 2.25, 2.0, PALETTE.ink);
    hopper(group, [0, 1.9, -3.15], 2.25, 2.0, PALETTE.compost);
    box(group, [-3.3, 2.55, -2.16], [0.8, 0.25, 0.035], PALETTE.ink);
    box(group, [0, 2.55, -2.16], [0.8, 0.25, 0.035], PALETTE.compost);
    conveyor(group, [-3.3, 1.05, -3.15], [-1.55, 2.8, -0.45], 0.8);
    conveyor(group, [0, 1.05, -3.15], [0.55, 2.8, -0.45], 0.8);
    // Open-topped V trough exposes the shaft and its interleaved mixing flights.
    box(group, [0, 1.65, 0.55], [MIXER_LENGTH, 0.17, 0.5], PALETTE.paper);
    for (const side of [-1, 1]) {
        surface(group, [[-2.4, 1.7, 0.55 + side * 0.25], [2.4, 1.7, 0.55 + side * 0.25], [2.4, 2.6, 0.55 + side * 0.97], [-2.4, 2.6, 0.55 + side * 0.97]], PALETTE.paper);
        beam(group, [-2.46, 2.6, 0.55 + side * 0.97], [2.46, 2.6, 0.55 + side * 0.97], 0.065, PALETTE.rose);
    }
    for (const x of [-2.4, 2.4]) {
        surface(group, [[x, 1.7, 0.3], [x, 1.7, 0.8], [x, 2.6, 1.52], [x, 2.6, -0.42]], PALETTE.pale);
        for (const z of [-0.15, 1.25]) {
            box(group, [x * 0.88, 0.95, z], [0.15, 1.55, 0.15], PALETTE.ink);
            box(group, [x * 0.88, 0.24, z], [0.55, 0.08, 0.48], PALETTE.paper);
        }
    }
    cylinder(group, [0, 2.15, 0.55], 0.105, 5.25, PALETTE.ink, [0, 0, HALF_TURN]);
    const helix: THREE.Vector3[] = [];
    for (let index = 0; index <= HELIX_SEGMENTS; index++) {
        const progress = index / HELIX_SEGMENTS;
        const angle = progress * HELIX_TURNS * Math.PI * 2;
        helix.push(new THREE.Vector3(-2.22 + progress * 4.44, 2.15 + Math.cos(angle) * 0.4, 0.55 + Math.sin(angle) * 0.4));
    }
    mesh(group, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(helix), HELIX_SEGMENTS, 0.08, 5, false), [0, 0, 0], PALETTE.rose);
    for (let index = 0; index < 9; index++) {
        const angle = index * Math.PI / 2;
        const x = -2 + index * 0.5;
        beam(group, [x, 2.15, 0.55], [x, 2.15 + Math.cos(angle) * 0.42, 0.55 + Math.sin(angle) * 0.42], 0.055, PALETTE.ink);
    }
    cylinder(group, [-3.05, 2.15, 0.55], 0.33, 0.86, PALETTE.pink, [0, 0, HALF_TURN]);
    for (const x of [-3.35, -3.2, -3.05, -2.9, -2.75])
        cylinder(group, [x, 2.15, 0.55], 0.35, 0.03, PALETTE.rose, [0, 0, HALF_TURN]);
    box(group, [-3.05, 1.73, 0.55], [1.2, 0.15, 0.85], PALETTE.paper);
    // Discharge rises to an elevated weigh hopper and sealed filling spout.
    conveyor(group, [2.25, 1.6, 0.6], [4.05, 3.95, 1.2], 0.65);
    hopper(group, [4.05, 2.95, 1.35], 1.5, 1.4, PALETTE.ink);
    cylinder(group, [4.05, 2.5, 1.35], 0.23, 0.9, PALETTE.paper);
    cylinder(group, [4.05, 2.15, 1.35], 0.28, 0.18, PALETTE.pink);
    bulkBag(group, [4.05, 0.2, 1.35]);
    for (const position of [[-3.5, 0.2, 3.3], [-1.25, 0.2, 3.3], [1, 0.2, 3.3], [3.25, 0.2, 3.8]] as Point[]) {
        box(group, [position[0], 0.21, position[2]], [1.62, 0.12, 1.62], PALETTE.rose);
        bulkBag(group, [position[0], 0.29, position[2]]);
    }
    return group;
}
