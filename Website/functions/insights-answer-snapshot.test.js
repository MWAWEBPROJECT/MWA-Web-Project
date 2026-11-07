const test=require('node:test'),assert=require('node:assert/strict');
const {createHash,randomUUID}=require('node:crypto');
const Answer=require('./insights-answer-snapshot'),Snapshot=require('./insights-multi-snapshot'),Mapping=require('./insights-mapping'),State=require('./insights-state');
const key=(form,id)=>createHash('sha256').update(form+':'+id).digest('hex');
test('resumable mapped-answer cross-tab exceeds 5000 rows without exposing raw answers',{skip:!process.env.FIRESTORE_EMULATOR_HOST,timeout:240000},async()=>{
 const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');
 const app=initializeApp({projectId:'demo-answers-snapshot'},randomUUID()),db=getFirestore(app),form='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const actor={uid:'aggregate',email:'aggregate@example.invalid',provider:'google.com',modules:['form-insights']};
 const fields=[{id:'choice',type:'checkboxes',label:'Choice',options:['A','B'],required:false},{id:'time',type:'radio',label:'Time',options:['X','Y'],required:false},{id:'text',type:'text',label:'Private',options:[],required:false}];
 const entries=[{fieldId:'choice',role:'',concept:'choice'},{fieldId:'time',role:'',concept:'time'},{fieldId:'text',role:'',concept:''}];
 const input={dateMode:'custom',from:'2026-01-01',to:'2026-12-31',basis:'submission',search:'',concept:'choice',concept2:'time'};
 try{
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-answers-snapshot/databases/(default)/documents`,{method:'DELETE'});
  await db.doc('users/'+actor.uid).set({role:'admin',email:actor.email});await db.doc('adminAllowlist/'+actor.email).set({uid:actor.uid,modules:actor.modules});
  await db.doc(`_insightsState/fieldMappings/forms/${form}/revisions/1`).set({status:'reviewed',version:1,schemaHash:Mapping.hashSchema(Mapping.schema(fields)),entries});
  for(let offset=0;offset<5202;offset+=200){
   const batch=db.batch();
   for(let i=offset;i<Math.min(5202,offset+200);i++){
    const id='r'+String(i).padStart(4,'0'),createdAt='2026-03-01T00:00:00.000Z';
    batch.set(db.doc(`registrationForms/${form}/responses/${id}`),{revision:1,fields,answers:{choice:i%2?['B']:['A','B'],time:i%2?'Y':'X',text:'PRIVATE SYNTHETIC'},eventId:'',createdAt});
    batch.set(db.doc('_registrationInsights/'+key(form,id)),{formId:form,responseId:id,eventId:'',submittedAt:createdAt,search:''});
   }
   await batch.commit();
  }
  let direct=0,reads=0;const getAll=db.getAll.bind(db),run=db.runTransaction.bind(db);
  db.getAll=(...refs)=>{direct+=refs.length;return getAll(...refs);};
  db.runTransaction=(fn,...rest)=>run(async tx=>{const get=tx.get.bind(tx),getMany=tx.getAll.bind(tx);tx.get=(...args)=>{reads++;return get(...args);};tx.getAll=(...refs)=>{reads+=refs.length;return getMany(...refs);};return fn(tx);},...rest);
  const started=Date.now();let job=await Answer.start(db,actor,input),id=job.jobId;
  await assert.rejects(Answer.results(db,actor,{jobId:id}),error=>error.status===409);
  while(job.status==='running')job=await Answer.step(db,actor,{jobId:id,step:job.step,search:''});
  const result=await Answer.results(db,actor,{jobId:id});
  assert.equal(result.coverage.indexed,5202);assert.equal(result.crossTabs.length,1);
  assert.deepEqual(result.crossTabs[0].counts,[[2601,0],[2601,2601]]);
  assert.equal(result.crossTabs[0].answered,5202);
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE SYNTHETIC/);
  assert.doesNotMatch(JSON.stringify((await db.doc('_insightsMultiJobs/'+id).get()).data()),/PRIVATE SYNTHETIC/);
  await assert.rejects(Answer.results(db,actor,{jobId:id,export:'xlsx'}),error=>error.status===403);
  console.log(`Synthetic answers: 5202 indexed, ${job.step} steps, ${Date.now()-started}ms, ${direct} direct getAll and ${reads} transaction reads, query reads excluded.`);
  await State.recordSourceChange(db,form);await assert.rejects(Answer.results(db,actor,{jobId:id}),error=>error.status===409);
  await Snapshot.cancel(db,actor,{jobId:id});let cleanup;do{cleanup=await Snapshot.cleanupExpired(db,id);}while(!cleanup.done);
  assert.equal((await db.doc(`registrationForms/${form}/responses/r0000`).get()).exists,true);
 }finally{await db.terminate();await deleteApp(app);}
});
