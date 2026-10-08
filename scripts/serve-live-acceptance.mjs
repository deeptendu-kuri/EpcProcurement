/** Loopback-only screenshot report. No API, database, credentials or directory listing. */
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
const discovery=process.argv.includes('--discovery');
const integrated=process.argv.includes('--integrated');
const automatic=process.argv.includes('--automatic');
const port=automatic?4178:integrated?4177:discovery?4176:4175;
const acceptanceDate=process.env.ACCEPTANCE_DATE||new Date().toISOString().slice(0,10).replaceAll('-','');
if(!/^\d{8}$/.test(acceptanceDate))throw new Error('Use an explicit YYYYMMDD report date.');
const directory=path.resolve(automatic?'tmp/local-demo-proof-20261007':integrated?'tmp/integrated-demo-proof':discovery?'tmp/discovery-acceptance-'+acceptanceDate:'tmp/live-acceptance-20261005');
const server=createServer(async(req,res)=>{
  const name=new URL(req.url||'/', `http://localhost:${port}`).pathname.slice(1)||'index.html';
  if(req.method!=='GET'||!/^(?:index\.html|[a-zA-Z0-9-]+\.png)$/.test(name)){res.writeHead(404);res.end('Not found');return;}
  try{
    const body=await readFile(path.join(directory,name));
    res.writeHead(200,{'Content-Type':name.endsWith('.png')?'image/png':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"});res.end(body);
  }catch{res.writeHead(404);res.end('Not found');}
});
server.listen(port,'127.0.0.1',()=>console.log(`Local screenshot report: http://localhost:${port}`));
