const test=require('node:test'),assert=require('node:assert/strict');
const {resolveAdmin,effectiveModules,hasModule,validateModules,accessActive}=require('./moduleAccess');
const {validateExpiry,register}=require('./teamPermissions');
const {OWNER_EMAIL}=require('./adminAccess');
const catalogue=require('./adminModules.json');
function environment(email='ec@example.org',entry={modules:['enquiries']},role='admin'){
 const docs=new Map([['users/u',{role}],['adminAllowlist/'+email,entry]]);
 const db={doc:path=>({path,get:async()=>({exists:docs.has(path),data:()=>docs.get(path)})})};
 return {db,docs,auth:{uid:'u',token:{email,email_verified:true,firebase:{sign_in_provider:'google.com'}}}};
}
test('legacy members keep the fixed baseline; Form Builder requires an explicit grant',()=>{
 assert.deepEqual(effectiveModules({}),catalogue.legacyModules);assert.deepEqual(effectiveModules({modules:[]}),[]);
 assert.equal(hasModule('ec@example.org',{},'form-builder'),false);
 assert.deepEqual(validateModules(['form-builder']),['form-builder']);
 assert.equal(hasModule('ec@example.org',{modules:['enquiries']},'website-cms'),false);
 assert.throws(()=>validateModules(['unknown']));assert.throws(()=>validateModules(undefined));
});
test('live allowlist enforces module isolation, revocation, expiry, role and password policy',async()=>{
 const e=environment();assert.ok(await resolveAdmin(e.db,'u',e.auth.token,'enquiries'));
 for(const module of catalogue.modules.filter(m=>m.id!=='enquiries'))assert.equal(await resolveAdmin(e.db,'u',e.auth.token,module.id),null);
 e.docs.set('adminAllowlist/ec@example.org',{modules:['enquiries'],accessExpiresAt:new Date(Date.now()-1000)});assert.equal(await resolveAdmin(e.db,'u',e.auth.token,'enquiries'),null);
 e.docs.delete('adminAllowlist/ec@example.org');assert.equal(await resolveAdmin(e.db,'u',e.auth.token,'enquiries'),null);
 const member=environment('member@example.org',{modules:['enquiries']},'member');assert.equal(await resolveAdmin(member.db,'u',member.auth.token,'enquiries'),null);
 const pw=environment();pw.docs.set('calendarSettings/auth',{passwordLoginDisabled:true});pw.auth.token.firebase.sign_in_provider='password';assert.equal(await resolveAdmin(pw.db,'u',pw.auth.token,'enquiries'),null);
});
test('verified owner keeps indefinite access; unverified owner does not bypass checks',async()=>{
 const e=environment(OWNER_EMAIL,{modules:[],accessExpiresAt:new Date(0)});
 for(const m of catalogue.modules)assert.ok(await resolveAdmin(e.db,'u',e.auth.token,m.id));
 e.auth.token.email_verified=false;assert.equal(await resolveAdmin(e.db,'u',e.auth.token,'tools-automation'),null);
});
test('expiry follows the end of the selected Sydney day in summer, winter and DST transition',()=>{
 assert.equal(validateExpiry('2027-01-15',0).accessExpiresAt.toISOString(),'2027-01-15T13:00:00.000Z');
 assert.equal(validateExpiry('2027-07-15',0).accessExpiresAt.toISOString(),'2027-07-15T14:00:00.000Z');
 assert.equal(validateExpiry('2027-04-04',0).accessExpiresAt.toISOString(),'2027-04-04T14:00:00.000Z');
 assert.deepEqual(validateExpiry(null),{accessExpiryDate:null,accessExpiresAt:null});
 assert.throws(()=>validateExpiry('2027-02-30',0));assert.throws(()=>validateExpiry('2020-01-01'));assert.throws(()=>validateExpiry(undefined));
 assert.equal(accessActive({accessExpiresAt:new Date(1000)},1000),false);assert.equal(accessActive({accessExpiresAt:'bad'}),false);
});
function teamEnv(email=OWNER_EMAIL){
 const e=environment(email,{modules:['tools-automation']});let counter=0;
 e.db.collection=path=>({doc:()=>({path:path+'/'+(++counter)})});
 e.db.runTransaction=async fn=>{const changes=[];const tx={get:ref=>ref.get(),create:(r,d)=>changes.push(()=>e.docs.set(r.path,d)),update:(r,d)=>changes.push(()=>e.docs.set(r.path,{...e.docs.get(r.path),...d})),set:(r,d)=>changes.push(()=>e.docs.set(r.path,d))};await fn(tx);changes.forEach(f=>f())};
 class HttpsError extends Error{constructor(code,message){super(message);this.code=code}}
 const requireAdmin=async(auth,module)=>{const actor=await resolveAdmin(e.db,auth?.uid,auth?.token,module);if(!actor)throw new HttpsError('permission-denied','Denied');return actor};
 return {...e,...register({db:e.db,onCall:(options,fn)=>fn,HttpsError,requireAdmin})};
}
test('only owner can add or edit access even when another member has Tools permission',async()=>{
 const e=teamEnv('ec@example.org');const input={auth:e.auth,data:{email:'new@example.org',modules:['enquiries'],expiryDate:null}};
 await assert.rejects(()=>e.addAdminEmail(input),{code:'permission-denied'});
 await assert.rejects(()=>e.setAdminModules(input),{code:'permission-denied'});
 assert.equal(e.docs.has('adminAllowlist/new@example.org'),false);
});
test('owner edits are audited atomically and reject stale revisions and owner changes',async()=>{
 const e=teamEnv(),input={auth:e.auth,data:{email:'new@example.org',modules:['enquiries'],expiryDate:null}};
 await e.addAdminEmail(input);assert.deepEqual(e.docs.get('adminAllowlist/new@example.org').modules,['enquiries']);
 await e.setAdminModules({auth:e.auth,data:{...input.data,modules:[],revision:1}});assert.deepEqual(e.docs.get('adminAllowlist/new@example.org').modules,[]);
 await assert.rejects(()=>e.setAdminModules({auth:e.auth,data:{...input.data,revision:1}}),{code:'failed-precondition'});
 await assert.rejects(()=>e.setAdminModules({auth:e.auth,data:{...input.data,email:OWNER_EMAIL,revision:0}}),{code:'failed-precondition'});
 assert.equal([...e.docs.keys()].filter(k=>k.startsWith('auditLog/')).length,2);
});
test('website and calendar deploy identical module policy and catalogue',()=>{
 const fs=require('node:fs'),path=require('node:path');for(const file of ['moduleAccess.js','adminModules.json'])assert.equal(fs.readFileSync(path.join(__dirname,file),'utf8'),fs.readFileSync(path.join(__dirname,'../../Website/functions',file),'utf8'));
});
