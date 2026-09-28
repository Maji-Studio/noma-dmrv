import * as THREE from 'three';
import { PALETTE, box, cylinder, beam, mesh } from './model-kit';
import { elevation } from './terrain';
const QUARTER_TURN = Math.PI / 2;
const FENCE_HEIGHT = 1.1;
const UTILITY_HEIGHT = 4.3;
const ORANGE_PALE = PALETTE.paleOrange;
const SITE_BOXES = [[-28, -12], [-13, -3], [-1, -8], [17, 0], [12, 18], [-15, 28]];
function levelBase(x: number, z: number, width: number, depth: number) {
    return Math.max(...[-1, 1].flatMap(sx => [-1, 1].map(sz => elevation(x + sx * width / 2, z + sz * depth / 2)))) + 0.08;
}
function cottage(parent: THREE.Group, x: number, z: number, width: number, depth: number, height: number) {
    const base = levelBase(x, z, width, depth);
    const group = new THREE.Group();
    group.position.set(x, base, z);
    parent.add(group);
    box(group, [0, height / 2, 0], [width, height, depth], PALETTE.paper);
    const foundationDepth = Math.max(0.12, base - elevation(x, z));
    box(group, [0, -foundationDepth / 2, 0], [width + 0.2, foundationDepth, depth + 0.2], PALETTE.pale);
    const ridge = height + width * 0.24;
    const outline = new THREE.Shape();
    outline.moveTo(-width / 2, height);
    outline.lineTo(width / 2, height);
    outline.lineTo(0, ridge);
    outline.closePath();
    mesh(group, new THREE.ExtrudeGeometry(outline, { depth, bevelEnabled: false }), [0, 0, -depth / 2], ORANGE_PALE);
    const slope = Math.atan2(ridge - height, width / 2);
    const roofWidth = Math.hypot(width / 2, ridge - height) + 0.22;
    for (const side of [-1, 1]) {
        const roof = box(group, [side * width / 4, (height + ridge) / 2 + 0.04, 0], [roofWidth, 0.085, depth + 0.45], PALETTE.orange);
        roof.rotation.z = -side * slope;
        beam(group, [side * (width / 2 + 0.18), height - 0.04, -depth / 2 - 0.16], [side * (width / 2 + 0.18), height - 0.04, depth / 2 + 0.16], 0.045, PALETTE.pink);
        for (let panel = 0; panel < 4; panel++) {
            const panelZ = -depth / 2 + panel * depth / 3;
            beam(group, [0, ridge + 0.1, panelZ], [side * (width / 2 + 0.16), height, panelZ], 0.016, PALETTE.pink);
        }
    }
    beam(group, [width / 2 + 0.18, height, -depth / 2 + 0.1], [width / 2 + 0.18, 0.18, -depth / 2 + 0.1], 0.035, PALETTE.pink);
    const front = depth / 2 + 0.026;
    box(group, [0.52, 0.86, front], [0.8, 1.72, 0.065], PALETTE.pink);
    cylinder(group, [0.77, 0.88, front + 0.055], 0.035, 0.04, PALETTE.orange, [QUARTER_TURN, 0, 0]);
    for (const windowX of [-width * 0.28, width * 0.3]) {
        if (width < 3 && windowX > 0)
            continue;
        box(group, [windowX, height * 0.64, front + 0.01], [0.8, 0.83, 0.05], ORANGE_PALE);
        beam(group, [windowX, height * 0.64 - 0.4, front + 0.055], [windowX, height * 0.64 + 0.4, front + 0.055], 0.022, PALETTE.pink);
        beam(group, [windowX - 0.39, height * 0.64, front + 0.055], [windowX + 0.39, height * 0.64, front + 0.055], 0.022, PALETTE.pink);
        box(group, [windowX, height * 0.64 - 0.45, front + 0.06], [0.99, 0.075, 0.21]);
    }
    box(group, [0.52, 0.09, front + 0.32], [1.05, 0.18, 0.58], PALETTE.pale);
    if (width > 3)
        box(group, [-1.15, ridge - 0.2, -0.7], [0.46, 1.1, 0.46], PALETTE.pink);
}
function fence(parent: THREE.Group, points: THREE.Vector2[]) {
    for (let index = 0; index < points.length; index++) {
        const point = points[index];
        const y = elevation(point.x, point.y);
        box(parent, [point.x, y + FENCE_HEIGHT / 2, point.y], [0.1, FENCE_HEIGHT, 0.1], PALETTE.pink);
        if (index === 0)
            continue;
        const previous = points[index - 1];
        for (const railY of [0.43, 0.91])
            beam(parent, [previous.x, elevation(previous.x, previous.y) + railY, previous.y], [point.x, y + railY, point.y], 0.032, PALETTE.rose);
    }
}
function crate(parent: THREE.Group, x: number, z: number, stack: number) {
    const base = elevation(x, z);
    box(parent, [x, base + 0.08, z], [1.2, 0.16, 1.06], PALETTE.pale);
    for (let layer = 0; layer < stack; layer++) {
        const y = base + 0.17 + layer * 0.7;
        for (const dx of [-0.48, 0.48])
            for (const dz of [-0.4, 0.4])
                box(parent, [x + dx, y + 0.3, z + dz], [0.065, 0.6, 0.065], PALETTE.pink);
        for (const slatY of [0.1, 0.3, 0.5]) {
            for (const dz of [-0.43, 0.43])
                box(parent, [x, y + slatY, z + dz], [1.05, 0.12, 0.045], PALETTE.orange);
            for (const dx of [-0.51, 0.51])
                box(parent, [x + dx, y + slatY, z], [0.045, 0.12, 0.86], ORANGE_PALE);
        }
        box(parent, [x, y + 0.025, z], [1, 0.05, 0.85], PALETTE.rose);
    }
}
/** Small static details remain separate here so the scene can batch them by material. */
function bench(parent: THREE.Group, x: number, z: number, angle = 0) {
    const group = new THREE.Group();
    group.position.set(x, elevation(x, z), z);
    group.rotation.y = angle;
    parent.add(group);
    for (const legX of [-0.65, 0.65]) {
        for (const legZ of [-0.19, 0.19])
            box(group, [legX, 0.23, legZ], [0.065, 0.46, 0.065], PALETTE.purple);
        beam(group, [legX, 0.2, -0.22], [legX, 0.99, -0.22], 0.028, PALETTE.purple);
    }
    for (const slatZ of [-0.18, 0, 0.18])
        box(group, [0, 0.49, slatZ], [1.75, 0.065, 0.15], PALETTE.orange);
    for (const slatY of [0.74, 0.94])
        box(group, [0, slatY, -0.22], [1.75, 0.14, 0.06], PALETTE.paleOrange);
}
function person(parent: THREE.Group, x: number, z: number, angle: number, color: string) {
    const group = new THREE.Group();
    group.position.set(x, elevation(x, z), z);
    group.rotation.y = angle;
    parent.add(group);
    // Deliberately quiet architectural scale figures, with a natural staggered stance.
    beam(group, [-0.11, 0.09, 0.08], [-0.1, 0.83, 0], 0.075, PALETTE.purple);
    beam(group, [0.12, 0.09, -0.11], [0.1, 0.83, 0], 0.075, PALETTE.purple);
    box(group, [-0.11, 0.055, 0.13], [0.17, 0.11, 0.29], PALETTE.ink);
    box(group, [0.12, 0.055, -0.06], [0.17, 0.11, 0.29], PALETTE.ink);
    const torso = mesh(group, new THREE.CylinderGeometry(0.23, 0.17, 0.58, 8), [0, 1.08, 0], color);
    torso.scale.z = 0.7;
    mesh(group, new THREE.SphereGeometry(0.14, 10, 7), [0, 1.55, 0], PALETTE.paleOrange);
    const hat = mesh(group, new THREE.SphereGeometry(0.16, 10, 5, 0, Math.PI * 2, 0, QUARTER_TURN), [0, 1.6, 0], PALETTE.paper);
    hat.scale.y = 0.68;
    cylinder(group, [0, 1.6, 0.01], 0.18, 0.025, PALETTE.paper);
    beam(group, [-0.23, 1.29, 0], [-0.28, 0.89, 0.06], 0.057, color);
    beam(group, [0.23, 1.29, 0], [0.32, 1.03, 0.12], 0.057, color);
    beam(group, [0.32, 1.03, 0.12], [0.22, 1.07, 0.27], 0.046, PALETTE.paleOrange);
}
function plantedBed(parent: THREE.Group, x: number, z: number, width: number) {
    const base = elevation(x, z);
    box(parent, [x, base + 0.08, z], [width, 0.16, 1.05], PALETTE.compost);
    for (const side of [-1, 1])
        box(parent, [x, base + 0.17, z + side * 0.56], [width + 0.14, 0.3, 0.1], PALETTE.paleOrange);
    for (const side of [-1, 1])
        box(parent, [x + side * width / 2, base + 0.17, z], [0.1, 0.3, 1.1], PALETTE.paleOrange);
    const plants = Math.floor(width / 0.43);
    for (let index = 0; index < plants; index++) {
        const plantX = x - width / 2 + 0.25 + index * 0.43;
        const plantZ = z + (index % 2 === 0 ? -0.19 : 0.19);
        const height = 0.35 + (index % 3) * 0.1;
        beam(parent, [plantX, base + 0.17, plantZ], [plantX, base + height + 0.15, plantZ], 0.015, PALETTE.pink);
        const crown = mesh(parent, new THREE.IcosahedronGeometry(0.21, 0), [plantX, base + height + 0.17, plantZ], index % 3 === 0 ? PALETTE.orange : PALETTE.rose);
        crown.scale.set(1, 1.25, 0.8);
    }
}
function architecturalDetails(parent: THREE.Group) {
    bench(parent, 29.8, -7.2);
    bench(parent, -9.5, 7.3, Math.PI);
    plantedBed(parent, 34.4, -7.1, 2.1);
    plantedBed(parent, 22.2, -11.2, 3.5);
    plantedBed(parent, -31.1, 1.7, 3.2);
    person(parent, -23, 0.7, -0.6, PALETTE.orange);
    person(parent, 7.7, 5.6, 1.3, PALETTE.pink);
    person(parent, 31.3, -5.2, 2.2, PALETTE.orange);
    // Individual pavers leave the base landscape and road hierarchy visible.
    for (let index = 0; index < 7; index++) {
        const x = 31.7 + Math.sin(index * 0.45) * 0.25;
        const z = -9.5 + index * 0.64;
        const paver = box(parent, [x, elevation(x, z) + 0.035, z], [0.75, 0.07, 0.48], index % 3 === 0 ? PALETTE.paleOrange : PALETTE.paper);
        paver.rotation.y = Math.sin(index) * 0.09;
    }
    // Low open drainage channel along the field's front edge, clear of the road.
    for (let index = 0; index < 12; index++) {
        const x = -38 + index * 1.08;
        const z = 15.63;
        box(parent, [x, elevation(x, z) + 0.018, z], [0.95, 0.035, 0.3], PALETTE.purple);
        for (const side of [-1, 1]) {
            const stone = mesh(parent, new THREE.DodecahedronGeometry(0.19, 0), [x, elevation(x, z + side * 0.24) + 0.08, z + side * 0.24], index % 3 === 0 ? PALETTE.paleOrange : PALETTE.paper);
            stone.scale.set(2.5, 0.55, 0.65);
        }
    }
}
export function createSurroundings(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'Warm rural surroundings';
    architecturalDetails(group);
    cottage(group, 31.4, -12, 4.5, 4, 2.7);
    cottage(group, 35.7, -12.5, 2.3, 3.3, 2.05);
    for (const [x, z, layers] of [[-37.4, -9, 2], [-36.1, -7.4, 1], [-38, -6.5, 1]])
        crate(group, x, z, layers);
    // An open gate faces the circulation lane; the far rails follow the hillside.
    fence(group, [new THREE.Vector2(-34, 5), new THREE.Vector2(-37, 5), new THREE.Vector2(-40, 5), new THREE.Vector2(-41, 7.5), new THREE.Vector2(-41, 10), new THREE.Vector2(-41, 12.5), new THREE.Vector2(-41, 15), new THREE.Vector2(-38, 15), new THREE.Vector2(-35, 15), new THREE.Vector2(-32, 15), new THREE.Vector2(-29, 15), new THREE.Vector2(-26, 15), new THREE.Vector2(-23, 15), new THREE.Vector2(-23, 12.5), new THREE.Vector2(-23, 10), new THREE.Vector2(-23, 7.5), new THREE.Vector2(-23, 5), new THREE.Vector2(-26, 5), new THREE.Vector2(-29, 5)]);
    fence(group, [new THREE.Vector2(-29, 5), new THREE.Vector2(-28, 7.3)]);
    beam(group, [-29, elevation(-29, 5) + 0.2, 5], [-28, elevation(-28, 7.3) + 0.97, 7.3], 0.025, PALETTE.pink);
    const poleXs = [-35, -25, -5];
    for (const x of poleXs) {
        const y = elevation(x, 1);
        cylinder(group, [x, y + UTILITY_HEIGHT / 2, 1], 0.065, UTILITY_HEIGHT, PALETTE.pink);
        box(group, [x, y + UTILITY_HEIGHT - 0.15, 1], [0.1, 0.1, 1.0], PALETTE.orange);
        for (const z of [0.62, 1.38])
            cylinder(group, [x, y + UTILITY_HEIGHT, z], 0.06, 0.14, PALETTE.paper);
    }
    const cableMaterial = new THREE.LineBasicMaterial({ color: PALETTE.ink, transparent: true, opacity: 0.65 });
    for (let span = 1; span < poleXs.length; span++) {
        const a = poleXs[span - 1], b = poleXs[span];
        for (const z of [0.62, 1.38]) {
            const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(a, elevation(a, 1) + UTILITY_HEIGHT, z), new THREE.Vector3((a + b) / 2, (elevation(a, 1) + elevation(b, 1)) / 2 + UTILITY_HEIGHT - 0.7, z), new THREE.Vector3(b, elevation(b, 1) + UTILITY_HEIGHT, z));
            group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(24)), cableMaterial));
        }
    }
    const tankX = -29.5, tankZ = 24, tankY = elevation(tankX, tankZ);
    cylinder(group, [tankX, tankY + 0.8, tankZ], 0.95, 1.55, ORANGE_PALE);
    for (const y of [0.25, 0.8, 1.35])
        mesh(group, new THREE.TorusGeometry(0.96, 0.022, 4, 24), [tankX, tankY + y, tankZ], PALETTE.pink, [QUARTER_TURN, 0, 0]);
    cylinder(group, [tankX, tankY + 1.6, tankZ], 0.27, 0.1, PALETTE.orange);
    beam(group, [tankX + 0.9, tankY + 0.4, tankZ], [-28, tankY + 0.4, tankZ], 0.055, PALETTE.pink);
    beam(group, [-28, tankY + 0.4, tankZ], [-28, tankY + 0.4, 26], 0.055, PALETTE.pink);
    for (let index = 0; index < 15; index++) {
        const x = -42 + (index * 17.37) % 85;
        const z = -19 + (index * 11.71) % 48;
        if ((x > -27 && x < -3 && z > 20) || SITE_BOXES.some(([sx, sz]) => Math.abs(x - sx) < 9 && Math.abs(z - sz) < 8))
            continue;
        const shrub = mesh(group, new THREE.IcosahedronGeometry(1, 1), [x, elevation(x, z) + 0.24, z], index % 3 === 0 ? PALETTE.orange : PALETTE.rose);
        shrub.scale.set(0.5, 0.32, 0.43);
    }
    return group;
}
