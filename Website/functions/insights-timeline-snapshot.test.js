const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const Timeline=require('./insights-timeline-snapshot'),Snapshot=require('./insights-multi-snapshot'),Mapping=require('./insights-mapping'),Reports=require('./insights-respondent-reports');
const hash=(form,id)=>createHash('sha256').update(form+':'+id).digest('hex');
const stamp=doc=>`${doc.updateTime.seconds}:${doc.updateTime.nanoseconds}`;
test('timeline snapshot pages over 250 links, fences changes and cleans temporary records',{skip:!process.env.FIRESTORE_EMULATOR_HOST,timeout:180000},async()=>{
 const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');
 const app=initializeApp({projectId:'demo-timeline-snapshot'},'timeline-test'),db=getFirestore(app),form='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',person='11111111-1111-4111-8111-111111111111',actor={uid:'people',email:'people@example.invalid',modules:['form-insights-people'],provider:'google.com'};
 const fields=[{id:'name',type:'text',label:'Name',required:true,options:[]}],entries=[{fieldId:'name',role:'respondent-name',concept:''}];
 try{
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-timeline-snapshot/databases/(default)/documents`,{method:'DELETE'});
  await db.doc('users/'+actor.uid).set({role:'admin',email:actor.email});await db.doc('adminAllowlist/'+actor.email).set({uid:actor.uid,modules:actor.modules});await db.doc('_respondents/'+person).set({linkRevision:1});
  await db.doc('_insightsState/fieldMappings/forms/'+form+'/revisions/1').set({status:'reviewed',version:1,schemaHash:Mapping.hashSchema(Mapping.schema(fields)),entries});await db.doc('events/public').set({title:'Public',visibility:'public',status:'confirmed',startAt:'2026-03-01T00:00:00.000Z'});await db.doc('events/private').set({title:'Private secret',visibility:'private',status:'confirmed'});
  for(let offset=0;offset<260;offset+=100){const batch=db.batch();for(let i=offset;i<Math.min(offset+100,260);i++){const id='r'+String(i).padStart(3,'0');batch.set(db.doc(`registrationForms/${form}/responses/${id}`),{reference:id,revision:1,fields,answers:{name:'Synthetic'},formTitle:'Synthetic',eventId:i===1?'private':'public',createdAt:new Date(Date.UTC(2026,0,1)+i*86400000).toISOString()});}await batch.commit();}
  const refs=Array.from({length:260},(_,i)=>db.doc(`registrationForms/${form}/responses/r${String(i).padStart(3,'0')}`)),docs=[];for(let i=0;i<refs.length;i+=100)docs.push(...await db.getAll(...refs.slice(i,i+100)));
  for(let offset=0;offset<260;offset+=200){const batch=db.batch();for(let i=offset;i<Math.min(offset+200,260);i++){const id=docs[i].id;batch.set(db.doc('_respondentLinks/'+hash(form,id)),{formId:form,responseId:id,revision:1,personId:person,status:i===2?'inactive':'linked',sourceVersion:i===3?'stale':stamp(docs[i]),sourceGeneration:0,mappingVersion:1});}await batch.commit();}
  await assert.rejects(Reports.timeline(db,{personId:person},false),error=>error.status===422);
  let direct=0,reads=0;const getAll=db.getAll.bind(db),run=db.runTransaction.bind(db);db.getAll=(...refs)=>{direct+=refs.length;return getAll(...refs);};db.runTransaction=(fn,...rest)=>run(async tx=>{const get=tx.get.bind(tx),getMany=tx.getAll.bind(tx);tx.get=(...args)=>{reads++;return get(...args);};tx.getAll=(...refs)=>{reads+=refs.length;return getMany(...refs);};return fn(tx);},...rest);
  const started=Date.now();let job=await Timeline.start(db,actor,{personId:person});await assert.rejects(Timeline.results(db,actor,{jobId:job.jobId}),error=>error.status===409);
  while(job.status==='running')job=await Timeline.step(db,actor,{jobId:job.jobId,step:job.step});
  let page=await Timeline.results(db,actor,{jobId:job.jobId}),rows=[...page.items];assert.equal(page.confirmed,258);assert.equal(page.reviewRequired,1);assert.equal(page.inactive,1);
  while(page.next){page=await Timeline.results(db,actor,{jobId:job.jobId,cursor:page.next});rows.push(...page.items);}
  assert.equal(rows.length,259);assert.equal(new Set(rows.map(row=>row.responseId)).size,259);assert.equal(rows[0].responseId,'r259');assert.equal(rows.at(-1).responseId,'r000');assert.equal(rows.find(row=>row.responseId==='r003').status,'review-required');assert.doesNotMatch(JSON.stringify(rows),/Private secret/);
  console.log(`Synthetic timeline: 260 links, ${job.step} steps, ${Date.now()-started}ms, ${direct} direct getAll reads, ${reads} transaction reads (includes retries and pages).`);
  await refs[259].update({reference:'changed'});await assert.rejects(Timeline.results(db,actor,{jobId:job.jobId}),error=>error.status===409);await refs[259].update({reference:'r259'});
  await db.doc('events/public').update({title:'Changed'});await assert.rejects(Timeline.results(db,actor,{jobId:job.jobId}),error=>error.status===409);
  await Snapshot.cancel(db,actor,{jobId:job.jobId});let clean;do{clean=await Snapshot.cleanupExpired(db,job.jobId);}while(!clean.done);assert.equal((await db.doc('_respondents/'+person).get()).exists,true);assert.equal((await refs[0].get()).exists,true);
  const event=await db.doc('events/public').get();await db.doc('_insightsState/programmeCategories/items/education').set({name:'Education'});
  await db.doc('_insightsState/programmeAssignments/events/public').set({version:1,categoryIds:['education'],eventVersion:stamp(event)});
  let scoped=await Timeline.start(db,actor,{personId:person,categories:['education']});while(scoped.status==='running')scoped=await Timeline.step(db,actor,{jobId:scoped.jobId,step:scoped.step});
  const scopedPage=await Timeline.results(db,actor,{jobId:scoped.jobId});assert.equal(scopedPage.confirmed,256);assert.equal(scopedPage.reviewRequired,2);assert.equal(scopedPage.inactive,1);
  await db.doc('_insightsState/programmeCategories/items/education').update({name:'Changed'});await assert.rejects(Timeline.results(db,actor,{jobId:scoped.jobId}),error=>error.status===409);
  let revoked=await Timeline.start(db,actor,{personId:person});await db.doc('adminAllowlist/'+actor.email).update({modules:[]});await assert.rejects(Timeline.step(db,actor,{jobId:revoked.jobId,step:0}),error=>error.status===403);
  await db.doc('adminAllowlist/'+actor.email).update({modules:actor.modules});await db.doc('_insightsMultiJobs/'+revoked.jobId).update({expiresAt:new Date('2020-01-01')});await assert.rejects(Timeline.step(db,actor,{jobId:revoked.jobId,step:0}),error=>error.status===409);
  do{clean=await Snapshot.cleanupExpired(db,revoked.jobId);}while(!clean.done);
 }finally{await db.terminate();await deleteApp(app);}
});
