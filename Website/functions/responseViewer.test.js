const test=require('node:test'),assert=require('node:assert/strict');const V=require('./responseViewer');
const future=new Date(Date.now()+3600000).toISOString();
test('viewer scope fails closed on expiry, revocation, new forms and relinking',()=>{const g={expiresAt:future,eventId:'one',formIds:['a'],fields:{a:['name']}};assert.ok(V.permitted(g,'a',{eventId:'one'}));assert.equal(V.permitted(g,'a',{eventId:'two'}),false);assert.equal(V.permitted(g,'b',{eventId:'one'}),false);assert.equal(V.permitted({...g,revoked:true},'a',{eventId:'one'}),false);assert.equal(V.active({...g,expiresAt:'2020-01-01'}),false);const r=V.project(g,'a',{fields:[{id:'name'},{id:'secret'}],answers:{name:'Fixture',secret:'private'},originalAnswers:{secret:'original'}});assert.deepEqual(r.answers,{name:'Fixture'});assert.equal(r.originalAnswers,undefined);});
test('viewer requires verified account, never substitutes for admin grants, and binds UID',async()=>{const records={'_responseViewers/v@example.org':{expiresAt:future,eventId:'one',formIds:['a'],fields:{a:['name']}}};const db={doc:path=>({path,get:async()=>({exists:!!records[path],data:()=>records[path]})}),runTransaction:async fn=>fn({get:r=>r.get(),update:(r,v)=>Object.assign(records[r.path],v)})};let t={email:'v@example.org',email_verified:false};assert.equal(await V.resolveViewer(db,'u',t),null);t.email_verified=true;assert.ok(await V.resolveViewer(db,'u',t));assert.equal(await V.resolveViewer(db,'other',t),null);records['adminAllowlist/v@example.org']={modules:[]};assert.equal(await V.resolveViewer(db,'u',t),null);});

test('API denies guessed forms, writes, stale export grants and revoked volunteer sessions',{skip:!process.env.FIRESTORE_EMULATOR_HOST},async()=>{
 const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore'),A=require('./registrations-api');const app=initializeApp({projectId:'demo-mwa-viewers'},'viewer-api'),db=getFirestore(app),id='11111111-1111-1111-1111-111111111111',other='22222222-2222-2222-2222-222222222222';
 const token={uid:'viewer',email:'viewer@example.invalid',email_verified:true,firebase:{sign_in_provider:'google.com'}},origin='https://refreshed.muhammadiwelfare.org.au';
 async function route(path,method='GET',body){let status=200,value;const [pathname,qs]=path.split('?');const res={status:n=>{status=n;return res},json:v=>{value=v;return res}};await A.handle({path:'/api/registrations'+pathname,query:Object.fromEntries(new URLSearchParams(qs)),method,body,ip:'fixture',get:k=>k==='Origin'?origin:k==='Authorization'?'Bearer fixture':'',is:()=>true},res,{db,getAuth:()=>({verifyIdToken:async()=>token}),origins:new Set([origin])});return {status,value};}
 try{
 await db.doc('registrationForms/'+id).set({eventId:'event-one',title:'Assigned',fields:[{id:'name'},{id:'private'}]});await db.doc('registrationForms/'+other).set({eventId:'event-one',title:'Not assigned'});
 await db.doc('registrationForms/'+id+'/responses/r1').set({createdAt:new Date().toISOString(),fields:[{id:'name'},{id:'private'}],answers:{name:'Allowed',private:'Never expose'},originalAnswers:{private:'Original private'}});
 const grant=db.doc('_responseViewers/'+token.email);await grant.set({eventId:'event-one',formIds:[id],fields:{[id]:['name']},expiresAt:future,revision:1});
 const list=await route('/admin');assert.equal(list.status,200);assert.equal(list.value.items.length,1);
 const read=await route('/admin/'+id+'/responses?grantRevision=1');assert.equal(read.status,200);assert.deepEqual(read.value.items[0].answers,{name:'Allowed'});assert.equal(JSON.stringify(read.value).includes('private'),false);
 for(const path of ['/admin/'+other+'/responses?grantRevision=1','/admin/events','/admin/viewers','/admin/insights'])assert.equal((await route(path)).status,403);
 assert.equal((await route('/admin/'+id+'/responses/r1','PUT',{grantRevision:1})).status,403);
 assert.equal((await route('/admin/'+id+'/export','POST',{grantRevision:1,asOf:new Date().toISOString(),count:1,filtered:true,format:'pdf'})).status,200);
 await grant.update({revision:2,fields:{[id]:[]}});assert.equal((await route('/admin/'+id+'/export','POST',{grantRevision:1,asOf:new Date().toISOString(),count:1})).status,409);
 await db.doc('registrationForms/'+id).update({eventId:'relinked'});assert.equal((await route('/admin/'+id+'/responses?grantRevision=2')).status,403);
 await grant.update({revoked:true});assert.equal((await route('/admin')).status,403);
 }finally{await db.terminate();await deleteApp(app);}
});
