import * as THREE from 'three';
// Keep station pigments independent of environmental shading studies.
// Private materials prevent the shared model palette from tagging surroundings.
export function prepareStageMaterials(groups: THREE.Group[]) {
    for (const group of groups) {
        const copies = new Map<THREE.Material, THREE.Material>();
        const clone = (source: THREE.Material) => {
            let copy = copies.get(source);
            if (copy)
                return copy;
            copy = source.clone();
            copy.onBeforeCompile = source.onBeforeCompile;
            copy.customProgramCacheKey = source.customProgramCacheKey;
            copy.userData.fullColorStation = true;
            copies.set(source, copy);
            return copy;
        };
        group.traverse(object => {
            if (!(object instanceof THREE.Mesh || object instanceof THREE.Line))
                return;
            object.material = Array.isArray(object.material) ? object.material.map(clone) : clone(object.material);
        });
    }
}
