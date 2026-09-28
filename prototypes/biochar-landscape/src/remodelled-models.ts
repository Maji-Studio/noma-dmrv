import * as THREE from 'three';
import { PALETTE as P, box, cylinder, beam, mesh, bulkBag } from './model-kit';
import { createTipper, createFlatbed } from './model-logistics';
import { createReactor, createMixer } from './model-production';
import { createFarmSurface } from './model-farm';
import { elevation } from './terrain-height';
type Style = 'circle' | 'campus';
const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;
const DETAIL = { ringSegments: 48, posts: 8, cropRows: 5, cropsPerArc: 19, roofRibs: 9 };
/** A shallow annular slab. Closed geometry makes offline AO/shadow baking reliable. */
function annulus(parent: THREE.Group, inner: number, outer: number, y: number, thickness: number, color: string, start = 0, sweep = TAU) {
    const shape = new THREE.Shape();
    shape.absarc(0, 0, outer, start, start + sweep, false);
    if (sweep >= TAU - .001) {
        const hole = new THREE.Path();
        hole.absarc(0, 0, inner, 0, TAU, true);
        shape.holes.push(hole);
    }
    else {
        shape.lineTo(Math.cos(start + sweep) * inner, Math.sin(start + sweep) * inner);
        shape.absarc(0, 0, inner, start + sweep, start, true);
        shape.closePath();
    }
    return mesh(parent, new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: DETAIL.ringSegments }), [0, y, 0], color, [-HALF_PI, 0, 0]);
}
function mound(parent: THREE.Group, x: number, z: number, radius: number, height: number) {
    const pile = mesh(parent, new THREE.SphereGeometry(1, 16, 8, 0, TAU, 0, HALF_PI), [x, .2, z], P.compost);
    pile.scale.set(radius, height, radius * .85);
    for (let i = 0; i < 22; i++) {
        const angle = i * 2.39996;
        const r = radius * Math.sqrt((i + .5) / 23) * .93;
        const chip = box(parent, [x + Math.cos(angle) * r, .23 + height * Math.sqrt(1 - r * r / (radius * radius)), z + Math.sin(angle) * r * .85], [.32, .07, .12], i % 3 ? P.pale : P.rose);
        chip.rotation.y = angle;
    }
}
function feedstock(style: Style) {
    const group = new THREE.Group();
    group.name = style === 'circle' ? 'Circular open feedstock pavilion' : 'Sawtooth feedstock warehouse';
    if (style === 'circle') {
        cylinder(group, [0, .12, 0], 6.8, .24, P.pale);
        // Rear crescent canopy leaves the stockpile and working apron in plain view.
        annulus(group, 3.2, 6.7, 5.15, .18, P.red, 0, Math.PI);
        for (let i = 0; i <= DETAIL.posts; i++) {
            const a = i / DETAIL.posts * Math.PI;
            const x = Math.cos(a) * 6.1, z = -Math.sin(a) * 6.1;
            beam(group, [x, .2, z], [x, 5.25, z], .095, P.paper);
            beam(group, [x, 4.6, z], [Math.cos(a) * 4.9, 5.2, -Math.sin(a) * 4.9], .055, P.rose);
        }
        for (const r of [3.25, 6.65])
            annulus(group, r - .055, r + .055, 5.32, .08, P.paper, 0, Math.PI);
        mound(group, -2, -.3, 2.4, 2.4);
        mound(group, 2.35, 1.6, 1.65, 1.3);
        for (let row = 0; row < 3; row++)
            for (let col = 0; col < 4 - row; col++) {
                cylinder(group, [2 + col * .6 + row * .3, .5 + row * .53, -3.15], .29, 3.2, P.pale, [HALF_PI, 0, 0]);
            }
    }
    else {
        box(group, [0, .1, 0], [14, .2, 11], P.pale);
        for (const x of [-6.4, -2.1, 2.1, 6.4])
            for (const z of [-4.9, .1])
                beam(group, [x, .2, z], [x, 5.1, z], .095, P.paper);
        for (let bay = 0; bay < 3; bay++) {
            const center = -4.3 + bay * 4.3;
            const roof = box(group, [center, 5.35, -2.35], [4.35, .12, 5.5], bay === 1 ? P.paper : P.red);
            roof.rotation.z = .2;
            box(group, [center + 2.12, 5.32, -2.35], [.09, .85, 5.4], P.rose);
            for (let rib = 0; rib < 7; rib++)
                beam(group, [center - 2.1, 4.96, -4.9 + rib * .85], [center + 2.1, 5.8, -4.9 + rib * .85], .027, P.pale);
        }
        box(group, [0, 2.3, -4.9], [12.9, 4.4, .14], P.paper);
        mound(group, -3.4, 1.1, 2.6, 2.4);
        mound(group, 2.3, .9, 2, 1.6);
        for (const x of [-6, -.2, 5.9])
            box(group, [x, .7, 1.2], [.17, 1.1, 6.4], P.paper);
    }
    return group;
}
function production(style: Style) {
    const group = createReactor();
    group.name = style === 'circle' ? 'Reactor with curved service gantry' : 'Reactor and recovery silo';
    if (style === 'circle') {
        // Open arched gantries frame the retort without enclosing it under a roof.
        for (const x of [-4.2, 4.2]) {
            const points: THREE.Vector3[] = [];
            for (let i = 0; i <= 24; i++) {
                const a = i / 24 * Math.PI;
                points.push(new THREE.Vector3(x, .2 + Math.sin(a) * 5.8, Math.cos(a) * 3.9));
            }
            mesh(group, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 24, .11, 6, false), [0, 0, 0], P.rose);
        }
        for (const a of [.22, .5, .78])
            beam(group, [-4.2, .2 + Math.sin(a * Math.PI) * 5.8, Math.cos(a * Math.PI) * 3.9], [4.2, .2 + Math.sin(a * Math.PI) * 5.8, Math.cos(a * Math.PI) * 3.9], .065, P.paper);
    }
    else {
        const x = -4.6, z = -3.4;
        cylinder(group, [x, 3.6, z], 1.08, 4.4, P.paper);
        mesh(group, new THREE.ConeGeometry(1.1, 1, 20), [x, 6.3, z], P.rose);
        mesh(group, new THREE.CylinderGeometry(1.08, .26, 1, 20), [x, .9, z], P.pale);
        for (const dx of [-.8, .8])
            for (const dz of [-.7, .7])
                beam(group, [x + dx, .2, z + dz], [x + dx, 2, z + dz], .065, P.ink);
        for (const y of [2, 3.8, 5.6])
            cylinder(group, [x, y, z], 1.1, .08, P.rose);
        beam(group, [x, 5.4, z], [1.4, 5.4, z], .1, P.paper);
        beam(group, [1.4, 5.4, z], [1.4, 4.8, 0], .1, P.paper);
    }
    return group;
}
function mixing(style: Style) {
    const group = createMixer();
    group.name = style === 'circle' ? 'Mixing workshop with curved packing canopy' : 'Mixing workshop with open portal frames';
    if (style === 'circle') {
        // A small barrel vault protects only the bagging edge, retaining the open mixer.
        const points: THREE.Vector2[] = [];
        for (let i = 0; i <= 16; i++) {
            const a = i / 16 * Math.PI;
            points.push(new THREE.Vector2(Math.cos(a) * 1.3, Math.sin(a) * .85));
        }
        for (const x of [-4.4, 3.1]) {
            const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(x, 3.25 + p.y, 3.6 + p.x)));
            mesh(group, new THREE.TubeGeometry(curve, 16, .065, 6, false), [0, 0, 0], P.rose);
            for (const z of [2.3, 4.9])
                beam(group, [x, .2, z], [x, 3.25, z], .065, P.paper);
        }
        for (let i = 0; i < DETAIL.roofRibs; i++) {
            const a = i / (DETAIL.roofRibs - 1) * Math.PI;
            beam(group, [-4.4, 3.25 + Math.sin(a) * .85, 3.6 + Math.cos(a) * 1.3], [3.1, 3.25 + Math.sin(a) * .85, 3.6 + Math.cos(a) * 1.3], .085, i % 2 ? P.pale : P.paper);
        }
    }
    else {
        for (const x of [-4.8, 0, 4.8]) {
            for (const z of [-4.4, 4.6])
                beam(group, [x, .2, z], [x, 5.3, z], .085, P.rose);
            beam(group, [x, 5.3, -4.4], [x, 6.1, 0], .1, P.paper);
            beam(group, [x, 6.1, 0], [x, 5.3, 4.6], .1, P.paper);
            beam(group, [x, 4.7, -4.4], [x, 5.55, -3], .055, P.rose);
        }
        beam(group, [-4.8, 6.1, 0], [4.8, 6.1, 0], .08, P.paper);
        for (const x of [-2.8, -.8])
            bulkBag(group, [x, .2, -4.8]);
    }
    return group;
}
function crop(parent: THREE.Group, x: number, z: number, index: number) {
    const height = .65 + index % 3 * .12;
    beam(parent, [x, .2, z], [x, height + .2, z], .027, P.pink);
    for (const side of [-1, 1]) {
        const leaf = mesh(parent, new THREE.SphereGeometry(1, 5, 3), [x + side * .14, height * .63 + .2, z], index % 4 ? P.pink : P.rose);
        leaf.scale.set(.1, .32, .09);
        leaf.rotation.z = side * -.7;
    }
}
function farm(style: Style) {
    const group = new THREE.Group();
    group.name = style === 'circle' ? 'Curving regenerative crop terraces' : 'Rounded demonstration crop beds';
    // Reuse the detailed tractor and spreader, not the rectangular field or soil cavity.
    const source = createFarmSurface();
    const tractor = source.children.find(child => child instanceof THREE.Group);
    if (tractor) {
        source.remove(tractor);
        group.add(tractor);
        tractor.position.set(-1, .18, 3.8);
        tractor.scale.setScalar(.85);
    }
    if (style === 'circle') {
        const beds = new THREE.Group();
        group.add(beds);
        beds.position.z = 2;
        for (let row = 0; row < DETAIL.cropRows; row++) {
            const radius = 3.7 + row * 1.23;
            annulus(beds, radius - .38, radius + .38, .03 + row * .035, .12, row % 2 ? P.rose : P.paleOrange, .12, Math.PI - .24);
            for (let col = 0; col < DETAIL.cropsPerArc; col++) {
                const angle = .2 + col / (DETAIL.cropsPerArc - 1) * (Math.PI - .4);
                crop(beds, Math.cos(angle) * radius, -Math.sin(angle) * radius, col + row);
            }
        }
    }
    else {
        for (const x of [-6.7, 0, 6.7]) {
            const bed = cylinder(group, [x, .1, -2.35], 2.8, .2, P.paleOrange);
            bed.scale.z = 1.45;
            for (let row = 0; row < 6; row++)
                for (let col = 0; col < 4; col++)
                    crop(group, x - 1.4 + col * .92, -5.1 + row * 1.05, row + col);
            const edge = mesh(group, new THREE.TorusGeometry(2.83, .055, 5, 32), [x, .24, -2.35], P.rose, [HALF_PI, 0, 0]);
            edge.scale.y = 1.45;
        }
    }
    return group;
}
export function createRemodelledModels(style: Style): THREE.Group[] {
    return [feedstock(style), createTipper(), production(style), mixing(style), createFlatbed(), farm(style)];
}
export function createRemodelledCommons(style: Style): THREE.Group {
    const group = new THREE.Group();
    group.name = style === 'circle' ? 'Circular shared rain garden' : 'Campus shared garden';
    const z = style === 'circle' ? 0 : 3;
    group.position.set(0, elevation(0, z), z);
    const radius = style === 'circle' ? 7.4 : 5;
    cylinder(group, [0, .05, 0], radius, .1, P.pale);
    cylinder(group, [0, .13, 0], radius * .68, .16, P.rose);
    annulus(group, radius * .71, radius * .75, .16, .12, P.paper);
    for (let i = 0; i < 5; i++) {
        const a = i / 5 * TAU;
        const bench = new THREE.Group();
        group.add(bench);
        bench.position.set(Math.cos(a) * radius * .83, 0, Math.sin(a) * radius * .83);
        bench.rotation.y = -a;
        box(bench, [0, .7, 0], [.55, .14, 1.8], P.paper);
        for (const b of [-.65, .65])
            box(bench, [0, .36, b], [.38, .6, .14], P.rose);
    }
    for (let i = 0; i < 15; i++) {
        const a = i * 2.39996, r = Math.sqrt(i / 15) * radius * .6;
        const bush = mesh(group, new THREE.SphereGeometry(1, 8, 5), [Math.cos(a) * r, .45, Math.sin(a) * r], i % 3 ? P.pink : P.rose);
        bush.scale.set(.65, .45 + i % 3 * .15, .6);
    }
    return group;
}
