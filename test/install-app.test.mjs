import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url);
const output=await build({entryPoints:[new URL('../src/InstallApp.jsx',import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'react',setup(b){b.onResolve({filter:/^react$/},()=>({path:pathToFileURL(require.resolve('react')).href,external:true}));}}]});
const {installationHelp}=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
test('install help matches iPhone, iPad desktop-mode, Android and desktop',()=>{
  assert.match(installationHelp({userAgent:'iPhone Safari'}),/Safari.*Share.*Add to Home Screen/);
  assert.match(installationHelp({platform:'MacIntel',maxTouchPoints:5}),/Safari/);
  assert.match(installationHelp({userAgent:'Android Chrome'}),/Chrome.*browser menu/);
  assert.match(installationHelp({userAgent:'Desktop browser'}),/bookmark/);
});
test('home-screen manifest uses the existing coin artwork without financial or session URLs',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../public/manifest.webmanifest',import.meta.url),'utf8'));
  assert.equal(manifest.start_url,'/');assert.equal(manifest.id,'/');assert.equal(manifest.scope,'/');assert.equal(manifest.display,'standalone');
  for(const icon of manifest.icons)assert.ok((await readFile(new URL('../public'+icon.src,import.meta.url))).length);
  const svg=await readFile(new URL('../public/assets/app-icon.svg',import.meta.url),'utf8');
  assert.ok(svg.includes((await readFile(new URL('../public/assets/cfk-coin.png',import.meta.url))).toString('base64')));
  assert.ok(manifest.icons.some(icon=>icon.sizes==='any'&&icon.type==='image/svg+xml'));
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/rel="manifest"/);assert.match(html,/rel="apple-touch-icon"/);
});
