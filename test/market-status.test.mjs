import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url);
const output=await build({entryPoints:[new URL('../src/MarketStatus.jsx',import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'react',setup(b){b.onResolve({filter:/^react$/},()=>({path:pathToFileURL(require.resolve('react')).href,external:true}));}}]});
const {default:MarketStatus}=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
test('live indicator requires a fresh valid price and a working connection',()=>{
  const market={priceUsd:.0000037,updatedAt:new Date().toISOString()};
  const render=(props={})=>renderToStaticMarkup(React.createElement(MarketStatus,{market,online:true,error:false,...props}));
  assert.match(render(),/is-live/);
  for(const props of [{online:false},{error:true},{market:null},{market:{...market,priceUsd:null}},{market:{...market,updatedAt:'invalid'}},{market:{...market,updatedAt:new Date(Date.now()-180000).toISOString()}}])assert.doesNotMatch(render(props),/is-live/);
  assert.match(render({online:false}),/Offline/);
  assert.match(render({error:true}),/Reconnecting/);
  assert.match(render({market:{...market,updatedAt:new Date(Date.now()-180000).toISOString()}}),/Last price/);
});
