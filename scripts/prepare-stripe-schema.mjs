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
