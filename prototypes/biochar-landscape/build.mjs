// Bundles the throwaway React/WebGL study and local fonts into one offline review file.
import {build} from 'esbuild';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const directory=path.dirname(fileURLToPath(import.meta.url));
const result=await build({entryPoints:[path.join(directory,'src/main.tsx')],bundle:true,write:false,outfile:'review.js',minify:true,format:'iife',target:'es2022',jsx:'automatic',loader:{'.svg':'dataurl','.hdr':'dataurl','.png':'dataurl'},define:{'process.env.NODE_ENV':'"production"'},legalComments:'inline'});
const js=result.outputFiles.find(f=>f.path.endsWith('.js')).text.replaceAll('</script','<\\/script');
const css=result.outputFiles.find(f=>f.path.endsWith('.css')).text;
let fonts='';for(const [family,file,weight] of [['GT Flexa','GT-Flexa-Standard-Light.woff2','300'],['GT Flexa','GT-Flexa-Standard-Bold.woff2','700'],['GT Flexa Mono','GT-Flexa-Mono-Medium.woff2','500']]){const data=await readFile(path.join(directory,'../../src/styles/fonts',file));fonts+=`@font-face{font-family:'${family}';src:url(data:font/woff2;base64,${data.toString('base64')}) format('woff2');font-weight:${weight};font-display:swap;}`;}
const html=`<!doctype html>\n<!-- THROWAWAY REVIEW ARTIFACT. Procedural R3F landscape; all code/fonts embedded, no network or data services. -->\n<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MAJI | The biochar landscape</title><style>${fonts}\n${css}</style></head><body><div id="app"></div><script>${js}</script></body></html>`;
await writeFile(path.join(directory,'index.html'),html);
console.log(`Built standalone review HTML: ${(Buffer.byteLength(html)/1024/1024).toFixed(2)} MB`);
