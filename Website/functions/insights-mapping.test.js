const test=require('node:test'),assert=require('node:assert/strict');
const I=require('./form-insights'),M=require('./insights-mapping'),State=require('./insights-state');

test('mapping validation is revision-specific, conservative and never maps consent',()=>{
 const fields=[{id:'name',type:'text'},{id:'consent',type:'consent'}];
 assert.deepEqual(M.cleanEntries([{fieldId:'consent',role:'',concept:''},{fieldId:'name',role:'respondent-name',concept:'person_name'}],fields),[{fieldId:'name',role:'respondent-name',concept:'person_name'},{fieldId:'consent',role:'',concept:''}]);
 assert.throws(()=>M.cleanEntries([{fieldId:'name',role:'household-size'},{fieldId:'consent'}],fields),/compatible/);
 assert.throws(()=>M.cleanEntries([{fieldId:'name',role:'constructor'},{fieldId:'consent'}],fields),/compatible/);
 assert.throws(()=>M.cleanEntries([{fieldId:'name'},{fieldId:'consent',concept:'consent'}],fields),/Consent/);
 assert.throws(()=>M.cleanEntries([{fieldId:'name'},{fieldId:'name'}],fields),/distinct/);
 assert.throws(()=>M.cleanEntries([{fieldId:'name',concept:'Bad concept'},{fieldId:'consent'}],fields),/Concept keys/);
});

test('mapping scans resume beyond 1,000 snapshots and page many revisions',{skip:!process.env.FIRESTORE_EMULATOR_HOST},async()=>{
 const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');
 const app=initializeApp({projectId:'demo-mwa-insights-mapping-large'},'insights-mapping-large'),db=getFirestore(app),formId='88888888-8888-4888-8888-888888888888';
 const actor={uid:'synthetic-owner',email:'admin@muhammadiwelfare.org.au'},fields=[{id:'name',type:'text',label:'Name',required:true,options:[]}],form=db.doc('registrationForms/'+formId);
 try{
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-mwa-insights-mapping-large/databases/(default)/documents`,{method:'DELETE'});
  await form.set({revision:200,fields});
  for(let offset=0;offset<1206;offset+=400){
   const batch=db.batch();
   for(let i=offset;i<Math.min(offset+400,1206);i++)batch.set(form.collection('responses').doc(String(i).padStart(6,'0')),{revision:i<1101?1:i-1099,fields,answers:{name:'PRIVATE SYNTHETIC ANSWER'}});
   await batch.commit();
  }
  let discovery=await M.startScan(db,actor,{formId,mode:'discover'});
  discovery=await M.stepScan(db,actor,discovery.jobId);
  assert.equal(discovery.status,'running');assert.equal(discovery.scanned,100);assert.equal(discovery.revisions,undefined);
  const parallel=await Promise.allSettled([M.stepScan(db,actor,discovery.jobId),M.stepScan(db,actor,discovery.jobId)]);
  assert.ok(parallel.some(result=>result.status==='fulfilled'));
  for(const result of parallel)if(result.status==='rejected')assert.equal(result.reason.status,409);
  discovery=await M.scanStatus(db,actor,discovery.jobId);
  assert.ok(discovery.scanned===200||discovery.scanned===300);
  while(discovery.status==='running')discovery=await M.stepScan(db,actor,discovery.jobId);
  assert.equal(discovery.scanned,1206);assert.equal(discovery.revisions.length,100);assert.ok(discovery.next);
  const second=await M.scanStatus(db,actor,discovery.jobId,discovery.next);
  assert.equal(second.revisions.length,7);assert.equal(second.next,null);
  let old=await M.startScan(db,actor,{formId,mode:'inspect',revision:1});
  old=await M.stepScan(db,actor,old.jobId);assert.equal(old.status,'running');assert.equal(old.result,undefined);
  old=await M.scanStatus(db,actor,old.jobId);
  while(old.status==='running')old=await M.stepScan(db,actor,old.jobId);
  assert.equal(old.result.status,'available');assert.equal(old.result.snapshotCount,1101);
  const entries=[{fieldId:'name',role:'respondent-name',concept:''}];
  await M.write(db,actor,{formId,revision:1,version:0,action:'save',scanId:old.jobId,entries});
  await M.write(db,actor,{formId,revision:1,version:1,action:'review',scanId:old.jobId});
  let current=await M.startScan(db,actor,{formId,mode:'inspect',revision:200});
  current=await M.stepScan(db,actor,current.jobId);
  const copied=await M.write(db,actor,{formId,revision:200,version:0,action:'copy',scanId:current.jobId,copyFromRevision:1,copyScanId:old.jobId});
  assert.equal(copied.status,'draft');assert.equal(copied.entries[0].role,'respondent-name');
  await M.write(db,actor,{formId,revision:200,version:1,action:'review',scanId:current.jobId});
  const privateData=JSON.stringify((await db.doc(`_insightsState/mappingScans/jobs/${old.jobId}`).get()).data());
  assert.equal(privateData.includes('PRIVATE SYNTHETIC ANSWER'),false);
 }finally{await db.terminate();await deleteApp(app);}
});

test('revision mapping requires explicit review and copied mappings are drafts only',{skip:!process.env.FIRESTORE_EMULATOR_HOST},async()=>{
 const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');
 const app=initializeApp({projectId:'demo-mwa-insights-mapping'},'insights-mapping-test'),db=getFirestore(app),formId='77777777-7777-4777-8777-777777777777',origin='https://refreshed.muhammadiwelfare.org.au',token={uid:'mapping-owner',email:'admin@muhammadiwelfare.org.au',email_verified:true,firebase:{sign_in_provider:'google.com'}};
 const fields=[{id:'name',type:'text',label:'Name',description:'',required:true,options:[],terms:''},{id:'choice',type:'select',label:'Meal',description:'',required:false,options:['A','B'],terms:''},{id:'consent',type:'consent',label:'Consent',description:'',required:true,options:[],terms:'Original terms'}];
 async function route(method,body={},query={}){let status=200,value;const res={status:code=>{status=code;return res},json:result=>{value=result;return res}};await I.handle({path:'/api/form-insights/mapping',method,body,query,is:()=>true,get:key=>key==='Authorization'?'Bearer synthetic-test-token':origin},res,{db,getAuth:()=>({verifyIdToken:async()=>token}),origins:new Set([origin])});return {status,value};}
 const scans=new Map();
 const start=(mode,revision)=>route('POST',{action:'scan-start',formId,mode,revision});
 const step=jobId=>route('POST',{action:'scan-step',jobId});
 const status=(jobId,after)=>route('GET',{}, {jobId,...(after?{after}:{})});
 const finish=async job=>{while(job.value.status==='running'){job=await step(job.value.jobId);assert.equal(job.status,200);}return job;};
 const read=async revision=>{const job=await finish(await start('inspect',revision));scans.set(revision,job.value.jobId);return {status:job.status,value:job.value.result};};
 const change=(revision,version,action,extra={})=>route('POST',{formId,revision,version,action,scanId:scans.get(revision),...extra});
 try{
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-mwa-insights-mapping/databases/(default)/documents`,{method:'DELETE'});
  await db.doc('users/'+token.uid).set({role:'admin',email:token.email});
  const form=db.doc('registrationForms/'+formId),response=form.collection('responses').doc('synthetic');
  await form.set({title:'Synthetic form',revision:2,fields:[fields[0],{...fields[1],options:['A','C']},fields[2]]});
  await response.set({revision:1,fields,answers:{name:'PRIVATE SYNTHETIC ANSWER',choice:'A',consent:true},createdAt:'2026-10-01T00:00:00Z'});
  const discovery=await finish(await start('discover'));assert.deepEqual(discovery.value.revisions,[{revision:1,current:false,responseSnapshots:1},{revision:2,current:true,responseSnapshots:0}]);assert.match(discovery.value.notice,/Earlier revisions without responses may be missing/);
  const missing=await read(3);assert.equal(missing.status,200);assert.equal(missing.value.status,'unavailable');assert.equal((await change(3,0,'save',{entries:[]})).status,409);
  const old=await read(1);assert.equal(old.value.status,'available');assert.equal(old.value.source,'response snapshots');assert.equal(JSON.stringify(old.value).includes('PRIVATE SYNTHETIC ANSWER'),false);assert.deepEqual(old.value.fields[1].options,['A','B']);
  const entries=[{fieldId:'name',role:'respondent-name',concept:''},{fieldId:'choice',role:'',concept:'meal_choice'},{fieldId:'consent',role:'',concept:''}];
  assert.equal((await change(1,0,'review')).status,409);
  const draft=await change(1,0,'save',{entries});assert.equal(draft.status,200);assert.equal(draft.value.mapping.status,'draft');assert.equal(draft.value.mapping.version,1);
  assert.equal((await change(1,0,'save',{entries})).status,409);
  const reviewed=await change(1,1,'review');assert.equal(reviewed.status,200);assert.equal(reviewed.value.mapping.status,'reviewed');
  const current=await read(2);assert.equal(current.value.mapping,null);assert.deepEqual(current.value.fields[1].options,['A','C']);
  const copied=await change(2,0,'copy',{copyFromRevision:1,copyScanId:scans.get(1)});assert.equal(copied.status,200);assert.equal(copied.value.mapping.status,'draft');assert.equal(copied.value.mapping.copiedFromRevision,1);assert.equal(copied.value.mapping.entries[0].role,'respondent-name');assert.equal(copied.value.mapping.entries[1].concept,'');
  assert.equal((await change(2,0,'review')).status,409);assert.equal((await change(2,1,'review')).value.mapping.status,'reviewed');
  assert.equal((await change(2,2,'save',{entries:[{fieldId:'name',role:'',concept:''},{fieldId:'choice',role:'',concept:''},{fieldId:'consent',role:'',concept:'consent'}]})).status,400);
  const coverage=(await db.doc('_insightsState/coverage').get()).data();assert.equal(coverage.status,'incomplete');assert.ok(coverage.updatedAt);assert.ok((await State.versionRef(db,'index',formId).get()).data().generation>=4);
  const audit=(await db.collection('auditLog').get()).docs.map(doc=>doc.data());assert.equal(audit.filter(item=>item.action==='insights.mapping_reviewed').length,2);assert.equal(JSON.stringify(audit).includes('PRIVATE SYNTHETIC ANSWER'),false);
  assert.equal((await response.get()).data().answers.name,'PRIVATE SYNTHETIC ANSWER');assert.equal((await db.collection('_registrationInsights').get()).size,0);
  await form.collection('responses').doc('conflict').set({revision:1,fields:[{...fields[0],label:'Different question'},...fields.slice(1)],answers:{}});
  assert.equal((await read(1)).value.status,'conflict');assert.equal((await change(1,2,'review')).status,409);
  const partial=await start('discover');assert.equal(partial.value.status,'running');assert.equal(partial.value.revisions,undefined);
  const cancelled=await route('POST',{action:'scan-cancel',jobId:partial.value.jobId});assert.equal(cancelled.value.status,'cancelled');assert.equal((await step(partial.value.jobId)).value.status,'cancelled');
  const stale=await start('inspect',2);await db.runTransaction(tx=>State.bumpSourceVersionTx(tx,db,formId));assert.equal((await step(stale.value.jobId)).value.status,'invalidated');assert.equal((await change(2,2,'review')).status,409);
  const changedForm=await start('inspect',2);await form.update({title:'Changed synthetic form'});assert.equal((await step(changedForm.value.jobId)).value.status,'invalidated');
  const completed=await finish(await start('inspect',2));assert.equal(completed.value.status,'complete');await form.update({title:'Changed again'});assert.equal((await status(completed.value.jobId)).value.status,'invalidated');
  token.uid='ordinary-insights';token.email='insights@example.invalid';await db.doc('users/'+token.uid).set({role:'admin',email:token.email});await db.doc('adminAllowlist/'+token.email).set({uid:token.uid,modules:['form-insights']});
  assert.equal((await read(1)).status,403);assert.equal((await change(2,2,'review')).status,403);
 }finally{await db.terminate();await deleteApp(app);}
});
