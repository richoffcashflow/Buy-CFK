import test from 'node:test';
import assert from 'node:assert/strict';
import {isVerifiedAdmin,accountAccess} from '../server/account-access.mjs';
import {publicConfig} from '../server/core.mjs';

const email='owner@example.test';
const verified={id:'did:privy:owner',is_guest:false,linked_accounts:[{type:'email',address:email,verified_at:1700000000}]};
test('owner preview requires a provider-verified email on a saved account',()=>{
  assert.equal(isVerifiedAdmin(verified,email),true);
  assert.equal(isVerifiedAdmin(verified,' OWNER@example.test '),true);
  assert.equal(isVerifiedAdmin(verified,''),false);
  assert.equal(isVerifiedAdmin(verified,'other@example.test'),false);
  assert.equal(isVerifiedAdmin({...verified,is_guest:true},email),false);
  assert.equal(isVerifiedAdmin({...verified,is_guest:undefined},email),false);
  assert.equal(isVerifiedAdmin({...verified,linked_accounts:[]},email),false);
  for(const type of ['wallet','custom_auth','telegram'])assert.equal(isVerifiedAdmin({...verified,linked_accounts:[{...verified.linked_accounts[0],type}]},email),false);
  for(const time of [null,undefined,0,-1,'1700000000'])assert.equal(isVerifiedAdmin({...verified,linked_accounts:[{type:'email',address:email,verified_at:time}]},email),false);
  assert.equal(isVerifiedAdmin({...verified,linked_accounts:[{type:'email',address:email,latest_verified_at:1700000000}]},email),true);
});

test('owner access looks up only the authenticated identity and exposes no email or secrets',async()=>{
  const names=['CFK_ADMIN_EMAIL','PRIVY_APP_ID','PRIVY_APP_SECRET'];
  const saved=names.map(key=>[key,process.env[key]]),previousFetch=globalThis.fetch;
  Object.assign(process.env,{CFK_ADMIN_EMAIL:email,PRIVY_APP_ID:'fixture-app',PRIVY_APP_SECRET:'fixture-secret'});
  let request,result=verified;
  globalThis.fetch=async(url,options)=>{request={url,...options};return new Response(JSON.stringify(result));};
  try{
    assert.deepEqual(await accountAccess({id:verified.id,email:'untrusted@example.test',role:'untrusted'}),{isAdmin:true});
    assert.equal(request.url,'https://api.privy.io/v1/users/did%3Aprivy%3Aowner');
    assert.equal(request.headers['privy-app-id'],'fixture-app');
    assert.equal(JSON.stringify(publicConfig()).includes(email),false);
    result={...verified,linked_accounts:[]};
    assert.deepEqual(await accountAccess({id:verified.id,email,role:'admin'}),{isAdmin:false});
    result={...verified,id:'did:privy:another-account'};
    await assert.rejects(accountAccess({id:verified.id}),{status:502});
    globalThis.fetch=async()=>new Response('{}',{status:503});
    await assert.rejects(accountAccess({id:verified.id}));
    delete process.env.CFK_ADMIN_EMAIL;
    assert.deepEqual(await accountAccess({id:verified.id}),{isAdmin:false});
  }finally{globalThis.fetch=previousFetch;for(const [key,value] of saved){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
