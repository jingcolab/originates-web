import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const routes={'/':'index.html','/login':'login.html','/app':'app.html','/auth.js':'auth.js','/account.js':'account.js','/account.css':'account.css'};
const assets={};for(const [route,file] of Object.entries(routes))assets[route]={type:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html',body:readFileSync(new URL('./public/'+file,import.meta.url),'utf8')};
const declaration='const STATIC_ASSETS='+JSON.stringify(assets)+';\n';
writeFileSync(new URL('./src/assets.mjs',import.meta.url),'export '+declaration);
mkdirSync(new URL('./dist',import.meta.url),{recursive:true});
const code=readFileSync(new URL('./src/worker.mjs',import.meta.url),'utf8').replace("import { STATIC_ASSETS } from './assets.mjs';",declaration);
writeFileSync(new URL('./dist/worker.mjs',import.meta.url),code);
console.log('Built standalone Worker:',Buffer.byteLength(code),'bytes');
