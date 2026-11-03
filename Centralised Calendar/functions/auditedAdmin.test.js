const {test}=require('node:test');const assert=require('node:assert/strict');
const {register,cleanDirectory,cleanIslamic}=require('./auditedAdmin');
function setup(seed={}) {
 const docs=new Map(Object.entries(seed));let n=0;
 const ref=path=>({path,id:path.split('/').pop()});
 const db={doc:ref,collection:name=>({doc:id=>ref(name+'/'+(id||'new-'+(++n))),add:async value=>{docs.set(name+'/new-'+(++n),value);}}),runTransaction:async fn=>{const pending=[];const tx={get:async r=>({exists:docs.has(r.path),data:()=>docs.get(r.path)}),set:(r,d,opts)=>pending.push(()=>docs.set(r.path,opts?.merge?{...docs.get(r.path),...d}:d)),create:(r,d)=>pending.push(()=>docs.set(r.path,d)),update:(r,d)=>pending.push(()=>docs.set(r.path,{...docs.get(r.path),...d})),delete:r=>pending.push(()=>docs.delete(r.path))};await fn(tx);pending.forEach(commit=>commit());}};
 class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
 const handlers=register({db,onCall:fn=>fn,HttpsError,requireAdmin:async (auth,module)=>{if(!auth?.approved||(module&&auth.modules&&!auth.modules.includes(module)))throw new HttpsError('permission-denied','Admin required');return {uid:'verified-uid',email:'verified@mwa.au'};},FieldValue:{serverTimestamp:()=>'(server timestamp)'}});
 return {docs,...handlers};
}
test('directory edits record the verified actor and exact change in the same commit',async()=>{
 const env=setup({'venues/hall':{name:'Main Hall',active:true}});
 await env.changeDirectory({auth:{approved:true},data:{kind:'venues',operation:'update',id:'hall',data:{name:'Hall'},userId:'forged'}});
 const log=[...env.docs].find(([key])=>key.startsWith('auditLog/'))[1];assert.equal(log.userId,'verified-uid');assert.equal(log.userEmail,'verified@mwa.au');assert.equal(log.module,'events-bookings');assert.deepEqual(log.diff.name,{before:'Main Hall',after:'Hall'});
});
test('anonymous changes and forged fields cannot alter records or create audit entries',async()=>{
 const env=setup({'venues/hall':{name:'Main Hall'}});
 await assert.rejects(()=>env.changeDirectory({data:{kind:'venues',operation:'delete',id:'hall'}}),{code:'permission-denied'});
 await assert.rejects(()=>env.changeDirectory({auth:{approved:true},data:{kind:'venues',operation:'update',id:'hall',data:{role:'admin'}}}),{code:'invalid-argument'});
 assert.equal(env.docs.size,1);
});
test('Hijri upserts preserve other months and removal records before/after settings',async()=>{
 const env=setup({'calendarSettings/hijri':{overrides:[{hYear:1448,hMonth:4,gDate:'2026-09-13'}]}});
 await env.changeHijriMonth({auth:{approved:true},data:{hYear:1448,hMonth:5,gDate:'2026-10-13'}});
 assert.equal(env.docs.get('calendarSettings/hijri').overrides.length,2);
 await env.changeHijriMonth({auth:{approved:true},data:{hYear:1448,hMonth:5,remove:true}});
 assert.equal(env.docs.get('calendarSettings/hijri').overrides.length,1);
 assert.equal([...env.docs].filter(([key])=>key.startsWith('auditLog/')).length,2);
});
test('Islamic event conflicts leave both record and audit unchanged',async()=>{
 const env=setup({'keyIslamicEvents/e':{name:'Eid',day:1,month:10,category:'Eid',revision:2}});
 await assert.rejects(()=>env.changeIslamicEvent({auth:{approved:true},data:{id:'e',revision:1,data:{name:'Eid',day:2,month:10,category:'Eid'}}}),{code:'failed-precondition'});assert.equal(env.docs.size,1);
});
test('activity endpoint cannot accept arbitrary actions or an unapproved session',async()=>{
 const env=setup();await assert.rejects(()=>env.recordActivity({auth:{approved:true},data:{module:'website-cms',action:'website.published',userId:'forged'}}),{code:'invalid-argument'});
 await env.recordActivity({auth:{approved:true},data:{module:'tools-automation',action:'module.opened'}});assert.equal([...env.docs.values()][0].userId,'verified-uid');
});
test('opening Form Builder records its own module and requires that specific access',async()=>{
 const env=setup();
 await assert.rejects(()=>env.recordActivity({auth:{approved:true,modules:['website-cms']},data:{module:'form-builder',action:'module.opened'}}),{code:'permission-denied'});
 assert.equal(env.docs.size,0);
 await env.recordActivity({auth:{approved:true,modules:['form-builder']},data:{module:'form-builder',action:'module.opened'}});
 assert.equal([...env.docs.values()][0].module,'form-builder');
});
test('directory and observance validation reject invalid inputs',()=>{
 assert.throws(()=>cleanDirectory('departments',{paletteTone:6},false));assert.throws(()=>cleanDirectory('venues',{bufferHours:-1},false));assert.throws(()=>cleanIslamic({name:'Eid',day:31,month:10,category:'Eid'}));
});
