import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
// The model authors retain readable parts; the viewer batches static geometry by material.
export function optimizeModel(source: THREE.Group) {
    source.updateMatrixWorld(true);
    const result = new THREE.Group();
    result.name = source.name;
    const solids = new Map<string, {
        material: THREE.Material;
        geometries: THREE.BufferGeometry[];
    }>();
    const lines = new Map<string, {
        material: THREE.Material;
        geometries: THREE.BufferGeometry[];
    }>();
    source.traverse(object => {
        if (object instanceof THREE.InstancedMesh) {
            const copy = object.clone();
            copy.matrix.copy(object.matrixWorld);
            copy.matrixAutoUpdate = false;
            result.add(copy);
            return;
        }
        if (object instanceof THREE.Mesh) {
            const mat = Array.isArray(object.material) ? object.material[0] : object.material;
            const color = (mat as THREE.MeshStandardMaterial).color?.getHexString();
            const key = `${mat.type}-${color}-${mat.side}-${mat.opacity}`;
            let geometry = object.geometry.clone();
            if (geometry.index)
                geometry = geometry.toNonIndexed();
            geometry.applyMatrix4(object.matrixWorld);
            for (const name of Object.keys(geometry.attributes))
                if (!['position', 'normal', 'bakedVisibility'].includes(name))
                    geometry.deleteAttribute(name);
            if (!geometry.getAttribute('normal'))
                geometry.computeVertexNormals();
            if (!solids.has(key))
                solids.set(key, { material: mat, geometries: [] });
            solids.get(key)!.geometries.push(geometry);
        }
        if (object instanceof THREE.Line) {
            const mat = object.material as THREE.LineBasicMaterial;
            const key = `${mat.color.getHexString()}-${mat.opacity}`;
            let geometry = object.geometry.clone();
            if (geometry.index)
                geometry = geometry.toNonIndexed();
            geometry.applyMatrix4(object.matrixWorld);
            if (!(object instanceof THREE.LineSegments)) {
                const pos = geometry.getAttribute('position');
                const vertices: number[] = [];
                for (let i = 0; i < pos.count - 1; i++)
                    vertices.push(pos.getX(i), pos.getY(i), pos.getZ(i), pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1));
                geometry = new THREE.BufferGeometry();
                geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
            }
            for (const name of Object.keys(geometry.attributes))
                if (name !== 'position')
                    geometry.deleteAttribute(name);
            if (!lines.has(key))
                lines.set(key, { material: mat, geometries: [] });
            lines.get(key)!.geometries.push(geometry);
        }
    });
    for (const { material, geometries } of solids.values()) {
        const merged = mergeGeometries(geometries);
        if (merged)
            result.add(new THREE.Mesh(merged, material));
    }
    for (const { material, geometries } of lines.values()) {
        const merged = mergeGeometries(geometries);
        if (merged)
            result.add(new THREE.LineSegments(merged, material));
    }
    return result;
}
