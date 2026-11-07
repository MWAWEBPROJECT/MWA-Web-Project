const test=require('node:test'),assert=require('node:assert/strict');
const API=require('./insights-detail-api');
const State=require('./insights-state');

test('expiry is the end of the selected Sydney calendar day',()=>{
 assert.equal(API.expiry('2099-01-15'),'2099-01-15T13:00:00.000Z');
 assert.throws(()=>API.expiry('2020-01-01'),/future/);
 assert.throws(()=>API.expiry('9999-12-31'),/valid/);
});

test('explicit detail grants enforce saved-event intersection, pagination and live revocation',{skip:!process.env.FIRESTORE_EMULATOR_HOST},async()=>{
 const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');
 const app=initializeApp({projectId:'demo-mwa-detail'},'detail-test'),db=getFirestore(app),origin='https://refreshed.muhammadiwelfare.org.au';
 const owner={uid:'owner',email:'admin@muhammadiwelfare.org.au',email_verified:true,firebase:{sign_in_provider:'google.com'}},admin={uid:'assigned',email:'assigned@example.invalid',email_verified:true,firebase:{sign_in_provider:'google.com'}},other={uid:'other',email:'other@example.invalid',email_verified:true,firebase:{sign_in_provider:'google.com'}};
 const formA='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',formB='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 async function route(actor,path,method='GET',body={},query={}){let status=200,value;const res={status:code=>{status=code;return res;},json:data=>{value=data;return res;}};await API.handle({path:'/api/insights-detail'+path,method,query,body,is:()=>true,get:name=>name==='Authorization'?['Bearer','synthetic'].join(' '):origin},res,{db,getAuth:()=>({verifyIdToken:async()=>actor}),origins:new Set([origin])});return {status,value};}
 const snapshot=(eventId,n)=>({reference:'TEST-'+n,createdAt:'2026-01-01T00:00:00.000Z',revision:1,formTitle:'Synthetic',eventId,fields:[{id:'email',type:'email',label:'Email',options:[]},{id:'agree',type:'consent',label:'Consent',terms:'Terms',options:[]}],answers:{email:'example@example.invalid',agree:true},digest:'PRIVATE-DIGEST',originalAnswers:{email:'PRIVATE-ORIGINAL'}});
 async function start(actor,scope={}){return route(actor,'/start','POST',scope);}
 async function step(actor,job){return route(actor,'/step','POST',{jobId:job.jobId,step:job.step});}
 try{
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-mwa-detail/databases/(default)/documents`,{method:'DELETE'});
  for(const person of [owner,admin,other])await db.doc('users/'+person.uid).set({role:'admin',email:person.email});
  await db.doc('adminAllowlist/'+admin.email).set({uid:admin.uid,modules:[]});
  await db.doc('adminAllowlist/'+other.email).set({uid:other.uid,modules:['form-insights','form-insights-people','form-insights-export']});
  await Promise.all([db.doc('registrationForms/'+formA).set({eventId:'other'}),db.doc('registrationForms/'+formB).set({eventId:'other'}),db.doc('events/one').set({title:'Private',visibility:'private'}),db.doc('events/two').set({title:'Other'})]);
  const batch=db.batch();for(let i=0;i<105;i++)batch.set(db.doc(`registrationForms/${formA}/responses/${String(i).padStart(3,'0')}`),snapshot(i<103?'one':'two',i));
  batch.set(db.doc(`registrationForms/${formB}/responses/one`),snapshot('one','other-form'));await batch.commit();
  assert.equal((await route(admin,'/session')).status,403);
  assert.equal((await route(other,'/session')).status,403);
  assert.equal((await route(other,'/grants')).status,403);
  assert.equal((await route(owner,'/grants','POST',{email:admin.email,revision:0,revoke:false,formIds:[formA],eventIds:['one'],expiryDate:'2099-01-15'})).status,200);
  assert.equal((await route(admin,'/session')).status,200);
  const started=await start(admin);assert.equal(started.status,201);const first=await step(admin,started.value);
  assert.equal(first.status,200,JSON.stringify(first.value));assert.equal(first.value.items.length,100);assert.equal(first.value.status,'running');
  assert.equal(JSON.stringify(first.value).includes('PRIVATE-DIGEST'),false);assert.equal(JSON.stringify(first.value).includes('PRIVATE-ORIGINAL'),false);
  assert.equal(first.value.items[0].answers.agree,true);assert.equal(first.value.items[0].eventId,'');
  const second=await step(admin,{jobId:started.value.jobId,step:first.value.step});assert.equal(second.status,200);assert.equal(second.value.count,103);assert.equal(second.value.items.length,3);assert.equal(second.value.status,'complete');
  assert.equal((await route(admin,'/authorize','POST',{jobId:started.value.jobId,step:second.value.step})).status,200);
  assert.equal((await route(admin,'/authorize','POST',{jobId:started.value.jobId,step:second.value.step})).status,409);
  assert.equal((await start(admin,{formId:formB})).status,403);
  assert.equal((await start(admin,{eventId:'two'})).status,403);
  assert.equal((await start(admin,{from:'2026-01-01'})).status,400);
  assert.equal((await start(admin,{from:false})).status,400);
  const narrow=await start(admin,{formId:formA,eventId:'one',from:'2026-01-01',to:'2026-01-01',search:'EXAMPLE@example.invalid'});
  const narrowFirst=await route(admin,'/step','POST',{...narrow.value,search:'EXAMPLE@example.invalid'});
  const narrowNext=await route(admin,'/step','POST',{jobId:narrow.value.jobId,step:narrowFirst.value.step,search:'EXAMPLE@example.invalid'});
  assert.equal(narrowNext.value.count,103);assert.equal(narrowNext.value.status,'complete');
  assert.equal((await route(admin,'/authorize','POST',{jobId:narrow.value.jobId,step:narrowNext.value.step})).status,200);
  const outside=await start(admin,{from:'2025-12-31',to:'2025-12-31'}),outsideFirst=await step(admin,outside.value),outsideNext=await step(admin,{jobId:outside.value.jobId,step:outsideFirst.value.step});
  assert.equal(outsideNext.value.count,0);
  for(const [id,createdAt] of [['edge-before','2025-12-31T12:59:59.000Z'],['edge-start','2025-12-31T13:00:00.000Z'],['edge-end','2026-01-01T13:00:00.000Z']])await db.doc(`registrationForms/${formA}/responses/${id}`).set({...snapshot('one',id),createdAt,answers:{email:'boundary@example.invalid',agree:true}});
  const boundary=await start(admin,{from:'2026-01-01',to:'2026-01-01',search:'boundary@example.invalid'});let progress=boundary.value;const boundaryRows=[];
  do{const page=await route(admin,'/step','POST',{jobId:boundary.value.jobId,step:progress.step,search:'boundary@example.invalid'});assert.equal(page.status,200);boundaryRows.push(...page.value.items);progress=page.value;}while(progress.status==='running');
  assert.deepEqual(boundaryRows.map(row=>row.reference),['TEST-edge-start']);
  for(const id of ['edge-before','edge-start','edge-end'])await db.doc(`registrationForms/${formA}/responses/${id}`).delete();
  const pending=await start(admin);await route(owner,'/grants','POST',{email:admin.email,revision:1,revoke:true});
  assert.equal((await step(admin,pending.value)).status,403);
  await route(owner,'/grants','POST',{email:admin.email,revision:2,revoke:false,formIds:[],eventIds:['one'],expiryDate:'2099-01-15'});
  const cross=await start(admin),cross1=await step(admin,cross.value);assert.equal(cross1.status,200,JSON.stringify(cross1.value));const cross2=await step(admin,{jobId:cross.value.jobId,step:cross1.value.step});assert.equal(cross2.status,200,JSON.stringify(cross2.value));assert.equal(cross2.value.count,104);
  const stale=await start(admin);await State.recordSourceChange(db,formA);assert.equal((await step(admin,stale.value)).status,409);
  const limited=await start(admin);await db.doc('_insightsDetailJobs/'+limited.value.jobId).update({scanned:19999});const overLimit=await step(admin,limited.value);assert.equal(overLimit.status,422);assert.equal(overLimit.value.items,undefined);
  const cancelled=await start(admin);assert.equal((await route(admin,'/cancel','POST',{jobId:cancelled.value.jobId,step:0})).status,200);assert.equal((await step(admin,cancelled.value)).status,409);
  await route(owner,'/grants','POST',{email:admin.email,revision:3,revoke:false,formIds:[formB],eventIds:[],expiryDate:'2099-01-15'});
  const formOnly=await start(admin),formPage=await step(admin,formOnly.value);assert.equal(formPage.value.count,1);assert.equal(formPage.value.status,'complete');
  await route(owner,'/grants','POST',{email:admin.email,revision:4,revoke:true});
  assert.equal((await route(admin,'/authorize','POST',{jobId:formOnly.value.jobId,step:formPage.value.step})).status,403);
  await route(owner,'/grants','POST',{email:admin.email,revision:5,revoke:false,formIds:[formB],eventIds:[],expiryDate:'2099-01-15'});
  await db.doc(`registrationForms/${formB}/responses/malformed`).set({...snapshot('one','malformed'),fields:[]});
  const invalid=await start(admin);assert.equal((await step(admin,invalid.value)).status,422);
  assert.equal((await route(owner,'/grants','POST',{email:admin.email,revision:6,revoke:false,formIds:[formA],eventIds:['one'],permission:'view',expiryDate:'2099-01-15'})).status,200);
  assert.equal((await route(admin,'/session')).value.grant.permission,'view');
  assert.equal((await start(admin)).status,403);
  assert.equal((await start(admin,{mode:'export'})).status,403);
  const viewing=await start(admin,{mode:'view',eventId:'one',search:'EXAMPLE@example.invalid'});assert.equal(viewing.status,201,JSON.stringify(viewing.value));
  assert.equal((await route(admin,'/authorize','POST',{jobId:viewing.value.jobId,step:0})).status,403);
  const page=await route(admin,'/step','POST',{...viewing.value,search:'EXAMPLE@example.invalid'});assert.equal(page.status,200,JSON.stringify(page.value));assert.equal(page.value.items.length,100);
  assert.equal((await route(admin,'/step','POST',{jobId:viewing.value.jobId,step:page.value.step,search:'different'})).status,409);
  const viewNext=await route(admin,'/step','POST',{jobId:viewing.value.jobId,step:page.value.step,search:'EXAMPLE@example.invalid'});assert.equal(viewNext.value.count,103);assert.equal(viewNext.value.status,'complete');
  assert.equal((await start(admin,{mode:'view',formId:formB})).status,403);
  const abandoned=await start(admin,{mode:'view'});assert.equal((await route(admin,'/cancel','POST',abandoned.value)).status,200);assert.equal((await step(admin,abandoned.value)).status,409);
  const revokedView=await start(admin,{mode:'view'});await route(owner,'/grants','POST',{email:admin.email,revision:7,revoke:true});assert.equal((await step(admin,revokedView.value)).status,403);
  await route(owner,'/grants','POST',{email:admin.email,revision:8,revoke:false,formIds:[],eventIds:['one'],permission:'view',expiryDate:'2099-01-15'});
  const crossView=await start(admin,{mode:'view'}),cv1=await step(admin,crossView.value),cv2=await step(admin,{jobId:crossView.value.jobId,step:cv1.value.step});assert.equal(cv2.status,422); // malformed saved snapshot is never silently skipped
  await db.doc(`registrationForms/${formB}/responses/malformed`).delete();
  const crossView2=await start(admin,{mode:'view',formId:formB}),cv3=await step(admin,crossView2.value);assert.equal(cv3.status,200);assert.equal(cv3.value.count,1);
  const expiring=await start(admin,{mode:'view'});await db.doc('_insightsDetailGrants/'+admin.email).update({expiresAt:'2020-01-01T00:00:00.000Z'});assert.equal((await step(admin,expiring.value)).status,403);
  await db.doc('adminAllowlist/'+admin.email).update({accessExpiresAt:new Date('2020-01-01')});assert.equal((await start(admin)).status,403);
  const audits=await db.collection('auditLog').get();const text=JSON.stringify(audits.docs.map(doc=>doc.data()));assert.equal(text.includes('example@example.invalid'),false);assert.equal(text.includes('PRIVATE-DIGEST'),false);assert.equal(text.includes('PRIVATE-ORIGINAL'),false);
 }finally{await db.terminate();await deleteApp(app);}
});
