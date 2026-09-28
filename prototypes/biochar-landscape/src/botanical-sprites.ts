// Simple editorial tree forms: instanced canopies and fixed trunks, without leaf textures.
import * as THREE from 'three';
import { elevation } from './terrain-height';
import { SHADING_UNIFORMS } from './shading-state';
type Tree = {
    x: number;
    z: number;
    height: number;
    type: number;
    tone: number;
};
const TREE = { dark: '#263c29', light: '#4a5b38', trunk: '#5a5c3f', shadow: '#34472c', sun: new THREE.Vector3(-85, 44.5, -52), shadowOpacity: .23 };
const vertex = `attribute vec3 treeBarycentric;varying vec3 vTreeBarycentric;varying vec3 vTreeNormal;varying vec3 vTreeLocal;varying float vTone;void main(){vTreeBarycentric=treeBarycentric;vTreeLocal=position;vec3 scaleSquared=vec3(dot(instanceMatrix[0].xyz,instanceMatrix[0].xyz),dot(instanceMatrix[1].xyz,instanceMatrix[1].xyz),dot(instanceMatrix[2].xyz,instanceMatrix[2].xyz));vTreeNormal=normalize(mat3(modelMatrix)*mat3(instanceMatrix)*(normal/scaleSquared));vec3 center=instanceMatrix[3].xyz;vTone=fract(sin(dot(center.xz,vec2(12.9898,78.233)))*43758.5453);gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}`;
const fragment = `varying vec3 vTreeBarycentric;varying vec3 vTreeNormal;varying vec3 vTreeLocal;varying float vTone;uniform vec3 uTreeDark;uniform vec3 uTreeLight;uniform float uShadingMode;
float treeEdge(){vec3 edge=smoothstep(vec3(0.),fwidth(vTreeBarycentric)*1.1,vTreeBarycentric);return 1.-min(min(edge.x,edge.y),edge.z);}
void main(){float facing=dot(normalize(vTreeNormal),normalize(vec3(-85.,44.5,-52.)));float facet=smoothstep(.16,.24,facing);vec3 colour=mix(uTreeDark,uTreeLight,facet*.64);colour*=.92+vTone*.12;
 if(uShadingMode>.5&&uShadingMode<1.5){colour=mix(uTreeDark,uTreeLight,step(.18,facing)*.80);}
 else if(uShadingMode<2.5&&uShadingMode>1.5){colour=mix(vec3(.93,.93,.89),mix(uTreeDark,vec3(.32,.36,.31),.55),treeEdge()*.78);}
 else if(uShadingMode<3.5&&uShadingMode>2.5){colour=mix(colour*1.12,uTreeDark*.55,treeEdge()*.26);}
 else if(uShadingMode<4.5&&uShadingMode>3.5){float light=clamp(facing,0.,1.);float baseAO=smoothstep(0.,.4,vTreeLocal.y);colour=vec3(.91,.90,.86)*(.68+light*.27+baseAO*.10);}
 else if(uShadingMode>4.5){float shade=1.-clamp(facing*.75+.25,0.,1.);vec2 dots=mat2(.965926,-.258819,.258819,.965926)*gl_FragCoord.xy/3.;vec2 point=fract(dots)-.5;float noise=fract(sin(dot(floor(dots),vec2(12.9898,78.233)))*43758.5453);float radius=.08+shade*.31;float dotMask=1.-smoothstep(radius-.045,radius+.045,length(point));colour=mix(mix(vec3(.81,.83,.65),uTreeLight,.50),uTreeDark,dotMask*(.45+noise*.35));}
 gl_FragColor=vec4(colour,1.);
#include <colorspace_fragment>
}`;
function treeMaterial() { return new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, toneMapped: false, uniforms: { ...SHADING_UNIFORMS, uTreeDark: { value: new THREE.Color(TREE.dark) }, uTreeLight: { value: new THREE.Color(TREE.light) } } }); }
function trunkMaterial() { const material = new THREE.MeshBasicMaterial({ color: TREE.trunk, toneMapped: false }); material.onBeforeCompile = shader => { Object.assign(shader.uniforms, SHADING_UNIFORMS); shader.fragmentShader = 'uniform float uShadingMode;\n' + shader.fragmentShader; shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `if(uShadingMode>1.5&&uShadingMode<2.5)outgoingLight=vec3(.32,.36,.31);if(uShadingMode>3.5&&uShadingMode<4.5)outgoingLight=vec3(.66,.65,.62);\n#include <opaque_fragment>`); }; material.customProgramCacheKey = () => 'maji-static-trunk-studies'; return material; }
function wireReady(geometry: THREE.BufferGeometry) { const expanded = geometry.toNonIndexed(); const count = expanded.getAttribute('position').count; const barycentric = new Float32Array(count * 3); for (let i = 0; i < count; i++)
    barycentric[i * 3 + i % 3] = 1; expanded.setAttribute('treeBarycentric', new THREE.BufferAttribute(barycentric, 3)); geometry.dispose(); return expanded; }
function canopyGeometry(type: number) {
    if (type === 1) {
        const profile = [new THREE.Vector2(0, 0), new THREE.Vector2(.52, .07), new THREE.Vector2(.48, .25), new THREE.Vector2(.30, .58), new THREE.Vector2(.14, .84), new THREE.Vector2(0, 1)];
        return wireReady(new THREE.LatheGeometry(profile, 10));
    }
    const geometry = new THREE.SphereGeometry(1, 12, 10);
    geometry.scale(type === 2 ? .56 : .46, .5, type === 2 ? .45 : .40);
    geometry.translate(0, .5, 0);
    return wireReady(geometry);
}
function shadowGeometry(trees: Tree[]) {
    const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
    const horizontal = new THREE.Vector2(-TREE.sun.x, -TREE.sun.z);
    const lengthPerHeight = horizontal.length() / TREE.sun.y;
    horizontal.normalize();
    const cross = new THREE.Vector2(-horizontal.y, horizontal.x);
    for (const tree of trees) {
        const h = tree.height, center = h * lengthPerHeight * .53, radius = h * lengthPerHeight * .47, width = h * (tree.type === 1 ? .12 : .24);
        const nx = Math.max(4, Math.ceil(radius * 4)), nz = Math.max(2, Math.ceil(width * 4));
        const start = positions.length / 3;
        for (let zi = 0; zi <= nz; zi++)
            for (let xi = 0; xi <= nx; xi++) {
                const u = xi / nx, v = zi / nz, along = center + (u * 2 - 1) * radius, across = (v * 2 - 1) * width;
                const x = tree.x + horizontal.x * along + cross.x * across, z = tree.z + horizontal.y * along + cross.y * across;
                positions.push(x, elevation(x, z) + .07, z);
                uvs.push(u, v);
            }
        for (let zi = 0; zi < nz; zi++)
            for (let xi = 0; xi < nx; xi++) {
                const a = start + zi * (nx + 1) + xi, b = a + 1, c = a + nx + 1, d = c + 1;
                indices.push(a, c, b, b, c, d);
            }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    return geometry;
}
export function createBotanicalSprites(trees: Tree[]) {
    const group = new THREE.Group();
    group.name = 'Simple oval and cypress woodland';
    const dummy = new THREE.Object3D();
    for (let type = 0; type < 3; type++) {
        const items = trees.filter(tree => tree.type === type);
        const canopy = new THREE.InstancedMesh(canopyGeometry(type), treeMaterial(), items.length);
        canopy.name = 'Static illustrated tree crowns';
        items.forEach((tree, i) => { const cypress = type === 1; dummy.position.set(tree.x, elevation(tree.x, tree.z) + tree.height * (cypress ? .04 : .16), tree.z); dummy.rotation.set(0, tree.tone * .71, 0); dummy.scale.set(tree.height * (cypress ? .27 : type === 2 ? .64 : .56), tree.height * (cypress ? .98 : .84), tree.height * (cypress ? .27 : type === 2 ? .64 : .56)); dummy.updateMatrix(); canopy.setMatrixAt(i, dummy.matrix); });
        group.add(canopy);
    }
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(.045, .065, 1, 5), trunkMaterial(), trees.length);
    trunks.name = 'Anchored tree trunks';
    trees.forEach((tree, i) => { dummy.position.set(tree.x, elevation(tree.x, tree.z) + tree.height * .18, tree.z); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, tree.height * .36, 1); dummy.updateMatrix(); trunks.setMatrixAt(i, dummy.matrix); });
    group.add(trunks);
    const shadows = new THREE.Mesh(shadowGeometry(trees), new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, uniforms: { ...SHADING_UNIFORMS, uShadow: { value: new THREE.Color(TREE.shadow) }, uOpacity: { value: TREE.shadowOpacity } }, vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`, fragmentShader: `varying vec2 vUv;uniform vec3 uShadow;uniform float uOpacity;uniform float uShadingMode;void main(){float radius=length((vUv-.5)*2.);float alpha=(1.-smoothstep(.94,1.,radius))*uOpacity;vec3 shadowColour=uShadow;if(uShadingMode>1.5&&uShadingMode<2.5){shadowColour=vec3(.45,.46,.43);alpha*=.42;}else if(uShadingMode>3.5&&uShadingMode<4.5){shadowColour=vec3(.48,.48,.47);alpha*=.63;}if(alpha<.001)discard;gl_FragColor=vec4(shadowColour,alpha);
#include <colorspace_fragment>
}` }));
    shadows.name = 'Static directional woodland shadows';
    group.add(shadows);
    return group;
}
