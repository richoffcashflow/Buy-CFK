import test from 'node:test';
import assert from 'node:assert/strict';
import {configureSandbox} from '../server/sandbox.mjs';
import handler from '../api/index.js';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';

test('sandbox cannot enable with live keys or alter production settings',()=>{
 const production={VERCEL_ENV:'production',VERCEL_GIT_COMMIT_REF:'stripe-sandbox',TRADING_ENABLED:'false'};
 configureSandbox(production);assert.equal(production.TRADING_ENABLED,'false');assert.equal(production.APP_URL,undefined);
 const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'stripe-sandbox',STRIPE_SECRET_KEY:'sk_live_example',STRIPE_PUBLISHABLE_KEY:'pk_test_example',STRIPE_ONRAMP_WEBHOOK_SECRET:'whsec_example'};
 assert.throws(()=>configureSandbox(env));env.STRIPE_SECRET_KEY='sk_test_example';configureSandbox(env);assert.equal(env.STRIPE_ONRAMP_ENABLED,'true');assert.equal(env.RAMP_ENABLED,'false');
});
test('sandbox trade endpoints and jobs reject before authentication or any network call',async()=>{
 const oldEnv=process.env.VERCEL_ENV,oldRef=process.env.VERCEL_GIT_COMMIT_REF,oldFetch=globalThis.fetch;
 process.env.VERCEL_ENV='preview';process.env.VERCEL_GIT_COMMIT_REF='stripe-sandbox';globalThis.fetch=()=>{throw Error('Unexpected network request');};
 try{for(const path of ['/trade/prepare','/trade/submit','/trade/confirm','/jobs']){let output;const res={setHeader(){},end(s){output=JSON.parse(s);}};await handler({method:path==='/jobs'?'GET':'POST',url:'/api'+path,headers:{}},res);assert.equal(res.statusCode,403);assert.match(output.message,/disabled/);}}
 finally{globalThis.fetch=oldFetch;if(oldEnv===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=oldEnv;if(oldRef===undefined)delete process.env.VERCEL_GIT_COMMIT_REF;else process.env.VERCEL_GIT_COMMIT_REF=oldRef;}
});
test('sandbox schema does not read or write public application tables',async()=>{
 const db=new PGlite();try{
 await db.exec('CREATE TABLE public.cfk_sessions(id text); INSERT INTO public.cfk_sessions VALUES (\'live\'); CREATE SCHEMA cfk_sandbox; SET search_path TO cfk_sandbox,pg_catalog;');
 await db.exec(await readFile(new URL('../server/schema.sql',import.meta.url),'utf8'));
 await db.query("INSERT INTO cfk_sessions(id,source_url) VALUES ('test','https://example.com')");
 assert.deepEqual((await db.query('SELECT id FROM cfk_sessions')).rows,[{id:'test'}]);assert.deepEqual((await db.query('SELECT id FROM public.cfk_sessions')).rows,[{id:'live'}]);
 }finally{await db.close();}
});
