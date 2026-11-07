const {randomUUID}=require('node:crypto');
const {FieldPath}=require('firebase-admin/firestore');
const Snapshot=require('./insights-multi-snapshot'),Ledger=require('./insights-snapshot-ledger'),Reports=require('./insights-respondent-reports');
const Insights=require('./form-insights'),Programme=require('./insights-programmes'),Calendar=require('./insights-calendar-snapshot');

const BATCH=100,GROUP=30,MAX_MEMBER_BYTES=500000;
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
function calendarQuery(db,range){return Calendar.query(db,range.from,range.to);}
async function validateCalendar(tx,db,ref,job){
 const current=await tx.get(calendarQuery(db,job.range).select().limit(Calendar.MAX_EVENTS+1));
 if(current.size!==job.calendarCount||Calendar.fingerprint(current.docs.map(Calendar.entry))!==Calendar.fingerprint(job.calendarEntries))fail(409,'Calendar events changed. Start again.');
 await Ledger.validate(tx,db,ref,job.ledgerCount);
 return Calendar.fingerprint(job.calendarEntries);
}
async function start(db,actor,input){
 const {from,to}=input||{},range=Insights.eventDateRange(from,to),filters=Programme.filters(input),jobId=randomUUID(),ref=Snapshot.ref(db,jobId);
 const job={type:'inventory',uid:actor.uid,email:actor.email,calendarAccess:actor.modules.includes('events-bookings'),from,to,range,filters,versions:Snapshot.expected(await db.getAll(...Snapshot.versions(db))),calendarLedger:{},ledgerCount:0,calendarCount:0,calendarEntries:[],status:'running',phase:'events',eventCursor:null,indexCursor:'',position:0,eventIds:[],scanned:0,step:0,createdAt:new Date(),expiresAt:new Date(Date.now()+Snapshot.TTL_MS)};
 await db.runTransaction(async tx=>{await Snapshot.validate(tx,db,actor,job);tx.create(ref,job);});
 return {jobId,status:'running',step:0,scanned:0};
}
async function step(db,actor,input){
 Snapshot.checkId(input.jobId);if(!Number.isSafeInteger(input.step)||input.step<0)fail(400,'Choose a valid analysis step.');
 const ref=Snapshot.ref(db,input.jobId),job=(await ref.get()).data();Snapshot.ensure(job,actor);
 if(job.type!=='inventory'||job.status!=='running'||job.step!==input.step)fail(409,'Inventory progress changed. Start again.');
 if(job.phase==='validate'){
  await db.runTransaction(async tx=>{
   const live=(await tx.get(ref)).data();Snapshot.ensure(live,actor);
   if(live.type!=='inventory'||live.phase!=='validate'||live.step!==input.step)fail(409,'Inventory progress changed. Start again.');
   await Snapshot.validate(tx,db,actor,live);const calendarVersion=await validateCalendar(tx,db,ref,live);
   tx.update(ref,{status:'complete',phase:'complete',calendarVersion,step:live.step+1,completedAt:new Date()});
  });
  return {jobId:input.jobId,status:'complete',step:input.step+1,scanned:job.scanned};
 }
 if(job.phase==='events'){
  let query=calendarQuery(db,job.range);if(job.eventCursor)query=query.startAfter(job.eventCursor.startAt,job.eventCursor.id);
  const page=await query.limit(BATCH+1).get(),events=page.docs.slice(0,BATCH),accessible=events.map(doc=>({doc,event:Insights.projectEvent(doc.data(),doc.id,job.calendarAccess)})).filter(item=>item.event);
  const calendarFilters={...job.filters,categories:[]};
  const candidates=accessible.filter(item=>Programme.matches(Programme.eventDimensions(item.doc),calendarFilters));
  const dimensions=job.filters.categories.length?await Programme.dimensions(db,candidates.map(item=>item.doc)):null;
  const visible=dimensions?candidates.filter(item=>Programme.matches(dimensions.map.get(item.doc.id),job.filters)):candidates;
  const counts=new Map();
  const checked=visible.slice(0,Math.max(0,100-job.eventIds.length));
  for(let offset=0;offset<checked.length;offset+=10)await Promise.all(checked.slice(offset,offset+10).map(async item=>{const count=await db.collectionGroup('responses').where('eventId','==',item.doc.id).count().get();counts.set(item.doc.id,count.data().count);}));
  let next;
  await db.runTransaction(async tx=>{
   const live=(await tx.get(ref)).data();Snapshot.ensure(live,actor);
   if(live.type!=='inventory'||live.phase!=='events'||live.step!==input.step)fail(409,'Inventory progress changed. Start again.');
   await Snapshot.validate(tx,db,actor,live);
   const evidence=[...events,...(dimensions?.documents||[])],current=evidence.length?await tx.getAll(...evidence.map(doc=>doc.ref)):[];
   if(current.some((doc,i)=>Snapshot.stamp(doc)!==Snapshot.stamp(evidence[i])))fail(409,'Calendar or programme reviews changed. Start again.');
   const prep=await Ledger.prepare(tx,ref,dimensions?.documents||[],live.ledgerCount),ids=[...live.eventIds,...visible.map(item=>item.doc.id)],calendarEntries=[...live.calendarEntries,...events.map(Calendar.entry)];
   Calendar.checkCapacity(calendarEntries,ids);
   const more=page.size>events.length,last=events.at(-1);
   next={phase:more?'events':ids.length?'index':'validate',eventCursor:more?{startAt:last.data().startAt,id:last.id}:null,eventIds:ids,calendarEntries,calendarCount:live.calendarCount+events.length,ledgerCount:prep.count,step:live.step+1};
   for(const {doc,event} of visible)tx.create(ref.collection('members').doc('e_'+doc.id),{event,indexedResponses:0,forms:[],sourceResponses:counts.has(doc.id)?counts.get(doc.id):null});
   prep.write();tx.update(ref,next);
  });
  return {jobId:input.jobId,status:'running',step:next.step,scanned:job.scanned};
 }
 if(job.phase!=='index')fail(409,'Inventory progress changed. Start again.');
 const ids=job.eventIds.slice(job.position,job.position+GROUP);
 let query=db.collection('_registrationInsights').where('eventId','in',ids).orderBy(FieldPath.documentId());if(job.indexCursor)query=query.startAfter(job.indexCursor);
 const page=await query.limit(BATCH+1).get(),indexes=page.docs.slice(0,BATCH);
 if(job.scanned+indexes.length>Snapshot.MAX_SCANNED)fail(422,`This inventory exceeds ${Snapshot.MAX_SCANNED} indexed records. Narrow the date range; no partial inventory is available.`);
 const groups=new Map();
 for(const index of indexes){
  const row=index.data();if(!validId(row.eventId)||!ids.includes(row.eventId))fail(409,'An indexed response needs reconciliation.');
  const group=groups.get(row.eventId)||{count:0,forms:new Set()};group.count++;if(typeof row.formId==='string'&&row.formId)group.forms.add(row.formId);groups.set(row.eventId,group);
 }
 let next;
 await db.runTransaction(async tx=>{
  const live=(await tx.get(ref)).data();Snapshot.ensure(live,actor);
  if(live.type!=='inventory'||live.phase!=='index'||live.step!==input.step)fail(409,'Inventory progress changed. Start again.');
  await Snapshot.validate(tx,db,actor,live);
  const current=indexes.length?await tx.getAll(...indexes.map(doc=>doc.ref)):[];if(current.some((doc,i)=>Snapshot.stamp(doc)!==Snapshot.stamp(indexes[i])))fail(409,'Indexed responses changed. Start again.');
  const eventIds=[...groups.keys()],members=eventIds.length?await tx.getAll(...eventIds.map(id=>ref.collection('members').doc('e_'+id))):[];
  for(let i=0;i<eventIds.length;i++){
   const old=members[i].data();if(!old)fail(409,'Inventory event changed. Start again.');
   const group=groups.get(eventIds[i]),forms=[...new Set([...old.forms,...group.forms])];
   if(Buffer.byteLength(JSON.stringify(forms),'utf8')>MAX_MEMBER_BYTES)fail(422,'An event has too many distinct forms for this inventory. Narrow the date range; no partial inventory is available.');
   tx.update(members[i].ref,{indexedResponses:old.indexedResponses+group.count,forms});
  }
  const more=page.size>indexes.length,position=more?live.position:live.position+GROUP;
  next={phase:position<live.eventIds.length?'index':'validate',position,indexCursor:more?indexes.at(-1).id:'',scanned:live.scanned+indexes.length,step:live.step+1};tx.update(ref,next);
 });
 return {jobId:input.jobId,status:'running',step:next.step,scanned:next.scanned};
}
async function results(db,actor,input){
 Snapshot.checkId(input.jobId);const ref=Snapshot.ref(db,input.jobId),job=(await ref.get()).data();Snapshot.ensure(job,actor);
 if(job.type!=='inventory'||job.status!=='complete')fail(409,'Inventory is not complete.');
 const members=await ref.collection('members').get();
 await db.runTransaction(async tx=>{
  const live=(await tx.get(ref)).data();Snapshot.ensure(live,actor);
  if(live.type!=='inventory'||live.status!=='complete'||live.step!==job.step)fail(409,'Inventory changed. Start again.');
  await Snapshot.validate(tx,db,actor,live);if(await validateCalendar(tx,db,ref,live)!==live.calendarVersion)fail(409,'Calendar events changed. Start again.');
 });
 const events=members.docs.map(doc=>{const row=doc.data(),sourceResponses=row.sourceResponses,indexedResponses=row.indexedResponses;return {...row.event,indexedResponses,indexedForms:row.forms.length,sourceResponses,reconciliationStatus:sourceResponses===null?'Not reconciled':sourceResponses===indexedResponses?'Counts match; history coverage incomplete':'Counts differ; coverage incomplete',coverageStatus:'incomplete'};}).sort((a,b)=>a.startAt.localeCompare(b.startAt)||a.id.localeCompare(b.id));
 return {events,filters:job.filters,calendarVersion:job.calendarVersion,generatedAt:job.completedAt.toDate().toISOString(),dateBasis:'Current calendar event start date, Australia/Sydney',coverage:Insights.coverageSummary(false,job.eventIds.length>100),analysisLimits:{indexed:Snapshot.MAX_SCANNED,calendar:Calendar.MAX_EVENTS,programme:Ledger.MAX_ENTRIES}};
}
module.exports={start,step,results};
