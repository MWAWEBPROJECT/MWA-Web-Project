const test=require('node:test'),assert=require('node:assert/strict');
const A=require('./enquiries-api'),G=require('./enquiries-gmail'),C=require('./enquiries-core');
test('custom-domain setup is allowed; Google OAuth stays bound to the registered callback host',async()=>{
 const custom='https://refreshed.muhammadiwelfare.org.au',origins=new Set([C.SITE,custom]);
 const db={doc:path=>({get:async()=>({exists:true,data:()=>path.startsWith('users/')?{role:'admin',email:C.OWNER}:{}})})};
 const getAuth=()=>({verifyIdToken:async()=>({uid:'owner',email:C.OWNER,email_verified:true,firebase:{sign_in_provider:'google.com'}})});
 let calls=0;const original=G.mailboxAction;G.mailboxAction=async(_db,_actor,input)=>{calls++;return input.action==='connect'?{url:'https://accounts.google.com/test',cookie:'test-state'}:{ok:true}};
 const run=async(origin,action)=>{const req={path:'/api/enquiries/mailbox',method:'POST',body:{action},is:()=>true,get:key=>key==='Origin'?origin:key==='Authorization'?'Bearer test':null};const res={code:200,headers:{},status(code){this.code=code;return this},set(k,v){this.headers[k]=v;return this},json(value){this.body=value;return this}};await A.handle(req,res,{db,getAuth,origins});return res;};
 try{assert.equal((await run(custom,'configure')).code,200);assert.equal(calls,1);assert.equal((await run(custom,'connect')).code,409);assert.equal(calls,1);assert.equal((await run('https://unrelated.example','configure')).code,403);assert.equal(calls,1);const connected=await run(C.SITE,'connect');assert.equal(connected.code,200);assert.match(connected.headers['Set-Cookie'],/HttpOnly; Secure/);assert.equal(connected.body.cookie,undefined);}finally{G.mailboxAction=original}
});
