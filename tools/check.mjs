import {readFile,readdir,stat} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
async function files(dir){return(await Promise.all((await readdir(dir)).map(async name=>{const file=path.join(dir,name);return(await stat(file)).isDirectory()?files(file):[file];}))).flat();}
const all=await files('web-app');
for(const file of all.filter(f=>f.endsWith('.js'))){const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(result.status!==0)throw new Error(result.stderr);}
const html=await readFile('web-app/index.html','utf8'),ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
if(ids.length!==new Set(ids).size)throw new Error('Duplicate HTML ids');
const app=await readFile('web-app/app.js','utf8');
for(const match of app.matchAll(/\$\('([^']+)'\)/g))if(!ids.includes(match[1])&& !match[1].endsWith('-'))throw new Error('Unknown UI id '+match[1]);
for(const match of html.matchAll(/(?:href|src)="(\.\/[^"#]+)"/g))await stat(path.join('web-app',match[1].split(/[?#]/,1)[0]));
const sw=await readFile('web-app/sw.js','utf8');
for(const match of sw.matchAll(/'(\.\/[^']+)'/g))await stat(path.join('web-app',match[1].split(/[?#]/,1)[0]));
console.log(`Checked ${all.length} website files, JS syntax, UI ids, local assets and offline shell.`);
