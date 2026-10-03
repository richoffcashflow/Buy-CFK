import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {sandboxLaunchUrl} from '../src/entry-policy.js';

test('production and callback visits stay on the website, with no Telegram launcher',async()=>{
  for(const hostname of ['buycfk.com','www.buycfk.com','buy-cfk.vercel.app']){
    for(const search of ['', '?ref=creator_1','?code=callback&state=callback'])assert.equal(sandboxLaunchUrl({hostname,search}),null);
  }
  const entry=await readFile(new URL('../src/Entry.jsx',import.meta.url),'utf8');
  const index=await readFile(new URL('../index.html',import.meta.url),'utf8');
  assert.doesNotMatch(entry,/shouldOpenTelegram|telegramLaunchUrl|t\.me/);
  assert.doesNotMatch(index,/telegram-web-app/);
});

test('explicit sandbox link has a fixed destination and cannot loop',()=>{
  const hash='#tgWebAppStartParam=cfk_stripe_test';
  assert.equal(sandboxLaunchUrl({hostname:'buycfk.com',hash}),'https://buy-cfk-git-stripe-sandbox-cashflowkey.vercel.app/'+hash);
  assert.equal(sandboxLaunchUrl({hostname:'buy-cfk-git-stripe-sandbox-cashflowkey.vercel.app',hash}),null);
  assert.equal(sandboxLaunchUrl({hostname:'buycfk.com.attacker.test',hash}),null);
});
