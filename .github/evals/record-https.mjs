// Disposable observer: records real backend I/O outside every model container.
import https from 'node:https';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
const original = https.request;
const log = process.env.LIVE_BACKEND_LOG;
https.request = function (...args) {
  const req = original.apply(this, args);
  const id = randomUUID();
  const body=[]; const write=req.write.bind(req); const end=req.end.bind(req);
  req.write=function(chunk,...rest){if(chunk)body.push(Buffer.from(chunk));return write(chunk,...rest);};
  req.end=function(chunk,...rest){if(chunk && typeof chunk !== 'function')body.push(Buffer.from(chunk));return end(chunk,...rest);};
  const host=req.getHeader('host');
  const emit=(extra)=>{
    if(log && /leadbay\.app$/.test(String(host)))fs.appendFileSync(log,JSON.stringify({id,at:new Date().toISOString(),method:req.method,host,path:req.path,...extra})+'\n');
  };
  req.on('finish',()=>emit({event:'request',body:Buffer.concat(body).toString('utf8')}));
  req.on('response',res=>{
    const chunks=[];res.on('data',c=>chunks.push(Buffer.from(c)));res.on('end',()=>emit({event:'response',status:res.statusCode,body:Buffer.concat(chunks).toString('utf8')}));
  });
  req.on('error',e=>emit({event:'error',message:e.message}));
  return req;
};
syncBuiltinESMExports();
