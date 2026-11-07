const test=require('node:test'),assert=require('node:assert/strict');const I=require('./form-insights');
test('reports count submissions separately from distinct events, forms and unresolved identities at Sydney boundaries',()=>{const report=I.summarize([{formId:'a',eventId:'e',reportAt:'2026-10-31T14:00:00Z'},{formId:'b',eventId:'e',reportAt:'2026-11-01T00:00:00Z'},{formId:'a',eventId:'',reportAt:'2026-10-01T00:00:00Z'}]);assert.equal(report.submissions,3);assert.equal(report.events,1);assert.equal(report.forms,2);assert.equal(report.unresolved,3);assert.deepEqual(report.months,[{month:'2026-10',count:1},{month:'2026-11',count:2}]);assert.deepEqual(report.days,[{date:'2026-10-01',count:1},{date:'2026-11-01',count:2}]);assert.equal(I.normalize(' A  Person '),'a person');});
test('ordinary Sydney reports retain submissions on 29 February',()=>{const report=I.summarize([{formId:'a',eventId:'',reportAt:'2024-02-28T13:00:00Z'}]);assert.equal(report.submissions,1);assert.deepEqual(report.days,[{date:'2024-02-29',count:1}]);assert.deepEqual(report.months,[{month:'2024-02',count:1}]);});
test('normalizes explicit Sydney month and year periods to bounded dates',()=>{assert.equal(I.reportDateRange({dateMode:'month',month:'2026-10'}).from,'2026-10-01');assert.equal(I.reportDateRange({dateMode:'month',month:'2026-10'}).to,'2026-10-31');assert.equal(I.reportDateRange({dateMode:'year',year:'2024'}).from,'2024-01-01');assert.equal(I.reportDateRange({dateMode:'year',year:'2024'}).to,'2024-12-31');assert.throws(()=>I.reportDateRange({dateMode:'month',month:'2026-13'}),/valid Sydney reporting month/);assert.throws(()=>I.reportDateRange({dateMode:'custom',from:'2026-02-02',to:'2026-01-01'}),/reporting period/);});

test('event response joins use bounded groups and refuse over-limit reports',async()=>{
 const events=Array.from({length:31},(_,i)=>({id:'event-'+i,data:()=>({startAt:'2026-04-15T00:00:00.000Z'})})),limits=[];
 const db={collection:()=>({where:(_field,_op,ids)=>({orderBy:()=>({limit:limit=>({get:async()=>{limits.push({ids,limit});return {docs:ids.map(id=>({id:'response-'+id,data:()=>({eventId:id})})).slice(0,limit)};}})})})})};
 const rows=await I.eventDateRows(db,events);assert.equal(rows.length,31);assert.deepEqual(limits.map(call=>call.ids.length),[30,1]);assert.equal(limits[1].limit,4971);
 const fullDb={collection:()=>({where:()=>({orderBy:()=>({limit:limit=>({get:async()=>({docs:Array.from({length:limit},(_,i)=>({id:String(i),data:()=>({eventId:'event-0'})}))})})})})})};
 await assert.rejects(I.eventDateRows(fullDb,events),/no partial report/);
});

test('current event dates unify rescheduled responses and invalidate stale report pages',{skip:!process.env.FIRESTORE_EMULATOR_HOST},async()=>{
 const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');
 const app=initializeApp({projectId:'demo-mwa-insights-provenance'},'insights-provenance-test'),db=getFirestore(app),formId='99999999-9999-4999-8999-999999999999',origin='https://refreshed.muhammadiwelfare.org.au',token={uid:'provenance-owner',email:'admin@muhammadiwelfare.org.au',email_verified:true,firebase:{sign_in_provider:'google.com'}};
 async function route(path,query={},method='GET',body={}){let status=200,value;const res={status:code=>{status=code;return res},json:result=>{value=result;return res}};await I.handle({path,method,query,body,is:()=>true,get:key=>key==='Authorization'?['Bearer','synthetic-test'].join(' '):origin},res,{db,getAuth:()=>({verifyIdToken:async()=>token}),origins:new Set([origin])});return {status,value};}
 const event=db.doc('events/synthetic'),form=db.doc('registrationForms/'+formId);
 const response=(eventId,reference)=>({reference,formTitle:'Synthetic',eventId,createdAt:'2026-02-01T00:00:00.000Z',fields:[{id:'name',type:'text'}],answers:{name:'Synthetic'}});
 try{
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-mwa-insights-provenance/databases/(default)/documents`,{method:'DELETE'});
  await db.doc('users/'+token.uid).set({role:'admin',email:token.email});await form.set({title:'Synthetic'});
  await event.set({title:'Before reschedule',status:'confirmed',visibility:'public',startAt:'2026-03-15T00:00:00.000Z',departmentId:'community',seriesId:'series'});
  await form.collection('responses').doc('first').set(response('synthetic','FIRST'));await I.indexResponse(db,formId,'first');
  await event.update({title:'Current title',startAt:'2026-04-15T00:00:00.000Z'});
  const secondFormId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',secondForm=db.doc('registrationForms/'+secondFormId);await secondForm.set({title:'Second synthetic form'});
  await secondForm.collection('responses').doc('second').set(response('synthetic','SECOND'));await I.indexResponse(db,secondFormId,'second');
  await form.collection('responses').doc('eventless').set(response('','EVENTLESS'));await I.indexResponse(db,formId,'eventless');
  await form.collection('responses').doc('missing').set(response('missing-event','MISSING'));await I.indexResponse(db,formId,'missing');
  await db.doc('events/no-date').set({title:'Date unavailable',status:'confirmed',visibility:'public'});await form.collection('responses').doc('no-date').set(response('no-date','NO-DATE'));await I.indexResponse(db,formId,'no-date');
  const march=await route('/api/form-insights',{basis:'event',dateMode:'month',month:'2026-03'}),april=await route('/api/form-insights',{basis:'event',dateMode:'month',month:'2026-04'});
  assert.equal(march.status,200,JSON.stringify(march.value));assert.equal(april.status,200,JSON.stringify(april.value));
  assert.equal(march.value.submissions,0);assert.equal(april.value.submissions,2);assert.equal(april.value.forms,2);assert.equal(april.value.events,1);assert.equal(april.value.eventRows[0].title,'Current title');
  assert.equal((await route('/api/form-insights',{basis:'submission',dateMode:'month',month:'2026-02'})).value.submissions,5);
  const exported=await route('/api/form-insights',{basis:'event',dateMode:'month',month:'2026-04',export:'xlsx'});assert.equal(exported.status,200);assert.equal(exported.value.submissions,2);assert.deepEqual(exported.value.months,april.value.months);
  const inventory=await route('/api/form-insights/events',{from:'2026-04-01',to:'2026-04-30'});assert.equal(inventory.value.events[0].indexedResponses,2);assert.equal(inventory.value.coverage.status,'incomplete');assert.equal(inventory.value.calendarVersion,april.value.calendarVersion);
  const flag=process.env.MWA_INSIGHTS_MULTI_SNAPSHOT_ENABLED,cleanup=process.env.MWA_INSIGHTS_MULTI_CLEANUP_ENABLED;
  try{
   delete process.env.MWA_INSIGHTS_MULTI_SNAPSHOT_ENABLED;delete process.env.MWA_INSIGHTS_MULTI_CLEANUP_ENABLED;
   assert.equal((await route('/api/form-insights/events',{},'POST',{action:'inventory-status'})).value.enabled,false);assert.equal((await route('/api/form-insights/events',{},'POST',{action:'inventory-start',from:'2026-04-01',to:'2026-04-30'})).status,503);
   process.env.MWA_INSIGHTS_MULTI_SNAPSHOT_ENABLED='true';process.env.MWA_INSIGHTS_MULTI_CLEANUP_ENABLED='true';
   let state=await route('/api/form-insights/events',{},'POST',{action:'inventory-start',from:'2026-04-01',to:'2026-04-30'});assert.equal(state.status,200,JSON.stringify(state.value));const jobId=state.value.jobId;
   assert.equal((await route('/api/form-insights/events',{},'POST',{action:'inventory-results',jobId})).status,409);
   while(state.value.status==='running'){state=await route('/api/form-insights/events',{},'POST',{action:'inventory-step',jobId,step:state.value.step});assert.equal(state.status,200,JSON.stringify(state.value));}
   const snapshot=await route('/api/form-insights/events',{},'POST',{action:'inventory-results',jobId});assert.equal(snapshot.status,200);assert.deepEqual(snapshot.value.events,inventory.value.events);assert.equal(snapshot.value.calendarVersion,april.value.calendarVersion);assert.equal((await route('/api/form-insights/events',{},'POST',{action:'inventory-cancel',jobId})).status,200);
   let aggregate=await route('/api/form-insights/analysis',{},'POST',{action:'aggregate-start',basis:'event',dateMode:'month',month:'2026-04'});assert.equal(aggregate.status,200,JSON.stringify(aggregate.value));const aggregateId=aggregate.value.jobId;
   assert.equal((await route('/api/form-insights/analysis',{},'POST',{action:'aggregate-results',jobId:aggregateId})).status,409);
   while(aggregate.value.status==='running'){aggregate=await route('/api/form-insights/analysis',{},'POST',{action:'aggregate-step',jobId:aggregateId,step:aggregate.value.step,search:''});assert.equal(aggregate.status,200,JSON.stringify(aggregate.value));}
   const aggregateResult=await route('/api/form-insights/analysis',{},'POST',{action:'aggregate-results',jobId:aggregateId});assert.equal(aggregateResult.status,200,JSON.stringify(aggregateResult.value));assert.equal(aggregateResult.value.submissions,april.value.submissions);assert.equal(aggregateResult.value.forms,april.value.forms);assert.deepEqual(aggregateResult.value.months,april.value.months);assert.equal(aggregateResult.value.calendarVersion,april.value.calendarVersion);assert.equal(aggregateResult.value.identified,0);
   assert.equal((await route('/api/form-insights/analysis',{},'POST',{action:'aggregate-results',jobId:aggregateId,export:'xlsx'})).status,200);assert.equal((await route('/api/form-insights/analysis',{},'POST',{action:'aggregate-cancel',jobId:aggregateId})).status,200);
  }finally{if(flag===undefined)delete process.env.MWA_INSIGHTS_MULTI_SNAPSHOT_ENABLED;else process.env.MWA_INSIGHTS_MULTI_SNAPSHOT_ENABLED=flag;if(cleanup===undefined)delete process.env.MWA_INSIGHTS_MULTI_CLEANUP_ENABLED;else process.env.MWA_INSIGHTS_MULTI_CLEANUP_ENABLED=cleanup;}
  const page=await route('/api/form-insights',{basis:'event',dateMode:'month',month:'2026-04',pageSize:'1'});assert.ok(page.value.nextCursor);
  const submissionPage=await route('/api/form-insights',{basis:'submission',dateMode:'month',month:'2026-02',pageSize:'1'});assert.ok(submissionPage.value.nextCursor);
  await db.doc('_insightsState/programmeCategories/items/education').set({name:'Education'});
  const eventBeforeReview=await event.get();
  await db.doc('_insightsState/programmeAssignments/events/synthetic').set({version:1,categoryIds:['education'],eventVersion:`${eventBeforeReview.updateTime.seconds}:${eventBeforeReview.updateTime.nanoseconds}`});
  await db.doc('events/unreviewed').set({title:'Unreviewed event',status:'confirmed',visibility:'public',startAt:'2026-04-20T00:00:00.000Z',departmentId:'community',seriesId:'series'});
  const inventoryFilter={from:'2026-04-01',to:'2026-04-30',categories:'education',bookingType:'community',series:'series'};
  const filteredInventory=await route('/api/form-insights/events',inventoryFilter);
  assert.equal(filteredInventory.status,200);assert.equal(filteredInventory.value.events.length,1);assert.equal(filteredInventory.value.events[0].indexedResponses,2);
  assert.deepEqual((await route('/api/form-insights/events',{...inventoryFilter,categories:'unknown'})).value.events.map(item=>item.id),['unreviewed']);
  assert.equal((await route('/api/form-insights/events',{...inventoryFilter,bookingType:'other'})).value.events.length,0);
  assert.equal((await route('/api/form-insights/events',{...inventoryFilter,series:'other'})).value.events.length,0);
  try{
   process.env.MWA_INSIGHTS_MULTI_SNAPSHOT_ENABLED='true';process.env.MWA_INSIGHTS_MULTI_CLEANUP_ENABLED='true';
   let state=await route('/api/form-insights/events',{},'POST',{action:'inventory-start',...inventoryFilter}),id=state.value.jobId;
   while(state.value.status==='running'){state=await route('/api/form-insights/events',{},'POST',{action:'inventory-step',jobId:id,step:state.value.step});assert.equal(state.status,200,JSON.stringify(state.value));}
   const filteredSnapshot=await route('/api/form-insights/events',{},'POST',{action:'inventory-results',jobId:id});
   assert.equal(filteredSnapshot.status,200,JSON.stringify(filteredSnapshot.value));assert.deepEqual(filteredSnapshot.value.events,filteredInventory.value.events);
   assert.deepEqual(filteredSnapshot.value.filters,filteredInventory.value.filters);
   let unknown=await route('/api/form-insights/events',{},'POST',{action:'inventory-start',...inventoryFilter,categories:'unknown'}),unknownId=unknown.value.jobId;
   while(unknown.value.status==='running'){unknown=await route('/api/form-insights/events',{},'POST',{action:'inventory-step',jobId:unknownId,step:unknown.value.step});assert.equal(unknown.status,200,JSON.stringify(unknown.value));}
   const unknownResult=await route('/api/form-insights/events',{},'POST',{action:'inventory-results',jobId:unknownId});
   assert.deepEqual(unknownResult.value.events.map(item=>item.id),['unreviewed']);await route('/api/form-insights/events',{},'POST',{action:'inventory-cancel',jobId:unknownId});
   await db.doc('_insightsState/programmeCategories/items/education').update({name:'Changed education'});
   assert.equal((await route('/api/form-insights/events',{},'POST',{action:'inventory-results',jobId:id})).status,409);
   await route('/api/form-insights/events',{},'POST',{action:'inventory-cancel',jobId:id});
  }finally{if(flag===undefined)delete process.env.MWA_INSIGHTS_MULTI_SNAPSHOT_ENABLED;else process.env.MWA_INSIGHTS_MULTI_SNAPSHOT_ENABLED=flag;if(cleanup===undefined)delete process.env.MWA_INSIGHTS_MULTI_CLEANUP_ENABLED;else process.env.MWA_INSIGHTS_MULTI_CLEANUP_ENABLED=cleanup;}
  const filtered=await route('/api/form-insights',{basis:'submission',dateMode:'month',month:'2026-02',categories:'education',pageSize:'1'});
  assert.equal(filtered.status,200);assert.equal(filtered.value.submissions,2);assert.ok(filtered.value.nextCursor);
  assert.equal((await route('/api/form-insights',{basis:'submission',dateMode:'month',month:'2026-02',categories:'education',export:'xlsx'})).value.submissions,2);
  assert.equal((await route('/api/form-insights',{basis:'submission',dateMode:'month',month:'2026-02',categories:'unknown'})).value.submissions,2);
  try{
   process.env.MWA_INSIGHTS_MULTI_SNAPSHOT_ENABLED='true';process.env.MWA_INSIGHTS_MULTI_CLEANUP_ENABLED='true';
   for(const scope of [
    {basis:'submission',dateMode:'month',month:'2026-02'},
    {basis:'submission',dateMode:'month',month:'2026-02',categories:'education',bookingType:'community',series:'series',formId},
    {basis:'submission',dateMode:'month',month:'2026-02',categories:'unknown'},
    {basis:'event',dateMode:'month',month:'2026-04',categories:'education,unknown'}
   ]){
    const legacy=await route('/api/form-insights',scope);assert.equal(legacy.status,200,JSON.stringify(legacy.value));
    let state=await route('/api/form-insights/analysis',{},'POST',{action:'aggregate-start',...scope}),id=state.value.jobId;
    assert.equal(state.status,200,JSON.stringify(state.value));
    while(state.value.status==='running'){state=await route('/api/form-insights/analysis',{},'POST',{action:'aggregate-step',jobId:id,step:state.value.step,search:''});assert.equal(state.status,200,JSON.stringify(state.value));}
    const snapshot=await route('/api/form-insights/analysis',{},'POST',{action:'aggregate-results',jobId:id,export:'xlsx'});
    assert.equal(snapshot.status,200,JSON.stringify(snapshot.value));
    for(const field of ['submissions','forms','events','days','months','years','totalMatching'])assert.deepEqual(snapshot.value[field],legacy.value[field],field);
    const sorted=rows=>[...rows].sort((a,b)=>a.id.localeCompare(b.id));
    assert.deepEqual(sorted(snapshot.value.eventRows),sorted(legacy.value.eventRows));
    assert.deepEqual(snapshot.value.filters,legacy.value.filters);
    await route('/api/form-insights/analysis',{},'POST',{action:'aggregate-cancel',jobId:id});
   }
  }finally{if(flag===undefined)delete process.env.MWA_INSIGHTS_MULTI_SNAPSHOT_ENABLED;else process.env.MWA_INSIGHTS_MULTI_SNAPSHOT_ENABLED=flag;if(cleanup===undefined)delete process.env.MWA_INSIGHTS_MULTI_CLEANUP_ENABLED;else process.env.MWA_INSIGHTS_MULTI_CLEANUP_ENABLED=cleanup;}
  const originalGetAll=db.getAll.bind(db);let changeReview=true;
  db.getAll=async(...refs)=>{const docs=await originalGetAll(...refs);if(changeReview&&refs.some(ref=>ref.path==='_insightsState/programmeAssignments/events/synthetic')){changeReview=false;await db.doc('_insightsState/programmeAssignments/events/synthetic').update({version:2,categoryIds:[]});}return docs;};
  assert.equal((await route('/api/form-insights',{basis:'submission',dateMode:'month',month:'2026-02',categories:'education',export:'xlsx'})).status,409);
  db.getAll=originalGetAll;
  assert.equal((await route('/api/form-insights',{basis:'submission',dateMode:'month',month:'2026-02',categories:'education',pageSize:'1',cursor:filtered.value.nextCursor})).status,409);
  let scan=await route('/api/form-insights/reconcile',{},'POST',{action:'start'});while(scan.value.status==='running')scan=await route('/api/form-insights/reconcile',{},'POST',{action:'step',jobId:scan.value.jobId});
  assert.equal(scan.value.status,'scan_complete');assert.equal(scan.value.freshness,'unchanged-since-scan');
  await event.update({startAt:'2026-05-15T00:00:00.000Z'});const freshness=await route('/api/form-insights/reconcile',{jobId:scan.value.jobId});
  assert.equal(freshness.value.freshness,'unchanged-since-scan');assert.match(freshness.value.freshnessScope,/calendar changes are not checked/);assert.equal((await route('/api/form-insights',{basis:'event',dateMode:'month',month:'2026-04'})).value.coverage.status,'incomplete');
  assert.equal((await route('/api/form-insights',{basis:'event',dateMode:'month',month:'2026-04',pageSize:'1',cursor:page.value.nextCursor})).status,409);
  assert.equal((await route('/api/form-insights',{basis:'submission',dateMode:'month',month:'2026-02',pageSize:'1',cursor:submissionPage.value.nextCursor})).status,409);
  assert.equal((await route('/api/form-insights',{basis:'event',dateMode:'month',month:'2026-05'})).value.submissions,2);
  await event.delete();const deleted=await route('/api/form-insights',{basis:'event',dateMode:'month',month:'2026-05'});assert.equal(deleted.value.submissions,0);
 }finally{await db.terminate();await deleteApp(app);}
});

test('event inventory groups responses across forms and keeps zero-indexed events explicitly incomplete',()=>{
 const events=[{id:'public',data:{title:'Public programme',status:'confirmed',visibility:'public',startAt:'2026-10-01T00:00:00Z',contactEmail:'private@example.invalid'}},{id:'private',data:{title:'Private programme',status:'confirmed',visibility:'private',startAt:'2026-10-01T00:00:00Z'}},{id:'pending',data:{title:'Pending programme',status:'pending',visibility:'public',startAt:'2026-10-01T00:00:00Z'}},{id:'empty',data:{title:'No indexed responses',status:'confirmed',visibility:'public',startAt:'2026-10-02T00:00:00Z'}}];
 const indexed=[{eventId:'public',formId:'form-a'},{eventId:'public',formId:'form-b'},{eventId:'private',formId:'form-a'}],publicRows=I.eventCoverageRows(events,indexed,false);
 assert.deepEqual(publicRows.map(row=>row.id),['public','empty']);assert.equal(publicRows[0].indexedResponses,2);assert.equal(publicRows[0].indexedForms,2);assert.equal(publicRows[1].indexedResponses,0);assert.equal(publicRows[1].coverageStatus,'incomplete');assert.equal(JSON.stringify(publicRows).includes('Private programme'),false);assert.equal(JSON.stringify(publicRows).includes('contactEmail'),false);
 const adminRows=I.eventCoverageRows(events,indexed,true);assert.equal(adminRows.length,4);assert.equal(adminRows.find(row=>row.id==='private').title,'Private programme');assert.equal(adminRows.find(row=>row.id==='pending').status,'pending');assert.equal(I.coverageSummary().status,'incomplete');
});

test('Insights index is idempotent and permissions separate aggregates, candidate search and exports',{skip:!process.env.FIRESTORE_EMULATOR_HOST},async()=>{
 const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');const app=initializeApp({projectId:'demo-mwa-insights'},'insights-test'),db=getFirestore(app),formId='33333333-3333-3333-3333-333333333333',responseId='a'.repeat(64),origin='https://refreshed.muhammadiwelfare.org.au',token={uid:'insights-admin',email:'insights@example.invalid',email_verified:true,firebase:{sign_in_provider:'google.com'}};
 async function route(query,path='/api/form-insights',method='GET',body){let status=200,value;const res={status:s=>{status=s;return res},json:v=>{value=v;return res}};await I.handle({path,method,body,is:()=>true,query:{from:'2026-01-01',to:'2026-12-31',...query},get:k=>k==='Authorization'?'Bearer fixture':origin},res,{db,getAuth:()=>({verifyIdToken:async()=>token}),origins:new Set([origin])});return {status,value};}
 try{await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-mwa-insights/databases/(default)/documents`,{method:'DELETE'});await db.doc('users/'+token.uid).set({role:'admin',email:token.email});const grant=db.doc('adminAllowlist/'+token.email);await grant.set({uid:token.uid,modules:['form-builder']});assert.equal((await route({})).status,403);
 await grant.set({uid:token.uid,modules:['form-insights']});const source=db.doc('registrationForms/'+formId+'/responses/'+responseId);await source.set({reference:'MWA-R-SYNTHETIC',formTitle:'Synthetic form',createdAt:'2026-10-01T00:00:00Z',eventId:'private',fields:[{id:'name',type:'text'},{id:'phone',type:'phone'}],answers:{name:'Example Person',phone:'0412345678'}});await db.doc('events/private').set({title:'Hidden booking',status:'confirmed',visibility:'private',startAt:'2026-10-01T00:00:00Z'});
 await I.indexResponse(db,formId,responseId);await I.indexResponse(db,formId,responseId);assert.equal((await db.collection('_registrationInsights').get()).size,1);const report=await route({});assert.equal(report.value.submissions,1);assert.equal(report.value.drilldownAvailable,false);assert.equal(report.value.items.length,0);assert.equal(JSON.stringify(report.value).includes('Hidden booking'),false);assert.equal(JSON.stringify(report.value).includes('Example Person'),false);assert.equal((await route({basis:'event'})).value.submissions,0);assert.equal((await route({search:'Example'})).status,403);assert.equal((await route({export:'pdf'})).status,403);
 await grant.set({uid:token.uid,modules:['form-insights','form-insights-people']});const redactedPage=await route({dateMode:'month',month:'2026-10',pageSize:'10'});assert.equal(redactedPage.value.drilldownAvailable,true);assert.equal(redactedPage.value.items[0].eventTitle,'');assert.equal(redactedPage.value.items[0].eventId,'');assert.equal(JSON.stringify(redactedPage.value.items).includes('Hidden booking'),false);assert.equal((await route({search:'Example'})).value.candidates[0].eventTitle,'');
 await grant.set({uid:token.uid,modules:['form-insights','form-insights-people','form-insights-export','events-bookings']});assert.equal((await route({search:'0412345678'})).value.candidates.length,1);assert.equal((await route({basis:'event'})).value.submissions,1);assert.equal((await route({export:'pdf'})).status,200);
 await Promise.all([
  db.doc('_registrationInsights/page-one').set({formId:'page-form',responseId:'page-response-one',reference:'PAGE-ONE',formTitle:'Page form',eventId:'private',eventTitle:'Hidden booking',submittedAt:'2026-10-02T00:00:00Z',eventAt:'2026-10-02T00:00:00Z',search:''}),
  db.doc('_registrationInsights/page-two').set({formId:'page-form',responseId:'page-response-two',reference:'PAGE-TWO',formTitle:'Page form',eventId:'private',eventTitle:'Hidden booking',submittedAt:'2026-10-03T00:00:00Z',eventAt:'2026-10-03T00:00:00Z',search:''})
 ]);
 const firstPage=await route({dateMode:'month',month:'2026-10',pageSize:'1'});assert.equal(firstPage.status,200);assert.equal(firstPage.value.filters.from,'2026-10-01');assert.equal(firstPage.value.filters.to,'2026-10-31');assert.equal(firstPage.value.totalMatching,3);assert.equal(firstPage.value.items.length,1);assert.ok(firstPage.value.nextCursor);
 const secondPage=await route({dateMode:'month',month:'2026-10',pageSize:'1',cursor:firstPage.value.nextCursor});assert.equal(secondPage.status,200);assert.equal(secondPage.value.items.length,1);assert.notEqual(secondPage.value.items[0].reference,firstPage.value.items[0].reference);
 assert.equal((await route({dateMode:'month',month:'2026-10',eventId:'private',pageSize:'1',cursor:firstPage.value.nextCursor})).status,409);
 const thirdPage=await route({dateMode:'month',month:'2026-10',pageSize:'1',cursor:secondPage.value.nextCursor});assert.equal(thirdPage.status,200);assert.equal(thirdPage.value.items.length,1);assert.equal(thirdPage.value.nextCursor,null);const yearReport=await route({dateMode:'year',year:'2026'});assert.equal(yearReport.value.filters.from,'2026-01-01');
 const exportPage=await route({dateMode:'month',month:'2026-10',pageSize:'1',export:'xlsx'});assert.equal(exportPage.status,200);assert.equal(exportPage.value.totalMatching,3);assert.equal((await route({pageSize:'1',cursor:firstPage.value.nextCursor,export:'pdf'})).status,400);
 await db.doc('_insightsState/coverage').set({status:'incomplete',updatedAt:'2026-11-07T00:00:00.000Z'});assert.equal((await route({dateMode:'month',month:'2026-10',pageSize:'1',cursor:firstPage.value.nextCursor})).status,409);
 assert.equal((await route({dateMode:'month',month:'2026-13'})).status,400);assert.equal((await route({pageSize:'101'})).status,400);
 const superToken={...token};token.uid='super-admin';token.email='admin@muhammadiwelfare.org.au';await db.doc('users/'+token.uid).set({role:'admin',email:token.email});assert.equal((await route({},'/api/form-insights/backfill','POST',{formId,dryRun:true})).value.count,1);assert.equal((await route({},'/api/form-insights/backfill','POST',{formId,dryRun:false})).status,409);Object.assign(token,superToken);
 await db.doc('_registrationInsights/page-one').delete();await db.doc('_registrationInsights/page-two').delete();await source.delete();await I.indexResponse(db,formId,responseId);assert.equal((await route({})).value.submissions,0);
 }finally{await db.terminate();await deleteApp(app);}
});

test('event inventory uses Sydney bounds, reconciles indexed counts across forms, and preserves calendar access boundaries',{skip:!process.env.FIRESTORE_EMULATOR_HOST},async()=>{
 const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');const app=initializeApp({projectId:'demo-mwa-insights-events'},'insights-events-test'),db=getFirestore(app),origin='https://refreshed.muhammadiwelfare.org.au',token={uid:'events-insights-admin',email:'events-insights@example.invalid',email_verified:true,firebase:{sign_in_provider:'google.com'}};
 async function route(path,query){let status=200,value;const res={status:s=>{status=s;return res},json:v=>{value=v;return res}};await I.handle({path,method:'GET',is:()=>true,query,get:k=>k==='Authorization'?'Bearer synthetic-test-token':origin},res,{db,getAuth:()=>({verifyIdToken:async()=>token}),origins:new Set([origin])});return {status,value};}
 try{
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-mwa-insights-events/databases/(default)/documents`,{method:'DELETE'});await db.doc('users/'+token.uid).set({role:'admin',email:token.email});const grant=db.doc('adminAllowlist/'+token.email);await grant.set({uid:token.uid,modules:['events-bookings']});assert.equal((await route('/api/form-insights/events',{from:'2026-10-01',to:'2026-10-01'})).status,403);await grant.set({uid:token.uid,modules:['form-insights']});
  await Promise.all([
   db.doc('events/public').set({title:'Public programme',status:'confirmed',visibility:'public',startAt:'2026-09-30T14:00:00Z',contactEmail:'private@example.invalid'}),
   db.doc('events/private').set({title:'Restricted programme',status:'confirmed',visibility:'private',startAt:'2026-09-30T14:00:00Z'}),
   db.doc('events/pending').set({title:'Unconfirmed programme',status:'pending',visibility:'public',startAt:'2026-09-30T14:00:00Z'}),
   db.doc('events/public-empty').set({title:'No indexed responses',status:'confirmed',visibility:'public',startAt:'2026-09-30T14:00:00Z'}),
   db.doc('events/before-start').set({title:'Before date',status:'confirmed',visibility:'public',startAt:'2026-09-30T13:59:59Z'}),
   db.doc('events/after-end').set({title:'After date',status:'confirmed',visibility:'public',startAt:'2026-10-01T14:00:00Z'}),
   db.doc('_registrationInsights/public-one').set({formId:'form-one',eventId:'public'}),
   db.doc('_registrationInsights/public-two').set({formId:'form-two',eventId:'public'}),
   db.doc('_registrationInsights/private-one').set({formId:'form-one',eventId:'private',submittedAt:'2026-10-01T00:00:00Z',search:''}),
   db.doc('registrationForms/form-one/responses/public-one').set({eventId:'public'}),
   db.doc('registrationForms/form-two/responses/public-two').set({eventId:'public'}),
   db.doc('registrationForms/form-two/responses/public-unindexed').set({eventId:'public'}),
   db.doc('registrationForms/form-one/responses/private-one').set({eventId:'private'})
  ]);
  const dateQuery={from:'2026-10-01',to:'2026-10-01'},publicInventory=await route('/api/form-insights/events',dateQuery);
  assert.equal(publicInventory.status,200);assert.deepEqual(publicInventory.value.events.map(event=>event.id),['public','public-empty']);assert.equal(publicInventory.value.events[0].indexedResponses,2);assert.equal(publicInventory.value.events[0].indexedForms,2);assert.equal(publicInventory.value.events[0].sourceResponses,3);assert.equal(publicInventory.value.events[0].reconciliationStatus,'Counts differ; coverage incomplete');assert.equal(publicInventory.value.events[1].indexedResponses,0);assert.equal(publicInventory.value.events[1].sourceResponses,0);assert.equal(publicInventory.value.events[1].coverageStatus,'incomplete');assert.equal(publicInventory.value.coverage.status,'incomplete');assert.equal(JSON.stringify(publicInventory.value).includes('Restricted programme'),false);assert.equal(JSON.stringify(publicInventory.value).includes('Unconfirmed programme'),false);assert.equal(JSON.stringify(publicInventory.value).includes('private@example.invalid'),false);
  assert.equal((await route('/api/form-insights',{from:'2026-10-01',to:'2026-10-01',eventId:'private'})).status,403);assert.equal((await route('/api/form-insights',{from:'2026-10-01',to:'2026-10-01',eventId:'bad/path'})).status,400);
  const publicReport=await route('/api/form-insights',{from:'2026-10-01',to:'2026-10-01'});assert.equal(JSON.stringify(publicReport.value).includes('Restricted programme'),false);
  const publicEventReport=await route('/api/form-insights',{basis:'event',from:'2026-10-01',to:'2026-10-01'});assert.equal(publicEventReport.status,200);assert.equal(publicEventReport.value.submissions,2);assert.equal(JSON.stringify(publicEventReport.value).includes('Restricted programme'),false);assert.equal(JSON.stringify(publicEventReport.value).includes('"private"'),false);
  await grant.set({uid:token.uid,modules:['form-insights','events-bookings']});const adminInventory=await route('/api/form-insights/events',dateQuery);assert.deepEqual(adminInventory.value.events.map(event=>event.id),['pending','private','public','public-empty']);assert.equal(adminInventory.value.events.find(event=>event.id==='private').title,'Restricted programme');assert.equal(adminInventory.value.events.find(event=>event.id==='private').sourceResponses,1);assert.equal(adminInventory.value.events.find(event=>event.id==='pending').status,'pending');assert.equal(JSON.stringify(adminInventory.value).includes('private@example.invalid'),false);
  const adminReport=await route('/api/form-insights',{from:'2026-10-01',to:'2026-10-01'});assert.equal(adminReport.value.eventRows.find(event=>event.id==='private').title,'Restricted programme');
  const adminEventReport=await route('/api/form-insights',{basis:'event',from:'2026-10-01',to:'2026-10-01'});assert.equal(adminEventReport.value.submissions,3);assert.equal(adminEventReport.value.eventRows.find(event=>event.id==='private').title,'Restricted programme');
 }finally{await db.terminate();await deleteApp(app);}
});

test('bounded reconciliation finds missing, stale and orphan indexes and invalidates concurrent source changes',{skip:!process.env.FIRESTORE_EMULATOR_HOST},async()=>{
 const {createHash}=require('node:crypto'),{initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore'),State=require('./insights-state');
 const app=initializeApp({projectId:'demo-mwa-insights-reconcile'},'insights-reconcile-test'),db=getFirestore(app),origin='https://refreshed.muhammadiwelfare.org.au',formId='44444444-4444-4444-8444-444444444444',token={uid:'admin-muhammadiwelfare',email:'admin@muhammadiwelfare.org.au',email_verified:true,firebase:{sign_in_provider:'google.com'}};
 const indexId=responseId=>createHash('sha256').update(formId+':'+responseId).digest('hex');
 async function route(path,method='GET',body={},query={}){let status=200,value;const res={status:code=>{status=code;return res},json:result=>{value=result;return res}};await I.handle({path,method,body,is:()=>true,query,get:key=>key==='Authorization'?'Bearer synthetic-test-token':origin},res,{db,getAuth:()=>({verifyIdToken:async()=>token}),origins:new Set([origin])});return {status,value};}
 async function step(jobId){return route('/api/form-insights/reconcile','POST',{action:'step',jobId});}
 try{
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-mwa-insights-reconcile/databases/(default)/documents`,{method:'DELETE'});
  await db.doc('users/'+token.uid).set({role:'admin',email:token.email});
  await db.doc('registrationForms/'+formId).set({title:'Synthetic reconciliation form'});
  const valid={reference:'RECON-ONE',formTitle:'Synthetic reconciliation form',createdAt:'2026-10-01T00:00:00Z',eventId:'',fields:[{id:'name',type:'text'}],answers:{name:'Synthetic only'}};
  await db.doc(`registrationForms/${formId}/responses/a-missing`).set(valid);
  await db.doc(`registrationForms/${formId}/responses/b-stale`).set({...valid,reference:'RECON-TWO',answers:{name:'Updated synthetic'}});
  await db.doc(`registrationForms/${formId}/responses/c-unindexable`).set({...valid,reference:'RECON-THREE',fields:[{id:'name'}]});
  const staleId='b-stale',staleHash=indexId(staleId);
  await db.doc('_registrationInsights/'+staleHash).set({formId,responseId:staleId,reference:'RECON-TWO',formTitle:'Synthetic reconciliation form',eventId:'',submittedAt:valid.createdAt,search:'old synthetic',indexVersion:1});
  await db.doc('_registrationInsights/'+indexId('deleted-source')).set({formId,responseId:'deleted-source',reference:'ORPHAN',formTitle:'Synthetic',eventId:'',submittedAt:valid.createdAt,search:'',indexVersion:1});
  await db.doc('_registrationInsights/invalid-index').set({formId,responseId:'a-missing',reference:'INVALID',formTitle:'Synthetic',eventId:'',submittedAt:valid.createdAt,search:'',indexVersion:1});
  const started=await route('/api/form-insights/reconcile','POST',{action:'start'});assert.equal(started.status,201);const jobId=started.value.jobId;
  assert.equal((await route('/api/form-insights/reconcile','POST',{action:'start'})).status,409);
  assert.equal((await route('/api/form-insights/reconcile','GET')).value.jobId,jobId);
  let state=started.value;for(let i=0;i<8&&state.status==='running';i++){const next=await step(jobId);assert.equal(next.status,200,JSON.stringify(next.value));state=next.value;}
  assert.equal(state.status,'scan_complete');assert.equal(state.generationStable,true);assert.equal(state.counts.sourcesScanned,3);assert.equal(state.counts.indexedScanned,3);assert.equal(state.counts.missingIndex,1);assert.equal(state.counts.staleIndex,1);assert.equal(state.counts.orphanIndex,1);assert.equal(state.counts.unindexableSource,1);assert.equal(state.counts.invalidIndex,1);assert.equal(state.issueCount,5);assert.equal(state.freshness,'unchanged-since-scan');assert.equal(state.latestReconciliation.coverageStatus,'incomplete');
  const issues=await db.collection(`_insightsState/reconciliationJobs/records/${jobId}/issues`).get();assert.equal(issues.size,5);assert.equal(JSON.stringify(issues.docs.map(doc=>doc.data())).includes('Synthetic only'),false);
  const second=await route('/api/form-insights/reconcile','POST',{action:'start'});assert.equal(second.status,201);const concurrentId=second.value.jobId;let concurrent=await step(concurrentId);assert.equal(concurrent.value.phase,'indexes');
  await db.doc(`registrationForms/${formId}/responses/a-missing`).update({answers:{name:'Changed during scan'}});await State.recordSourceChange(db,formId);
  const staleIndexRef=db.doc('_registrationInsights/'+staleHash);await db.runTransaction(async tx=>{const current=await tx.get(staleIndexRef);await State.bumpIndexVersionTx(tx,db,formId);tx.update(staleIndexRef,{search:'changed synthetic'});assert.equal(current.exists,true);});
  await db.doc('registrationForms/55555555-5555-4555-8555-555555555555').set({title:'Added during scan'});await State.recordFormCatalogChange(db);
  for(let i=0;i<5&&concurrent.value.status==='running';i++)concurrent=await step(concurrentId);
  assert.equal(concurrent.value.status,'invalidated');assert.equal(concurrent.value.generationStable,false);assert.equal(concurrent.value.freshness,'changed-during-scan');
  assert.equal((await db.doc('_registrationInsights/'+indexId('a-missing')).get()).exists,false);assert.equal((await db.doc(`registrationForms/${formId}/responses/a-missing`).get()).data().answers.name,'Changed during scan');
  await db.doc(`registrationForms/${formId}/responses/a-missing`).update({answers:{name:'Changed after scan'}});await State.recordSourceChange(db,formId);
  const status=await route('/api/form-insights/reconcile','GET',{}, {jobId});assert.equal(status.status,200);assert.equal(status.value.freshness,'changed-since-scan');assert.equal(status.value.latestReconciliation.coverageStatus,'incomplete');
  token.email='insights@example.invalid';token.uid='insights-only';await db.doc('users/'+token.uid).set({role:'admin',email:token.email});await db.doc('adminAllowlist/'+token.email).set({uid:token.uid,modules:['form-insights']});assert.equal((await route('/api/form-insights/reconcile','POST',{action:'start'})).status,403);assert.equal((await route('/api/form-insights/reconcile','GET')).status,403);
 }finally{await db.terminate();await deleteApp(app);}
});

test('reconciliation resumes in bounded 50-record source and index batches without repairing data',{skip:!process.env.FIRESTORE_EMULATOR_HOST},async()=>{
 const {createHash}=require('node:crypto'),{initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');
 const app=initializeApp({projectId:'demo-mwa-insights-resume'},'insights-resume-test'),db=getFirestore(app),origin='https://refreshed.muhammadiwelfare.org.au',formId='66666666-6666-4666-8666-666666666666',token={uid:'resume-owner',email:'admin@muhammadiwelfare.org.au',email_verified:true,firebase:{sign_in_provider:'google.com'}},hash=responseId=>createHash('sha256').update(formId+':'+responseId).digest('hex');
 async function route(path,method='GET',body={}){let status=200,value;const res={status:code=>{status=code;return res},json:result=>{value=result;return res}};await I.handle({path,method,body,is:()=>true,query:{},get:key=>key==='Authorization'?'Bearer synthetic-test-token':origin},res,{db,getAuth:()=>({verifyIdToken:async()=>token}),origins:new Set([origin])});return {status,value};}
 async function step(jobId){return route('/api/form-insights/reconcile','POST',{action:'step',jobId});}
 try{
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-mwa-insights-resume/databases/(default)/documents`,{method:'DELETE'});
  await db.doc('users/'+token.uid).set({role:'admin',email:token.email});await db.doc(`registrationForms/${formId}`).set({title:'Batch synthetic form'});
  const batch=db.batch();
  for(let i=0;i<51;i++){
   const responseId='response-'+String(i).padStart(2,'0'),reference='BATCH-'+i,createdAt='2026-10-01T00:00:00Z',responseRef=db.doc(`registrationForms/${formId}/responses/${responseId}`);
   const source={reference,formTitle:'Batch synthetic form',createdAt,eventId:'',fields:[{id:'name',type:'text'}],answers:{name:'Person '+String(i).padStart(2,'0')}};
   batch.set(responseRef,source);batch.set(db.doc('_registrationInsights/'+hash(responseId)),{formId,responseId,reference,formTitle:source.formTitle,eventId:'',submittedAt:createdAt,search:source.answers.name.toLowerCase(),indexVersion:1});
  }
  await batch.commit();
  const started=await route('/api/form-insights/reconcile','POST',{action:'start'});assert.equal(started.status,201);const jobId=started.value.jobId;
  let state=await step(jobId);assert.equal(state.status,200,JSON.stringify(state.value));assert.equal(state.value.phase,'sources');assert.equal(state.value.counts.sourcesScanned,50);
  state=await step(jobId);assert.equal(state.status,200,JSON.stringify(state.value));assert.equal(state.value.phase,'indexes');assert.equal(state.value.counts.sourcesScanned,51);assert.equal(state.value.counts.indexedScanned,0);
  state=await step(jobId);assert.equal(state.status,200,JSON.stringify(state.value));assert.equal(state.value.phase,'indexes');assert.equal(state.value.counts.indexedScanned,50);
  state=await step(jobId);assert.equal(state.status,200,JSON.stringify(state.value));assert.equal(state.value.phase,'verify');assert.equal(state.value.counts.indexedScanned,51);
  state=await step(jobId);assert.equal(state.status,200,JSON.stringify(state.value));assert.equal(state.value.status,'scan_complete');assert.equal(state.value.issueCount,0);assert.equal(state.value.latestReconciliation.coverageStatus,'incomplete');
  assert.equal((await db.collection(`registrationForms/${formId}/responses`).get()).size,51);assert.equal((await db.collection('_registrationInsights').get()).size,51);
  assert.equal((await db.doc(`registrationForms/${formId}/responses/response-00`).get()).data().answers.name,'Person 00');
 }finally{await db.terminate();await deleteApp(app);}
});
