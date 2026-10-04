import test from 'node:test';
import assert from 'node:assert/strict';
import {measurementAllowed,measurementPolicy} from '../server/measurement-policy.mjs';
test('measurement defaults are regional and never override an opt-out or GPC',()=>{
  const us={headers:{'x-vercel-ip-country':'US'}};
  assert.deepEqual(measurementPolicy(us),{defaultEnabled:true,privacySignal:false});
  assert.equal(measurementAllowed(us,'default'),true);
  assert.equal(measurementAllowed(us,'denied'),false);
  assert.equal(measurementAllowed(us,'unknown'),false);
  for(const country of ['GB','DE','CA',undefined]){
    const req={headers:{'x-vercel-ip-country':country}};
    assert.equal(measurementAllowed(req,'default'),false);
    assert.equal(measurementAllowed(req,'granted'),true);
  }
  const gpc={headers:{'x-vercel-ip-country':'US','sec-gpc':'1'}};
  assert.deepEqual(measurementPolicy(gpc),{defaultEnabled:false,privacySignal:true});
  assert.equal(measurementAllowed(gpc,'granted'),false);
  assert.equal(measurementAllowed(gpc,'default'),false);
});
