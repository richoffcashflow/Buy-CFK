import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeDisplayName,saveAccountProfile} from '../server/account-profile.mjs';

test('profile names accept real international names and reject invalid presentation data',()=>{
  assert.equal(normalizeDisplayName('  José   Russell  '),'José Russell');
  assert.equal(normalizeDisplayName('李 明'),'李 明');
  for(const invalid of ['',null,42,'a'.repeat(41),'<script>','Name\u202e'])assert.throws(()=>normalizeDisplayName(invalid));
});

test('profile update changes only the authenticated users display name through a partial update',async()=>{
  const previous=globalThis.fetch;
  let request;
  globalThis.fetch=async(url,options)=>{request={url,...options};return new Response(JSON.stringify({id:'did:privy:owner',custom_metadata:{cfk_display_name:'Jordan',role:'unchanged'},linked_accounts:[{secret:'private'}]}));};
  try{
    const result=await saveAccountProfile({id:'did:privy:owner'},{displayName:'Jordan',userId:'other',custom_metadata:{role:'admin'}});
    assert.equal(request.url,'https://auth.privy.io/api/v1/users/did%3Aprivy%3Aowner/custom_metadata');
    assert.equal(request.method,'PATCH');
    assert.deepEqual(JSON.parse(request.body),{custom_metadata:{cfk_display_name:'Jordan'}});
    assert.deepEqual(result,{displayName:'Jordan'});
  }finally{globalThis.fetch=previous;}
});

test('a failed profile save never reports success',async()=>{
  const previous=globalThis.fetch;
  globalThis.fetch=async()=>new Response('{}',{status:503});
  try{await assert.rejects(saveAccountProfile({id:'did:privy:owner'},{displayName:'Jordan'}));}
  finally{globalThis.fetch=previous;}
});
