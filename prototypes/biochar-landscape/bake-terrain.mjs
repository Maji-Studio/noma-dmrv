// Offline terrain bake: horizon AO, area-sun visibility, and a one-bounce terrain proxy.
import {build} from 'esbuild';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const compiled=await build({entryPoints:[path.join(root,'src/terrain-height.ts')],bundle:true,write:false,format:'esm',platform:'node'});
const {elevation,LAND}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const baked=[],horizonSteps=[.6,1.2,2.4,4.5,7.5,12,18,26];
const sunDirection=[-.85,-.52],sunAngle=24*Math.PI/180;
for(let j=0;j<=LAND.segmentsZ;j++)for(let i=0;i<=LAND.segmentsX;i++){
 const x=i/LAND.segmentsX*LAND.width-LAND.width/2,z=j/LAND.segmentsZ*LAND.depth-LAND.depth/2,y=elevation(x,z);
 let occlusion=0,bounce=0;
 for(let direction=0;direction<12;direction++){const angle=direction*Math.PI/6;let horizon=0;
 for(const distance of horizonSteps){const dy=elevation(x+Math.cos(angle)*distance,z+Math.sin(angle)*distance)-y;horizon=Math.max(horizon,Math.atan2(dy-.08,distance))}
 const blocked=Math.sin(horizon)**2;occlusion+=blocked;bounce+=blocked*Math.max(0,Math.cos(angle-3.69));}
 let sun=0;
 for(const offset of [-.035,0,.035]){let visible=1;for(let distance=.75;distance<46;distance+=1.5){const terrain=elevation(x+sunDirection[0]*distance,z+sunDirection[1]*distance);if(terrain>y+Math.tan(sunAngle+offset)*distance+.14){visible=0;break}}sun+=visible/3}
 baked.push(Math.round((1-occlusion/12)*1000)/1000,Math.round(sun*1000)/1000,Math.round(bounce/12*1000)/1000);
}
await writeFile(path.join(root,'src/terrain-light-bake.json'),JSON.stringify({method:'12-direction horizon AO; 3-sample 24-degree sunset visibility; warm one-bounce approximation',values:baked}));
console.log(`Baked ${baked.length/3} terrain vertices. No runtime ray marching.`);
