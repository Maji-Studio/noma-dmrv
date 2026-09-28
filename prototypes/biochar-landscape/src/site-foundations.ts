import * as THREE from 'three';
import { elevation, siteElevation } from './terrain-height';
import { mesh, PALETTE } from './model-kit';
const FOUNDATION = { segments: 48, embed: .08 };
/** Fill the gap below a level working slab, without cutting or flattening the landscape. */
export function addFoundation(group: THREE.Group, position: THREE.Vector3Tuple, width: number, depth: number, round = false) {
    const outline = round ? Array.from({ length: FOUNDATION.segments }, (_, i) => [Math.cos(i / FOUNDATION.segments * Math.PI * 2) * width / 2, Math.sin(i / FOUNDATION.segments * Math.PI * 2) * depth / 2]) : [[-width / 2, -depth / 2], [-width / 2, depth / 2], [width / 2, depth / 2], [width / 2, -depth / 2]];
    const vertices: number[] = [], indices: number[] = [];
    outline.forEach(([x, z]) => { vertices.push(x, 0, z, x, Math.min(-FOUNDATION.embed, elevation(position[0] + x, position[2] + z) - position[1] - FOUNDATION.embed), z); });
    for (let i = 0; i < outline.length; i++) {
        const a = i * 2, b = (i + 1) % outline.length * 2;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const skirt = mesh(group, geometry, [0, 0, 0], PALETTE.pale);
    skirt.material = (skirt.material as THREE.Material).clone();
    (skirt.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    // Material.clone does not retain shader callbacks.
    const source = group.children.find(child => child instanceof THREE.Mesh && child !== skirt) as THREE.Mesh | undefined;
    if (source) {
        const material = source.material as THREE.Material;
        skirt.material.onBeforeCompile = material.onBeforeCompile;
        skirt.material.customProgramCacheKey = material.customProgramCacheKey;
    }
}
/** Planting follows the terrain; the tractor remains a rigid model on its wheel footprint. */
export function groundFarm(group: THREE.Group, position: THREE.Vector3Tuple) {
    const tractor = group.children.find(child => child instanceof THREE.Group);
    if (tractor)
        tractor.position.y += siteElevation(position[0] + tractor.position.x, position[2] + tractor.position.z, 8, 3) - position[1];
    group.updateMatrixWorld(true);
    const point = new THREE.Vector3();
    group.traverse(object => {
        if (!(object instanceof THREE.Mesh))
            return;
        for (let parent: THREE.Object3D | null = object; parent; parent = parent.parent)
            if (parent === tractor)
                return;
        const inverse = object.matrixWorld.clone().invert();
        const geometry = object.geometry.clone(), positions = geometry.attributes.position;
        for (let i = 0; i < positions.count; i++) {
            point.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld);
            point.y += elevation(position[0] + point.x, position[2] + point.z) - position[1];
            point.applyMatrix4(inverse);
            positions.setXYZ(i, point.x, point.y, point.z);
        }
        geometry.computeVertexNormals();
        object.geometry = geometry;
        // Rebuild attached outline geometry after deforming the planting.
        for (const child of object.children)
            if (child instanceof THREE.LineSegments)
                child.geometry = new THREE.EdgesGeometry(geometry, 28);
    });
}
