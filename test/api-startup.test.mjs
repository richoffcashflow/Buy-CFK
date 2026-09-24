import test from 'node:test';
import {execFileSync} from 'node:child_process';

test('Vercel API starts without CommonJS-to-ESM require interop and exposes no secrets',()=>{
  execFileSync(process.execPath,['--no-experimental-require-module','--input-type=module','-e',`
    import assert from 'node:assert/strict';
    import handler from './api/index.js';
    process.env.PRIVY_APP_SECRET='test-only-secret';
    let payload;
    const res={setHeader(){},end(body){payload=JSON.parse(body);}};
    await handler({method:'GET',url:'/api/config'},res);
    assert.equal(res.statusCode,200);
    assert.ok(payload.mint);
    assert.equal(payload.feeBps,1500);
    assert.equal(JSON.stringify(payload).includes('test-only-secret'),false);
  `],{cwd:new URL('..',import.meta.url),stdio:'pipe'});
});
