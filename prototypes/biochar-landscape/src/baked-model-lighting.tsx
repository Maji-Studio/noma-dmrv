import * as THREE from 'three';
import atlasBake from './bakes/model-light-bake.json';
import circleBake from './bakes/model-light-bake-circle.json';
import campusBake from './bakes/model-light-bake-campus.json';
import { COMPOSITION } from './composition-state';
const bake = { atlas: atlasBake, circle: circleBake, campus: campusBake }[COMPOSITION];
import { elevation } from './terrain-height';
// Vertex visibility belongs to the exact static model geometry, in traversal order.
export function applyModelBake(groups: THREE.Group[]) { let index = 0; for (const group of groups)
    group.traverse(object => { if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh)
        return; const values = bake.models[index++]; if (!values || values.length !== object.geometry.attributes.position.count * 2)
        throw new Error('Model lighting bake is stale. Run bake:models.'); object.geometry.setAttribute('bakedVisibility', new THREE.Uint8BufferAttribute(values, 2, true)); }); }
function createGroundShadows() {
    const bytes = Uint8Array.from(atob(bake.ground), c => c.charCodeAt(0));
    const rgba = new Uint8Array(bake.size * bake.size * 4);
    for (let i = 0; i < bytes.length / 2; i++) {
        rgba[i * 4] = bytes[i * 2];
        rgba[i * 4 + 1] = bytes[i * 2 + 1];
        rgba[i * 4 + 3] = 255;
    }
    const texture = new THREE.DataTexture(rgba, bake.size, bake.size, THREE.RGBAFormat);
    texture.magFilter = texture.minFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    const segments = 256, geometry = new THREE.PlaneGeometry(bake.extent, bake.extent, segments, segments);
    geometry.rotateX(-Math.PI / 2);
    const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i++)
        positions.setY(i, elevation(positions.getX(i), positions.getZ(i)) + .29);
    const material = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, toneMapped: false, uniforms: { uBake: { value: texture }, uTexel: { value: 1 / bake.size }, uExtent: { value: bake.extent }, uTint: { value: new THREE.Color('#63566e') } }, vertexShader: `varying vec2 vBakeUv;uniform float uExtent;void main(){vBakeUv=position.xz/uExtent+.5;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`, fragmentShader: `varying vec2 vBakeUv;uniform sampler2D uBake;uniform float uTexel;uniform vec3 uTint;void main(){vec2 visibility=vec2(0.);for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++)visibility+=texture2D(uBake,vBakeUv+vec2(float(x),float(y))*uTexel).rg/9.;float opacity=(1.-visibility.x)*.28+(1.-visibility.y)*.26;gl_FragColor=vec4(uTint,min(opacity,.48));#include <colorspace_fragment>}`.replace(';#include', ';\n#include') });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'Offline AO and directional ground shadows';
    mesh.renderOrder = 1;
    return mesh;
}
const groundShadows = createGroundShadows();
export function BakedGroundShadows() { return <primitive object={groundShadows} dispose={null}/>; }
