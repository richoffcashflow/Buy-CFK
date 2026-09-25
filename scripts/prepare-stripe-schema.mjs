import {isSandbox} from '../server/sandbox.mjs';
import {readFile} from 'node:fs/promises';
import {database,transaction} from '../server/db.mjs';
// Add only the receipt uniqueness table, using this project's existing database.
// Preview and local builds never mutate a production database.
if(process.env.VERCEL_ENV==='production'){
  if(!(process.env.DATABASE_URL||process.env.POSTGRES_URL)){
    console.log('CFK_STRIPE_SCHEMA database_not_configured');
    if(process.env.STRIPE_ONRAMP_ENABLED==='true')process.exitCode=1;
  }else{
    try{
      await transaction(async c=>{
        await c.query("SELECT pg_advisory_xact_lock(hashtext('cfk_stripe_schema_v1'))");
        const tables=(await c.query("SELECT to_regclass('public.cfk_ramps') AS ramps")).rows[0];
        if(!tables?.ramps)throw new Error('CFK_SCHEMA_MISSING');
        await c.query('CREATE TABLE IF NOT EXISTS public.cfk_stripe_settlements (transaction_id text PRIMARY KEY, ramp_id uuid NOT NULL UNIQUE REFERENCES public.cfk_ramps(id))');
        await c.query('ALTER TABLE public.cfk_stripe_settlements ENABLE ROW LEVEL SECURITY');
        const roles=(await c.query("SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated')")).rows;
        for(const {rolname} of roles)await c.query(`REVOKE ALL ON public.cfk_stripe_settlements FROM "${rolname}"`);
        const check=(await c.query("SELECT relrowsecurity FROM pg_class WHERE oid='public.cfk_stripe_settlements'::regclass")).rows[0];
        const constraints=(await c.query("SELECT contype FROM pg_constraint WHERE conrelid='public.cfk_stripe_settlements'::regclass")).rows;
        if(!check?.relrowsecurity||!['p','u','f'].every(type=>constraints.some(c=>c.contype===type)))throw new Error('CFK_SCHEMA_INVALID');
        await c.query('SELECT transaction_id,ramp_id FROM public.cfk_stripe_settlements LIMIT 0');
      });
      console.log('CFK_STRIPE_SCHEMA ready');
    }catch{
      console.error('CFK_STRIPE_SCHEMA unavailable; the deployment was stopped');process.exitCode=1;
    }finally{await database().end();}
  }
}

if(isSandbox()){
  try{
    await transaction(async c=>{
      await c.query("SELECT pg_advisory_xact_lock(hashtext('cfk_sandbox_schema_v1'))");
      await c.query('CREATE SCHEMA IF NOT EXISTS cfk_sandbox');
      await c.query('REVOKE ALL ON SCHEMA cfk_sandbox FROM PUBLIC');
      await c.query('SET LOCAL search_path TO cfk_sandbox,pg_catalog');
      await c.query(await readFile(new URL('../server/schema.sql',import.meta.url),'utf8'));
      const roles=(await c.query("SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated')")).rows;
      for(const {rolname} of roles){await c.query(`REVOKE ALL ON SCHEMA cfk_sandbox FROM "${rolname}"`);await c.query(`REVOKE ALL ON ALL TABLES IN SCHEMA cfk_sandbox FROM "${rolname}"`);}
      const check=(await c.query("SELECT current_schema() AS schema, to_regclass('cfk_ramps')=to_regclass('cfk_sandbox.cfk_ramps') AS isolated")).rows[0];
      if(check.schema!=='cfk_sandbox'||!check.isolated)throw new Error('Sandbox isolation check failed');
      const unsafe=(await c.query("SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='cfk_sandbox' AND c.relkind='r' AND NOT c.relrowsecurity")).rows[0];
      if(unsafe.n)throw new Error('Sandbox RLS check failed');
    });
    const check=(await database().query("SELECT current_schema() AS schema, to_regclass('cfk_ramps')=to_regclass('cfk_sandbox.cfk_ramps') AS isolated")).rows[0];
    if(check.schema!=='cfk_sandbox'||!check.isolated)throw new Error('Sandbox connection isolation check failed');
    console.log('CFK_SANDBOX_SCHEMA ready; private tables and RLS verified');
  }catch(e){console.error('CFK_SANDBOX_SCHEMA failed',/^[A-Z0-9_]+$/.test(e.code||'')?e.code:'configuration');process.exitCode=1;}
  finally{await database().end();}
}
