const test=require('node:test'),assert=require('node:assert/strict');
const {createHash,randomUUID}=require('node:crypto');
const Answer=require('./insights-answer-snapshot'),Snapshot=require('./insights-multi-snapshot'),Mapping=require('./insights-mapping'),State=require('./insights-state');
const key=(form,id)=>createHash('sha256').update(form+':'+id).digest('hex');
const conflict=e=>e.status===409;

test('answer snapshots apply reviewed dimensions and fence progress, access and expiry',{skip:!process.env.FIRESTORE_EMULATOR_HOST,timeout:120000},async()=>{
 const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore,Timestamp}=require('firebase-admin/firestore');
 const app=initializeApp({projectId:'demo-answer-races'},randomUUID()),db=getFirestore(app);
 const actor={uid:'answers',email:'answers@example.invalid',provider:'google.com',modules:['form-insights','form-insights-export']};
 const form='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const fields=[{id:'choice',type:'radio',label:'Choice',options:['A','B'],required:false}];
 const input={dateMode:'year',year:'2026',basis:'submission',search:'',concept:'choice',categories:['education'],bookingType:'community',series:'series',formId:form};
 const finish=async job=>{while(job.status==='running')job=await Answer.step(db,actor,{jobId:job.jobId,step:job.step,search:''});return job;};
 try{
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-answer-races/databases/(default)/documents`,{method:'DELETE'});
  await db.doc('users/'+actor.uid).set({role:'admin',email:actor.email});
  await db.doc('adminAllowlist/'+actor.email).set({uid:actor.uid,modules:actor.modules});
  await db.doc(`_insightsState/fieldMappings/forms/${form}/revisions/1`).set({status:'reviewed',version:1,schemaHash:Mapping.hashSchema(Mapping.schema(fields)),entries:[{fieldId:'choice',role:'',concept:'choice'}]});
  await db.doc('_insightsState/programmeCategories/items/education').set({name:'Education'});
  for(const [eventId,type,choice] of [['one','community','A'],['two','other','B']]){
   const event=db.doc('events/'+eventId);
   await event.set({title:eventId,status:'confirmed',visibility:'public',startAt:'2026-05-01T00:00:00.000Z',departmentId:type,seriesId:'series'});
   const saved=await event.get(),eventVersion=`${saved.updateTime.seconds}:${saved.updateTime.nanoseconds}`;
   await db.doc('_insightsState/programmeAssignments/events/'+eventId).set({version:1,categoryIds:['education'],eventVersion});
   const id='r_'+eventId,createdAt='2026-03-01T00:00:00.000Z';
   await db.doc(`registrationForms/${form}/responses/${id}`).set({revision:1,fields,answers:{choice},eventId,createdAt});
   await db.doc('_registrationInsights/'+key(form,id)).set({formId:form,responseId:id,eventId,submittedAt:createdAt,search:''});
  }
  for(const basis of ['submission','event']){
   let job=await Answer.start(db,actor,{...input,basis});
   await assert.rejects(Answer.results(db,actor,{jobId:job.jobId}),conflict);
   const attempts=await Promise.allSettled([Answer.step(db,actor,{jobId:job.jobId,step:0,search:''}),Answer.step(db,actor,{jobId:job.jobId,step:0,search:''})]);
   assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);
   assert.equal(attempts.filter(x=>x.status==='rejected'&&conflict(x.reason)).length,1);
   job=await finish(attempts.find(x=>x.status==='fulfilled').value);
   const result=await Answer.results(db,actor,{jobId:job.jobId,export:'xlsx'});
   assert.equal(result.coverage.indexed,1);
   assert.deepEqual(result.groups[0].options,[{label:'A',count:1},{label:'B',count:0}]);
   assert.deepEqual(result.filters.categories,['education']);assert.equal(result.filters.bookingType,'community');assert.equal(result.filters.series,'series');assert.equal(result.filters.basis,basis);
   await db.doc('adminAllowlist/'+actor.email).update({modules:['form-insights']});
   await assert.rejects(Answer.results(db,actor,{jobId:job.jobId,export:'pdf'}),e=>e.status===403);
   await db.doc('adminAllowlist/'+actor.email).update({modules:actor.modules});
  }
  let job=await finish(await Answer.start(db,actor,input));
  await db.doc('_insightsState/programmeCategories/items/education').update({name:'Changed'});
  await assert.rejects(Answer.results(db,actor,{jobId:job.jobId}),conflict);
  job=await Answer.start(db,actor,input);
  job=await Answer.step(db,actor,{jobId:job.jobId,step:0,search:''});
  await db.doc('events/one').update({title:'Changed'});
  await assert.rejects(Answer.step(db,actor,{jobId:job.jobId,step:job.step,search:''}),conflict);
  job=await Answer.start(db,actor,input);
  await State.recordSourceChange(db,form);
  await assert.rejects(Answer.step(db,actor,{jobId:job.jobId,step:0,search:''}),conflict);
  await Snapshot.cancel(db,actor,{jobId:job.jobId});await Snapshot.cancel(db,actor,{jobId:job.jobId});
  const unfiltered={...input,categories:[],bookingType:'',series:''};
  job=await Answer.start(db,actor,unfiltered);
  job=await Answer.step(db,actor,{jobId:job.jobId,step:0,search:''});
  await db.runTransaction(async tx=>{
   tx.update(db.doc(`_insightsState/fieldMappings/forms/${form}/revisions/1`),{status:'draft',version:2});
   tx.set(db.doc('_insightsState/coverage'),{updatedAt:randomUUID()});
  });
  await assert.rejects(Answer.step(db,actor,{jobId:job.jobId,step:job.step,search:''}),conflict);
  await Snapshot.cancel(db,actor,{jobId:job.jobId});
  await db.doc(`_insightsState/fieldMappings/forms/${form}/revisions/1`).update({status:'reviewed',version:3});
  job=await finish(await Answer.start(db,actor,unfiltered));
  await db.runTransaction(tx=>State.bumpIndexVersionTx(tx,db,form));
  await assert.rejects(Answer.results(db,actor,{jobId:job.jobId,export:'xlsx'}),conflict);
  await Snapshot.cancel(db,actor,{jobId:job.jobId});
  job=await Answer.start(db,actor,unfiltered);
  await db.doc('_insightsState/respondentVersion').set({revision:randomUUID()});
  await assert.rejects(Answer.step(db,actor,{jobId:job.jobId,step:0,search:''}),conflict);
  await Snapshot.cancel(db,actor,{jobId:job.jobId});
  job=await finish(await Answer.start(db,actor,input));
  await db.doc('adminAllowlist/'+actor.email).update({modules:[]});
  await assert.rejects(Answer.results(db,actor,{jobId:job.jobId}),e=>e.status===403);
  await db.doc('adminAllowlist/'+actor.email).update({modules:actor.modules});
  await db.doc('_insightsMultiJobs/'+job.jobId).update({expiresAt:Timestamp.fromMillis(Date.now()-1)});
  await assert.rejects(Answer.results(db,actor,{jobId:job.jobId}),conflict);
  let cleanup;do{cleanup=await Snapshot.cleanupExpired(db,job.jobId);}while(!cleanup.done);
  assert.equal((await db.doc('_insightsMultiJobs/'+job.jobId).collection('ledger').get()).size,0);
  assert.equal((await db.doc(`registrationForms/${form}/responses/r_one`).get()).exists,true);
  assert.equal((await db.doc('events/one').get()).exists,true);
 }finally{await db.terminate();await deleteApp(app);}
});
