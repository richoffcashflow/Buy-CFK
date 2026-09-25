import {isSandbox} from './sandbox.mjs';
import pg from 'pg';
import {readFileSync} from 'node:fs';
import {appError} from './core.mjs';
let pool;
export function database(){
  if(pool)return pool;
  let connectionString=process.env.DATABASE_URL||process.env.POSTGRES_URL;
  if(!connectionString)throw appError('The app is still being connected. Please try again later.',503);
  const url=new URL(connectionString);let ssl;
  if(url.hostname.endsWith('.pooler.supabase.com')||/^db\.[a-z0-9]+\.supabase\.co$/.test(url.hostname)){
    for(const key of ['sslmode','sslrootcert','sslcert','sslkey','ssl','uselibpqcompat'])url.searchParams.delete(key);
    connectionString=url.toString();
    ssl={ca:readFileSync(new URL('./certs/supabase-ca.crt',import.meta.url),'utf8'),rejectUnauthorized:true};
  }
  return pool=new pg.Pool({connectionString,ssl,...(isSandbox()?{options:'-c search_path=cfk_sandbox,pg_catalog'}:{}),max:4,idleTimeoutMillis:15000,connectionTimeoutMillis:8000});
}
export async function transaction(fn){const c=await database().connect();try{await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
