const {randomUUID,randomBytes,createHash,timingSafeEqual}=require('node:crypto');
const {FieldPath}=require('firebase-admin/firestore');
const Snapshot=require('./insights-multi-snapshot'),Ledger=require('./insights-snapshot-ledger'),IndexSnapshot=require('./insights-index-snapshot');
const Insights=require('./form-insights'),Programme=require('./insights-programmes'),Calendar=require('./insights-calendar-snapshot');

const GROUP=30,MAX_JOB_BYTES=700000;
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const hash=value=>createHash('sha256').update(value).digest('hex');
const stamp=Snapshot.stamp;
const calendarQuery=(db,range)=>Calendar.query(db,range.fromTimestamp,range.toTimestamp);
const day=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Sydney',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
const digest=(salt,value)=>hash(salt+'\0'+value);
function searchFor(job,input){
 if(typeof input.search!=='string'||input.search.length>200)fail(400,'Choose a valid candidate search.');
 const search=Insights.normalize(input.search),actual=Buffer.from(digest(job.salt,search),'hex'),expected=Buffer.from(job.searchHash,'hex');
 if(actual.length!==expected.length||!timingSafeEqual(actual,expected))fail(409,'Search changed. Start again.');
 return search;
}
async function validateCalendar(tx,db,ref,job){
 if(job.basis==='event'){
  const current=await tx.get(calendarQuery(db,job.range).select().limit(Calendar.MAX_EVENTS+1));
  if(current.size!==job.calendarCount||Calendar.fingerprint(current.docs.map(Calendar.entry))!==job.calendarVersion)fail(409,'Calendar events changed. Start again.');
 }
 await Ledger.validate(tx,db,ref,job.ledgerCount);
}
async function start(db,actor,input,{type='aggregate'}={}){
 if(!['aggregate','answers'].includes(type))fail(400,'Choose a valid analysis type.');
 const {basis='submission',search='',eventId='',formId=''}=input||{},range=Insights.reportDateRange(input),filters={...Programme.filters(input),eventId,formId};
 if(type==='answers')require('./insights-answer-analysis').validateConcepts(input.concept,input.concept2||'');
 if(!['submission','event'].includes(basis)||typeof search!=='string'||search.length>200||typeof eventId!=='string'||eventId&&!/^[A-Za-z0-9_-]{1,128}$/.test(eventId)||typeof formId!=='string'||formId.length>128)fail(400,'Choose valid report filters.');
 if(search&&!actor.modules.includes('form-insights-people'))fail(403,'Person search requires a separate permission.');
 if(eventId&&!actor.modules.includes('events-bookings')){
  const event=await db.doc('events/'+eventId).get();if(!event.exists||!Insights.projectEvent(event.data(),event.id,false))fail(403,'That event is not available with your current access.');
 }
 const jobId=randomUUID(),ref=Snapshot.ref(db,jobId),salt=randomBytes(32).toString('hex'),versionRefs=[...Snapshot.versions(db),db.doc('_insightsState/coverage')];
 const job={type,uid:actor.uid,email:actor.email,calendarAccess:actor.modules.includes('events-bookings'),peopleAccess:actor.modules.includes('form-insights-people'),basis,range,history:{start:range.fromTimestamp,end:range.toTimestamp},filters,salt,searchHash:digest(salt,Insights.normalize(search)),searchUsed:!!search,versions:Snapshot.expected(await db.getAll(...versionRefs)),calendarLedger:{},ledgerCount:0,calendarCount:0,calendarEntries:[],calendarCursor:null,calendarVersion:null,eventIds:[],position:0,cursor:null,status:'running',phase:basis==='event'?'calendar':'scan',step:0,scanned:0,submissions:0,forms:0,identified:0,days:{},events:{},createdAt:new Date(),expiresAt:new Date(Date.now()+Snapshot.TTL_MS)};
 if(type==='answers')Object.assign(job,{concept:input.concept,concept2:input.concept2||'',answerAccumulator:JSON.stringify(require('./insights-answer-analysis').emptyAccumulator())});
 await db.runTransaction(async tx=>{
  await Snapshot.validate(tx,db,actor,job);
  tx.create(ref,job);
 });
 return {jobId,status:'running',step:0,scanned:0};
}
async function calendarStep(db,actor,input,job){
 const ref=Snapshot.ref(db,input.jobId);
 let query=calendarQuery(db,job.range);if(job.calendarCursor)query=query.startAfter(job.calendarCursor.startAt,job.calendarCursor.id);
 const page=await query.limit(101).get(),events=page.docs.slice(0,100);
 let next;
 await db.runTransaction(async tx=>{
  const live=(await tx.get(ref)).data();Snapshot.ensure(live,actor);
  if(live.type!==job.type||live.phase!=='calendar'||live.step!==input.step)fail(409,'Analysis progress changed. Start again.');
  searchFor(live,input);await Snapshot.validate(tx,db,actor,live);
  const current=events.length?await tx.getAll(...events.map(doc=>doc.ref)):[];
  if(current.some((doc,i)=>stamp(doc)!==stamp(events[i])))fail(409,'Calendar events changed. Start again.');
  const calendarEntries=[...live.calendarEntries,...events.map(Calendar.entry)];
  const eventIds=[...live.eventIds,...events.filter(doc=>Number.isFinite(Date.parse(doc.data().startAt))&&Insights.projectEvent(doc.data(),doc.id,live.calendarAccess)&&(!live.filters.eventId||doc.id===live.filters.eventId)).map(doc=>doc.id)];
  Calendar.checkCapacity(calendarEntries,eventIds);
  const more=page.size>events.length,last=events.at(-1);
  next={phase:more?'calendar':eventIds.length?'scan':'validate',calendarCursor:more?{startAt:last.data().startAt,id:last.id}:null,calendarEntries,calendarCount:calendarEntries.length,eventIds,calendarVersion:more?null:Calendar.fingerprint(calendarEntries),step:live.step+1};
  tx.update(ref,next);
 });
 return {jobId:input.jobId,status:'running',step:next.step,scanned:job.scanned};
}
async function step(db,actor,input){
 Snapshot.checkId(input.jobId);if(!Number.isSafeInteger(input.step)||input.step<0)fail(400,'Choose a valid analysis step.');
 const ref=Snapshot.ref(db,input.jobId),job=(await ref.get()).data();Snapshot.ensure(job,actor);
 if(job.type!=='aggregate'||job.status!=='running'||job.step!==input.step)fail(409,'Analysis progress changed. Start again.');
 const search=searchFor(job,input);
 if(job.phase==='calendar')return calendarStep(db,actor,input,job);
 if(job.phase==='validate'){
  await db.runTransaction(async tx=>{
   const live=(await tx.get(ref)).data();Snapshot.ensure(live,actor);
   if(live.type!=='aggregate'||live.phase!=='validate'||live.step!==input.step)fail(409,'Analysis progress changed. Start again.');
   searchFor(live,input);await Snapshot.validate(tx,db,actor,live);await validateCalendar(tx,db,ref,live);
   tx.update(ref,{status:'complete',phase:'complete',step:live.step+1,completedAt:new Date()});
  });
  return {jobId:input.jobId,status:'complete',step:input.step+1,scanned:job.scanned};
 }
 const {page,indexes,docs,ledgerDocs,rows,dimensions}=await IndexSnapshot.scan(db,job,{includeIndexEvents:true}),identity=new Map(rows.map(row=>[row.index.id,row]));
 const selected=[],people=new Set(),forms=new Set();
 for(const index of indexes){
  const row=index.data(),event=typeof row.eventId==='string'?docs.get('events/'+row.eventId):null,visible=event&&Insights.projectEvent(event.exists?event.data():null,event.id,job.calendarAccess);
  if(job.filters.eventId&&row.eventId!==job.filters.eventId||job.filters.formId&&row.formId!==job.filters.formId||search&&!(typeof row.search==='string'&&row.search.includes(search)))continue;
  if(dimensions){const dimension=row.eventId?dimensions.map.get(row.eventId):{categories:[],bookingType:'',series:''};if(!dimension||!Programme.matches(dimension,job.filters))continue;}
  const reportAt=job.basis==='event'?event?.data()?.startAt:row.submittedAt;
  if(typeof reportAt!=='string'||reportAt.length>200||!Number.isFinite(Date.parse(reportAt)))fail(409,'An indexed response needs date reconciliation. No partial report is available.');
  const id='r_'+Buffer.from(reportAt).toString('hex')+'_'+index.id;
  const matched=identity.get(index.id);if(matched?.confirmed)people.add(matched.link.personId);
  forms.add(hash(String(row.formId)));
  const source=docs.get(`registrationForms/${row.formId}/responses/${row.responseId}`),link=docs.get('_respondentLinks/'+index.id),revision=source?.data()?.revision,mapping=Number.isSafeInteger(revision)?docs.get(`_insightsState/fieldMappings/forms/${row.formId}/revisions/${revision}`):null;
  selected.push({index,row,reportAt,visible,id,sample:Snapshot.expected([index,source,link,mapping,matched?.person].filter(Boolean))});
 }
 let next;
 await db.runTransaction(async tx=>{
  const live=(await tx.get(ref)).data();Snapshot.ensure(live,actor);
  if(live.type!=='aggregate'||live.phase!=='scan'||live.step!==input.step)fail(409,'Analysis progress changed. Start again.');
  searchFor(live,input);await Snapshot.validate(tx,db,actor,live);await IndexSnapshot.validateBatch(tx,live,docs);
  const prep=await Ledger.prepare(tx,ref,live.basis==='event'?ledgerDocs.filter(doc=>!doc.ref.path.startsWith('events/')):ledgerDocs,live.ledgerCount),formIds=[...forms],personIds=[...people],formDocs=formIds.length?await tx.getAll(...formIds.map(id=>ref.collection('members').doc('f_'+id))):[],personDocs=personIds.length?await tx.getAll(...personIds.map(id=>ref.collection('members').doc('p_'+id))):[];
  const days={...live.days},events={...live.events};
  for(const item of selected){
   const date=day(item.reportAt);days[date]=(days[date]||0)+1;
   if(item.visible){const old=events[item.visible.id]||{...item.visible,count:0};events[item.visible.id]={...old,count:old.count+1};}
  }
  const more=page.size>indexes.length,last=indexes.at(-1),position=job.basis==='event'&&!more?live.position+GROUP:live.position;
  const finished=job.basis==='event'?position>=live.eventIds.length:!more;
  const cursor=more?(job.basis==='event'?last.id:{submittedAt:last.data().submittedAt,id:last.id}):null;
  next={phase:finished?'validate':'scan',position,cursor,step:live.step+1,scanned:live.scanned+indexes.length,submissions:live.submissions+selected.length,forms:live.forms+formDocs.filter(doc=>!doc.exists).length,identified:live.identified+personDocs.filter(doc=>!doc.exists).length,days,events,ledgerCount:prep.count};
  if(Buffer.byteLength(JSON.stringify(next),'utf8')>MAX_JOB_BYTES)fail(422,'This aggregate has too many distinct dates or events. Narrow the scope; no partial report is available.');
  for(const doc of formDocs)if(!doc.exists)tx.create(doc.ref,{kind:'form'});
  for(const doc of personDocs)if(!doc.exists)tx.create(doc.ref,{kind:'person'});
  if(live.peopleAccess)for(const item of selected){
   const {row,visible,id}=item;
   tx.create(ref.collection('members').doc(id),{kind:'response',sample:item.sample,item:{reference:row.reference||'',formTitle:row.formTitle||'',eventTitle:visible?.title||'',eventId:live.calendarAccess?row.eventId||'':'',submittedAt:row.submittedAt},candidate:{formId:row.formId,responseId:row.responseId,reference:row.reference||'',formTitle:row.formTitle||'',eventTitle:visible?.title||'',submittedAt:row.submittedAt}});
  }
  prep.write();tx.update(ref,next);
 });
 return {jobId:input.jobId,status:'running',step:next.step,scanned:next.scanned};
}
async function results(db,actor,input){
 Snapshot.checkId(input.jobId);const ref=Snapshot.ref(db,input.jobId),job=(await ref.get()).data();Snapshot.ensure(job,actor);
 if(job.type!=='aggregate'||job.status!=='complete')fail(409,'Analysis is not complete.');
 const {cursor='',export:exporting=''}=input,pageSize=Number(input.pageSize||50);
 if(typeof cursor!=='string'||cursor&&!/^r_[a-f0-9]+_[a-f0-9]{64}$/.test(cursor)||!Number.isInteger(pageSize)||pageSize<1||pageSize>100||typeof exporting!=='string'||exporting&&!['xlsx','pdf'].includes(exporting)||exporting&&cursor)fail(400,'Choose a valid report page or aggregate export.');
 let page={docs:[],size:0},candidatePage={docs:[],size:0};
 if(job.peopleAccess){
  let query=ref.collection('members').where('kind','==','response').orderBy(FieldPath.documentId());if(cursor)query=query.startAfter(cursor);
  page=await query.limit(pageSize+1).get();if(job.searchUsed)candidatePage=await ref.collection('members').where('kind','==','response').orderBy(FieldPath.documentId()).limit(101).get();
 }else if(cursor)fail(403,'Response references require a separate permission.');
 const samples={};
 for(const member of [...page.docs.slice(0,pageSize),...candidatePage.docs.slice(0,100)])for(const [path,version] of Object.entries(member.data().sample||{})){
  if(Object.hasOwn(samples,path)&&samples[path]!==version)fail(409,'Response data changed. Start again.');
  samples[path]=version;
 }
 await db.runTransaction(async tx=>{
  const live=(await tx.get(ref)).data();Snapshot.ensure(live,actor);
  if(live.type!=='aggregate'||live.status!=='complete'||live.step!==job.step)fail(409,'Analysis changed. Start again.');
  await Snapshot.validate(tx,db,actor,live,{exporting:!!exporting});await validateCalendar(tx,db,ref,live);
  const pairs=Object.entries(samples);for(let offset=0;offset<pairs.length;offset+=200){const slice=pairs.slice(offset,offset+200),current=await tx.getAll(...slice.map(([path])=>db.doc(path)));if(current.some((doc,i)=>stamp(doc)!==slice[i][1]))fail(409,'Response data changed. Start again.');}
 });
 const days=Object.entries(job.days).sort().map(([date,count])=>({date,count})),months=new Map(),years=new Map();
 for(const {date,count} of days){const month=date.slice(0,7),year=date.slice(0,4);months.set(month,(months.get(month)||0)+count);years.set(year,(years.get(year)||0)+count);}
 const records=page.docs.slice(0,pageSize),eventRows=Object.values(job.events).sort((a,b)=>b.count-a.count);
 return {snapshot:true,submissions:job.submissions,forms:job.forms,events:eventRows.length,identified:job.identified,days,months:[...months].map(([month,count])=>({month,count})),years:[...years].map(([year,count])=>({year,count})),eventRows,generatedAt:job.completedAt.toDate().toISOString(),filters:{from:job.range.from,to:job.range.to,dateMode:job.range.dateMode,basis:job.basis,eventId:job.filters.eventId,formId:job.filters.formId,searchUsed:job.searchUsed,categories:job.filters.categories,bookingType:job.filters.bookingType,series:job.filters.series},coverage:Insights.coverageSummary(),candidates:candidatePage.docs.slice(0,100).map(doc=>doc.data().candidate),candidateLimit:candidatePage.size>100,items:records.map(doc=>doc.data().item),drilldownAvailable:job.peopleAccess,pageSize,nextCursor:page.size>pageSize?records.at(-1).id:null,totalMatching:job.submissions,coverageVersion:input.jobId+':'+job.step,calendarVersion:job.basis==='event'?job.calendarVersion:null,definitions:'Submissions are not attendance. Identified people are distinct current confirmed reviewed links in accessible history; unindexed, unmapped, stale or unresolved records are excluded. Search finds candidates, not verified identities. Counts cover indexed records only and may lag source corrections. Current event-date reports use current calendar dates, not dates at submission.'};
}
module.exports={start,step,results,searchFor,validateCalendar,calendarStep};
