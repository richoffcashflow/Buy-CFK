import http from 'node:http';
import {createServer} from 'vite';
import handler from '../api/index.js';
const vite=await createServer({server:{middlewareMode:true},appType:'spa'});
http.createServer(async(req,res)=>{if(req.url.startsWith('/api/')){req.query=Object.fromEntries(new URL(req.url,'http://localhost').searchParams);return handler(req,res);}vite.middlewares(req,res);}).listen(4173,'0.0.0.0',()=>console.log('Buy CFK listening on port 4173'));
