const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const Reports=require('./insights-respondent-reports'),Respondent=require('./insights-respondent'),Mapping=require('./insights-mapping'),Insights=require('./form-insights');
const key=(form,response)=>createHash('sha256').update(form+':'+response).digest('hex');
const version=doc=>`${doc.updateTime.seconds}:${doc.updateTime.nanoseconds}`;

test('bounded respondent timelines and event comparisons use current reviewed identities and calendar visibility',{skip:!process.env.FIRESTORE_EMULATOR_HOST},async()=>{
 const previousFlag=process.env.MWA_INSIGHTS_MULTI_SNAPSHOT_ENABLED,previousCleanupFlag=process.env.MWA_INSIGHTS_MULTI_CLEANUP_ENABLED;process.env.MWA_INSIGHTS_MULTI_SNAPSHOT_ENABLED='true';process.env.MWA_INSIGHTS_MULTI_CLEANUP_ENABLED='true';
 const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');
 const app=initializeApp({projectId:'demo-respondent-reports'},'respondent-reports'),db=getFirestore(app),origin='http://localhost:5174';
 const forms=['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'];
 const one='11111111-1111-4111-8111-111111111111',two='22222222-2222-4222-8222-222222222222',empty='33333333-3333-4333-8333-333333333333';
 const owner={uid:'owner',email:'admin@muhammadiwelfare.org.au',email_verified:true,firebase:{sign_in_provider:'google.com'}},people={uid:'people',email:'people@example.invalid',email_verified:true,firebase:{sign_in_provider:'google.com'}},aggregate={uid:'aggregate',email:'aggregate@example.invalid',email_verified:true,firebase:{sign_in_provider:'google.com'}};
 const fields=[{id:'name',type:'text',label:'Name',required:true,options:[]},{id:'email',type:'email',label:'Email',required:true,options:[]},{id:'mobile',type:'phone',label:'Mobile',required:false,options:[]}],entries=[{fieldId:'name',role:'respondent-name',concept:''},{fieldId:'email',role:'respondent-email',concept:''},{fieldId:'mobile',role:'respondent-mobile',concept:''}];
 async function route(token,body){let status=200,value;const res={status:n=>{status=n;return res;},json:v=>{value=v;return res;}};await Insights.handle({path:'/api/form-insights/respondent',method:'POST',body,query:{},is:()=>true,get:name=>name==='Authorization'?['Bearer','synthetic'].join(' '):origin},res,{db,getAuth:()=>({verifyIdToken:async()=>token}),origins:new Set([origin])});return {status,value};}
 async function add(form,id,event,person,name='Synthetic Person',createdAt='2026-01-01T00:00:00.000Z'){
  const response={reference:'REF-'+id,formTitle:'Synthetic form',revision:1,fields,answers:{name,email:'shared@example.invalid',mobile:'0412 345 678'},eventId:event,createdAt};
  const ref=db.doc(`registrationForms/${form}/responses/${id}`);await ref.set(response);await Insights.indexResponse(db,form,id);
  if(person){
   const source=await ref.get(),values=Respondent.evidence(response,{status:'reviewed',schemaHash:Mapping.hashSchema(Mapping.schema(fields)),entries}),hashes=Respondent.contacts(values);
   await db.doc('_respondentLinks/'+key(form,id)).set({formId:form,responseId:id,revision:1,personId:person,status:'linked',sourceVersion:version(source),sourceGeneration:0,mappingVersion:1,contactHashes:hashes});
   for(const hash of hashes)await db.doc(`_respondentContacts/${hash}/links/${key(form,id)}`).set({personId:person});
  }
 }
 try{
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-respondent-reports/databases/(default)/documents`,{method:'DELETE'});
  for(const user of [owner,people,aggregate])await db.doc('users/'+user.uid).set({role:'admin',email:user.email});
  await db.doc('adminAllowlist/'+people.email).set({uid:people.uid,modules:['form-insights-people']});
  await db.doc('adminAllowlist/'+aggregate.email).set({uid:aggregate.uid,modules:['form-insights']});
  for(const [id,title] of [['event-a','Event A'],['event-b','Event B']])await db.doc('events/'+id).set({title,status:'confirmed',visibility:'public',startAt:'2026-03-01T00:00:00.000Z'});
  for(const form of forms){await db.doc('registrationForms/'+form).set({revision:1,fields});await db.doc(`_insightsState/fieldMappings/forms/${form}/revisions/1`).set({status:'reviewed',version:1,schemaHash:Mapping.hashSchema(Mapping.schema(fields)),entries});}
  for(const id of [one,two,empty])await db.doc('_respondents/'+id).set({linkRevision:1});
  await add(forms[0],'a-one','event-a',one);
  await add(forms[1],'a-one-again','event-a',one);
  await add(forms[1],'b-one','event-b',one);
  await add(forms[0],'b-two','event-b',two,'Different Synthetic');
  await add(forms[0],'a-unresolved','event-a',null);
  let result=await route(people,{action:'compare',eventA:'event-a',eventB:'event-b'});
  assert.equal(result.status,200,JSON.stringify(result.value));assert.deepEqual(result.value.counts,{common:1,aOnly:0,bOnly:1});
  assert.deepEqual(result.value.coverage.map(x=>[x.submissions,x.identifiedRespondents,x.unresolved]),[[3,1,1],[2,2,0]]);
  const formComparison=await route(people,{action:'compare',eventA:'event-a',eventB:'event-b',formId:forms[0]});
  assert.deepEqual(formComparison.value.counts,{common:0,aOnly:1,bOnly:1});assert.deepEqual(formComparison.value.coverage.map(x=>x.submissions),[2,1]);
  await db.doc('events/event-c').set({title:'Event C',status:'confirmed',visibility:'public',startAt:'2030-03-01T00:00:00.000Z'});
  const cohortSnapshot=async input=>{
   let state=await route(people,{action:'cohort-start',...input});assert.equal(state.status,200,JSON.stringify(state.value));
   const jobId=state.value.jobId;assert.equal((await route(people,{action:'cohort-results',jobId})).status,409);
   while(state.value.status==='running'){state=await route(people,{action:'cohort-step',jobId,step:state.value.step});assert.equal(state.status,200,JSON.stringify(state.value));}
   return jobId;
  };
  const multi=await route(people,{action:'compare',eventIds:['event-a','event-b','event-c']});
  assert.equal(multi.status,200);assert.deepEqual(multi.value.counts,{common:0,only:[0,1,0]});assert.deepEqual(multi.value.matrix,[[1,1,0],[1,2,0],[0,0,0]]);
  assert.equal((await route(people,{action:'compare',eventIds:['event-a','event-b','event-c'],group:'only:1'})).value.items[0].personId,two);
  assert.equal((await route(people,{action:'compare',eventIds:['event-a','event-a']})).status,400);
  await add(forms[0],'c-one','event-c',one);
  const allThree=await route(people,{action:'compare',eventIds:['event-a','event-b','event-c']});
  assert.deepEqual(allThree.value.counts,{common:1,only:[0,1,0]});assert.deepEqual(allThree.value.matrix,[[1,1,1],[1,2,1],[1,1,1]]);assert.equal(allThree.value.items[0].personId,one);
  assert.equal((await route(people,{action:'compare',eventIds:['event-a','event-b','event-c'],group:'pair:0:2'})).value.items[0].personId,one);
  delete process.env.MWA_INSIGHTS_MULTI_SNAPSHOT_ENABLED;
  assert.equal((await route(people,{action:'multi-status'})).value.enabled,false);
  assert.equal((await route(people,{action:'multi-start',eventIds:['event-a','event-b']})).status,503);
  process.env.MWA_INSIGHTS_MULTI_SNAPSHOT_ENABLED='true';
  delete process.env.MWA_INSIGHTS_MULTI_CLEANUP_ENABLED;
  assert.equal((await route(people,{action:'multi-status'})).value.enabled,false);
  assert.equal((await route(people,{action:'multi-start',eventIds:['event-a','event-b']})).status,503);
  assert.equal((await route(people,{action:'cohort-start',historyFrom:'2025-01-01',from:'2026-01-01',to:'2026-12-31'})).status,503);
  assert.equal((await route(people,{action:'lookup-start',from:'2026-01-01',to:'2026-12-31',kind:'name',term:'Synthetic'})).status,503);
  process.env.MWA_INSIGHTS_MULTI_CLEANUP_ENABLED='true';
  let snap=await route(people,{action:'multi-start',eventIds:['event-a','event-b','event-c']});assert.equal(snap.status,200,JSON.stringify(snap.value));
  const jobId=snap.value.jobId;assert.equal((await route(people,{action:'multi-results',jobId})).status,409);
  while(snap.value.status==='running'){snap=await route(people,{action:'multi-step',jobId,step:snap.value.step});assert.equal(snap.status,200,JSON.stringify(snap.value));}
  const complete=await route(people,{action:'multi-results',jobId,group:'pair:2:0'});assert.equal(complete.status,200,JSON.stringify(complete.value));assert.deepEqual(complete.value.counts,allThree.value.counts);assert.deepEqual(complete.value.matrix,allThree.value.matrix);assert.equal(complete.value.items[0].personId,one);
  assert.equal((await route(aggregate,{action:'multi-results',jobId})).status,403);
  assert.equal((await route(people,{action:'multi-cancel',jobId})).status,200);
  const cleanup=require('./insights-multi-snapshot');assert.equal((await cleanup.cleanupExpired(db,jobId)).deleted,2);assert.equal((await cleanup.cleanupExpired(db,jobId)).done,true);assert.equal((await cleanup.cleanupExpired(db,jobId)).done,true);
  const extraLink=db.doc('_respondentLinks/'+key(forms[0],'c-one')),extra=(await extraLink.get()).data();
  for(const hash of extra.contactHashes)await db.doc(`_respondentContacts/${hash}/links/${key(forms[0],'c-one')}`).delete();
  await extraLink.delete();await db.doc(`registrationForms/${forms[0]}/responses/c-one`).delete();await Insights.indexResponse(db,forms[0],'c-one');
  assert.equal((await route(aggregate,{action:'compare',eventA:'event-a',eventB:'event-b'})).status,403);
  assert.equal((await route(people,{action:'timeline',personId:empty})).value.items.length,0);
  result=await route(people,{action:'timeline',personId:one});assert.equal(result.value.confirmed,3);assert.equal(result.value.items[0].event.title,'Event A');
  let timelineJob=await route(people,{action:'timeline-start',personId:one,formId:forms[1],eventId:'event-b'});assert.equal(timelineJob.status,200);const timelineId=timelineJob.value.jobId;
  assert.equal((await route(people,{action:'timeline-results',jobId:timelineId})).status,409);
  while(timelineJob.value.status==='running'){timelineJob=await route(people,{action:'timeline-step',jobId:timelineId,step:timelineJob.value.step});assert.equal(timelineJob.status,200,JSON.stringify(timelineJob.value));}
  const timelineSnapshot=await route(people,{action:'timeline-results',jobId:timelineId});assert.equal(timelineSnapshot.status,200);assert.equal(timelineSnapshot.value.confirmed,1);assert.equal(timelineSnapshot.value.items[0].event.title,'Event B');
  assert.equal((await route(aggregate,{action:'timeline-results',jobId:timelineId})).status,403);assert.equal((await route(people,{action:'timeline-cancel',jobId:timelineId})).status,200);assert.equal((await route(people,{action:'timeline-results',jobId:timelineId})).status,409);
  result=await route(people,{action:'timeline',personId:one,formId:forms[1],eventId:'event-b'});assert.equal(result.value.confirmed,1);assert.equal(result.value.items[0].formId,forms[1]);assert.equal(result.value.items[0].event.title,'Event B');
  const search={action:'lookup',from:'2026-01-01',to:'2026-12-31',kind:'email',term:'shared@example.invalid'};
  result=await route(people,search);assert.equal(result.status,200,JSON.stringify(result.value));assert.equal(result.value.confirmedMatches,2);assert.equal(result.value.unresolvedMatches,1);assert.doesNotMatch(JSON.stringify(result.value),/shared@example\.invalid/);
  let lookupJob=await route(people,{...search,action:'lookup-start'});assert.equal(lookupJob.status,200,JSON.stringify(lookupJob.value));const lookupId=lookupJob.value.jobId;
  assert.equal((await route(people,{action:'lookup-results',jobId:lookupId})).status,409);
  assert.equal((await route(people,{action:'lookup-step',jobId:lookupId,step:0,term:'wrong@example.invalid'})).status,409);
  while(lookupJob.value.status==='running'){lookupJob=await route(people,{action:'lookup-step',jobId:lookupId,step:lookupJob.value.step,term:search.term});assert.equal(lookupJob.status,200,JSON.stringify(lookupJob.value));}
  const lookupResult=await route(people,{action:'lookup-results',jobId:lookupId});assert.equal(lookupResult.status,200);assert.equal(lookupResult.value.confirmedMatches,result.value.confirmedMatches);assert.equal(lookupResult.value.unresolvedMatches,result.value.unresolvedMatches);assert.deepEqual(lookupResult.value.coverage,result.value.coverage);assert.doesNotMatch(JSON.stringify(lookupResult.value),/shared@example\.invalid/);
  assert.equal((await route(aggregate,{action:'lookup-results',jobId:lookupId})).status,403);
  assert.equal((await route(people,{action:'lookup-cancel',jobId:lookupId})).status,200);assert.equal((await route(people,{action:'lookup-results',jobId:lookupId})).status,409);
  result=await route(people,{...search,kind:'mobile',term:'+61 412 345 678'});assert.equal(result.value.confirmedMatches,2);assert.equal(result.value.unresolvedMatches,1);assert.doesNotMatch(JSON.stringify(result.value),/0412 345 678|\+61412345678/);
  assert.equal((await route(aggregate,search)).status,403);
  assert.equal((await route(people,{...search,formId:forms[1]})).value.confirmedMatches,1);
  assert.equal((await route(people,{...search,eventId:'event-b'})).value.confirmedMatches,2);
  assert.equal((await route(people,{...search,eventId:'bad/path'})).status,400);
  assert.equal((await route(people,{...search,formId:false})).status,400);
  const cohort={action:'cohorts',historyFrom:'2025-01-01',from:'2026-01-01',to:'2026-12-31'};
  const concurrentCohort=await route(people,{action:'cohort-start',historyFrom:cohort.historyFrom,from:cohort.from,to:cohort.to});
  const concurrentSteps=await Promise.all([route(people,{action:'cohort-step',jobId:concurrentCohort.value.jobId,step:0}),route(people,{action:'cohort-step',jobId:concurrentCohort.value.jobId,step:0})]);
  assert.deepEqual(concurrentSteps.map(item=>item.status).sort(),[200,409]);assert.equal((await route(people,{action:'cohort-cancel',jobId:concurrentCohort.value.jobId})).status,200);
  result=await route(people,cohort);assert.deepEqual(result.value.counts,{firstKnown:2,returning:0,identified:2});
  const heat={...cohort,action:'cohortMatrix'};
  result=await route(people,heat);assert.equal(result.status,200);assert.deepEqual(result.value.years,['2026']);assert.deepEqual(result.value.rows,[{cohortYear:'2026',counts:[2]}]);
  assert.equal((await route(people,{...heat,cohortYear:'2026',returnYear:'2026'})).value.items.length,2);
  assert.equal((await route(people,{...heat,export:'xlsx'})).status,403);
  await db.doc('adminAllowlist/'+people.email).update({modules:['form-insights-people','form-insights-export']});
  const heatExport=await route(people,{...heat,export:'xlsx'});assert.equal(heatExport.status,200);assert.equal(heatExport.value.fingerprint,result.value.fingerprint);assert.deepEqual(heatExport.value.items,[]);
  assert.equal((await route(people,{...heat,cohortYear:'2026',returnYear:'2026',export:'xlsx'})).status,400);
  await db.doc('adminAllowlist/'+people.email).update({modules:['form-insights-people']});
  assert.equal((await route(aggregate,heat)).status,403);
  await db.doc('_insightsState/programmeCategories/items/education').set({name:'Education'});
  const eventA=await db.doc('events/event-a').get();
  await db.doc('_insightsState/programmeAssignments/events/event-a').set({version:1,categoryIds:['education'],eventVersion:version(eventA)});
  assert.equal((await route(people,{...search,categories:['education']})).value.confirmedMatches,1);
  assert.equal((await route(people,{...search,categories:['education']})).value.unresolvedMatches,1);
  assert.equal((await route(people,{...cohort,categories:['education']})).value.counts.identified,1);
  assert.equal((await route(people,{action:'timeline',personId:one,categories:['education']})).value.confirmed,2);
  assert.equal((await route(people,{action:'compare',eventA:'event-a',eventB:'event-b',categories:['education']})).status,400);
  const scopedChoices=await route(people,{action:'event-choices',from:'2026-01-01',to:'2026-12-31',categories:['education','unknown']});
  assert.equal(scopedChoices.value.events.length,2);
  await db.doc('_insightsState/programmeAssignments/events/event-a').update({version:2,categoryIds:[]});
  assert.equal((await route(people,{...search,categories:['education']})).value.confirmedMatches,0);
  await add(forms[0],'noncanonical','',null,'Synthetic','2026-06-01T00:00:00Z');
  result=await route(people,search);assert.equal(result.value.coverage.staleIndex,1);
  assert.deepEqual((await route(people,{...cohort,from:'2027-01-01',to:'2027-12-31'})).value.counts,{firstKnown:0,returning:0,identified:0});
  await add(forms[0],'earlier','',two,'Different Synthetic','2025-05-01T00:00:00.000Z');
  result=await route(people,cohort);assert.deepEqual(result.value.counts,{firstKnown:1,returning:1,identified:2});
  result=await route(people,heat);assert.deepEqual(result.value.rows,[{cohortYear:'2025',counts:[1]},{cohortYear:'2026',counts:[1]}]);
  assert.deepEqual((await route(people,{...heat,formId:forms[1]})).value.rows,[{cohortYear:'2026',counts:[1]}]);
  assert.deepEqual((await route(people,{...heat,eventId:'event-b'})).value.rows,[{cohortYear:'2025',counts:[1]},{cohortYear:'2026',counts:[1]}]);
  assert.equal((await route(people,{...heat,cohortYear:'2025',returnYear:'2026'})).value.items[0].personId,two);
  result=await route(people,{...cohort,categories:['unknown']});assert.deepEqual(result.value.counts,{firstKnown:1,returning:1,identified:2});
  const eventB=await db.doc('events/event-b').get();
  await db.doc('_insightsState/programmeAssignments/events/event-b').set({version:1,categoryIds:['education'],eventVersion:version(eventB)});
  result=await route(people,{...cohort,categories:['education']});assert.deepEqual(result.value.counts,{firstKnown:1,returning:1,identified:2});
  const scopedJob=await cohortSnapshot({historyFrom:cohort.historyFrom,from:cohort.from,to:cohort.to,categories:['education']});
  const scopedHeat=await route(people,{action:'cohort-results',jobId:scopedJob});assert.equal(scopedHeat.status,200);assert.deepEqual(scopedHeat.value.counts,result.value.counts);
  const scopedLegacy=await route(people,{...heat,categories:['education']});assert.deepEqual(scopedHeat.value.rows,scopedLegacy.value.rows);
  assert.equal((await route(people,{action:'cohort-results',jobId:scopedJob,cohortYear:'2025',returnYear:'2026'})).value.items[0].personId,two);
  assert.equal((await route(people,{action:'cohort-results',jobId:scopedJob,export:'xlsx'})).status,403);
  await db.doc('adminAllowlist/'+people.email).update({modules:['form-insights-people','form-insights-export']});
  const scopedExport=await route(people,{action:'cohort-results',jobId:scopedJob,export:'xlsx'});assert.equal(scopedExport.status,200);assert.deepEqual(scopedExport.value.rows,scopedHeat.value.rows);assert.deepEqual(scopedExport.value.items,[]);assert.equal(scopedExport.value.fingerprint,scopedHeat.value.fingerprint);
  assert.equal((await route(people,{action:'cohort-results',jobId:scopedJob,cohortYear:'2025',returnYear:'2026',export:'xlsx'})).status,400);
  await db.doc('adminAllowlist/'+people.email).update({modules:['form-insights-people']});
  await db.doc('_insightsState/programmeCategories/items/education').update({name:'Education revised'});assert.equal((await route(people,{action:'cohort-results',jobId:scopedJob})).status,409);
  let pendingCohort=await route(people,{action:'cohort-start',historyFrom:cohort.historyFrom,from:cohort.from,to:cohort.to,categories:['education']});
  const pendingId=pendingCohort.value.jobId;pendingCohort=await route(people,{action:'cohort-step',jobId:pendingId,step:0});assert.equal(pendingCohort.value.status,'running');
  await db.doc('_insightsState/programmeAssignments/events/event-b').update({version:2,categoryIds:[]});
  assert.equal((await route(people,{action:'cohort-step',jobId:pendingId,step:pendingCohort.value.step})).status,409);
  const revokedJob=await cohortSnapshot({historyFrom:cohort.historyFrom,from:cohort.from,to:cohort.to});
  await db.doc('adminAllowlist/'+people.email).update({modules:[]});assert.equal((await route(people,{action:'cohort-results',jobId:revokedJob})).status,403);
  await db.doc('adminAllowlist/'+people.email).update({modules:['form-insights-people']});
  assert.equal((await route(people,{action:'cohort-cancel',jobId:revokedJob})).status,200);assert.equal((await route(people,{action:'cohort-results',jobId:revokedJob})).status,409);
  let cleanupResult;do{cleanupResult=await require('./insights-multi-snapshot').cleanupExpired(db,revokedJob);}while(!cleanupResult.done);
  assert.equal((await db.doc('_insightsMultiJobs/'+revokedJob).collection('ledger').get()).size,0);
  const expiredJob=await cohortSnapshot({historyFrom:cohort.historyFrom,from:cohort.from,to:cohort.to});
  await db.doc('_insightsMultiJobs/'+expiredJob).update({expiresAt:new Date('2020-01-01')});assert.equal((await route(people,{action:'cohort-results',jobId:expiredJob})).status,409);
  do{cleanupResult=await require('./insights-multi-snapshot').cleanupExpired(db,expiredJob);}while(!cleanupResult.done);
  const mappingFencedJob=await cohortSnapshot({historyFrom:cohort.historyFrom,from:cohort.from,to:cohort.to});
  await db.runTransaction(tx=>require('./insights-state').bumpIndexVersionTx(tx,db,forms[0]));
  assert.equal((await route(people,{action:'cohort-results',jobId:mappingFencedJob})).status,409);
  const identityFencedJob=await cohortSnapshot({historyFrom:cohort.historyFrom,from:cohort.from,to:cohort.to});
  await db.doc('_insightsState/respondentVersion').set({generation:1});
  assert.equal((await route(people,{action:'cohort-results',jobId:identityFencedJob})).status,409);
  result=await route(people,{...cohort,historyFrom:'2026-01-01'});assert.deepEqual(result.value.counts,{firstKnown:2,returning:0,identified:2});
  await db.doc('events/event-a').update({startAt:'2027-04-04T00:00:00.000Z'});
  result=await route(people,{action:'timeline',personId:one});assert.equal(result.value.items.find(x=>x.event.title==='Event A').event.date,'2027-04-04T00:00:00.000Z');
  await db.doc('events/event-a').update({visibility:'private',title:'Private secret'});
  const choices=await route(people,{action:'event-choices',from:'2026-01-01',to:'2027-12-31'});assert.equal(choices.status,200);assert.doesNotMatch(JSON.stringify(choices.value),/Private secret|event-a/);assert.match(JSON.stringify(choices.value),/event-b/);
  result=await route(people,{...search,kind:'name',term:'Synthetic'});assert.doesNotMatch(JSON.stringify(result.value),/event-a|Private secret/);assert.ok(result.value.coverage.unavailable>0);
  result=await route(people,{action:'timeline',personId:one});assert.doesNotMatch(JSON.stringify(result.value),/Private secret|event-a|2027-04-04/);
  assert.equal((await route(people,{action:'compare',eventA:'event-a',eventB:'event-b'})).status,403);
  assert.equal((await route(owner,{action:'compare',eventA:'event-a',eventB:'event-b'})).status,200);
  await db.doc('events/event-a').delete();result=await route(owner,{action:'compare',eventA:'event-a',eventB:'event-b'});assert.equal(result.value.events[0].title,'Unavailable calendar event');assert.equal(result.value.events[0].date,null);
  await db.doc('events/event-a').set({title:'Event A',status:'confirmed',visibility:'public'});result=await route(people,{action:'compare',eventA:'event-a',eventB:'event-b'});assert.equal(result.value.events[0].date,null);
  await db.doc('events/event-a').update({startAt:'2026-03-01T00:00:00.000Z'});
  const preview=await Respondent.mergePreview(db,{sourceId:two,targetId:one});
  const merged=await Respondent.mergeConfirm(db,{...owner,provider:'google.com'},{sourceId:two,targetId:one,reviewToken:preview.reviewToken});
  result=await route(people,{action:'compare',eventA:'event-a',eventB:'event-b'});assert.deepEqual(result.value.counts,{common:1,aOnly:0,bOnly:0});
  result=await route(people,cohort);assert.deepEqual(result.value.counts,{firstKnown:0,returning:1,identified:1});
  assert.deepEqual((await route(people,heat)).value.rows,[{cohortYear:'2025',counts:[1]}]);
  await Respondent.mergeUndo(db,{...owner,provider:'google.com'},{operationId:merged.operationId});
  result=await route(people,{action:'compare',eventA:'event-a',eventB:'event-b'});assert.deepEqual(result.value.counts,{common:1,aOnly:0,bOnly:1});
  result=await route(people,cohort);assert.deepEqual(result.value.counts,{firstKnown:1,returning:1,identified:2});
  assert.deepEqual((await route(people,heat)).value.rows,[{cohortYear:'2025',counts:[1]},{cohortYear:'2026',counts:[1]}]);
  await db.doc(`registrationForms/${forms[0]}/responses/b-two`).update({'answers.name':'Corrected'});
  result=await route(people,{action:'compare',eventA:'event-a',eventB:'event-b'});assert.equal(result.value.coverage[1].unresolved,1);assert.equal(result.value.counts.bOnly,0);
  result=await route(people,{...search,kind:'name',term:'Corrected'});assert.equal(result.value.confirmedMatches,0);assert.equal(result.value.unresolvedMatches,1);
  result=await route(people,{action:'timeline',personId:two});assert.equal(result.value.reviewRequired,1);
  await db.doc(`_insightsState/fieldMappings/forms/${forms[1]}/revisions/1`).update({status:'draft',version:2});
  result=await route(people,{action:'compare',eventA:'event-a',eventB:'event-b'});assert.equal(result.value.counts.common,0);assert.equal(result.value.coverage[0].unresolved,2);
  result=await route(people,search);assert.ok(result.value.coverage.unmapped>=2);
  const batch=db.batch();
  for(let n=0;n<26;n++){
   const id='extra-'+n,source=db.doc(`registrationForms/${forms[0]}/responses/${id}`),response={reference:id,revision:1,fields,answers:{name:'Synthetic Person',email:'shared@example.invalid'},eventId:'event-a',createdAt:'2026-01-02T00:00:00.000Z'};
   batch.set(source,response);batch.set(db.doc('_registrationInsights/'+key(forms[0],id)),{formId:forms[0],responseId:id,eventId:'event-a'});
  }
  await batch.commit();
  const linkBatch=db.batch();
  for(let n=0;n<26;n++){
   const id='extra-'+n,source=await db.doc(`registrationForms/${forms[0]}/responses/${id}`).get();
   linkBatch.set(db.doc('_respondentLinks/'+key(forms[0],id)),{formId:forms[0],responseId:id,revision:1,personId:one,status:'linked',sourceVersion:version(source),sourceGeneration:0,mappingVersion:1,contactHashes:[]});
  }
  await linkBatch.commit();
  result=await route(people,{action:'timeline',personId:one});assert.equal(result.value.items.length,25);assert.ok(result.value.next);
  const next=result.value.next;result=await route(people,{action:'timeline',personId:one,cursor:next});assert.equal(result.status,200);assert.equal(result.value.items.length,4);
  await db.doc('events/event-a').update({startAt:'2028-01-01T00:00:00.000Z'});
  assert.equal((await route(people,{action:'timeline',personId:one,cursor:next})).status,409);
  const many=db.batch();
  for(let n=0;n<26;n++){
   const id='many-'+n,person=`44444444-4444-4444-8444-${String(n).padStart(12,'0')}`;
   many.set(db.doc('_respondents/'+person),{linkRevision:1});
   many.set(db.doc(`registrationForms/${forms[0]}/responses/${id}`),{reference:id,revision:1,fields,answers:{name:'Synthetic '+n,email:'shared@example.invalid'},eventId:'event-b',createdAt:'2026-01-02T00:00:00.000Z'});
   many.set(db.doc('_registrationInsights/'+key(forms[0],id)),{formId:forms[0],responseId:id,eventId:'event-b',submittedAt:'2026-01-02T00:00:00.000Z'});
  }
  await many.commit();
  const manyLinks=db.batch();for(let n=0;n<26;n++){
   const id='many-'+n,person=`44444444-4444-4444-8444-${String(n).padStart(12,'0')}`,source=await db.doc(`registrationForms/${forms[0]}/responses/${id}`).get();
   manyLinks.set(db.doc('_respondentLinks/'+key(forms[0],id)),{formId:forms[0],responseId:id,revision:1,personId:person,status:'linked',sourceVersion:version(source),sourceGeneration:0,mappingVersion:1,contactHashes:[]});
  }await manyLinks.commit();
  result=await route(people,{...search,kind:'name',term:'Synthetic'});assert.ok(result.value.confirmedMatches>25);assert.equal(result.value.items.length,25);assert.ok(result.value.next);
  const searchNext=result.value.next;result=await route(people,{...search,kind:'name',term:'Synthetic',cursor:searchNext});assert.ok(result.value.items.length>0);
  await db.doc('events/event-b').update({title:'Changed event'});
  assert.equal((await route(people,{...search,kind:'name',term:'Synthetic',cursor:searchNext})).status,409);
  result=await route(people,cohort);assert.ok(result.value.counts.firstKnown>25);assert.equal(result.value.items.length,25);assert.ok(result.value.next);
  const cohortNext=result.value.next;assert.equal((await route(people,{...cohort,cursor:cohortNext})).status,200);
  result=await route(people,{action:'compare',eventA:'event-a',eventB:'event-b',group:'b-only'});assert.equal(result.value.items.length,25);assert.equal(result.value.counts.bOnly,26);assert.ok(result.value.next);
  const compareNext=result.value.next;result=await route(people,{action:'compare',eventA:'event-a',eventB:'event-b',group:'b-only',cursor:compareNext});assert.equal(result.value.items.length,1);
  await db.doc(`registrationForms/${forms[0]}/responses/many-1`).update({'answers.name':'Corrected again'});
  assert.equal((await route(people,{...cohort,cursor:cohortNext})).status,409);
  await db.doc('events/event-b').update({startAt:'2028-01-01T00:00:00.000Z'});
  assert.equal((await route(people,{action:'compare',eventA:'event-a',eventB:'event-b',group:'b-only',cursor:compareNext})).status,409);
  assert.equal((await route(people,{action:'compare',eventA:'event-a',eventB:'event-b',group:'common',cursor:compareNext})).status,409);
  const over=db.batch();for(let n=0;n<251;n++)over.set(db.doc('_registrationInsights/over-'+n),{eventId:'event-a'});await over.commit();
  assert.equal((await route(people,{action:'compare',eventA:'event-a',eventB:'event-b'})).status,422);
  const getAll=db.getAll.bind(db);let revoke=true;
  db.getAll=async(...refs)=>{const docs=await getAll(...refs);if(revoke){revoke=false;await db.doc('adminAllowlist/'+people.email).update({modules:[]});}return docs;};
  assert.equal((await route(people,{action:'timeline',personId:one})).status,403);
  db.getAll=getAll;await db.doc('adminAllowlist/'+people.email).update({modules:['form-insights-people']});
  for(const action of ['lookup','cohorts']){
   revoke=true;db.getAll=async(...refs)=>{const docs=await getAll(...refs);if(revoke){revoke=false;await db.doc('adminAllowlist/'+people.email).update({modules:[]});}return docs;};
   assert.equal((await route(people,action==='lookup'?search:cohort)).status,403);
   db.getAll=getAll;await db.doc('adminAllowlist/'+people.email).update({modules:['form-insights-people']});
  }
  const {midnight}=require('./donation-records'),boundary=midnight('2028-04-02');
  await add(forms[0],'dst-before','',empty,'Sydney Boundary',new Date(boundary-1).toISOString());
  await add(forms[0],'dst-after','',empty,'Sydney Boundary',new Date(boundary).toISOString());
  result=await route(people,{action:'cohorts',historyFrom:'2028-04-01',from:'2028-04-02',to:'2028-04-02'});assert.deepEqual(result.value.counts,{firstKnown:0,returning:1,identified:1});
  const dstJob=await cohortSnapshot({historyFrom:'2028-04-01',from:'2028-04-02',to:'2028-04-02'});
  const dstSnapshot=await route(people,{action:'cohort-results',jobId:dstJob,group:'returning'});assert.equal(dstSnapshot.status,200);assert.deepEqual(dstSnapshot.value.counts,result.value.counts);assert.equal(dstSnapshot.value.items[0].personId,empty);
  for(let offset=0;offset<5001;offset+=500){
   const cap=db.batch();for(let n=offset;n<Math.min(offset+500,5001);n++)cap.set(db.doc('_registrationInsights/cap-'+n),{submittedAt:'2029-01-02T00:00:00.000Z'});await cap.commit();
  }
  assert.equal((await route(people,{...search,from:'2029-01-01',to:'2029-12-31'})).status,422);
  assert.equal((await route(people,{...cohort,historyFrom:'2029-01-01',from:'2029-01-01',to:'2029-12-31'})).status,422);
  await db.doc('adminAllowlist/'+people.email).update({modules:[]});
  assert.equal((await route(people,{action:'timeline',personId:one})).status,403);
  assert.equal((await route(people,{action:'access-check'})).status,403);
  assert.equal((await route(people,search)).status,403);assert.equal((await route(people,cohort)).status,403);
  const audits=await db.collection('auditLog').get();assert.doesNotMatch(JSON.stringify(audits.docs.map(doc=>doc.data())),/shared@example\.invalid|Synthetic Person/);
 }finally{if(previousFlag===undefined)delete process.env.MWA_INSIGHTS_MULTI_SNAPSHOT_ENABLED;else process.env.MWA_INSIGHTS_MULTI_SNAPSHOT_ENABLED=previousFlag;if(previousCleanupFlag===undefined)delete process.env.MWA_INSIGHTS_MULTI_CLEANUP_ENABLED;else process.env.MWA_INSIGHTS_MULTI_CLEANUP_ENABLED=previousCleanupFlag;await db.terminate();await deleteApp(app);}
});
