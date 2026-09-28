// Throwaway modelling primitives. Coordinates are metres, Y is up.
import * as THREE from 'three';
import { applySketch, pencilEdges } from './sketch-material';
// Scene pigments are intentionally natural; the interface retains the MAJI brand tokens.
export const PALETTE = { ink: '#514b38', rose: '#a8b58a', paper: '#fff1d6', ground: '#fff9f3', orange: '#FF8359', pink: '#687c48', red: '#b46e59', purple: '#626554', warm: '#fffdf8', paleOrange: '#e7dcc1', pale: '#e9ddc6', compost: '#b78659' };
const materials = new Map<string, THREE.MeshStandardMaterial>();
const edgeMaterial = pencilEdges();
export function material(color: string) { let m = materials.get(color); if (!m) {
    m = applySketch(new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0 }));
    materials.set(color, m);
} return m; }
export function mesh(parent: THREE.Object3D, geometry: THREE.BufferGeometry, pos: THREE.Vector3Tuple, color: string = PALETTE.paper, rotation: THREE.Vector3Tuple = [0, 0, 0]): THREE.Mesh {
    const visibility = new Float32Array(geometry.attributes.position.count * 2).fill(1);
    geometry.setAttribute('bakedVisibility', new THREE.BufferAttribute(visibility, 2));
    const object = new THREE.Mesh(geometry, material(color));
    object.position.set(...pos);
    object.rotation.set(...rotation);
    object.castShadow = false;
    object.receiveShadow = false;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 28), edgeMaterial);
    object.add(edges);
    parent.add(object);
    return object;
}
export function box(parent: THREE.Object3D, pos: THREE.Vector3Tuple, size: THREE.Vector3Tuple, color: string = PALETTE.paper) { return mesh(parent, new THREE.BoxGeometry(...size), pos, color); }
export function cylinder(parent: THREE.Object3D, pos: THREE.Vector3Tuple, radius: number, height: number, color: string = PALETTE.paper, rotation: THREE.Vector3Tuple = [0, 0, 0]) { return mesh(parent, new THREE.CylinderGeometry(radius, radius, height, 16), pos, color, rotation); }
export function beam(parent: THREE.Object3D, a: THREE.Vector3Tuple, b: THREE.Vector3Tuple, radius = .055, color: string = PALETTE.ink) { const av = new THREE.Vector3(...a), bv = new THREE.Vector3(...b), delta = bv.clone().sub(av); const object = mesh(parent, new THREE.CylinderGeometry(radius, radius, delta.length(), 7), av.clone().add(bv).multiplyScalar(.5).toArray(), color); object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()); return object; }
export function bulkBag(parent: THREE.Object3D, pos: THREE.Vector3Tuple) { const group = new THREE.Group(); group.position.set(...pos); parent.add(group); box(group, [0, .7, 0], [1.05, 1.4, 1.05], PALETTE.paper); box(group, [0, .06, 0], [1.2, .12, 1.2], PALETTE.pale); for (const x of [-.37, .37])
    for (const z of [-.37, .37]) {
        beam(group, [x, 1.4, z], [x, 1.75, z], .027, PALETTE.pink);
        beam(group, [x, 1.75, z], [x + .16, 1.75, z], .027, PALETTE.pink);
        beam(group, [x + .16, 1.75, z], [x + .16, 1.4, z], .027, PALETTE.pink);
    } for (const x of [-.38, .38])
    beam(group, [x, .16, .532], [x, 1.35, .532], .012, PALETTE.pink); cylinder(group, [0, 1.44, 0], .19, .13, PALETTE.pale); return group; }
