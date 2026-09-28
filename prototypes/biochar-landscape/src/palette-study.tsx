import { useLayoutEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { PALETTE } from './model-kit';
import { PALETTE_STUDIES, type PaletteStudy } from './colour-studies';
export { PALETTE_STUDIES, type PaletteStudy } from './colour-studies';
const SOURCE = Object.entries(PALETTE).map(([key, value]) => [key, new THREE.Color(value)] as const);
export function PaletteTreatment({ palette }: {
    palette: PaletteStudy;
}) {
    const { scene, invalidate } = useThree();
    useLayoutEffect(() => {
        const preset = PALETTE_STUDIES[palette];
        const visited = new Set<THREE.Material>();
        scene.traverse(object => {
            const material = (object as THREE.Mesh).material;
            if (!material)
                return;
            for (const mat of Array.isArray(material) ? material : [material]) {
                if (visited.has(mat))
                    continue;
                visited.add(mat);
                if (mat instanceof THREE.ShaderMaterial && mat.uniforms.uTreeDark) {
                    mat.uniforms.uTreeDark.value.set(palette === 'natural' ? '#263c29' : preset.tree);
                    mat.uniforms.uTreeLight.value.copy(mat.uniforms.uTreeDark.value).lerp(new THREE.Color('#dce2ca'), palette === 'natural' ? .23 : .35);
                    continue;
                }
                if (mat instanceof THREE.ShaderMaterial && mat.uniforms.uPaper) {
                    mat.uniforms.uPaper.value.set(preset.ground);
                    mat.uniforms.uIllustrated.value = palette === 'natural' ? 1 : 0;
                    mat.uniforms.uOrange.value.set(preset.terrainAccent);
                    mat.uniforms.uRose.value.set(preset.terrain);
                    mat.uniforms.uInk.value.set(preset.ink);
                    continue;
                }
                if (mat instanceof THREE.ShaderMaterial && mat.uniforms.uTint)
                    mat.uniforms.uTint.value.set(preset.shadow);
                if (mat instanceof THREE.MeshStandardMaterial) {
                    if (!mat.userData.originalPigment)
                        mat.userData.originalPigment = mat.color.clone();
                    const original = mat.userData.originalPigment as THREE.Color;
                    let role = 'paper', distance = Infinity;
                    for (const [key, color] of SOURCE) {
                        const d = Math.abs(color.r - original.r) + Math.abs(color.g - original.g) + Math.abs(color.b - original.b);
                        if (d < distance) {
                            distance = d;
                            role = key;
                        }
                    }
                    mat.color.set(mat.userData.paletteRole === 'road' ? preset.road : preset[role as keyof typeof preset] as string);
                }
                if (mat instanceof THREE.MeshBasicMaterial && !mat.map && mat.userData.paperSurface)
                    mat.color.set(preset.ground);
                // Tint the botanical artwork while preserving its illustrated texture and transparency.
                if ((mat instanceof THREE.MeshBasicMaterial || mat instanceof THREE.SpriteMaterial) && mat.map) {
                    if (!mat.userData.paletteUniforms) {
                        const uniforms = { uStudyOriginal: { value: 0 }, uStudyInk: { value: new THREE.Color() }, uStudyPaper: { value: new THREE.Color() } };
                        mat.userData.paletteUniforms = uniforms;
                        const previous = mat.onBeforeCompile;
                        const cache = mat.customProgramCacheKey();
                        mat.onBeforeCompile = (shader, renderer) => {
                            previous.call(mat, shader, renderer);
                            Object.assign(shader.uniforms, uniforms);
                            shader.fragmentShader = 'uniform float uStudyOriginal;uniform vec3 uStudyInk;uniform vec3 uStudyPaper;\n' + shader.fragmentShader;
                            shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `float pigment=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
 outgoingLight=mix(mix(uStudyInk,uStudyPaper,smoothstep(.04,.85,pigment)),outgoingLight,uStudyOriginal);
 #include <opaque_fragment>`);
                        };
                        mat.customProgramCacheKey = () => cache + '-palette-study';
                        mat.needsUpdate = true;
                    }
                    mat.userData.paletteUniforms.uStudyOriginal.value = palette === 'natural' ? 1 : 0;
                    mat.userData.paletteUniforms.uStudyInk.value.set(mat instanceof THREE.SpriteMaterial ? preset.cloud : preset.tree);
                    mat.userData.paletteUniforms.uStudyPaper.value.set('#ffffff');
                }
            }
        });
        invalidate();
    }, [palette, scene, invalidate]);
    return null;
}
