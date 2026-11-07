const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const Lookup=require('./insights-respondent-lookup'),Snapshot=require('./insights-multi-snapshot'),Search=require('./insights-lookup-snapshot'),Mapping=require('./insights-mapping');
const key=(form,id)=>createHash('sha256').update(form+':'+id).digest('hex');
const stamp=doc=>`${doc.updateTime.seconds}:${doc.updateTime.nanoseconds}`;

test('lookup snapshot handles over 5000 indexed records with private paging and fences',{skip:!process.env.FIRESTORE_EMULATOR_HOST,timeout:240000},async()=>{
 const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');
 const app=initializeApp({projectId:'demo-lookup-snapshot'},'lookup-snapshot'),db=getFirestore(app),form='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const actor={uid:'people',email:'people@example.invalid',modules:['form-insights-people'],provider:'google.com'},term='Synthetic';
 const fields=[{id:'name',type:'text',label:'Name',required:true,options:[]},{id:'email',type:'email',label:'Email',required:true,options:[]}],entries=[{fieldId:'name',role:'respondent-name',concept:''},{fieldId:'email',role:'respondent-email',concept:''}];
 const person=i=>`${String(i%31).padStart(8,'0')}-1111-4111-8111-111111111111`,response=i=>'r'+String(i).padStart(4,'0'),createdAt='2026-03-01T00:00:00.000Z';
 try{
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-lookup-snapshot/databases/(default)/documents`,{method:'DELETE'});
  await db.doc('users/'+actor.uid).set({role:'admin',email:actor.email});await db.doc('adminAllowlist/'+actor.email).set({uid:actor.uid,modules:actor.modules});
  await db.doc('_insightsState/fieldMappings/forms/'+form+'/revisions/1').set({status:'reviewed',version:1,schemaHash:Mapping.hashSchema(Mapping.schema(fields)),entries});
  await db.doc('events/public').set({title:'Public',visibility:'public',status:'confirmed'});await db.doc('events/private').set({title:'Private secret',visibility:'private',status:'confirmed'});
  for(let offset=0;offset<5202;offset+=200){
   const batch=db.batch();
   for(let i=offset;i<Math.min(offset+200,5202);i++){
    const id=response(i),eventId=i===0?'private':'public';
    batch.set(db.doc(`registrationForms/${form}/responses/${id}`),{reference:id,revision:1,fields,answers:{name:'Synthetic Person',email:'synthetic@example.invalid'},eventId,createdAt});
    batch.set(db.doc('_registrationInsights/'+key(form,id)),{formId:form,responseId:id,eventId,submittedAt:createdAt});
   }
   await batch.commit();
  }
  for(let i=0;i<31;i++)await db.doc('_respondents/'+person(i)).set({linkRevision:1});
  for(let offset=0;offset<5100;offset+=200){
   const refs=Array.from({length:Math.min(200,5100-offset)},(_,j)=>db.doc(`registrationForms/${form}/responses/${response(offset+j)}`)),sources=await db.getAll(...refs),batch=db.batch();
   for(let j=0;j<sources.length;j++){const i=offset+j,id=response(i);batch.set(db.doc('_respondentLinks/'+key(form,id)),{formId:form,responseId:id,revision:1,personId:person(i),status:'linked',sourceVersion:stamp(sources[j]),sourceGeneration:0,mappingVersion:1});}
   await batch.commit();
  }
  const input={from:'2026-01-01',to:'2026-12-31',kind:'name',term};
  await assert.rejects(Lookup.lookup(db,input,false),error=>error.status===422);
  let direct=0,reads=0;const getAll=db.getAll.bind(db),run=db.runTransaction.bind(db);db.getAll=(...refs)=>{direct+=refs.length;return getAll(...refs);};db.runTransaction=(fn,...rest)=>run(async tx=>{const get=tx.get.bind(tx),getMany=tx.getAll.bind(tx);tx.get=(...args)=>{reads++;return get(...args);};tx.getAll=(...refs)=>{reads+=refs.length;return getMany(...refs);};return fn(tx);},...rest);
  const started=Date.now();let job=await Search.start(db,actor,input),jobId=job.jobId;
  assert.doesNotMatch(JSON.stringify((await db.doc('_insightsMultiJobs/'+jobId).get()).data()),/Synthetic|synthetic@example/);
  await assert.rejects(Search.results(db,actor,{jobId}),error=>error.status===409);await assert.rejects(Search.step(db,actor,{jobId,step:0,term:'Different'}),error=>error.status===409);
  const concurrent=await Promise.allSettled([Search.step(db,actor,{jobId,step:0,term}),Search.step(db,actor,{jobId,step:0,term})]);
  assert.equal(concurrent.filter(value=>value.status==='fulfilled').length,1);assert.equal(concurrent.filter(value=>value.status==='rejected'&&value.reason.status===409).length,1);
  job=concurrent.find(value=>value.status==='fulfilled').value;while(job.status==='running')job=await Search.step(db,actor,{jobId,step:job.step,term});
  let page=await Search.results(db,actor,{jobId}),items=[...page.items];assert.equal(page.confirmedMatches,31);assert.equal(page.unresolvedMatches,102);assert.deepEqual(page.coverage,{indexed:5202,staleIndex:0,unavailable:1,unmapped:0,unresolved:102});
  while(page.next){page=await Search.results(db,actor,{jobId,cursor:page.next});items.push(...page.items);}
  assert.equal(items.length,133);assert.equal(new Set(items.map(item=>item.personId||item.formId+':'+item.responseId)).size,133);assert.doesNotMatch(JSON.stringify(items),/synthetic@example\.invalid|Private secret/);
  console.log(`Synthetic lookup: 5202 indexed records, ${job.step} steps, ${Date.now()-started}ms, ${direct} direct getAll reads, ${reads} transaction reads (includes retries and pages).`);
  const first=(await db.doc('_insightsMultiJobs/'+jobId).collection('members').orderBy('__name__').limit(1).get()).docs[0],sourcePath=Object.keys(first.data().sample).find(path=>path.startsWith('registrationForms/'));
  await db.doc(sourcePath).update({reference:'changed'});await assert.rejects(Search.results(db,actor,{jobId}),error=>error.status===409);
  await Snapshot.cancel(db,actor,{jobId});let clean;do{clean=await Snapshot.cleanupExpired(db,jobId);}while(!clean.done);assert.equal((await db.doc(sourcePath).get()).exists,true);assert.equal((await db.doc('_respondents/'+person(1)).get()).exists,true);
  let changed=await Search.start(db,actor,input);await db.doc('_insightsState/respondentVersion').set({generation:1});await assert.rejects(Search.step(db,actor,{jobId:changed.jobId,step:0,term}),error=>error.status===409);assert.deepEqual(await Promise.all([Snapshot.cancel(db,actor,{jobId:changed.jobId}),Snapshot.cancel(db,actor,{jobId:changed.jobId})]),[{ok:true},{ok:true}]);do{clean=await Snapshot.cleanupExpired(db,changed.jobId);}while(!clean.done);
  const event=await db.doc('events/public').get();await db.doc('_insightsState/programmeCategories/items/education').set({name:'Education'});await db.doc('_insightsState/programmeAssignments/events/public').set({version:1,categoryIds:['education'],eventVersion:stamp(event)});
  let scoped=await Search.start(db,actor,{...input,categories:['education']});scoped=await Search.step(db,actor,{jobId:scoped.jobId,step:0,term});await db.doc('_insightsState/programmeCategories/items/education').update({name:'Changed'});await assert.rejects(Search.step(db,actor,{jobId:scoped.jobId,step:scoped.step,term}),error=>error.status===409);await Snapshot.cancel(db,actor,{jobId:scoped.jobId});do{clean=await Snapshot.cleanupExpired(db,scoped.jobId);}while(!clean.done);
  let capped=await Search.start(db,actor,input);await db.doc('_insightsMultiJobs/'+capped.jobId).update({scanned:Snapshot.MAX_SCANNED});await assert.rejects(Search.step(db,actor,{jobId:capped.jobId,step:0,term}),error=>error.status===422);await assert.rejects(Search.results(db,actor,{jobId:capped.jobId}),error=>error.status===409);await Snapshot.cancel(db,actor,{jobId:capped.jobId});do{clean=await Snapshot.cleanupExpired(db,capped.jobId);}while(!clean.done);
  let revoked=await Search.start(db,actor,input);await db.doc('adminAllowlist/'+actor.email).update({modules:[]});await assert.rejects(Search.step(db,actor,{jobId:revoked.jobId,step:0,term}),error=>error.status===403);
  await db.doc('adminAllowlist/'+actor.email).update({modules:actor.modules});await db.doc('_insightsMultiJobs/'+revoked.jobId).update({expiresAt:new Date('2020-01-01')});await assert.rejects(Search.step(db,actor,{jobId:revoked.jobId,step:0,term}),error=>error.status===409);
  do{clean=await Snapshot.cleanupExpired(db,revoked.jobId);}while(!clean.done);
 }finally{await db.terminate();await deleteApp(app);}
});
