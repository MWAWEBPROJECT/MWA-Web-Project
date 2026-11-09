const {test}=require('node:test');
const assert=require('node:assert/strict');
const A=require('./niaz-api'),M=require('./niaz-model');
function request(path,method='GET',body={},token=''){
 return {path:'/api/niaz'+path,method,body,query:{},get:key=>({'Authorization':token?'Bearer '+token:'','Origin':'https://refreshed.muhammadiwelfare.org.au'}[key]),is:()=>true};
}
function response(){return {code:200,body:null,set(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};}
const dbFor=records=>({doc:path=>({get:async()=>({exists:!!records[path],data:()=>records[path]})})});
test('Contact-only proof requires correct session, purpose, verification and unexpired timestamp',async()=>{
 const sessionId='a'.repeat(32),challengeId='b'.repeat(43),contact='demo@example.org';
 const challenge={purpose:'public-booking',scope:'contact',method:'email',contact,status:'verified',expiresAt:{toMillis:()=>Date.now()+10000},sessionIdHash:M.hash(sessionId)};
 const records={['_bookingVerificationChallenges/'+challengeId]:challenge,['_bookingVerificationSessions/'+M.hash(sessionId)]:{challengeId}};
 const req=request('/eoi','POST',{verification:{sessionId,challengeId}});
 assert.equal((await A.identity(req,dbFor(records),()=>null)).email,contact);
 for(const patch of [{scope:'booking'},{status:'active'},{purpose:'other'},{expiresAt:null},{expiresAt:{toMillis:()=>0}},{sessionIdHash:'different'}]){
  await assert.rejects(A.identity(req,dbFor({...records,['_bookingVerificationChallenges/'+challengeId]:{...challenge,...patch}}),()=>null),/expired/);
 }
});
test('Server requires verified profile/module/expiry; new finance is not a legacy grant',async()=>{
 const email='reader@example.org',uid='synthetic-reader',profile={role:'admin',email},entry={uid,modules:['niaz-read']};
 const records={['users/'+uid]:profile,['adminAllowlist/'+email]:entry,'calendarSettings/auth':{}};
 const token={uid,email,email_verified:true,firebase:{sign_in_provider:'google.com'}},getAuth=()=>({verifyIdToken:async(_,revoked)=>{assert.equal(revoked,true);return token;}});
 const opts={db:dbFor(records),getAuth,origins:new Set(['https://refreshed.muhammadiwelfare.org.au'])};
 let res=response();await A.handle(request('/session','GET',{},'test'),res,opts);
 assert.equal(res.code,200);assert.equal(res.body.manage,false);assert.equal(res.body.finance,false);
 res=response();await A.handle(request('/sponsor','POST',{},'test'),res,opts);assert.equal(res.code,403);
 for(const modules of [['niaz-read'],['niaz-finance']]){
  records['adminAllowlist/'+email]={uid,modules};
  res=response();await A.handle(request('/attention-acknowledge','POST',{id:'conflict'},'test'),res,opts);assert.equal(res.code,403);
 }
 records['adminAllowlist/'+email]={uid,modules:['niaz']};
 res=response();await A.handle(request('/attention-acknowledge','GET',{id:'conflict'},'test'),res,opts);assert.equal(res.code,405);
 records['adminAllowlist/'+email]={uid,modules:['niaz'],accessExpiresAt:{toMillis:()=>0}};
 res=response();await A.handle(request('/session','GET',{},'test'),res,opts);assert.equal(res.code,403);
 records['adminAllowlist/'+email]={uid};
 res=response();await A.handle(request('/session','GET',{},'test'),res,opts);assert.equal(res.body.manage,true);assert.equal(res.body.finance,false);
 res=response();await A.handle(request('/sponsor','GET',{},'test'),res,opts);assert.equal(res.code,405);
});
