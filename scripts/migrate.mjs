import {readFile} from 'node:fs/promises';
import {database} from '../server/db.mjs';
const db=database();
try{await db.query(await readFile(new URL('../server/schema.sql',import.meta.url),'utf8'));console.log('CFK database schema is ready.');}finally{await db.end();}
