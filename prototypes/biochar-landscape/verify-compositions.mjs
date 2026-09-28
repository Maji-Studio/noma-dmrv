// Verify that every selectable scene uses visibility data for its current geometry.
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
for(const composition of ['atlas','circle','campus']){
 globalThis.__landscapeComposition=composition;
 const result=await build({stdin:{contents:`export {createStaticModels,createStaticSurroundings} from './src/static-models';`,resolveDir:import.meta.dirname,loader:'ts'},bundle:true,platform:'node',format:'esm',write:false});
 const module=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text+`\n// ${composition}`).toString('base64'));
 const bake=JSON.parse(await readFile(new URL(composition==='atlas'?'./src/model-light-bake.json':`./src/model-light-bake-${composition}.json`,import.meta.url),'utf8'));
 const groups=[...module.createStaticModels(),module.createStaticSurroundings()];let index=0;
 for(const group of groups)group.traverse(object=>{if(!object.isMesh||object.isInstancedMesh)return;const expected=object.geometry.attributes.position.count*2;if(bake.models[index]?.length!==expected)throw new Error(`${composition}: mesh ${index} stale visibility data`);index++});
 if(index!==bake.models.length)throw new Error(`${composition}: unmatched baked meshes`);
 console.log(`${composition}: ${index} static meshes match their bake`);
}
