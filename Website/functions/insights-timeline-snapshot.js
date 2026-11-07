const {randomUUID}=require('node:crypto');
const {FieldPath}=require('firebase-admin/firestore');
const Snapshot=require('./insights-multi-snapshot'),Ledger=require('./insights-snapshot-ledger'),Reports=require('./insights-respondent-reports'),Programme=require('./insights-programmes');
const BATCH=100,PAGE=25;
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const validPerson=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value);
function memberId(data,link){
 const parsed=typeof data.createdAt==='string'?Date.parse(data.createdAt):NaN;
 const order=Number.isFinite(parsed)?(8640000000000000n-BigInt(parsed)).toString().padStart(17,'0'):'99999999999999999';
 return `${order}:${link.id}`;
}
async function start(db,actor,input){
 const {personId,formId='',eventId=''}=input||{};
 if(!validPerson(personId)||typeof formId!=='string'||formId&&!validId(formId)||typeof eventId!=='string'||eventId&&!validId(eventId))fail(400,'Choose a valid respondent, form and event.');
 const person=await db.doc('_respondents/'+personId).get();
 if(!person.exists)fail(404,'Respondent is unavailable.');
 if(person.data()?.mergedInto)fail(409,'This respondent was merged. Inspect a current linked response.');
 const id=randomUUID(),ref=Snapshot.ref(db,id),job={type:'timeline',uid:actor.uid,email:actor.email,personId,personVersion:Snapshot.stamp(person),formId,eventId,filters:Programme.filters(input),calendarAccess:actor.modules.includes('events-bookings'),versions:Snapshot.expected(await db.getAll(...Snapshot.versions(db))),calendarLedger:{},ledgerCount:0,status:'running',phase:'scan',cursor:'',step:0,scanned:0,confirmed:0,reviewRequired:0,inactive:0,createdAt:new Date(),expiresAt:new Date(Date.now()+Snapshot.TTL_MS)};
 await db.runTransaction(async tx=>{await Snapshot.validate(tx,db,actor,job);if(Snapshot.stamp(await tx.get(person.ref))!==job.personVersion)fail(409,'Respondent changed. Start again.');tx.create(ref,job);});
 return {jobId:id,status:'running',step:0,scanned:0};
}
async function step(db,actor,input){
 Snapshot.checkId(input.jobId);if(!Number.isSafeInteger(input.step)||input.step<0)fail(400,'Choose a valid analysis step.');
 const ref=Snapshot.ref(db,input.jobId),job=(await ref.get()).data();Snapshot.ensure(job,actor);
 if(job.type!=='timeline'||job.status!=='running'||job.step!==input.step)fail(409,'Analysis progress changed. Start again.');
 if(job.phase==='validate'){
  await db.runTransaction(async tx=>{const live=(await tx.get(ref)).data();Snapshot.ensure(live,actor);if(live.type!=='timeline'||live.phase!=='validate'||live.step!==input.step)fail(409,'Analysis progress changed.');await Snapshot.validate(tx,db,actor,live);if(Snapshot.stamp(await tx.get(db.doc('_respondents/'+live.personId)))!==live.personVersion)fail(409,'Respondent changed. Start again.');await Ledger.validate(tx,db,ref,live.ledgerCount);tx.update(ref,{status:'complete',phase:'complete',step:live.step+1});});
  return {jobId:input.jobId,status:'complete',step:input.step+1,scanned:job.scanned};
 }
 let query=db.collection('_respondentLinks').where('personId','==',job.personId).orderBy(FieldPath.documentId());if(job.cursor)query=query.startAfter(job.cursor);
 const page=await query.limit(BATCH+1).get(),links=page.docs.slice(0,BATCH),linked=links.filter(doc=>doc.data().status==='linked');
 if(job.scanned+links.length>Snapshot.MAX_SCANNED)fail(422,`This history exceeds ${Snapshot.MAX_SCANNED} links. No partial timeline is available.`);
 const refs=[];for(const doc of linked){if(!Reports.refValid(doc.data()))fail(409,'A respondent link is malformed and needs review.');refs.push(...Reports.sourceRefs(db,doc.data()));}
 const docs=await Reports.getDocuments(db,refs);for(const doc of links)docs.set(doc.ref.path,doc);
 const eventRefs=[];for(const doc of linked){const link=doc.data(),source=docs.get(`registrationForms/${link.formId}/responses/${link.responseId}`);if(source?.exists&&validId(source.data().eventId))eventRefs.push(db.doc('events/'+source.data().eventId));}
 for(const [path,doc] of await Reports.getDocuments(db,eventRefs))docs.set(path,doc);
 const eventDocs=[...docs.values()].filter(doc=>doc.ref.path.startsWith('events/')),visible=eventDocs.filter(doc=>doc.exists&&Reports.eventProjection(doc,job.calendarAccess));
 const dimensions=Programme.active(job.filters)?await Programme.dimensions(db,visible):null,ledgerDocs=[...eventDocs,...(dimensions?.documents||[])];
 for(const doc of ledgerDocs){if(docs.has(doc.ref.path)&&Snapshot.stamp(docs.get(doc.ref.path))!==Snapshot.stamp(doc))fail(409,'Calendar or programme reviews changed. Start again.');docs.set(doc.ref.path,doc);}
 const rows=[];
 for(const doc of linked){
  const link=doc.data(),source=docs.get(`registrationForms/${link.formId}/responses/${link.responseId}`),data=source?.data()||{};
  if(job.formId&&link.formId!==job.formId||job.eventId&&data.eventId!==job.eventId)continue;
  const event=validId(data.eventId)?Reports.eventProjection(docs.get('events/'+data.eventId),job.calendarAccess):null;
  const dimension=data.eventId?dimensions?.map.get(data.eventId):{categories:[],bookingType:'',series:''};
  if(dimensions&&(!dimension||!Programme.matches(dimension,job.filters)))continue;
  const item={formId:link.formId,responseId:link.responseId,revision:link.revision,status:Reports.currentLink(docs,link)?'confirmed':'review-required',reference:typeof data.reference==='string'?data.reference.slice(0,128):'',formTitle:(!data.eventId||event)&&typeof data.formTitle==='string'?data.formTitle.slice(0,200):'',submittedAt:typeof data.createdAt==='string'&&Number.isFinite(Date.parse(data.createdAt))?data.createdAt:null,event:event||{title:data.eventId?'Event unavailable or not accessible':'No saved event',date:null}};
  const sourcePath=`registrationForms/${link.formId}/responses/${link.responseId}`,mappingPath=`_insightsState/fieldMappings/forms/${link.formId}/revisions/${link.revision}`;
  rows.push({id:memberId(data,doc),item,versions:Snapshot.expected([doc,docs.get(sourcePath),docs.get(mappingPath)])});
 }
 let next;
 await db.runTransaction(async tx=>{
  const live=(await tx.get(ref)).data();Snapshot.ensure(live,actor);if(live.type!=='timeline'||live.phase!=='scan'||live.step!==input.step)fail(409,'Analysis progress changed. Start again.');
  await Snapshot.validate(tx,db,actor,live);if(Snapshot.stamp(await tx.get(db.doc('_respondents/'+live.personId)))!==live.personVersion)fail(409,'Respondent changed. Start again.');
  const all=[...docs.values()].filter(doc=>{if(Object.hasOwn(live.versions,doc.ref.path)){if(Snapshot.stamp(doc)!==live.versions[doc.ref.path])fail(409,'Source or identity changed.');return false;}return true;});
  for(let offset=0;offset<all.length;offset+=200){const slice=all.slice(offset,offset+200),current=await tx.getAll(...slice.map(doc=>doc.ref));if(current.some((doc,i)=>Snapshot.stamp(doc)!==Snapshot.stamp(slice[i])))fail(409,'Respondent or calendar data changed. Start again.');}
  const ledger=await Ledger.prepare(tx,ref,ledgerDocs,live.ledgerCount),more=page.size>BATCH;
  next={phase:more?'scan':'validate',cursor:more?links.at(-1).id:'',step:live.step+1,scanned:live.scanned+links.length,confirmed:live.confirmed+rows.filter(row=>row.item.status==='confirmed').length,reviewRequired:live.reviewRequired+rows.filter(row=>row.item.status==='review-required').length,inactive:live.inactive+links.length-linked.length,ledgerCount:ledger.count};
  for(const row of rows)tx.create(ref.collection('members').doc(row.id),{item:row.item,versions:row.versions});
  ledger.write();tx.update(ref,next);
 });
 return {jobId:input.jobId,status:'running',step:next.step,scanned:next.scanned};
}
async function results(db,actor,input){
 Snapshot.checkId(input.jobId);const ref=Snapshot.ref(db,input.jobId),job=(await ref.get()).data();Snapshot.ensure(job,actor);
 if(job.type!=='timeline'||job.status!=='complete')fail(409,'Analysis is not complete.');
 const cursor=input.cursor===undefined?'':input.cursor;if(typeof cursor!=='string'||cursor&&!/^\d{17}:[A-Za-z0-9_-]{1,128}$/.test(cursor))fail(400,'Choose a valid timeline page.');
 let query=ref.collection('members').orderBy(FieldPath.documentId());if(cursor)query=query.startAfter(cursor);
 const page=await query.limit(PAGE+1).get(),members=page.docs.slice(0,PAGE);
 await db.runTransaction(async tx=>{
  const live=(await tx.get(ref)).data();Snapshot.ensure(live,actor);if(live.type!=='timeline'||live.status!=='complete'||live.step!==job.step)fail(409,'Analysis changed. Start again.');await Snapshot.validate(tx,db,actor,live);if(Snapshot.stamp(await tx.get(db.doc('_respondents/'+live.personId)))!==live.personVersion)fail(409,'Respondent changed. Start again.');await Ledger.validate(tx,db,ref,live.ledgerCount);
  const expected={};for(const member of members)for(const [path,value] of Object.entries(member.data().versions||{})){if(Object.hasOwn(expected,path)&&expected[path]!==value)fail(409,'Respondent data changed. Start again.');expected[path]=value;}
  const pairs=Object.entries(expected);for(let offset=0;offset<pairs.length;offset+=200){const slice=pairs.slice(offset,offset+200),current=await tx.getAll(...slice.map(([path])=>db.doc(path)));if(current.some((doc,i)=>Snapshot.stamp(doc)!==slice[i][1]))fail(409,'Respondent data changed. Start again.');}
 });
 return {personId:job.personId,confirmed:job.confirmed,reviewRequired:job.reviewRequired,inactive:job.inactive,items:members.map(doc=>doc.data().item),next:page.size>PAGE?members.at(-1).id:null,notice:'Only current explicitly reviewed response links identify respondents. Indexed/source coverage is incomplete; candidates, stale, unlinked and unindexed responses are not identified people. Registrations are not attendance. Dates use the current calendar.'};
}
module.exports={start,step,results};
