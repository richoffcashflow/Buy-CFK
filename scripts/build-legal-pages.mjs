import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const require=createRequire(import.meta.url);
const pages=[{path:'privacy',kind:'privacy',title:'Privacy Policy'},{path:'terms',kind:'terms',title:'Terms of Service'}];

// Render the same existing content as the app's legal dialogs. These documents
// require no JavaScript, wallet, authentication, tracking, or Telegram launch.
export async function buildLegalPages(outputDirectory=new URL('../public/',import.meta.url)){
  const output=await build({entryPoints:[fileURLToPath(new URL('../src/Legal.jsx',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'react',setup(b){b.onResolve({filter:/^react$/},()=>({path:pathToFileURL(require.resolve('react')).href,external:true}));}}]});
  const {default:Legal}=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
  const directory=outputDirectory instanceof URL?fileURLToPath(outputDirectory):outputDirectory;
  await mkdir(directory,{recursive:true});
  for(const page of pages){
    const content=renderToStaticMarkup(React.createElement(Legal,{kind:page.kind}));
    const html=`<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#ffffff"><title>${page.title} | Buy CFK</title><link rel="icon" href="/assets/cashflow-favicon-transparent.png"><style>
*{box-sizing:border-box}body{margin:0;background:#f6f8fb;color:#102a42;font:16px/1.7 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:740px;margin:0 auto;padding:24px 20px 48px}a{color:#315c80}a:focus-visible{outline:3px solid #79b9ff;outline-offset:3px}.back{display:inline-block;margin-bottom:22px;text-decoration:none;font-weight:650;min-height:44px;padding:8px 0}header{display:flex;align-items:center;gap:14px;margin-bottom:24px}header img{width:48px;height:48px;object-fit:contain}h1{font-size:30px;font-weight:550;letter-spacing:-.8px;line-height:1.2;margin:0}header p{margin:6px 0 0;color:#627184;font-size:13px}.legal{background:#fff;border:1px solid #e9ebf0;border-radius:20px;padding:24px;overflow-wrap:anywhere}.legal h3{font-size:17px;line-height:1.4;margin:24px 0 8px}.legal section:first-child h3{margin-top:0}.legal p{margin:0 0 14px;color:#556579}nav{display:flex;flex-wrap:wrap;gap:20px;margin-top:24px}nav a{min-height:44px;padding:8px 0}@media(max-width:400px){main{padding:16px 14px 32px}.legal{padding:18px}h1{font-size:26px}}
</style></head><body><main><a class="back" href="/">← Back to Buy CFK</a><header><img src="/assets/cashflow-logo-transparent.png" width="48" height="48" alt="Cashflowkey"><div><h1>${page.title}</h1><p>Buy CFK · Free Crypto App LLC</p></div></header>${content}<nav aria-label="Legal pages"><a href="/privacy"${page.path==='privacy'?' aria-current="page"':''}>Privacy Policy</a><a href="/terms"${page.path==='terms'?' aria-current="page"':''}>Terms of Service</a><a href="/">Back to Buy CFK</a></nav></main></body></html>
`;
    await writeFile(resolve(directory,page.path+'.html'),html);
  }
  return pages.map(page=>resolve(directory,page.path+'.html'));
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const files=await buildLegalPages(process.argv[2]);
  console.log('Generated public legal pages: '+files.map(path=>path.split('/').at(-1)).join(', '));
}
