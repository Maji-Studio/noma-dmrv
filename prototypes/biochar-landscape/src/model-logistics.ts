import * as THREE from 'three';
import { PALETTE, box, cylinder, beam, mesh, bulkBag } from './model-kit';
const HALF_TURN = Math.PI;
const QUARTER_TURN = HALF_TURN / 2;
const TRUCK = { wheelRadius: 0.7, wheelWidth: 0.38, deckHeight: 1.48, cabFront: 5.45 };
const CHIP_COUNT = 140;
const SIDES = [-1, 1];
/** Deterministic scatter keeps the loading yard stable between renders. */
function fraction(index: number, seed: number): number {
    const value = Math.sin(index * 127.1 + seed * 311.7) * 43758.5453;
    return value - Math.floor(value);
}
function residue(parent: THREE.Group, center: THREE.Vector3Tuple, size: THREE.Vector3Tuple, seed: number) {
    const [width, height, depth] = size;
    const geometry = new THREE.SphereGeometry(1, 14, 6, 0, HALF_TURN * 2, 0, QUARTER_TURN);
    const mound = mesh(parent, geometry, center, PALETTE.compost);
    mound.scale.set(width / 2, height, depth / 2);
    const chips = new THREE.InstancedMesh(new THREE.BoxGeometry(0.24, 0.075, 0.1), new THREE.MeshStandardMaterial({ color: PALETTE.paper, roughness: 1 }), CHIP_COUNT);
    const transform = new THREE.Object3D();
    const tint = new THREE.Color();
    for (let index = 0; index < CHIP_COUNT; index++) {
        const angle = fraction(index, seed) * HALF_TURN * 2;
        const radius = Math.sqrt(fraction(index, seed + 1)) * 0.97;
        transform.position.set(center[0] + Math.cos(angle) * radius * width / 2, center[1] + Math.sqrt(1 - radius * radius) * height + 0.045, center[2] + Math.sin(angle) * radius * depth / 2);
        transform.rotation.set(fraction(index, seed + 2), angle, fraction(index, seed + 3));
        transform.scale.set(0.7 + fraction(index, seed + 4) * 1.6, 1, 1);
        transform.updateMatrix();
        chips.setMatrixAt(index, transform.matrix);
        chips.setColorAt(index, tint.set(index % 4 === 0 ? PALETTE.rose : PALETTE.paper));
    }
    chips.castShadow = true;
    parent.add(chips);
}
export function createFeedstock(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'Feedstock shed and residue stockpiles';
    box(group, [0, 0.12, 0], [14, 0.24, 11], PALETTE.pale);
    // The roof covers the rear half, leaving the working stockpiles visible.
    for (const x of [-6.5, 0, 6.5]) {
        for (const z of [-4.8, 0.4]) {
            box(group, [x, 2.8, z], [0.19, 5.4, 0.19]);
            beam(group, [x, 4.6, z], [x + (x > 0 ? -0.8 : 0.8), 5.65, z], 0.055);
        }
        beam(group, [x, 5.55, 0.7], [x, 6.3, -5.2], 0.075);
    }
    box(group, [0, 2.7, -5.0], [13.25, 5.2, 0.12], PALETTE.paper);
    for (let index = 0; index < 29; index++) {
        box(group, [-6.4 + index * 0.455, 2.7, -4.9], [0.025, 5.2, 0.035], PALETTE.rose);
    }
    for (let index = 0; index < 25; index++) {
        const roofStrip = box(group, [-6.72 + index * 0.56, 5.93, -2.3], [0.55, 0.065, 6.2], index % 4 === 0 ? PALETTE.paleOrange : PALETTE.red);
        roofStrip.rotation.x = 0.127;
    }
    beam(group, [-6.95, 5.53, 0.78], [6.95, 5.53, 0.78], 0.09);
    beam(group, [-6.95, 6.31, -5.38], [6.95, 6.31, -5.38], 0.065);
    for (const x of [-6.35, 1.65])
        box(group, [x, 0.82, -0.5], [0.16, 1.4, 7.3], PALETTE.paper);
    residue(group, [-3.1, 0.25, 0.1], [6.1, 2.7, 7.4], 3);
    residue(group, [0.5, 0.25, 3.4], [3.5, 1.45, 3.5], 8);
    // Stacked debarked timber: exposed end rings and an offset second tier.
    for (let row = 0; row < 3; row++) {
        for (let column = 0; column < 4 - row; column++) {
            const x = 3.1 + column * 0.68 + row * 0.33;
            const y = 0.58 + row * 0.57;
            cylinder(group, [x, y, -1.55], 0.32, 5.5, PALETTE.pale, [QUARTER_TURN, 0, 0]);
            for (const radius of [0.18, 0.27]) {
                mesh(group, new THREE.TorusGeometry(radius, 0.009, 3, 14), [x, y, 1.211], PALETTE.ink);
            }
        }
    }
    for (const z of [-3.3, 0])
        box(group, [4.1, 0.28, z], [3.65, 0.2, 0.24], PALETTE.rose);
    return group;
}
function truckBase(): THREE.Group {
    const group = new THREE.Group();
    box(group, [-0.25, 1.02, 0], [10.6, 0.3, 2.02], PALETTE.ink);
    for (const z of [-0.82, 0.82])
        box(group, [-0.3, 1.25, z], [10.4, 0.2, 0.14]);
    for (const x of [-3.75, -2.15, 3.65]) {
        cylinder(group, [x, 0.73, 0], 0.11, 2.7, PALETTE.ink, [QUARTER_TURN, 0, 0]);
        for (const side of SIDES) {
            const z = side * 1.34;
            cylinder(group, [x, 0.73, z], TRUCK.wheelRadius, TRUCK.wheelWidth, PALETTE.ink, [QUARTER_TURN, 0, 0]);
            cylinder(group, [x, 0.73, side * 1.545], 0.43, 0.025, PALETTE.paper, [QUARTER_TURN, 0, 0]);
            cylinder(group, [x, 0.73, side * 1.568], 0.19, 0.045, PALETTE.rose, [QUARTER_TURN, 0, 0]);
            for (let bolt = 0; bolt < 6; bolt++) {
                const angle = bolt * HALF_TURN / 3;
                cylinder(group, [x + Math.sin(angle) * 0.29, 0.73 + Math.cos(angle) * 0.29, side * 1.575], 0.033, 0.035, PALETTE.ink, [QUARTER_TURN, 0, 0]);
            }
            box(group, [x - 0.65, 0.6, side * 1.33], [0.07, 0.65, 0.43], PALETTE.ink);
        }
    }
    // Cab silhouette has a chamfered windscreen and a forward bumper.
    const cabShape = new THREE.Shape();
    cabShape.moveTo(2.35, 1.45);
    cabShape.lineTo(5.22, 1.45);
    cabShape.lineTo(5.22, 2.78);
    cabShape.lineTo(4.76, 3.82);
    cabShape.lineTo(2.35, 3.82);
    cabShape.closePath();
    mesh(group, new THREE.ExtrudeGeometry(cabShape, { depth: 2.66, bevelEnabled: false }), [0, 0, -1.33], PALETTE.orange);
    const glass = box(group, [5.018, 3.245, 0], [0.035, 0.87, 2.31], PALETTE.pale);
    glass.rotation.z = 0.416;
    beam(group, [5.22, 2.86, 0], [4.85, 3.65, 0], 0.023);
    for (const side of SIDES) {
        box(group, [3.43, 3.21, side * 1.345], [1.64, 0.87, 0.035], PALETTE.pale);
        beam(group, [4.04, 2.78, side * 1.37], [4.04, 3.66, side * 1.37], 0.027);
        box(group, [3.34, 2.15, side * 1.354], [1.6, 0.77, 0.035]);
        box(group, [2.89, 2.57, side * 1.39], [0.31, 0.055, 0.05], PALETTE.ink);
        box(group, [3.01, 1.38, side * 1.39], [0.95, 0.1, 0.32], PALETTE.rose);
        box(group, [3.01, 1.12, side * 1.41], [0.91, 0.09, 0.3]);
        beam(group, [4.47, 3.42, side * 1.32], [4.58, 3.27, side * 1.59], 0.028);
        box(group, [4.55, 3.12, side * 1.59], [0.18, 0.46, 0.1], PALETTE.ink);
        box(group, [0.95, 1.03, side * 1.04], [1.6, 0.56, 0.6], PALETTE.pale);
    }
    box(group, [5.33, 1.52, 0], [0.23, 0.25, 2.86]);
    box(group, [5.25, 2.12, 0], [0.035, 0.48, 1.43], PALETTE.ink);
    for (const y of [1.99, 2.12, 2.25])
        box(group, [5.28, y, 0], [0.025, 0.025, 1.35], PALETTE.paper);
    for (const z of [-1.04, 1.04]) {
        box(group, [5.255, 2.08, z], [0.05, 0.24, 0.43], PALETTE.pale);
        box(group, [5.26, 1.88, z], [0.06, 0.1, 0.3], PALETTE.orange);
    }
    box(group, [3.36, 3.87, 0], [1.28, 0.12, 1.66], PALETTE.rose);
    return group;
}
export function createTipper(): THREE.Group {
    const group = truckBase();
    group.name = 'Loaded woodchip tipper truck';
    box(group, [-1.57, 1.58, 0], [7.14, 0.22, 2.8]);
    for (const side of SIDES) {
        box(group, [-1.57, 2.44, side * 1.4], [7.14, 1.55, 0.12], PALETTE.pale);
        box(group, [-1.57, 3.25, side * 1.41], [7.25, 0.13, 0.15]);
        for (let rib = 0; rib < 8; rib++)
            box(group, [-4.93 + rib * 0.96, 2.44, side * 1.49], [0.09, 1.59, 0.09], PALETTE.rose);
    }
    for (const x of [-5.1, 2.0])
        box(group, [x, 2.43, 0], [0.12, 1.57, 2.8]);
    for (const z of [-0.92, 0.92]) {
        box(group, [-5.19, 2.99, z], [0.13, 0.16, 0.43], PALETTE.ink);
        box(group, [-5.18, 1.73, z], [0.12, 0.2, 0.4], PALETTE.rose);
    }
    residue(group, [-1.56, 2.92, 0], [6.8, 1.0, 2.61], 17);
    return group;
}
export function createFlatbed(): THREE.Group {
    const group = truckBase();
    group.name = 'Flatbed with strapped bulk bags';
    box(group, [-1.56, TRUCK.deckHeight, 0], [7.2, 0.24, 2.92], PALETTE.pale);
    for (let plank = 0; plank < 9; plank++)
        box(group, [-4.95 + plank * 0.82, 1.617, 0], [0.012, 0.012, 2.84], PALETTE.rose);
    box(group, [2.06, 2.34, 0], [0.1, 1.82, 2.93]);
    for (let row = 0; row < 4; row++) {
        const x = -4.25 + row * 1.75;
        for (const z of [-0.7, 0.7])
            bulkBag(group, [x, 1.63, z]);
        // Two taut edge segments and top run describe load restraint without hiding bags.
        for (const side of SIDES)
            beam(group, [x, 1.43, side * 1.49], [x, 3.1, side * 1.31], 0.026, PALETTE.pink);
        beam(group, [x, 3.1, -1.31], [x, 3.1, 1.31], 0.026, PALETTE.pink);
    }
    for (const z of [-1.47, 1.47]) {
        box(group, [-1.56, 1.5, z], [7.3, 0.13, 0.08]);
        for (const x of [-4.85, -2.9, -0.9, 1.35])
            box(group, [x, 1.4, z], [0.12, 0.18, 0.09], PALETTE.orange);
    }
    return group;
}
