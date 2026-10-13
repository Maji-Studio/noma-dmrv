// Offline visibility bake. No ray casting is shipped to the viewer.
import {build} from 'esbuild';
import {writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const composition=process.argv[2]||'atlas';
if(!['atlas','circle','campus'].includes(composition))throw new Error('Unknown composition');
globalThis.__landscapeComposition=composition;
const resolve=createRequire(import.meta.url);
const bvhPath=createRequire(resolve.resolve('@react-three/drei')).resolve('three-mesh-bvh');
const entry=`import * as THREE from 'three';import {MeshBVH} from ${JSON.stringify(bvhPath)};import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';import {createStaticModels,createStaticSurroundings} from './src/static-models';import {STEPS} from './src/process-data';import {elevation} from './src/terrain-height';export {THREE,MeshBVH,mergeGeometries,createStaticModels,createStaticSurroundings,STEPS,elevation};`;
const result=await build({stdin:{contents:entry,resolveDir:import.meta.dirname,loader:'ts'},bundle:true,platform:'node',format:'esm',write:false});
const {THREE,MeshBVH,mergeGeometries,createStaticModels,createStaticSurroundings,STEPS,elevation}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const groups=[...createStaticModels(),createStaticSurroundings()];groups.forEach((g,i)=>{if(i<6)g.position.set(...STEPS[i].position);g.updateMatrixWorld(true)});
const meshes=[];const geometry=[];
for(const group of groups)group.traverse(m=>{if(!m.isMesh||m.isInstancedMesh)return;meshes.push(m);let g=m.geometry.clone();if(g.index)g=g.toNonIndexed();g.applyMatrix4(m.matrixWorld);for(const k of Object.keys(g.attributes))if(k!=='position')g.deleteAttribute(k);geometry.push(g)});
const merged=mergeGeometries(geometry);const bvh=new MeshBVH(merged,{maxLeafTris:12});const ray=new THREE.Ray();const normal=new THREE.Vector3(),pos=new THREE.Vector3(),dir=new THREE.Vector3(),tangent=new THREE.Vector3(),bitangent=new THREE.Vector3();
const sun=new THREE.Vector3(-85,44.5,-52).normalize();const up=new THREE.Vector3(0,1,0);const aoSamples=12;const hemisphere=Array.from({length:aoSamples},(_,i)=>{const a=i*2.39996323,r=Math.sqrt((i+.5)/aoSamples);return new THREE.Vector3(Math.cos(a)*r,Math.sqrt(1-r*r),Math.sin(a)*r)});
function visible(origin,direction,distance){ray.set(origin,direction);return !bvh.raycastFirst(ray,THREE.DoubleSide,.015,distance)}
function visibility(p,n,radius){tangent.crossVectors(Math.abs(n.y)>.95?new THREE.Vector3(1,0,0):up,n).normalize();bitangent.crossVectors(n,tangent);let count=0;for(const h of hemisphere){dir.copy(tangent).multiplyScalar(h.x).addScaledVector(n,h.y).addScaledVector(bitangent,h.z);if(visible(p,dir,radius))count++}return count/aoSamples}
const modelValues=[];
for(let j=0;j<meshes.length;j++){const m=meshes[j],p=m.geometry.attributes.position,n=m.geometry.attributes.normal;const normalMatrix=new THREE.Matrix3().getNormalMatrix(m.matrixWorld);const values=[];const cache=new Map();for(let i=0;i<p.count;i++){pos.fromBufferAttribute(p,i).applyMatrix4(m.matrixWorld);normal.fromBufferAttribute(n,i).applyMatrix3(normalMatrix).normalize();pos.addScaledVector(normal,.035);const key=[pos.x,pos.y,pos.z,normal.x,normal.y,normal.z].map(v=>v.toFixed(3)).join(',');let pair=cache.get(key);if(!pair){pair=[Math.round(visibility(pos,normal,3.5)*255),visible(pos,sun,120)?255:0];cache.set(key,pair)}values.push(...pair)}modelValues.push(values);if(j%20===0)console.log('Model bake',j,'/',meshes.length)}
const size=512,extent=130,ground=new Uint8Array(size*size*2);
for(let z=0;z<size;z++)for(let x=0;x<size;x++){const wx=(x+.5)/size*extent-extent/2,wz=(z+.5)/size*extent-extent/2;pos.set(wx,elevation(wx,wz)+.28,wz);const i=(z*size+x)*2;ground[i]=Math.round(visibility(pos,up,5)*255);ground[i+1]=visible(pos,sun,120)?255:0;if(x===0&&z%128===0)console.log('Ground bake row',z)}
await writeFile(new URL(composition==='atlas'?'./src/bakes/model-light-bake.json':`./src/bakes/model-light-bake-${composition}.json`,import.meta.url),JSON.stringify({composition,models:modelValues,ground:Buffer.from(ground).toString('base64'),size,extent,sun:sun.toArray()}));console.log('Baked',meshes.length,'meshes and',size*size,'ground samples');
