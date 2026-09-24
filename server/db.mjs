import pg from 'pg';
import {appError} from './core.mjs';
let pool;
export function database(){if(!process.env.DATABASE_URL)throw appError('The app is still being connected. Please try again later.',503);return pool??=new pg.Pool({connectionString:process.env.DATABASE_URL,max:4,idleTimeoutMillis:15000,connectionTimeoutMillis:8000});}
export async function transaction(fn){const c=await database().connect();try{await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
