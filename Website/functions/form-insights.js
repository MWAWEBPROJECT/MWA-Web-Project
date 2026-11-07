const {createHash,randomUUID}=require('node:crypto');
const {midnight,validDate,publicEvent}=require('./donation-records');
const {resolveAdmin}=require('./moduleAccess');
const {isOwner}=require('./adminAccess');
const State=require('./insights-state');
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const key=(f,r)=>createHash('sha256').update(f+':'+r).digest('hex');
const day=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Sydney',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
const normalize=v=>String(v??'').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
const calendarAccess=actor=>actor.modules.includes('events-bookings');
const VERSION_FIELDS=['formId','responseId','reference','formTitle','eventId','submittedAt','search','indexVersion'];
const MAX_RECONCILE_FORMS=5000,RECONCILE_BATCH_SIZE=50;
const RECONCILIATION_JOBS='_insightsState/reconciliationJobs/records';
const RECONCILIATION_LOCK='_insightsState/reconciliationLock';
const reconciliationJobRef=(db,jobId)=>db.doc(`${RECONCILIATION_JOBS}/${jobId}`);
function versionSnapshot(source,index,forms){return {source,index,forms};}
async function captureVersions(db){const [source,index,forms]=await Promise.all([State.readGenerations(db,'source'),State.readGenerations(db,'index'),State.readFormsGeneration(db)]);return versionSnapshot(source,index,forms);}
function sameVersions(a,b){return a.forms===b.forms&&a.source.length===b.source.length&&a.index.length===b.index.length&&a.source.every((value,index)=>value===b.source[index])&&a.index.every((value,index)=>value===b.index[index]);}
function sameIndexSource(record,expected){return VERSION_FIELDS.every(field=>record[field]===expected[field]);}
function safeResponseRecord(formId,responseId,response){
 if(!response||!Number.isFinite(Date.parse(response.createdAt))||!Array.isArray(response.fields)||response.fields.some(field=>!field||typeof field.id!=='string'||typeof field.type!=='string')||!response.answers||typeof response.answers!=='object'||Array.isArray(response.answers))return null;
 const eventId=typeof response.eventId==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(response.eventId)?response.eventId:'';
 const search=response.fields.filter(field=>['text','email','phone'].includes(field.type)).map(field=>normalize(response.answers[field.id])).filter(Boolean).join(' ').slice(0,12000);
 return {formId,responseId,reference:response.reference,formTitle:response.formTitle,eventId,submittedAt:response.createdAt,search,indexVersion:1};
}
function reconciliationIssueRef(db,jobId,formId,responseId,indexId=''){
 const id=createHash('sha256').update([formId,responseId,indexId].join(':')).digest('hex');
 return db.doc(`${RECONCILIATION_JOBS}/${jobId}/issues/${id}`);
}
function projectEvent(data,id,includePrivate){
 if(!data)return includePrivate?{id,title:'Unavailable calendar event',startAt:'',status:'unavailable'}:null;
 if(!includePrivate){const event=publicEvent(data,id);return event?{id,title:event.title,startAt:event.startAt,status:'confirmed'}:null;}
 return {id,title:String(data.title||'Untitled calendar event').slice(0,200),startAt:typeof data.startAt==='string'?data.startAt:'',status:String(data.status||'unspecified').slice(0,40)};
}
function eventCoverageRows(events,indexRows,includePrivate,sourceCounts=new Map(),indexScanTruncated=false){
 const available=events.map(event=>projectEvent(event.data,event.id,includePrivate)).filter(Boolean);
 const counts=new Map();
 for(const row of indexRows){if(!row.eventId)continue;const item=counts.get(row.eventId)||{responses:0,forms:new Set()};item.responses++;if(row.formId)item.forms.add(row.formId);counts.set(row.eventId,item);}
 return available.map(event=>{
  const indexedResponses=counts.get(event.id)?.responses||0,sourceResponses=sourceCounts.has(event.id)?sourceCounts.get(event.id):null;
  const reconciliationStatus=sourceResponses===null?'Not reconciled':indexScanTruncated?'Index scan incomplete':sourceResponses===indexedResponses?'Counts match; history coverage incomplete':'Counts differ; coverage incomplete';
  return {id:event.id,title:event.title,startAt:event.startAt,status:event.status,indexedResponses,indexedForms:counts.get(event.id)?.forms.size||0,sourceResponses,reconciliationStatus,coverageStatus:'incomplete'};
 });
}
function coverageSummary(indexScanTruncated=false,sourceReconciliationTruncated=false){
 return {status:'incomplete',label:'Coverage incomplete',reason:'The indexed responses have not been comprehensively reconciled against all source responses. Source counts include only responses explicitly linked by event ID.',indexScanTruncated,sourceReconciliationTruncated};
}
async function eventDetails(db,eventIds,includePrivate){
 const ids=[...new Set(eventIds.filter(id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(id)))],details=new Map();
 for(let offset=0;offset<ids.length;offset+=500){
  const docs=await db.getAll(...ids.slice(offset,offset+500).map(id=>db.doc('events/'+id)));
  for(let i=0;i<docs.length;i++){const event=projectEvent(docs[i].exists?docs[i].data():null,ids[offset+i],includePrivate);if(event)details.set(event.id,event);}
 }
 return details;
}
function calendarFingerprint(docs){
 return createHash('sha256').update(JSON.stringify(docs.map(doc=>[doc.id,doc.exists?`${doc.updateTime.seconds}:${doc.updateTime.nanoseconds}`:'missing']).sort((a,b)=>a[0].localeCompare(b[0])))).digest('hex');
}
async function calendarRange(db,range){
 const snap=await db.collection('events').where('startAt','>=',range.fromTimestamp).where('startAt','<',range.toTimestamp).orderBy('startAt').orderBy('__name__').limit(5001).get();
 if(snap.size>5000)fail(422,'More than 5,000 calendar events match this period. Narrow the date range; no partial report has been returned.');
 return snap.docs;
}
async function calendarDocuments(db,ids){
 const unique=[...new Set(ids.filter(id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(id)))].sort(),docs=[];
 for(let offset=0;offset<unique.length;offset+=500)docs.push(...await db.getAll(...unique.slice(offset,offset+500).map(id=>db.doc('events/'+id))));
 return docs;
}
async function eventDateRows(db,events){
 const dates=new Map(events.map(doc=>[doc.id,doc.data().startAt])),ids=[...dates.keys()],docs=[];
 for(let offset=0;offset<ids.length;offset+=30){
  const snap=await db.collection('_registrationInsights').where('eventId','in',ids.slice(offset,offset+30)).orderBy('__name__').limit(5001-docs.length).get();
  docs.push(...snap.docs);
  if(docs.length>5000)fail(422,'More than 5,000 indexed responses match events in this date window. Narrow the dates; no partial report has been returned.');
 }
 return docs.map(doc=>({...doc.data(),id:doc.id,reportAt:dates.get(doc.data().eventId)})).sort((a,b)=>a.reportAt.localeCompare(b.reportAt)||a.id.localeCompare(b.id));
}
function eventDateRange(from,to){
 if(!validDate(from)||!validDate(to)||from>to||Date.parse(to)-Date.parse(from)>3660*86400000)fail(400,'Choose a valid event date range of up to ten years.');
 const nextDay=new Date(Date.parse(to+'T00:00:00Z')+86400000).toISOString().slice(0,10);
 return {from:new Date(midnight(from)).toISOString(),to:new Date(midnight(nextDay)).toISOString()};
}
function reportDateRange({dateMode='custom',from,to,month,year}={}){
 if(dateMode==='month'){
  if(typeof month!=='string'||!/^\d{4}-\d{2}$/.test(month)||!validDate(month+'-01'))fail(400,'Choose a valid Sydney reporting month.');
  from=month+'-01';to=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10);
 }else if(dateMode==='year'){
  if(typeof year!=='string'||!/^\d{4}$/.test(year)||!validDate(year+'-01-01'))fail(400,'Choose a valid Sydney reporting year.');
  from=year+'-01-01';to=year+'-12-31';
 }else if(dateMode!=='custom')fail(400,'Choose a valid reporting period.');
 if(!validDate(from)||!validDate(to)||from>to||Date.parse(to)-Date.parse(from)>3660*86400000)fail(400,'Choose a reporting period of up to ten years.');
 const nextDay=new Date(Date.parse(to+'T00:00:00Z')+86400000).toISOString().slice(0,10);
 return {from,to,fromTimestamp:new Date(midnight(from)).toISOString(),toTimestamp:new Date(midnight(nextDay)).toISOString(),dateMode};
}
function encodePageCursor(row,coverageVersion,scope){
 return Buffer.from(JSON.stringify({t:row.reportAt,id:row.id,v:coverageVersion,s:scope})).toString('base64url');
}
function decodePageCursor(value){
 if(!value)return null;
 let cursor;try{cursor=JSON.parse(Buffer.from(String(value),'base64url').toString());}catch{}
 if(!cursor||typeof cursor.t!=='string'||!Number.isFinite(Date.parse(cursor.t))||typeof cursor.id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(cursor.id)||typeof cursor.v!=='string'||cursor.v.length>64||typeof cursor.s!=='string'||!/^[a-f0-9]{64}$/.test(cursor.s))fail(400,'This report page cursor is invalid. Run the report again.');
 return cursor;
}
async function listEventCoverage(db,from,to,includePrivate,input={}){
 const range=eventDateRange(from,to);
 const inventory=await db.collection('events').where('startAt','>=',range.from).where('startAt','<',range.to).orderBy('startAt').orderBy('__name__').limit(5001).get();
 if(inventory.size>5000)fail(422,'More than 5,000 calendar events match this period. Narrow the date range; no partial inventory has been returned.');
 const programme=require('./insights-programmes'),filters=programme.filters(input),accessible=inventory.docs.filter(doc=>includePrivate||projectEvent(doc.data(),doc.id,false));
 const dimensions=programme.active(filters)?await programme.dimensions(db,accessible):null;
 const events=accessible.filter(doc=>!dimensions||programme.matches(dimensions.map.get(doc.id),filters)).map(doc=>({id:doc.id,data:doc.data()}));
 const indexed=events.length?await db.collection('_registrationInsights').limit(5001).get():{docs:[],size:0};
 const indexScanTruncated=indexed.size>5000,rows=indexed.docs.slice(0,5000).map(doc=>doc.data()),sourceCounts=new Map();
 for(let offset=0;offset<Math.min(events.length,100);offset+=10){
  await Promise.all(events.slice(offset,offset+10).map(async event=>{
   const snapshot=await db.collectionGroup('responses').where('eventId','==',event.id).count().get();sourceCounts.set(event.id,snapshot.data().count);
  }));
 }
 const projected=eventCoverageRows(events,rows,includePrivate,sourceCounts,indexScanTruncated);
 const calendarVersion=calendarFingerprint(inventory.docs),after=await calendarRange(db,{fromTimestamp:range.from,toTimestamp:range.to});
 if(calendarVersion!==calendarFingerprint(after))fail(409,'Calendar events changed while preparing this inventory. Run it again.');
 if(dimensions&&(await programme.dimensions(db,after.filter(doc=>includePrivate||projectEvent(doc.data(),doc.id,false)))).fingerprint!==dimensions.fingerprint)fail(409,'Programme reviews changed while preparing this inventory. Run it again.');
 return {events:projected,filters,calendarVersion,generatedAt:new Date().toISOString(),dateBasis:'Current calendar event start date, Australia/Sydney',coverage:coverageSummary(indexScanTruncated,events.length>100)};
}
function summarize(rows){
 const days=new Map(),months=new Map(),years=new Map(),events=new Map(),forms=new Set();
 for(const row of rows){const reportDay=day(row.reportAt),month=reportDay.slice(0,7),year=reportDay.slice(0,4);days.set(reportDay,(days.get(reportDay)||0)+1);months.set(month,(months.get(month)||0)+1);years.set(year,(years.get(year)||0)+1);forms.add(row.formId);if(row.eventId){const e=events.get(row.eventId)||{id:row.eventId,title:row.eventTitle||'Unavailable event',count:0};e.count++;events.set(row.eventId,e);}}
 return {submissions:rows.length,forms:forms.size,events:events.size,unresolved:rows.length,days:[...days].sort().map(([date,count])=>({date,count})),years:[...years].sort().map(([year,count])=>({year,count})),months:[...months].sort().map(([month,count])=>({month,count})),eventRows:[...events.values()].sort((a,b)=>b.count-a.count)};
}
// Re-read the current source in a transaction: out-of-order triggers cannot restore old answers.
async function indexResponse(db,formId,responseId){
 const source=db.doc('registrationForms/'+formId+'/responses/'+responseId),target=db.doc('_registrationInsights/'+key(formId,responseId));
 const coverage=db.doc('_insightsState/coverage');
 await db.runTransaction(async tx=>{const [snap,coverageSnap]=await Promise.all([tx.get(source),tx.get(coverage)]);
 const existing=await tx.get(target);
 if(!snap.exists){if(existing.exists){await State.bumpIndexVersionTx(tx,db,formId);tx.delete(target);}tx.set(coverage,{...(coverageSnap.exists?coverageSnap.data():{}),status:'incomplete',updatedAt:new Date().toISOString(),reason:'Source changes require response-index reconciliation.'});return;}
 const r=snap.data(),expected=safeResponseRecord(formId,responseId,r);
 if(!expected){if(existing.exists){await State.bumpIndexVersionTx(tx,db,formId);tx.delete(target);}tx.set(coverage,{...(coverageSnap.exists?coverageSnap.data():{}),status:'incomplete',updatedAt:new Date().toISOString(),reason:'A malformed source response could not be indexed and requires reconciliation.'});return;}
 const eventId=typeof r.eventId==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(r.eventId)?r.eventId:'';
 const event=eventId?await tx.get(db.doc('events/'+eventId)):null;
 const safeEvent=event?publicEvent(event.data(),eventId):null;
 const record={...expected,eventTitle:safeEvent?.title||'',eventAt:typeof event?.data()?.startAt==='string'?event.data().startAt:'',indexedAt:new Date().toISOString()};
 if(!existing.exists||!sameIndexSource(existing.data(),expected)||existing.data().eventTitle!==record.eventTitle||existing.data().eventAt!==record.eventAt){await State.bumpIndexVersionTx(tx,db,formId);tx.set(target,record);}
 tx.set(coverage,{...(coverageSnap.exists?coverageSnap.data():{}),status:'incomplete',updatedAt:new Date().toISOString(),reason:'Source changes require response-index reconciliation.'});
 });
}
async function beginReconciliation(db,actor){
 const lockRef=db.doc(RECONCILIATION_LOCK),lock=(await lockRef.get()).data();
 if(lock?.status==='running')fail(409,'A reconciliation scan is already running. Resume its job before starting another.');
 const initialVersions=await captureVersions(db);
 const formSnapshot=await db.collection('registrationForms').orderBy('__name__').limit(MAX_RECONCILE_FORMS+1).get();
 if(formSnapshot.size>MAX_RECONCILE_FORMS)fail(422,'More than 5,000 forms are in scope. No reconciliation job was started.');
 const versions=await captureVersions(db);
 if(!sameVersions(initialVersions,versions))fail(409,'Insights data changed while the scan scope was being captured. Retry to establish a stable cutoff.');
 const startedAt=new Date().toISOString(),jobId=randomUUID(),job={id:jobId,status:'running',phase:'sources',formIds:formSnapshot.docs.map(doc=>doc.id),formIndex:0,after:'',indexAfter:'',versions,startedAt,scopeCutoff:startedAt,updatedAt:startedAt,startedBy:actor.uid,counts:{sourcesScanned:0,indexedScanned:0,missingIndex:0,staleIndex:0,orphanIndex:0,unindexableSource:0,invalidIndex:0}};
 await db.runTransaction(async tx=>{
  const current=await tx.get(lockRef);
  if(current.data()?.status==='running')fail(409,'A reconciliation scan is already running. Resume its job before starting another.');
  tx.create(reconciliationJobRef(db,jobId),job);
  tx.set(lockRef,{jobId,status:'running',updatedAt:startedAt});
 });
 return {jobId,status:job.status,phase:job.phase,scopeCutoff:job.scopeCutoff,formCount:job.formIds.length,counts:job.counts};
}
function issueChange(db,jobId,changes,kind,formId,responseId,indexId=''){
 const ref=reconciliationIssueRef(db,jobId,formId,responseId,indexId);
 changes.set(ref.path,{ref,kind,formId,responseId,indexDocumentId:indexId||undefined});
}
async function hydrateIssueChanges(db,changes){
 const entries=[...changes.values()],snapshots=entries.length?await db.getAll(...entries.map(entry=>entry.ref)):[];
 entries.forEach((entry,index)=>{entry.previous=snapshots[index].exists?snapshots[index].data():null;});
 return changes;
}
function applyIssueDelta(job,changes,tx){
 const deltas={missingIndex:0,staleIndex:0,orphanIndex:0,unindexableSource:0,invalidIndex:0};
 for(const change of changes.values()){
  if(change.previous?.kind)deltas[change.previous.kind]--;
  if(change.kind)deltas[change.kind]++;
  if(change.kind)tx.set(change.ref,{kind:change.kind,formId:change.formId,responseId:change.responseId,...(change.indexDocumentId?{indexDocumentId:change.indexDocumentId}:{}),updatedAt:new Date().toISOString()});
  else if(change.previous)tx.delete(change.ref);
 }
 for(const [key,value]of Object.entries(deltas))job.counts[key]=Math.max(0,(job.counts[key]||0)+value);
}
async function readSourceReconciliationBatch(db,job){
 let formIndex=job.formIndex,after=job.after,scanned=0;const changes=new Map();
 while(formIndex<job.formIds.length&&scanned<RECONCILE_BATCH_SIZE){
  const formId=job.formIds[formIndex],remaining=RECONCILE_BATCH_SIZE-scanned,collection=db.collection(`registrationForms/${formId}/responses`);
  let query=collection.orderBy('__name__');if(after)query=query.startAfter(after);
  const snapshot=await query.limit(remaining+1).get(),docs=snapshot.docs.slice(0,remaining);
  if(!docs.length){formIndex++;after='';continue;}
  const indexDocs=await db.getAll(...docs.map(doc=>db.doc('_registrationInsights/'+key(formId,doc.id))));
  for(let i=0;i<docs.length;i++){
   const source=docs[i].data(),indexed=indexDocs[i],expected=safeResponseRecord(formId,docs[i].id,source);let kind='';
   if(!expected)kind='unindexableSource';
   else if(!indexed.exists)kind='missingIndex';
   else if(!sameIndexSource(indexed.data(),expected))kind='staleIndex';
   issueChange(db,job.id,changes,kind,formId,docs[i].id);
  }
  scanned+=docs.length;
  const hasMore=snapshot.size>docs.length;
  if(hasMore)after=docs.at(-1).id;else{formIndex++;after='';}
 }
 return {formIndex,after,scanned,changes,done:formIndex>=job.formIds.length};
}
async function readIndexReconciliationBatch(db,job){
 let query=db.collection('_registrationInsights').orderBy('__name__');if(job.indexAfter)query=query.startAfter(job.indexAfter);
 const snapshot=await query.limit(RECONCILE_BATCH_SIZE+1).get(),docs=snapshot.docs.slice(0,RECONCILE_BATCH_SIZE),changes=new Map();
 if(docs.length){
  const sourceRefs=docs.map(doc=>{const value=doc.data();if(typeof value.formId!=='string'||!value.formId||value.formId.includes('/')||typeof value.responseId!=='string'||!value.responseId||value.responseId.includes('/'))return null;return db.doc(`registrationForms/${value.formId}/responses/${value.responseId}`);});
  const validRefs=sourceRefs.filter(Boolean),validDocs=validRefs.length?await db.getAll(...validRefs):[];
  let validIndex=0;
  for(let i=0;i<docs.length;i++){
   const data=docs[i].data(),ref=sourceRefs[i],source=ref?validDocs[validIndex++]:null,expected=ref&&source?.exists?safeResponseRecord(data.formId,data.responseId,source.data()):null;
   let kind='';
   if(!ref||docs[i].id!==key(data.formId,data.responseId))kind='invalidIndex';
   else if(!source?.exists)kind='orphanIndex';
   else if(!expected)kind='unindexableSource';
   else if(!sameIndexSource(data,expected))kind='staleIndex';
   issueChange(db,job.id,changes,kind,data.formId||'',data.responseId||docs[i].id,kind==='invalidIndex'?docs[i].id:'');
  }
 }
 return {indexAfter:docs.length?docs.at(-1).id:job.indexAfter,scanned:docs.length,changes,done:snapshot.size<=docs.length};
}
function jobCheckpoint(job){return [job.status,job.phase,job.formIndex,job.after,job.indexAfter].join('|');}
function issueCount(counts={}){return ['missingIndex','staleIndex','orphanIndex','unindexableSource','invalidIndex'].reduce((sum,key)=>sum+(counts[key]||0),0);}
async function saveReconciliationBatch(db,job,next,changes){
 await hydrateIssueChanges(db,changes);
 const ref=reconciliationJobRef(db,job.id),before=jobCheckpoint(job),timestamp=new Date().toISOString();
 await db.runTransaction(async tx=>{
  const current=await tx.get(ref);
  if(!current.exists||jobCheckpoint(current.data())!==before)fail(409,'Another reconciliation batch advanced this job. Refresh its status before continuing.');
  const updated={...current.data(),...next,updatedAt:timestamp};
  applyIssueDelta(updated,changes,tx);
  if(updated.phase==='sources'&&next.sourceDone){updated.phase='indexes';updated.formIndex=updated.formIds.length;updated.after='';}
  if(updated.phase==='indexes'&&next.indexDone)updated.phase='verify';
  tx.set(ref,updated);
 });
 return (await ref.get()).data();
}
async function finishReconciliation(db,job){
 const jobRef=reconciliationJobRef(db,job.id),sourceRefs=State.versionRefs(db,'source'),indexRefs=State.versionRefs(db,'index'),formsRef=State.formsVersionRef(db),before=jobCheckpoint(job);
 await db.runTransaction(async tx=>{
  const reads=await Promise.all([tx.get(jobRef),...sourceRefs.map(ref=>tx.get(ref)),...indexRefs.map(ref=>tx.get(ref)),tx.get(formsRef)]);
  const current=reads[0],sourceDocs=reads.slice(1,1+State.VERSION_SHARDS),indexDocs=reads.slice(1+State.VERSION_SHARDS,1+State.VERSION_SHARDS*2),formsDoc=reads.at(-1);
  if(!current.exists||jobCheckpoint(current.data())!==before)fail(409,'Another reconciliation batch advanced this job. Refresh its status before continuing.');
  const source=sourceDocs.map(doc=>doc.data()?.generation||0),index=indexDocs.map(doc=>doc.data()?.generation||0);
  const actual=versionSnapshot(source,index,formsDoc.data()?.generation||0),unchanged=sameVersions(actual,current.data().versions);
  const timestamp=new Date().toISOString(),status=unchanged?'scan_complete':'invalidated',summary={jobId:job.id,status,startedAt:job.startedAt,completedAt:timestamp,scopeCutoff:job.scopeCutoff,formCount:job.formIds.length,generationStable:unchanged,counts:job.counts,coverageStatus:'incomplete',coverageReason:'A completed source/index scan does not prove that unlinked legacy responses or identity mappings are complete.'};
  tx.set(jobRef,{...current.data(),status,phase:'done',completedAt:timestamp,generationStable:unchanged,updatedAt:timestamp});
  tx.set(db.doc(RECONCILIATION_LOCK),{jobId:job.id,status:'finished',updatedAt:timestamp});
  tx.set(db.doc('_insightsState/reconciliationSummary'),summary);
  tx.set(db.doc('_insightsState/coverage'),{status:'incomplete',updatedAt:timestamp,reason:summary.coverageReason,lastReconciliation:job.id});
 });
 return reconciliationStatus(db,(await jobRef.get()).data());
}
async function stepReconciliation(db,jobId){
 if(!/^[a-f0-9-]{36}$/.test(jobId||''))fail(400,'Choose a valid reconciliation job.');
 const ref=reconciliationJobRef(db,jobId),snapshot=await ref.get();
 if(!snapshot.exists)fail(404,'Reconciliation job not found.');
 let job=snapshot.data();
 if(job.status!=='running')return reconciliationStatus(db,job);
 if(job.phase==='sources'){
  const batch=await readSourceReconciliationBatch(db,job);
  job=await saveReconciliationBatch(db,job,{formIndex:batch.formIndex,after:batch.after,sourceDone:batch.done,scannedSources:(job.scannedSources||0)+batch.scanned,counts:{...job.counts,sourcesScanned:(job.counts.sourcesScanned||0)+batch.scanned}},batch.changes);
  return reconciliationStatus(db,job);
 }
 if(job.phase==='indexes'){
  const batch=await readIndexReconciliationBatch(db,job);
  job=await saveReconciliationBatch(db,job,{indexAfter:batch.indexAfter,indexDone:batch.done,counts:{...job.counts,indexedScanned:(job.counts.indexedScanned||0)+batch.scanned}},batch.changes);
  return reconciliationStatus(db,job);
 }
 if(job.phase==='verify')return finishReconciliation(db,job);
 fail(409,'This reconciliation job is not in a resumable state.');
}
async function reconciliationStatus(db,job){
 const summarySnapshot=await db.doc('_insightsState/reconciliationSummary').get(),latest=summarySnapshot.data();
 const unchanged=job.status==='scan_complete'?sameVersions(await captureVersions(db),job.versions):false,freshness=job.status==='scan_complete'?(unchanged?'unchanged-since-scan':'changed-since-scan'):job.status==='invalidated'?'changed-during-scan':'not-complete';
 return {jobId:job.id,status:job.status,phase:job.phase,scopeCutoff:job.scopeCutoff,startedAt:job.startedAt,completedAt:job.completedAt||null,formCount:job.formIds?.length||0,counts:job.counts,issueCount:issueCount(job.counts),generationStable:job.generationStable??null,freshness,freshnessScope:'Source, index and form-catalog generation markers only; event dates and calendar changes are not checked. Coverage remains incomplete.',latestReconciliation:latest?{jobId:latest.jobId,status:latest.status,completedAt:latest.completedAt,scopeCutoff:latest.scopeCutoff,coverageStatus:latest.coverageStatus,coverageReason:latest.coverageReason}:null};
}
async function latestReconciliationStatus(db){
 const lock=(await db.doc(RECONCILIATION_LOCK).get()).data();
 if(lock?.status==='running'){
  const active=(await reconciliationJobRef(db,lock.jobId).get()).data();
  if(active)return reconciliationStatus(db,active);
 }
 const summary=(await db.doc('_insightsState/reconciliationSummary').get()).data();if(!summary?.jobId)return null;
 const job=(await reconciliationJobRef(db,summary.jobId).get()).data();return job?reconciliationStatus(db,job):null;
}
async function handle(req,res,{db,getAuth,origins}){
 try{
 const tokenMatch=/^Bearer (.+)$/.exec(req.get('Authorization')||'');if(!tokenMatch)fail(401,'Sign in to open Insights.');
 let token;try{token=await getAuth().verifyIdToken(tokenMatch[1],true);}catch{fail(401,'Sign in again.');}
 const path=req.path.replace(/^\/api\/form-insights/,'').replace(/\/$/,'')||'/';
 const actor=await resolveAdmin(db,token.uid,token,['/respondent','/respondent-scan'].includes(path)?'form-insights-people':path==='/programme-options'?null:'form-insights');if(!actor)fail(403,'The required Form Insights access is not assigned.');
 const audit=async(action,details={})=>db.collection('auditLog').add({module:'form-insights',entityType:'registration-insights',action,userId:actor.uid,userEmail:actor.email,timestamp:new Date().toISOString(),...details});
 if(req.method!=='GET'&&(!origins.has(req.get('Origin'))||!req.is('application/json')))fail(403,'Use the MWA website.');
 if(path==='/programme-options'&&req.method==='GET'){
  if(!actor.modules.includes('form-insights')&&!actor.modules.includes('form-insights-people'))fail(403,'Insights access is required.');
  const categories=await require('./insights-programmes').catalog(db);
  const current=await resolveAdmin(db,token.uid,token);
  if(!current||(!current.modules.includes('form-insights')&&!current.modules.includes('form-insights-people')))fail(403,'Insights access changed.');
  return res.json({categories});
 }
 if(path==='/programmes'){
  if(!isOwner(actor.email))fail(403,'Only Super Admin can review programme categories.');
  const programmes=require('./insights-programmes'),reviewer={...actor,provider:token.firebase?.sign_in_provider||''};
  if(req.method==='GET'){
   const result=req.query.eventId?await programmes.inspect(db,req.query.eventId):{categories:await programmes.catalog(db)};
   if(!await resolveAdmin(db,token.uid,token,'form-insights'))fail(403,'Super Admin access changed.');
   return res.json(result);
  }
  if(req.method==='POST'){
   if(req.body?.action==='create')return res.status(201).json(await programmes.createCategory(db,reviewer,req.body));
   if(req.body?.action==='review')return res.json(await programmes.review(db,reviewer,req.body));
   fail(400,'Choose a category review action.');
  }
  fail(405,'Method not allowed.');
 }
 if(path==='/events'&&req.method==='GET'){
  const {from,to}=req.query;const result=await listEventCoverage(db,from,to,calendarAccess(actor),req.query);result.reconciliation=await latestReconciliationStatus(db);await audit('insights.event_inventory_viewed',{from,to,count:result.events.length});return res.json(result);
 }
 if(path==='/events'&&req.method==='POST'){
  const enabled=process.env.MWA_INSIGHTS_MULTI_SNAPSHOT_ENABLED==='true'&&process.env.MWA_INSIGHTS_MULTI_CLEANUP_ENABLED==='true';
  if(req.body?.action==='inventory-status')return res.json({enabled});
  const method={'inventory-start':'start','inventory-step':'step','inventory-results':'results','inventory-cancel':'cancel'}[req.body?.action];
  if(!method)fail(400,'Choose an inventory action.');
  if(method==='start'&&!enabled)fail(503,'Temporary inventory snapshots are not enabled. Their cleanup must be configured before use.');
  const target=method==='cancel'?require('./insights-multi-snapshot'):require('./insights-inventory-snapshot'),result=await target[method](db,{...actor,provider:token.firebase?.sign_in_provider||''},req.body);
  const current=await resolveAdmin(db,token.uid,token,'form-insights');if(!current||calendarAccess(current)!==calendarAccess(actor))fail(403,'Insights or calendar access changed. Start again.');
  if(method==='results')result.reconciliation=await latestReconciliationStatus(db);
  if(method!=='step')await audit('insights.'+req.body.action,{count:result.events?.length||0});
  return res.json({...result,calendarAllowed:calendarAccess(current)});
 }
 if(path==='/analysis'&&req.method==='POST'){
  const enabled=process.env.MWA_INSIGHTS_MULTI_SNAPSHOT_ENABLED==='true'&&process.env.MWA_INSIGHTS_MULTI_CLEANUP_ENABLED==='true';
  if(['aggregate-status','answers-status'].includes(req.body?.action))return res.json({enabled});
  const action=req.body?.action,answerAction=typeof action==='string'&&action.startsWith('answers-');
  const method={'aggregate-start':'start','aggregate-step':'step','aggregate-results':'results','aggregate-cancel':'cancel','answers-start':'start','answers-step':'step','answers-results':'results','answers-cancel':'cancel'}[action];
  if(!method)fail(400,'Choose an aggregate analysis action.');
  if(method==='start'&&!enabled)fail(503,'Temporary aggregate snapshots are not enabled. Their cleanup must be configured before use.');
  const exporting=method==='results'&&req.body.export!==undefined&&req.body.export!=='';
  if(exporting&&!actor.modules.includes('form-insights-export'))fail(403,'Insights export requires a separate permission.');
  const target=method==='cancel'?require('./insights-multi-snapshot'):require(answerAction?'./insights-answer-snapshot':'./insights-aggregate-snapshot'),result=await target[method](db,{...actor,provider:token.firebase?.sign_in_provider||''},req.body);
  const current=await resolveAdmin(db,token.uid,token,'form-insights');
  if(!current||calendarAccess(current)!==calendarAccess(actor)||current.modules.includes('form-insights-people')!==actor.modules.includes('form-insights-people')||exporting&&!current.modules.includes('form-insights-export'))fail(403,'Insights, people, export or calendar access changed. Start again.');
  if(method==='results'&&!answerAction)result.reconciliation=await latestReconciliationStatus(db);
  if(method!=='step')await audit(exporting?(answerAction?'insights.answer_export_prepared':'insights.aggregate_export_prepared'):'insights.'+req.body.action,{count:answerAction?result.coverage?.indexed||0:result.totalMatching||0});
  return res.json({...result,calendarAllowed:calendarAccess(current)});
 }
 if(path==='/reconcile'&&req.method==='GET'){
  if(!isOwner(actor.email))fail(403,'Only Super Admin can inspect reconciliation jobs.');
  const jobId=req.query.jobId||'',job=jobId?(await reconciliationJobRef(db,jobId).get()).data():null;
  if(jobId&&!job)fail(404,'Reconciliation job not found.');
  return res.json(job?await reconciliationStatus(db,job):await latestReconciliationStatus(db));
 }
 if(path==='/reconcile'&&req.method==='POST'){
  if(!isOwner(actor.email))fail(403,'Only Super Admin can run a reconciliation scan.');
  const {action,jobId}=req.body||{};
  if(action==='start'){const result=await beginReconciliation(db,actor);await audit('insights.reconciliation_started',{jobId:result.jobId,formCount:result.formCount,scopeCutoff:result.scopeCutoff});return res.status(201).json(result);}
  if(action==='step'){const result=await stepReconciliation(db,jobId);await audit('insights.reconciliation_batch',{jobId:result.jobId,status:result.status,phase:result.phase,counts:result.counts});return res.json(result);}
  fail(400,'Choose start or step for the reconciliation job.');
 }
 if(path==='/mapping'){
  if(!isOwner(actor.email))fail(403,'Only Super Admin can review historical question mappings.');
  const mapping=require('./insights-mapping');
  if(req.method==='GET')return res.json(await mapping.scanStatus(db,actor,req.query.jobId,req.query.after||''));
  if(req.method==='POST'){
   const {action,jobId}=req.body||{};
   if(action==='scan-start')return res.status(201).json(await mapping.startScan(db,actor,req.body));
   if(action==='scan-step')return res.json(await mapping.stepScan(db,actor,jobId));
   if(action==='scan-cancel')return res.json(await mapping.cancelScan(db,actor,jobId));
   return res.json({mapping:await mapping.write(db,actor,req.body)});
  }
  fail(405,'Method not allowed.');
 }
 if(path==='/respondent'){
  if(req.method!=='POST')fail(405,'Method not allowed.');
  const respondents=require('./insights-respondent');
  const checkReviewAccess=async()=>{if(!await resolveAdmin(db,token.uid,token,'form-insights-people'))fail(403,'Respondent review access changed.');};
  if(req.body?.action==='access-check'){const current=await resolveAdmin(db,token.uid,token,'form-insights-people');if(!current)fail(403,'Respondent review access changed.');return res.json({ok:true,calendarAllowed:calendarAccess(current)});}
  const multiEnabled=process.env.MWA_INSIGHTS_MULTI_SNAPSHOT_ENABLED==='true'&&process.env.MWA_INSIGHTS_MULTI_CLEANUP_ENABLED==='true';
  if(req.body?.action==='multi-status')return res.json({enabled:multiEnabled});
  if(['multi-start','multi-step','multi-results','multi-cancel'].includes(req.body?.action)){
   if(req.body.action==='multi-start'&&!multiEnabled)fail(503,'Temporary comparison snapshots are not enabled. Their cleanup must be configured before use.');
   const snapshot=require('./insights-multi-snapshot'),method={'multi-start':'start','multi-step':'step','multi-results':'results','multi-cancel':'cancel'}[req.body.action];
   const result=await snapshot[method](db,{...actor,provider:token.firebase?.sign_in_provider||''},req.body);
   const current=await resolveAdmin(db,token.uid,token,'form-insights-people');
   if(!current||calendarAccess(current)!==calendarAccess(actor))fail(403,'Respondent or calendar access changed. Start again.');
   if(method!=='step')await audit('insights.respondent_'+req.body.action,{count:result.items?.length||0});
   return res.json({...result,calendarAllowed:calendarAccess(current)});
  }
  if(['cohort-start','cohort-step','cohort-results','cohort-cancel'].includes(req.body?.action)){
   if(req.body.action==='cohort-start'&&!multiEnabled)fail(503,'Temporary cohort snapshots are not enabled. Their cleanup must be configured before use.');
   const exporting=req.body.action==='cohort-results'&&req.body.export!==undefined&&req.body.export!=='';
   if(exporting&&!actor.modules.includes('form-insights-export'))fail(403,'Insights export requires a separate permission.');
   const snapshot=require('./insights-cohort-snapshot'),method={'cohort-start':'start','cohort-step':'step','cohort-results':'results','cohort-cancel':'cancel'}[req.body.action];
   const target=method==='cancel'?require('./insights-multi-snapshot'):snapshot;
   const result=await target[method](db,{...actor,provider:token.firebase?.sign_in_provider||''},req.body);
   const current=await resolveAdmin(db,token.uid,token,'form-insights-people');
   if(!current||calendarAccess(current)!==calendarAccess(actor)||exporting&&!current.modules.includes('form-insights-export'))fail(403,'Respondent, export or calendar access changed. Start again.');
   if(method!=='step')await audit(exporting?'insights.cohort_export_prepared':'insights.respondent_'+req.body.action,{count:result.items?.length||0});
   return res.json({...result,calendarAllowed:calendarAccess(current)});
  }
  if(['timeline-start','timeline-step','timeline-results','timeline-cancel'].includes(req.body?.action)){
   if(req.body.action==='timeline-start'&&!multiEnabled)fail(503,'Temporary timeline snapshots are not enabled. Their cleanup must be configured before use.');
   const snapshot=require('./insights-timeline-snapshot'),method={'timeline-start':'start','timeline-step':'step','timeline-results':'results','timeline-cancel':'cancel'}[req.body.action],target=method==='cancel'?require('./insights-multi-snapshot'):snapshot;
   const result=await target[method](db,{...actor,provider:token.firebase?.sign_in_provider||''},req.body);
   const current=await resolveAdmin(db,token.uid,token,'form-insights-people');
   if(!current||calendarAccess(current)!==calendarAccess(actor))fail(403,'Respondent or calendar access changed. Start again.');
   if(method!=='step')await audit('insights.respondent_'+req.body.action,{count:result.items?.length||0});
   return res.json({...result,calendarAllowed:calendarAccess(current)});
  }
  if(['lookup-start','lookup-step','lookup-results','lookup-cancel'].includes(req.body?.action)){
   if(req.body.action==='lookup-start'&&!multiEnabled)fail(503,'Temporary search snapshots are not enabled. Their cleanup must be configured before use.');
   const snapshot=require('./insights-lookup-snapshot'),method={'lookup-start':'start','lookup-step':'step','lookup-results':'results','lookup-cancel':'cancel'}[req.body.action],target=method==='cancel'?require('./insights-multi-snapshot'):snapshot;
   const result=await target[method](db,{...actor,provider:token.firebase?.sign_in_provider||''},req.body);
   const current=await resolveAdmin(db,token.uid,token,'form-insights-people');
   if(!current||calendarAccess(current)!==calendarAccess(actor))fail(403,'Respondent or calendar access changed. Start again.');
   if(method!=='step')await audit('insights.respondent_'+req.body.action,{count:result.items?.length||0});
   return res.json({...result,calendarAllowed:calendarAccess(current)});
  }
  if(['lookup','cohorts','cohortMatrix'].includes(req.body?.action)){
   const exporting=req.body?.export===undefined?'':req.body.export;
   if(typeof exporting!=='string')fail(400,'Choose a valid aggregate export.');
   if(exporting&&(!['xlsx','pdf'].includes(exporting)||req.body.action!=='cohortMatrix'||req.body.cohortYear||req.body.returnYear||req.body.cursor))fail(400,'Choose an aggregate cohort export without a selected person page.');
   if(exporting&&!actor.modules.includes('form-insights-export'))fail(403,'Insights export requires a separate permission.');
   const reports=require('./insights-respondent-lookup'),result=await reports[req.body.action](db,req.body,calendarAccess(actor));
   const current=await resolveAdmin(db,token.uid,token,'form-insights-people');
   if(!current||calendarAccess(current)!==calendarAccess(actor)||exporting&&!current.modules.includes('form-insights-export'))fail(403,'Respondent, export or calendar access changed. Run the report again.');
   await audit(exporting?'insights.cohort_export_prepared':'insights.respondent_'+req.body.action,{count:result.items.length});
   return res.json({...result,calendarAllowed:calendarAccess(current)});
  }
  if(['timeline','compare','event-choices'].includes(req.body?.action)){
   const reports=require('./insights-respondent-reports'),handler=req.body.action==='event-choices'?reports.eventChoices:reports[req.body.action],result=await handler(db,req.body,calendarAccess(actor));
   const current=await resolveAdmin(db,token.uid,token,'form-insights-people');
   if(!current||calendarAccess(current)!==calendarAccess(actor))fail(403,'Respondent or calendar access changed. Run the report again.');
   await audit('insights.respondent_'+req.body.action,{count:(result.items||result.events).length});
   return res.json({...result,calendarAllowed:calendarAccess(current)});
  }
  if(req.body?.action==='inspect'){const result=await respondents.inspect(db,actor,req.body);await checkReviewAccess();await audit('insights.respondent_inspected',{formId:result.source.formId,responseId:result.source.responseId});return res.json(result);}
  if(req.body?.action==='history'){const result=await respondents.history(db,req.body);await checkReviewAccess();await audit('insights.respondent_history_viewed',{personId:result.personId,count:result.items.length});return res.json(result);}
  if(req.body?.action==='merge-preview'){const result=await respondents.mergePreview(db,req.body);await checkReviewAccess();await audit('insights.respondent_merge_previewed',{sourceId:result.sourceId,targetId:result.targetId,sourceCount:result.sourceCount,targetCount:result.targetCount});return res.json(result);}
  if(req.body?.action==='merge-confirm')return res.json(await respondents.mergeConfirm(db,{...actor,provider:token.firebase?.sign_in_provider||''},req.body));
  if(req.body?.action==='merge-undo')return res.json(await respondents.mergeUndo(db,{...actor,provider:token.firebase?.sign_in_provider||''},req.body));
  return res.json(await respondents.change(db,{...actor,provider:token.firebase?.sign_in_provider||''},req.body));
 }
 if(path==='/respondent-scan'&&req.method==='POST'){
  const mapping=require('./insights-mapping'),{action,jobId}=req.body||{};
  if(action==='start')return res.status(201).json(await mapping.startScan(db,actor,{...req.body,mode:'inspect'}));
  if(action==='step')return res.json(await mapping.stepScan(db,actor,jobId));
  if(action==='cancel')return res.json(await mapping.cancelScan(db,actor,jobId));
  fail(400,'Choose start, step or cancel.');
 }
 if(path==='/authorize-export'&&req.method==='POST'){if(!actor.modules.includes('form-insights-export'))fail(403,'Insights export permission is no longer active.');return res.json({ok:true});}
 if(path==='/answers-access'&&req.method==='POST')return res.json({ok:true,calendarAllowed:calendarAccess(actor),peopleAllowed:actor.modules.includes('form-insights-people')});
 if(path==='/backfill'&&req.method==='POST'){
  if(!isOwner(actor.email))fail(403,'Only Super Admin can rebuild historical indexes.');
  const {formId,after='',dryRun=true}=req.body||{};if(!/^[a-f0-9-]{36}$/.test(formId||'')||!/^[a-f0-9]{0,64}$/.test(after)||typeof dryRun!=='boolean')fail(400,'Choose a valid form and cursor.');
  let q=db.collection('registrationForms/'+formId+'/responses').orderBy('__name__');if(after)q=q.startAfter(after);const snap=await q.limit(51).get(),docs=snap.docs.slice(0,50);
  if(!dryRun&&(await db.doc('_insightsState/config').get()).data()?.enabled!==true)fail(409,'Insights indexing is disabled until the retention and historical-use policy is approved.');
  if(!dryRun)for(const doc of docs)await indexResponse(db,formId,doc.id);
  await audit(dryRun?'insights.backfill_preview':'insights.backfill_batch',{formId,count:docs.length});
  return res.json({count:docs.length,next:snap.size>50?docs.at(-1).id:null,dryRun});
 }
 if(!['/','/answers'].includes(path)||req.method!=='GET')fail(404,'Insights endpoint not found.');
 const {basis='submission',search='',eventId='',formId='',export:exporting=''}=req.query;
 const programme=require('./insights-programmes'),dimensionFilters=programme.filters(req.query),dimensionActive=programme.active(dimensionFilters);
 const range=reportDateRange(req.query),{from,to}=range;
 if(!['submission','event'].includes(basis)||typeof search!=='string'||search.length>200)fail(400,'Choose a reporting period of up to ten years.');
 if(typeof eventId!=='string'||(eventId&&!/^[A-Za-z0-9_-]{1,128}$/.test(eventId)))fail(400,'Choose a valid event reference.');
 if(typeof formId!=='string'||formId.length>128)fail(400,'Choose a valid form reference.');
 if(exporting&&!['xlsx','pdf'].includes(exporting))fail(400,'Choose a supported export format.');
 if(search&&!actor.modules.includes('form-insights-people'))fail(403,'Person search requires a separate permission.');
 if(exporting&&!actor.modules.includes('form-insights-export'))fail(403,'Insights export requires a separate permission.');
 if(eventId&&!calendarAccess(actor)&&!(await eventDetails(db,[eventId],false)).has(eventId))fail(403,'That event is not available with your current access.');
 const cursor=decodePageCursor(req.query.cursor||''),pageSizeRaw=req.query.pageSize||'50',pageSize=Number(pageSizeRaw);
 if(!/^\d{1,3}$/.test(String(pageSizeRaw))||!Number.isInteger(pageSize)||pageSize<1||pageSize>100)fail(400,'Choose a page size from 1 to 100.');
 if(exporting&&cursor)fail(400,'Exports use the complete selected filter, not a single page. Run the export again without a page cursor.');
 const scope=createHash('sha256').update(JSON.stringify({from,to,basis,eventId,formId,search:normalize(search),dimensionFilters})).digest('hex');
 if(cursor&&cursor.s!==scope)fail(409,'Report filters changed while you were paging. Run the report again for a consistent result.');
 const coverageSnapshot=await db.doc('_insightsState/coverage').get(),sourceVersion=String(coverageSnapshot.data()?.updatedAt||'');
 let calendar,rows;
 if(basis==='event'){
  calendar=await calendarRange(db,range);
  const accessible=calendar.filter(doc=>Number.isFinite(Date.parse(doc.data().startAt))&&projectEvent(doc.data(),doc.id,calendarAccess(actor))&&(!eventId||doc.id===eventId));
  rows=await eventDateRows(db,accessible);
 }else{
  const snap=await db.collection('_registrationInsights').where('submittedAt','>=',range.fromTimestamp).where('submittedAt','<',range.toTimestamp).orderBy('submittedAt').orderBy('__name__').limit(5001).get();
  if(snap.size>5000)fail(422,'More than 5,000 indexed responses match this date window. Narrow the dates; no partial report has been returned.');
  rows=snap.docs.map(d=>({...d.data(),id:d.id,reportAt:d.data().submittedAt}));
  calendar=await calendarDocuments(db,rows.map(row=>row.eventId));
 }
 const accessible=docs=>docs.filter(doc=>doc.exists&&projectEvent(doc.data(),doc.id,calendarAccess(actor)));
 const dimensions=dimensionActive?await programme.dimensions(db,accessible(calendar)):null;
 rows=rows.filter(r=>{
  if((eventId&&r.eventId!==eventId)||(formId&&r.formId!==formId)||(search&&!r.search.includes(normalize(search))))return false;
  if(!dimensions)return true;
  const value=r.eventId?dimensions.map.get(r.eventId):{categories:[],bookingType:'',series:''};
  return !!value&&programme.matches(value,dimensionFilters);
 });
 if(path==='/answers'){
  if(cursor)fail(400,'Answer analysis uses the complete selected filter, not a page.');
  const visibleEvents=new Map(calendar.map(doc=>projectEvent(doc.exists?doc.data():null,doc.id,calendarAccess(actor))).filter(Boolean).map(event=>[event.id,event]));
  const analysis=await require('./insights-answer-analysis').analyse(db,rows,req.query.concept,visibleEvents,calendarAccess(actor),req.query.concept2||'');
  const calendarAfter=basis==='event'?await calendarRange(db,range):await calendarDocuments(db,calendar.map(doc=>doc.id));
  if(calendarFingerprint(calendar)!==calendarFingerprint(calendarAfter)||(dimensions&&(await programme.dimensions(db,accessible(calendarAfter))).fingerprint!==dimensions.fingerprint)||String((await db.doc('_insightsState/coverage').get()).data()?.updatedAt||'')!==sourceVersion)fail(409,'Insights, programme review or calendar data changed. Run analysis again.');
  const current=await resolveAdmin(db,token.uid,token,'form-insights');
  if(!current||calendarAccess(current)!==calendarAccess(actor)||search&&!current.modules.includes('form-insights-people')||exporting&&!current.modules.includes('form-insights-export'))fail(403,'Insights access changed. Run analysis again.');
  await audit(exporting?'insights.answer_export_prepared':'insights.answer_analysis_viewed',{basis,from,to,count:rows.length});
  const fingerprint=createHash('sha256').update(JSON.stringify([scope,analysis.concept,analysis.concept2||'',analysis.fingerprint,sourceVersion,calendarFingerprint(calendar),dimensions?.fingerprint||''])).digest('hex');
  return res.json({...analysis,fingerprint,filters:{from,to,basis,formId,eventFiltered:!!eventId,searchUsed:!!search,...dimensionFilters},generatedAt:new Date().toISOString(),calendarAllowed:calendarAccess(current)});
 }
 const calendarAfter=basis==='event'?await calendarRange(db,range):await calendarDocuments(db,calendar.map(doc=>doc.id));
 if(calendarFingerprint(calendar)!==calendarFingerprint(calendarAfter))fail(409,'Calendar events changed while preparing this report. Run it again.');
 if(dimensions&&(await programme.dimensions(db,accessible(calendarAfter))).fingerprint!==dimensions.fingerprint)fail(409,'Programme reviews changed while preparing this report. Run it again.');
 const coverageVersion=createHash('sha256').update(JSON.stringify([sourceVersion,calendarFingerprint(calendar),dimensions?.fingerprint||''])).digest('hex');
 if(cursor&&cursor.v!==coverageVersion)fail(409,'Insights data or calendar events changed while you were paging. Run the report again for a consistent result.');
 const afterCoverage=await db.doc('_insightsState/coverage').get();
 if(String(afterCoverage.data()?.updatedAt||'')!==sourceVersion)fail(409,'Insights data changed while preparing this report. Run it again.');
 const liveActor=await resolveAdmin(db,token.uid,token,'form-insights');
 if(!liveActor||calendarAccess(liveActor)!==calendarAccess(actor)||liveActor.modules.includes('form-insights-people')!==actor.modules.includes('form-insights-people')||(exporting&&!liveActor.modules.includes('form-insights-export')))fail(403,'Insights access changed. Run the report again.');
 let start=0;
 if(cursor){
  const found=rows.findIndex(row=>row.id===cursor.id&&row.reportAt===cursor.t);
  if(found<0)fail(409,'Insights data changed while you were paging. Run the report again for a consistent result.');
  start=found+1;
 }
 const pageRows=rows.slice(start,start+pageSize),hasNext=start+pageRows.length<rows.length,nextCursor=hasNext?encodePageCursor(pageRows.at(-1),coverageVersion,scope):null;
 await audit(exporting?'insights.export_prepared':search?'insights.person_search':'insights.report_viewed',{basis,from,to,count:rows.length,searchUsed:!!search});
 const visibleEvents=new Map(calendar.map(doc=>projectEvent(doc.exists?doc.data():null,doc.id,calendarAccess(actor))).filter(Boolean).map(event=>[event.id,event])),summary=summarize(rows);
 summary.eventRows=summary.eventRows.filter(row=>visibleEvents.has(row.id)).map(row=>({...visibleEvents.get(row.id),count:row.count}));
 summary.events=summary.eventRows.length;
 const candidates=search?rows.slice(0,100).map(r=>({formId:r.formId,responseId:r.responseId,reference:r.reference,formTitle:r.formTitle,eventTitle:visibleEvents.get(r.eventId)?.title||'',submittedAt:r.submittedAt})):[]; 
 const items=actor.modules.includes('form-insights-people')?pageRows.map(r=>({reference:r.reference,formTitle:r.formTitle,eventTitle:visibleEvents.get(r.eventId)?.title||'',eventId:calendarAccess(actor)?r.eventId:'',submittedAt:r.submittedAt})):[];
 return res.json({...summary,generatedAt:new Date().toISOString(),filters:{from,to,dateMode:range.dateMode,basis,eventId,formId,searchUsed:!!search,...dimensionFilters},coverage:coverageSummary(),reconciliation:await latestReconciliationStatus(db),candidates,candidateLimit:search&&rows.length>100,items,drilldownAvailable:actor.modules.includes('form-insights-people'),pageSize,nextCursor,totalMatching:rows.length,coverageVersion,calendarVersion:basis==='event'?calendarFingerprint(calendar):null,definitions:'Submissions are not attendance or unique people. Search finds candidate answers, not verified identities. No people are automatically merged. Counts cover indexed records only, which may lag source corrections; unindexed history and zero-response events are not included. Event-date reports use current calendar dates, not dates at submission or historical dates. Responses without an accessible event with a current date are excluded. Inventory uses current dates and excludes events without a current date. Calendar changes are not checked by source/index reconciliation. Private calendar details require Events & Bookings access.'});
 }catch(e){return res.status(e.status||503).json({error:e.status?e.message:'Insights are temporarily unavailable.'});}
}
module.exports={handle,indexResponse,summarize,normalize,projectEvent,eventCoverageRows,coverageSummary,eventDateRange,reportDateRange,encodePageCursor,decodePageCursor,listEventCoverage,safeResponseRecord,sameIndexSource,beginReconciliation,stepReconciliation,reconciliationStatus,eventDateRows};
