const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const Snapshot=require('./insights-multi-snapshot'),Cohort=require('./insights-cohort-snapshot'),Mapping=require('./insights-mapping'),State=require('./insights-state');
const key=(form,id)=>createHash('sha256').update(form+':'+id).digest('hex');
const version=doc=>`${doc.updateTime.seconds}:${doc.updateTime.nanoseconds}`;

test('resumable comparison exceeds old limits, fences changes and only cleans temporary data',{skip:!process.env.FIRESTORE_EMULATOR_HOST,timeout:600000},async()=>{
 const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');
 const app=initializeApp({projectId:'demo-large-multi-snapshot'},'large-multi'),db=getFirestore(app),form='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',person='11111111-1111-4111-8111-111111111111';
 const actor={uid:'people',email:'people@example.invalid',modules:['form-insights-people'],provider:'google.com'};
 const fields=[{id:'name',type:'text',label:'Name',required:true,options:[]}],entries=[{fieldId:'name',role:'respondent-name',concept:''}],source=(id,eventId)=>({reference:'SYNTHETIC-'+id,formTitle:'Synthetic',revision:1,fields,answers:{name:'Synthetic Person'},eventId,createdAt:'2026-03-01T00:00:00.000Z'});
 try{
  const cleared=await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-large-multi-snapshot/databases/(default)/documents`,{method:'DELETE'});assert.equal(cleared.status,200);
  await db.doc('users/'+actor.uid).set({role:'admin',email:actor.email});await db.doc('adminAllowlist/'+actor.email).set({uid:actor.uid,modules:actor.modules});
  await db.doc('registrationForms/'+form).set({title:'Synthetic'});await db.doc('_respondents/'+person).set({linkRevision:1});
  await db.doc(`_insightsState/fieldMappings/forms/${form}/revisions/1`).set({status:'reviewed',version:1,schemaHash:Mapping.hashSchema(Mapping.schema(fields)),entries});
  for(const id of ['a','b'])await db.doc('events/'+id).set({title:'Event '+id,visibility:'public',status:'confirmed',startAt:'2026-03-01T00:00:00.000Z'});
  const total=5202;for(let offset=0;offset<total;offset+=200){
   const batch=db.batch();for(let i=offset;i<Math.min(offset+200,total);i++){const id='r'+String(i).padStart(5,'0'),eventId=i<5101?'a':'b';batch.set(db.doc(`registrationForms/${form}/responses/${id}`),source(id,eventId));batch.set(db.doc('_registrationInsights/'+key(form,id)),{formId:form,responseId:id,eventId,submittedAt:'2026-03-01T00:00:00.000Z'});}await batch.commit();
  }
  for(const id of ['r00000','r05101']){
   const src=await db.doc(`registrationForms/${form}/responses/${id}`).get();await db.doc('_respondentLinks/'+key(form,id)).set({formId:form,responseId:id,revision:1,personId:person,status:'linked',sourceVersion:version(src),sourceGeneration:0,mappingVersion:1});
  }
  const people=Array.from({length:30},(_,i)=>String(i+1).padStart(8,'0')+'-1111-4111-8111-111111111111'),refs=people.flatMap((_,i)=>[i+1,5102+i].map(n=>db.doc(`registrationForms/${form}/responses/r${String(n).padStart(5,'0')}`))),sources=await db.getAll(...refs),linked=db.batch();
  for(let i=0;i<people.length;i++){linked.set(db.doc('_respondents/'+people[i]),{linkRevision:1});for(const src of sources.slice(i*2,i*2+2)){const id=src.id;linked.set(db.doc('_respondentLinks/'+key(form,id)),{formId:form,responseId:id,revision:1,personId:people[i],status:'linked',sourceVersion:version(src),sourceGeneration:0,mappingVersion:1});}}await linked.commit();
  let txReads=0,directReads=0;const getAll=db.getAll.bind(db),run=db.runTransaction.bind(db);
  db.getAll=(...refs)=>{directReads+=refs.length;return getAll(...refs);};
  db.runTransaction=(fn,...rest)=>run(async tx=>{const get=tx.get.bind(tx),getMany=tx.getAll.bind(tx);tx.get=(...args)=>{txReads++;return get(...args);};tx.getAll=(...refs)=>{txReads+=refs.length;return getMany(...refs);};return fn(tx);},...rest);
  const started=Date.now();let progress=await Snapshot.start(db,actor,{eventIds:['a','b']});
  await assert.rejects(Snapshot.results(db,actor,{jobId:progress.jobId}),error=>error.status===409);
  const concurrent=await Promise.allSettled([Snapshot.step(db,actor,{jobId:progress.jobId,step:0}),Snapshot.step(db,actor,{jobId:progress.jobId,step:0})]);
  assert.equal(concurrent.filter(item=>item.status==='fulfilled').length,1);assert.equal(concurrent.filter(item=>item.status==='rejected'&&item.reason.status===409).length,1);
  progress=concurrent.find(item=>item.status==='fulfilled').value;let steps=1;
  while(progress.status==='running'){progress=await Snapshot.step(db,actor,{jobId:progress.jobId,step:progress.step});steps++;}
  const result=await Snapshot.results(db,actor,{jobId:progress.jobId,group:'common'});
  assert.equal(progress.scanned,total);assert.deepEqual(result.counts,{common:31,only:[0,0]});assert.deepEqual(result.matrix,[[31,31],[31,31]]);
  assert.deepEqual(result.coverage.map(x=>x.submissions),[5101,101]);assert.equal(result.items.length,25);assert.deepEqual(result.items[0].names,['Synthetic Person']);
  const second=await Snapshot.results(db,actor,{jobId:progress.jobId,group:'common',cursor:result.next});assert.equal(second.items.length,6);assert.ok(second.items.some(item=>item.personId===person));assert.equal(second.next,null);
  await assert.rejects(Snapshot.results(db,actor,{jobId:progress.jobId,group:false}),error=>error.status===400);
  await assert.rejects(Snapshot.results(db,actor,{jobId:progress.jobId,cursor:false}),error=>error.status===400);
  const elapsed=Date.now()-started;console.log(`Synthetic snapshot: ${total} indexed records, ${steps} steps, ${elapsed}ms, ${directReads} direct getAll reads, ${txReads} transaction reads (includes retry attempts).`);
  const multiCap=await Snapshot.start(db,actor,{eventIds:['a','b']});await db.doc('_insightsMultiJobs/'+multiCap.jobId).update({scanned:Snapshot.MAX_SCANNED});
  await assert.rejects(Snapshot.step(db,actor,{jobId:multiCap.jobId,step:0}),error=>error.status===422);await assert.rejects(Snapshot.results(db,actor,{jobId:multiCap.jobId}),error=>error.status===409);
  const cohortCap=await Cohort.start(db,actor,{historyFrom:'2025-01-01',from:'2026-01-01',to:'2026-12-31'});await db.doc('_insightsMultiJobs/'+cohortCap.jobId).update({scanned:Snapshot.MAX_SCANNED});
  await assert.rejects(Cohort.step(db,actor,{jobId:cohortCap.jobId,step:0}),error=>error.status===422);await assert.rejects(Cohort.results(db,actor,{jobId:cohortCap.jobId}),error=>error.status===409);
  const cohortStart=Date.now(),beforeDirect=directReads,beforeTx=txReads;let cohort=await Cohort.start(db,actor,{historyFrom:'2025-01-01',from:'2026-01-01',to:'2026-12-31'});
  await assert.rejects(Cohort.results(db,actor,{jobId:cohort.jobId}),error=>error.status===409);
  while(cohort.status==='running')cohort=await Cohort.step(db,actor,{jobId:cohort.jobId,step:cohort.step});
  const heatmap=await Cohort.results(db,actor,{jobId:cohort.jobId});assert.deepEqual(heatmap.counts,{firstKnown:31,returning:0,identified:31});assert.deepEqual(heatmap.rows,[{cohortYear:'2026',counts:[31]}]);assert.equal(heatmap.coverage.indexed,total);
  const cell=await Cohort.results(db,actor,{jobId:cohort.jobId,cohortYear:'2026',returnYear:'2026'});assert.equal(cell.items.length,25);assert.equal((await Cohort.results(db,actor,{jobId:cohort.jobId,cohortYear:'2026',returnYear:'2026',cursor:cell.next})).items.length,6);
  const aggregate=await Cohort.results(db,actor,{jobId:cohort.jobId,export:'xlsx'});assert.deepEqual(aggregate.rows,heatmap.rows);assert.deepEqual(aggregate.items,[]);
  console.log(`Synthetic cohort: ${total} indexed records, ${cohort.step} steps, ${Date.now()-cohortStart}ms, ${directReads-beforeDirect} direct getAll reads, ${txReads-beforeTx} transaction reads (includes retry attempts).`);
  await db.doc('events/a').update({startAt:'2026-04-01T00:00:00.000Z'});await assert.rejects(Cohort.results(db,actor,{jobId:cohort.jobId}),error=>error.status===409);
  let sourceFence=await Cohort.start(db,actor,{historyFrom:'2027-01-01',from:'2027-01-01',to:'2027-12-31'});
  while(sourceFence.status==='running')sourceFence=await Cohort.step(db,actor,{jobId:sourceFence.jobId,step:sourceFence.step});
  await State.recordSourceChange(db,form);await assert.rejects(Cohort.results(db,actor,{jobId:sourceFence.jobId}),error=>error.status===409);
  await assert.rejects(Snapshot.cleanupExpired(db,progress.jobId),error=>error.status===409);
  let pending=await Snapshot.start(db,actor,{eventIds:['a','b']});await db.doc('events/a').update({startAt:'2026-05-01T00:00:00.000Z'});await assert.rejects(Snapshot.step(db,actor,{jobId:pending.jobId,step:0}),error=>error.status===409);
  pending=await Snapshot.start(db,actor,{eventIds:['a','b']});await db.doc('adminAllowlist/'+actor.email).update({modules:[]});await assert.rejects(Snapshot.step(db,actor,{jobId:pending.jobId,step:0}),error=>error.status===403);await db.doc('adminAllowlist/'+actor.email).update({modules:actor.modules});
  pending=await Snapshot.start(db,actor,{eventIds:['a','b']});await State.recordSourceChange(db,form);await assert.rejects(Snapshot.step(db,actor,{jobId:pending.jobId,step:0}),error=>error.status===409);
  await db.doc('_insightsState/programmeCategories/items/education').set({name:'Education'});
  for(const eventId of ['a','b']){const event=await db.doc('events/'+eventId).get();await db.doc('_insightsState/programmeAssignments/events/'+eventId).set({version:1,categoryIds:['education'],eventVersion:version(event)});}
  pending=await Snapshot.start(db,actor,{eventIds:['a','b'],categories:['education']});await db.doc('_insightsState/programmeCategories/items/education').update({name:'Updated'});await assert.rejects(Snapshot.step(db,actor,{jobId:pending.jobId,step:0}),error=>error.status===409);
  await assert.rejects(Snapshot.start(db,actor,{eventIds:['a','missing']}),error=>error.status===403);
  await assert.rejects(Snapshot.start(db,actor,{eventIds:['a','b'],formId:false}),error=>error.status===400);
  const racing=await Snapshot.start(db,actor,{eventIds:['a','b']});
  let release,signal;const paused=new Promise(resolve=>{signal=resolve;}),gate=new Promise(resolve=>{release=resolve;}),currentGetAll=db.getAll;
  db.getAll=async(...refs)=>{db.getAll=currentGetAll;signal();await gate;return currentGetAll(...refs);};
  const racingStep=Promise.allSettled([Snapshot.step(db,actor,{jobId:racing.jobId,step:0})]);await paused;
  await db.doc('_insightsMultiJobs/'+racing.jobId).update({expiresAt:new Date('2020-01-01')});assert.equal((await Snapshot.cleanupExpired(db,racing.jobId)).done,true);
  release();const raced=await racingStep;assert.equal(raced[0].status,'rejected');assert.ok([404,409].includes(raced[0].reason.status));assert.equal((await db.doc('_insightsMultiJobs/'+racing.jobId+'/members/'+person).get()).exists,false);
  const id=progress.jobId;await db.runTransaction(tx=>State.bumpIndexVersionTx(tx,db,form));await assert.rejects(Snapshot.results(db,actor,{jobId:id}),error=>error.status===409);
  const extra=db.batch();for(let i=0;i<105;i++)extra.set(db.doc(`_insightsMultiJobs/${id}/members/extra${i}`),{bits:1});await extra.commit();
  await db.doc('_insightsMultiJobs/'+id).update({expiresAt:new Date('2020-01-01')});await assert.rejects(Snapshot.results(db,actor,{jobId:id}),error=>error.status===409);
  const originalBatch=db.batch.bind(db);db.batch=()=>{throw Error('Synthetic cleanup failure');};await assert.rejects(Snapshot.cleanupExpired(db,id),/Synthetic cleanup failure/);db.batch=originalBatch;
  let clean,totalDeleted=0,passes=0;do{clean=await Snapshot.cleanupBatch(db);totalDeleted+=clean.deleted;passes++;}while(clean.jobs);assert.equal(totalDeleted,136);assert.ok(passes>=3);assert.equal((await Snapshot.cleanupExpired(db,id)).done,true);
  assert.equal((await db.doc('_respondents/'+person).get()).exists,true);assert.equal((await db.doc(`registrationForms/${form}/responses/r00000`).get()).exists,true);
 }finally{await db.terminate();await deleteApp(app);}
});
