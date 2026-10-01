import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {JSDOM} from 'jsdom';
import {buildLegalPages} from '../scripts/build-legal-pages.mjs';

test('public legal routes serve unchanged legal content without auth, scripts, or Telegram redirection',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'cfk-legal-test-'));
  try{
    await buildLegalPages(directory);
    const config=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
    for(const [path,title] of [['privacy','Privacy Policy'],['terms','Terms of Service']]){
      const generated=await readFile(join(directory,path+'.html'),'utf8');
      assert.equal(await readFile(new URL('../public/'+path+'.html',import.meta.url),'utf8'),generated,'committed document must match the current Legal.jsx source');
      const dom=new JSDOM(generated,{url:'https://buycfk.com/'+path}),document=dom.window.document;
      assert.equal(document.querySelector('h1').textContent,title);
      assert.ok(document.querySelector('.legal').textContent.includes('Free Crypto App LLC'));
      assert.equal(document.querySelectorAll('script,iframe,form').length,0);
      assert.equal(document.querySelector('.back').getAttribute('href'),'/');
      assert.equal(document.querySelector('a[aria-current="page"]').getAttribute('href'),'/'+path);
      for(const route of ['/'+path,'/'+path+'/']){
        const index=config.rewrites.findIndex(item=>item.source===route);
        assert.ok(index>=0&&index<config.rewrites.length-1);
        assert.equal(config.rewrites[index].destination,'/'+path+'.html');
      }
      assert.equal(/t\.me|telegram-web-app|privy|localStorage|location\.replace/.test(generated),false);
      dom.window.close();
    }
  }finally{await rm(directory,{recursive:true,force:true});}
});
