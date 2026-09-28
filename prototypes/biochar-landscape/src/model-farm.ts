import * as THREE from 'three';
import { PALETTE, box, cylinder, beam, mesh } from './model-kit';
const FARM = { width: 22, depth: 15, cropRows: 6, plantsPerRow: 24, treadCount: 20, rootCount: 23 };
const HALF_PI = Math.PI / 2;
const whiteMaterial = new THREE.MeshStandardMaterial({ color: PALETTE.paper, roughness: .92, side: THREE.DoubleSide });
const pinkMaterial = new THREE.MeshStandardMaterial({ color: PALETTE.pink, roughness: 1 });
function wheel(parent: THREE.Group, x: number, z: number, radius: number, width: number) {
    const y = radius + .06;
    // Hollow-profile tires, visible hubs, lug nuts and alternating agricultural chevrons.
    mesh(parent, new THREE.TorusGeometry(radius * .75, radius * .25, 8, 24), [x, y, z], PALETTE.pale);
    cylinder(parent, [x, y, z], radius * .55, width * .98, PALETTE.paper, [HALF_PI, 0, 0]);
    for (const side of [-1, 1]) {
        cylinder(parent, [x, y, z + side * width * .52], radius * .24, .07, PALETTE.rose, [HALF_PI, 0, 0]);
        for (let bolt = 0; bolt < 6; bolt++) {
            const angle = bolt / 6 * Math.PI * 2;
            cylinder(parent, [x + Math.sin(angle) * radius * .36, y + Math.cos(angle) * radius * .36, z + side * width * .52], .045, .08, PALETTE.ink, [HALF_PI, 0, 0]);
        }
    }
    for (let i = 0; i < FARM.treadCount; i++) {
        const angle = i / FARM.treadCount * Math.PI * 2;
        for (const side of [-1, 1]) {
            const tread = box(parent, [x + Math.sin(angle) * radius, y + Math.cos(angle) * radius, z + side * width * .22], [.17, .095, width * .57], PALETTE.paper);
            tread.rotation.set(0, side * .36, -angle);
        }
    }
}
function tractor(parent: THREE.Group) {
    const machine = new THREE.Group();
    machine.position.set(-3, 0, 1.25);
    parent.add(machine);
    box(machine, [-.7, .85, 0], [4.25, .34, 1.25], PALETTE.pale);
    box(machine, [-1.9, 1.6, 0], [2.1, 1.06, 1.34]);
    box(machine, [-2.98, 1.48, 0], [.06, .66, 1.11], PALETTE.ink);
    for (let i = 0; i < 9; i++)
        box(machine, [-3.025, 1.49, -.47 + i * .118], [.045, .59, .024], PALETTE.rose);
    box(machine, [-3.13, .93, 0], [.3, .24, 1.58]);
    for (const z of [-.52, .52])
        cylinder(machine, [-3.06, 1.88, z], .145, .08, PALETTE.orange, [0, 0, HALF_PI]);
    for (const z of [-1.05, 1.05]) {
        wheel(machine, .7, z, 1.04, .65);
        wheel(machine, -2.15, z * .83, .65, .45);
        box(machine, [.68, 2.13, z], [1.88, .12, .78]);
        box(machine, [.9, 2.22, z * .71], [1.8, .32, .1], PALETTE.rose);
    }
    box(machine, [.36, 1.33, 0], [1.84, .18, 1.58]);
    const glassMaterial = new THREE.MeshPhysicalMaterial({ color: PALETTE.rose, transparent: true, opacity: .18, roughness: .12, metalness: 0, depthWrite: false });
    const glazing = new THREE.Mesh(new THREE.BoxGeometry(1.69, 1.4, 1.35), glassMaterial);
    glazing.position.set(.3, 2.32, 0);
    machine.add(glazing);
    for (const x of [-.57, 1.17])
        for (const z of [-.71, .71])
            beam(machine, [x, 1.55, z], [x, 3.07, z], .046, PALETTE.ink);
    for (const z of [-.71, .71]) {
        beam(machine, [-.57, 1.55, z], [1.17, 1.55, z], .032, PALETTE.ink);
        beam(machine, [-.57, 3.04, z], [1.17, 3.04, z], .032, PALETTE.ink);
        beam(machine, [.88, 1.6, z], [.88, 3, z], .025, PALETTE.ink);
        box(machine, [.69, 2.08, z * 1.025], [.17, .045, .04], PALETTE.ink);
    }
    box(machine, [.3, 3.15, 0], [2.02, .19, 1.77]);
    cylinder(machine, [.9, 3.31, 0], .12, .16, PALETTE.orange);
    box(machine, [.53, 1.77, 0], [.61, .17, .67], PALETTE.pink);
    box(machine, [.82, 2.02, 0], [.14, .55, .66], PALETTE.pale);
    beam(machine, [-.38, 1.53, 0], [-.46, 2.17, 0], .045, PALETTE.ink);
    mesh(machine, new THREE.TorusGeometry(.22, .025, 6, 16), [-.46, 2.19, 0], PALETTE.ink, [.7, HALF_PI, 0]);
    cylinder(machine, [-1.18, 2.55, -.46], .075, 1.4, PALETTE.ink);
    cylinder(machine, [-1.18, 3.28, -.46], .12, .07, PALETTE.paper);
    for (const y of [.5, .81, 1.12])
        box(machine, [-.38, y, 1], [.64, .07, .48], PALETTE.pale);
    for (const z of [-.87, .87]) {
        beam(machine, [-.55, 2.82, z * .8], [-.8, 2.82, z * 1.2], .023, PALETTE.ink);
        box(machine, [-.8, 2.78, z * 1.2], [.1, .22, .23], PALETTE.pink);
    }
    beam(machine, [1.35, .77, 0], [2.65, .73, 0], .095, PALETTE.ink);
    spreader(machine);
}
function spreader(parent: THREE.Group) {
    const trailer = new THREE.Group();
    trailer.position.set(3.8, 0, 0);
    parent.add(trailer);
    box(trailer, [0, .85, 0], [3, .19, 1.9], PALETTE.pale);
    for (const z of [-1.04, 1.04])
        wheel(trailer, .4, z, .68, .42);
    // Open tapered hopper, four sloped sheet-metal panels, contents visible from above.
    const bottom = { x: 1.03, z: .55, y: 1.04 };
    const top = { x: 1.55, z: .98, y: 2.16 };
    const points = [
        [-bottom.x, bottom.y, -bottom.z], [bottom.x, bottom.y, -bottom.z], [bottom.x, bottom.y, bottom.z], [-bottom.x, bottom.y, bottom.z],
        [-top.x, top.y, -top.z], [top.x, top.y, -top.z], [top.x, top.y, top.z], [-top.x, top.y, top.z],
    ];
    const hopper = new THREE.BufferGeometry();
    hopper.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
    hopper.setIndex([0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0]);
    hopper.computeVertexNormals();
    const shell = mesh(trailer, hopper, [0, 0, 0]);
    shell.material = new THREE.MeshStandardMaterial({ color: PALETTE.paper, side: THREE.DoubleSide, roughness: .8 });
    for (const z of [-top.z, top.z])
        beam(trailer, [-top.x, top.y, z], [top.x, top.y, z], .045, PALETTE.pink);
    for (const x of [-top.x, top.x])
        beam(trailer, [x, top.y, -top.z], [x, top.y, top.z], .045, PALETTE.pink);
    box(trailer, [0, 1.89, 0], [2.76, .1, 1.65], PALETTE.compost);
    const grains = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(.07, 0), pinkMaterial, 240);
    const transform = new THREE.Object3D();
    for (let i = 0; i < 240; i++) {
        transform.position.set(Math.sin(i * 17.4) * 1.35, 1.96 + Math.sin(i * 2.1) * .06, Math.cos(i * 4.7) * .77);
        transform.rotation.set(i, i * .4, 0);
        transform.updateMatrix();
        grains.setMatrixAt(i, transform.matrix);
    }
    trailer.add(grains);
    for (const z of [-.53, .53]) {
        cylinder(trailer, [1.53, .73, z], .45, .065, PALETTE.rose);
        for (let i = 0; i < 4; i++) {
            const angle = i * HALF_PI;
            beam(trailer, [1.53, .8, z], [1.53 + Math.cos(angle) * .4, .8, z + Math.sin(angle) * .4], .035, PALETTE.ink);
        }
    }
    const particles = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(.052, 0), pinkMaterial, 110);
    for (let i = 0; i < 110; i++) {
        const t = (i % 22) / 22;
        transform.position.set(1.55 + t * 2.7, .72 + Math.sin(t * Math.PI) * .48 - t * .7, Math.sin(i * 31.3) * (.3 + t * 1.65));
        transform.scale.setScalar(.6 + (i % 5) * .18);
        transform.updateMatrix();
        particles.setMatrixAt(i, transform.matrix);
    }
    trailer.add(particles);
}
function crops(parent: THREE.Group) {
    const count = FARM.cropRows * FARM.plantsPerRow;
    const stems = new THREE.InstancedMesh(new THREE.CylinderGeometry(.018, .023, .9, 5), pinkMaterial, count);
    const leafShape = new THREE.Shape();
    leafShape.moveTo(0, 0);
    leafShape.quadraticCurveTo(.25, .1, .12, .6);
    leafShape.quadraticCurveTo(-.14, .25, 0, 0);
    const leaves = new THREE.InstancedMesh(new THREE.ShapeGeometry(leafShape), whiteMaterial, count * 4);
    const headMaterial = new THREE.MeshStandardMaterial({ color: PALETTE.rose, roughness: 1 });
    const heads = new THREE.InstancedMesh(new THREE.ConeGeometry(.065, .36, 6), headMaterial, count);
    const transform = new THREE.Object3D();
    for (let row = 0; row < FARM.cropRows; row++) {
        const z = -6 + row * .9;
        box(parent, [0, .015, z], [20, .03, .44], PALETTE.pale);
        for (let plant = 0; plant < FARM.plantsPerRow; plant++) {
            const index = row * FARM.plantsPerRow + plant;
            const x = -9.6 + plant * .83;
            const height = .8 + (index % 4) * .06;
            transform.position.set(x, height / 2, z);
            transform.rotation.set(0, 0, 0);
            transform.scale.set(1, height / .9, 1);
            transform.updateMatrix();
            stems.setMatrixAt(index, transform.matrix);
            transform.position.y = height + .1;
            transform.scale.set(1, 1, 1);
            transform.updateMatrix();
            heads.setMatrixAt(index, transform.matrix);
            for (let leaf = 0; leaf < 4; leaf++) {
                transform.position.set(x, .2 + leaf * .12, z);
                transform.rotation.set(.3, leaf * 2.4 + index * .2, (leaf % 2 ? 1 : -1) * .88);
                transform.scale.setScalar(.75);
                transform.updateMatrix();
                leaves.setMatrixAt(index * 4 + leaf, transform.matrix);
            }
        }
    }
    parent.add(stems, leaves, heads);
}
function soilCutaway(parent: THREE.Group) {
    // Thin section occupies the front lip so the shared landscape can meet its back face.
    box(parent, [0, -.3, 6.4], [21, .6, 1.5], PALETTE.compost);
    box(parent, [0, -1.05, 6.4], [21, .9, 1.5], PALETTE.pale);
    box(parent, [0, -2.22, 6.4], [21, 1.44, 1.5], PALETTE.ground);
    const linePoints: number[] = [];
    const rootLine = (a: THREE.Vector3Tuple, b: THREE.Vector3Tuple) => linePoints.push(...a, ...b);
    for (let i = 0; i < FARM.rootCount; i++) {
        const x = -10 + i * .9;
        const tipY = -1.3 - (i % 4) * .38;
        rootLine([x, .03, 7.164], [x + .12, -.48, 7.164]);
        rootLine([x + .12, -.48, 7.164], [x - .13, tipY, 7.164]);
        for (let branch = 0; branch < 5; branch++) {
            const startY = -.3 - branch * .25;
            const side = branch % 2 ? 1 : -1;
            const endX = x + side * (.25 + branch * .045);
            const endY = startY - .4;
            rootLine([x, startY, 7.17], [endX, endY, 7.17]);
            rootLine([endX, endY, 7.17], [endX + side * .12, endY - .25, 7.17]);
            rootLine([endX, endY, 7.17], [endX - side * .07, endY - .2, 7.17]);
        }
    }
    const rootGeometry = new THREE.BufferGeometry();
    rootGeometry.setAttribute('position', new THREE.Float32BufferAttribute(linePoints, 3));
    parent.add(new THREE.LineSegments(rootGeometry, new THREE.LineBasicMaterial({ color: PALETTE.pink, transparent: true, opacity: .75 })));
    const granules = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(.08, 0), pinkMaterial, 180);
    const transform = new THREE.Object3D();
    for (let i = 0; i < 180; i++) {
        transform.position.set(Math.sin(i * 4.13) * 10.1, -.11 - ((i * 17) % 97) / 97 * 1.2, 7.18);
        transform.scale.setScalar(.45 + (i % 7) * .13);
        transform.rotation.set(i, i * .6, 0);
        transform.updateMatrix();
        granules.setMatrixAt(i, transform.matrix);
    }
    parent.add(granules);
    // Sparse plants on the section make the relationship between stems and roots explicit.
    for (let i = 0; i < 11; i++) {
        const x = -9 + i * 1.8;
        beam(parent, [x, 0, 6.82], [x, .64, 6.82], .018, PALETTE.pink);
        for (const side of [-1, 1]) {
            const leaf = mesh(parent, new THREE.SphereGeometry(.16, 6, 4), [x + side * .12, .34, 6.82], PALETTE.paper);
            leaf.scale.set(.48, 1.65, .22);
            leaf.rotation.z = -side * .75;
        }
    }
}
export function createFarmSoil(): THREE.Group {
    const soil = new THREE.Group();
    soil.name = 'Farm • soil carbon';
    soilCutaway(soil);
    return soil;
}
export function createFarmSurface(): THREE.Group {
    const farm = new THREE.Group();
    farm.name = 'Farm • surface application';
    crops(farm);
    tractor(farm);
    // Parallel fine furrows ground the machinery in an actively worked field.
    for (const z of [3.55, 4.15, 4.75, 5.35])
        beam(farm, [-10, .012, z], [10, .012, z], .016, PALETTE.rose);
    return farm;
}
export function createFarm(): THREE.Group {
    const farm = new THREE.Group();
    farm.name = 'Farm • application and soil carbon';
    farm.add(createFarmSurface(), createFarmSoil());
    return farm;
}
