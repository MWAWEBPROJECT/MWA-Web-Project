const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {gzipSync}=require('node:zlib');
const {jsonBody}=require('./apiBody');

async function withServer(run){
 const app=express();
 app.use(jsonBody);
 app.post('/',(req,res)=>res.json({ok:true,body:req.body}));
 const server=app.listen(0,'127.0.0.1');
 await new Promise(resolve=>server.once('listening',resolve));
 const address=server.address();
 try{return await run(`http://127.0.0.1:${address.port}`)}
 finally{await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()))}
}

test('calendar REST body parser rejects malformed, compressed and oversized JSON',async()=>{
 await withServer(async url=>{
  assert.equal((await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:'{'})).status,400);
  assert.equal((await fetch(url,{method:'POST',headers:{'content-type':'application/json','content-encoding':'gzip'},body:gzipSync(Buffer.from('{"ok":true}'))})).status,415);
  assert.equal((await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({value:'x'.repeat(33*1024)})})).status,413);
  const valid=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:'{"ok":true}'});
  assert.equal(valid.status,200);
  assert.deepEqual(await valid.json(),{ok:true,body:{ok:true}});
 });
});
