const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID,createHash}=require('node:crypto');
const Inventory=require('./insights-inventory-snapshot'),Snapshot=require('./insights-multi-snapshot'),API=require('./form-insights');
const Aggregate=require('./insights-aggregate-snapshot'),Answers=require('./insights-answer-snapshot');
const Mapping=require('./insights-mapping');

test('calendar inventory exceeds 600 events without exposing private events or accepting calendar changes',{skip:!process.env.FIRESTORE_EMULATOR_HOST,timeout:180000},async()=>{
 const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');
 const app=initializeApp({projectId:'demo-inventory-calendar-scale'},randomUUID()),db=getFirestore(app);
 const actor={uid:'aggregate',email:'aggregate@example.invalid',modules:['form-insights'],provider:'google.com'};
 try{
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-inventory-calendar-scale/databases/(default)/documents`,{method:'DELETE'});
  await db.doc('users/'+actor.uid).set({role:'admin',email:actor.email});await db.doc('adminAllowlist/'+actor.email).set({uid:actor.uid,modules:actor.modules});
  for(let offset=0;offset<651;offset+=200){
   const batch=db.batch();
   for(let i=offset;i<Math.min(651,offset+200);i++)batch.set(db.doc('events/e'+String(i).padStart(4,'0')),{title:i===650?'Private synthetic':'Public synthetic',visibility:i===650?'private':'public',status:'confirmed',startAt:'2026-03-01T00:00:00.000Z',departmentId:'programs',seriesId:'series-one'});
   await batch.commit();
  }
  const started=Date.now();let job=await Inventory.start(db,actor,{from:'2026-01-01',to:'2026-12-31'}),id=job.jobId;
  while(job.status==='running')job=await Inventory.step(db,actor,{jobId:id,step:job.step});
  const result=await Inventory.results(db,actor,{jobId:id});
  assert.equal(result.events.length,650);assert.ok(result.events.every(event=>event.indexedResponses===0));
  assert.doesNotMatch(JSON.stringify(result),/Private synthetic/);assert.equal(result.analysisLimits.calendar,5000);
  console.log(`Synthetic inventory calendar: 651 events, ${job.step} steps, ${Date.now()-started}ms; production capacity not established.`);
  let direct=0,transactionReads=0;const getAll=db.getAll.bind(db),run=db.runTransaction.bind(db);
  db.getAll=(...refs)=>{direct+=refs.length;return getAll(...refs);};
  db.runTransaction=(fn,...rest)=>run(async tx=>{const get=tx.get.bind(tx),getMany=tx.getAll.bind(tx);tx.get=(...args)=>{transactionReads++;return get(...args);};tx.getAll=(...refs)=>{transactionReads+=refs.length;return getMany(...refs);};return fn(tx);},...rest);
  const filteredStarted=Date.now();let filtered=await Inventory.start(db,actor,{from:'2026-01-01',to:'2026-12-31',bookingType:'programs',series:'series-one'}),filteredId=filtered.jobId;
  while(filtered.status==='running')filtered=await Inventory.step(db,actor,{jobId:filteredId,step:filtered.step});
  const filteredResult=await Inventory.results(db,actor,{jobId:filteredId});
  assert.deepEqual(filteredResult.events.map(event=>event.id),result.events.map(event=>event.id));
  assert.equal((await Snapshot.ref(db,filteredId).get()).data().ledgerCount,0);
  console.log(`Synthetic booking-type/series inventory: 651 calendar events, ${filtered.step} steps, ${Date.now()-filteredStarted}ms, ${direct} direct getAll and ${transactionReads} transaction reads, query documents excluded.`);
  db.getAll=getAll;db.runTransaction=run;
  await db.doc('_insightsState/programmeAssignments/events/e0000').set({version:1,categoryIds:[]});
  assert.equal((await Inventory.results(db,actor,{jobId:filteredId})).events.length,650);
  await db.doc('events/e0649').update({title:'Changed'});
  await assert.rejects(Inventory.results(db,actor,{jobId:filteredId}),error=>error.status===409);
  await Snapshot.cancel(db,actor,{jobId:filteredId});let filteredClean;do{filteredClean=await Snapshot.cleanupExpired(db,filteredId);}while(!filteredClean.done);
  let categorized=await Inventory.start(db,actor,{from:'2026-01-01',to:'2026-12-31',categories:['unknown']}),categorizedId=categorized.jobId;
  await assert.rejects(async()=>{while(categorized.status==='running')categorized=await Inventory.step(db,actor,{jobId:categorizedId,step:categorized.step});},error=>error.status===422&&/600.*Narrow.*no partial/i.test(error.message));
  await assert.rejects(Inventory.results(db,actor,{jobId:categorizedId}),error=>error.status===409);
  await Snapshot.cancel(db,actor,{jobId:categorizedId});do{filteredClean=await Snapshot.cleanupExpired(db,categorizedId);}while(!filteredClean.done);
  const flag=process.env.MWA_INSIGHTS_MULTI_SNAPSHOT_ENABLED,cleanupFlag=process.env.MWA_INSIGHTS_MULTI_CLEANUP_ENABLED,origin='https://fixture.invalid';
  const token={uid:actor.uid,email:actor.email,email_verified:true,firebase:{sign_in_provider:'google.com'}};
  async function route(body){
   let status=200,value;const res={status(code){status=code;return this;},json(data){value=data;return this;}};
   await API.handle({path:'/api/form-insights/events',method:'POST',body,query:{},is:()=>true,get:name=>name==='Authorization'?'Bearer fixture':origin},res,{db,getAuth:()=>({verifyIdToken:async()=>token}),origins:new Set([origin])});
   return {status,value};
  }
  try{
   process.env.MWA_INSIGHTS_MULTI_SNAPSHOT_ENABLED='true';process.env.MWA_INSIGHTS_MULTI_CLEANUP_ENABLED='true';
   let state=await route({action:'inventory-start',from:'2026-01-01',to:'2026-12-31',categories:['unknown']});assert.equal(state.status,200);const apiId=state.value.jobId;
   while(state.status===200&&state.value.status==='running')state=await route({action:'inventory-step',jobId:apiId,step:state.value.step});
   assert.equal(state.status,422);assert.match(state.value.error,/600.*Narrow.*no partial/i);assert.equal(Object.hasOwn(state.value,'events'),false);
   const refused=await route({action:'inventory-results',jobId:apiId});assert.equal(refused.status,409);assert.equal(Object.hasOwn(refused.value,'events'),false);
   assert.equal((await route({action:'inventory-cancel',jobId:apiId})).status,200);do{filteredClean=await Snapshot.cleanupExpired(db,apiId);}while(!filteredClean.done);
  }finally{
   if(flag===undefined)delete process.env.MWA_INSIGHTS_MULTI_SNAPSHOT_ENABLED;else process.env.MWA_INSIGHTS_MULTI_SNAPSHOT_ENABLED=flag;
   if(cleanupFlag===undefined)delete process.env.MWA_INSIGHTS_MULTI_CLEANUP_ENABLED;else process.env.MWA_INSIGHTS_MULTI_CLEANUP_ENABLED=cleanupFlag;
  }
  const updates=db.batch();for(let i=0;i<50;i++)updates.update(db.doc('events/e'+String(i).padStart(4,'0')),{departmentId:'few'});await updates.commit();
  let narrowed=await Inventory.start(db,actor,{from:'2026-01-01',to:'2026-12-31',categories:['unknown'],bookingType:'few'}),narrowedId=narrowed.jobId;
  while(narrowed.status==='running')narrowed=await Inventory.step(db,actor,{jobId:narrowedId,step:narrowed.step});
  const narrowedResult=await Inventory.results(db,actor,{jobId:narrowedId});
  assert.equal(narrowedResult.events.length,50);assert.equal((await Snapshot.ref(db,narrowedId).get()).data().ledgerCount,50);
  await db.doc('events/e0100').update({departmentId:'few'});await assert.rejects(Inventory.results(db,actor,{jobId:narrowedId}),error=>error.status===409);
  await Snapshot.cancel(db,actor,{jobId:narrowedId});do{filteredClean=await Snapshot.cleanupExpired(db,narrowedId);}while(!filteredClean.done);
  await assert.rejects(Inventory.results(db,actor,{jobId:id}),error=>error.status===409);
  await Snapshot.cancel(db,actor,{jobId:id});let clean;do{clean=await Snapshot.cleanupExpired(db,id);}while(!clean.done);
  assert.equal((await db.doc('events/e0649').get()).exists,true);
  const form='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',fields=[{id:'choice',type:'radio',label:'Choice',options:['A','B'],required:false}];
  await db.doc(`_insightsState/fieldMappings/forms/${form}/revisions/1`).set({status:'reviewed',version:1,schemaHash:Mapping.hashSchema(Mapping.schema(fields)),entries:[{fieldId:'choice',role:'',concept:'choice'}]});
  for(let offset=0;offset<650;offset+=200){
   const batch=db.batch();
   for(let i=offset;i<Math.min(650,offset+200);i++){
    const response='r'+String(i).padStart(4,'0'),eventId='e'+String(i).padStart(4,'0'),createdAt='2026-03-01T00:00:00.000Z',key=createHash('sha256').update(form+':'+response).digest('hex');
    batch.set(db.doc(`registrationForms/${form}/responses/${response}`),{revision:1,fields,answers:{choice:i%2?'B':'A'},eventId,createdAt});
    batch.set(db.doc('_registrationInsights/'+key),{formId:form,responseId:response,eventId,submittedAt:createdAt,search:''});
   }
   await batch.commit();
  }
  for(const [name,analysis] of [['aggregate',Aggregate],['answers',Answers]]){
   let direct=0,transactionReads=0;const getAll=db.getAll.bind(db),run=db.runTransaction.bind(db);
   db.getAll=(...refs)=>{direct+=refs.length;return getAll(...refs);};
   db.runTransaction=(fn,...rest)=>run(async tx=>{const get=tx.get.bind(tx),getMany=tx.getAll.bind(tx);tx.get=(...args)=>{transactionReads++;return get(...args);};tx.getAll=(...refs)=>{transactionReads+=refs.length;return getMany(...refs);};return fn(tx);},...rest);
   const analysisStarted=Date.now();
   const input={dateMode:'year',year:'2026',basis:'event',search:'',concept:'choice'};
   job=await analysis.start(db,actor,input);id=job.jobId;
   await assert.rejects(analysis.results(db,actor,{jobId:id}),error=>error.status===409);
   while(job.status==='running')job=await analysis.step(db,actor,{jobId:id,step:job.step,search:''});
   const report=await analysis.results(db,actor,{jobId:id});
   assert.equal(name==='aggregate'?report.submissions:report.coverage.indexed,650);
   if(name==='aggregate'){assert.equal(report.events,650);assert.deepEqual(report.months,[{month:'2026-03',count:650}]);}
   else assert.deepEqual(report.groups[0].options,[{label:'A',count:325},{label:'B',count:325}]);
   assert.doesNotMatch(JSON.stringify(report),/Private synthetic/);
   console.log(`Synthetic ${name}: 651 calendar events, ${job.step} steps, ${Date.now()-analysisStarted}ms, ${direct} direct getAll and ${transactionReads} transaction reads, query documents excluded.`);
   db.getAll=getAll;db.runTransaction=run;
   await db.doc('events/e0649').update({title:'Changed again '+name});
   await assert.rejects(analysis.results(db,actor,{jobId:id}),error=>error.status===409);
   await Snapshot.cancel(db,actor,{jobId:id});do{clean=await Snapshot.cleanupExpired(db,id);}while(!clean.done);
   job=await analysis.start(db,actor,input);id=job.jobId;
   job=await analysis.step(db,actor,{jobId:id,step:job.step,search:''});
   const phantom=db.doc('events/aaa-'+name);
   await phantom.set({title:'Added behind cursor',visibility:'public',status:'confirmed',startAt:'2026-02-01T00:00:00.000Z'});
   await assert.rejects(async()=>{while(job.status==='running')job=await analysis.step(db,actor,{jobId:id,step:job.step,search:''});},error=>error.status===409);
   await assert.rejects(analysis.results(db,actor,{jobId:id}),error=>error.status===409);
   await Snapshot.cancel(db,actor,{jobId:id});do{clean=await Snapshot.cleanupExpired(db,id);}while(!clean.done);
   await phantom.delete();
  }
  job=await Inventory.start(db,actor,{from:'2026-01-01',to:'2026-12-31'});id=job.jobId;
  job=await Inventory.step(db,actor,{jobId:id,step:job.step});
  await db.doc('events/aaa-added').set({title:'Added behind cursor',visibility:'public',status:'confirmed',startAt:'2026-02-01T00:00:00.000Z'});
  await assert.rejects(async()=>{while(job.status==='running')job=await Inventory.step(db,actor,{jobId:id,step:job.step});},error=>error.status===409);
  await Snapshot.cancel(db,actor,{jobId:id});do{clean=await Snapshot.cleanupExpired(db,id);}while(!clean.done);
  job=await Inventory.start(db,actor,{from:'2026-01-01',to:'2026-12-31'});id=job.jobId;
  await db.doc('_insightsMultiJobs/'+id).update({calendarCount:5000,calendarEntries:Array.from({length:5000},(_,i)=>'synthetic'+i+'\0missing')});
  await assert.rejects(Inventory.step(db,actor,{jobId:id,step:0}),error=>error.status===422);
  await assert.rejects(Inventory.results(db,actor,{jobId:id}),error=>error.status===409);
  await Snapshot.cancel(db,actor,{jobId:id});do{clean=await Snapshot.cleanupExpired(db,id);}while(!clean.done);
 }finally{await db.terminate();await deleteApp(app);}
});
