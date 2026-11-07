const {randomUUID}=require('node:crypto');
const {FieldPath}=require('firebase-admin/firestore');
const Snapshot=require('./insights-multi-snapshot'),Ledger=require('./insights-snapshot-ledger'),Reports=require('./insights-respondent-reports');
const Programme=require('./insights-programmes'),Respondent=require('./insights-respondent'),IndexSnapshot=require('./insights-index-snapshot');
const {validDate,midnight}=require('./donation-records');

const PAGE=25;
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const validPerson=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value);
const sydneyYear=value=>new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Sydney',year:'numeric'}).format(new Date(value));
function dates(from,to){
 if(!validDate(from)||!validDate(to)||from>to||Date.parse(to)-Date.parse(from)>3660*86400000||to>='9999-12-31')fail(400,'Choose a valid Sydney date range of up to ten years.');
 const next=new Date(Date.parse(to+'T00:00:00Z')+86400000).toISOString().slice(0,10);
 return {start:new Date(midnight(from)).toISOString(),end:new Date(midnight(next)).toISOString()};
}
async function start(db,actor,input){
 const {historyFrom,from,to,formId='',eventId=''}=input||{};
 if(!validDate(historyFrom)||!validDate(from)||historyFrom>from||typeof formId!=='string'||typeof eventId!=='string'||formId&&!validId(formId)||eventId&&!validId(eventId))fail(400,'Choose a valid history start, form and event.');
 const history=dates(historyFrom,to),period=dates(from,to),filters={...Programme.filters(input),formId,eventId};
 const years=Array.from({length:Number(to.slice(0,4))-Number(from.slice(0,4))+1},(_,i)=>String(Number(from.slice(0,4))+i));
 const jobId=randomUUID(),ref=Snapshot.ref(db,jobId),job={type:'cohort',uid:actor.uid,email:actor.email,calendarAccess:actor.modules.includes('events-bookings'),historyFrom,from,to,history,period,filters,years,versions:Snapshot.expected(await db.getAll(...Snapshot.versions(db))),calendarLedger:{},ledgerCount:0,status:'running',phase:'scan',cursor:null,step:0,scanned:0,coverage:{indexed:0,staleIndex:0,unavailable:0,unmapped:0,unresolved:0},counts:{firstKnown:0,returning:0,identified:0},matrix:{},createdAt:new Date(),expiresAt:new Date(Date.now()+Snapshot.TTL_MS)};
 await db.runTransaction(async tx=>{await Snapshot.validate(tx,db,actor,job);tx.create(ref,job);});
 return {jobId,status:'running',step:0,scanned:0};
}
async function step(db,actor,input){
 Snapshot.checkId(input.jobId);if(!Number.isSafeInteger(input.step)||input.step<0)fail(400,'Choose a valid analysis step.');
 const ref=Snapshot.ref(db,input.jobId),job=(await ref.get()).data();Snapshot.ensure(job,actor);
 if(job.type!=='cohort'||job.status!=='running'||job.step!==input.step)fail(409,'Analysis progress changed. Start again.');
 if(job.phase==='validate'){
  await db.runTransaction(async tx=>{
   const live=(await tx.get(ref)).data();Snapshot.ensure(live,actor);
   if(live.type!=='cohort'||live.phase!=='validate'||live.step!==input.step)fail(409,'Analysis progress changed. Start again.');
   await Snapshot.validate(tx,db,actor,live);await Ledger.validate(tx,db,ref,live.ledgerCount);
   tx.update(ref,{status:'complete',phase:'complete',step:live.step+1,completedAt:new Date()});
  });
  return {jobId:input.jobId,status:'complete',step:input.step+1,scanned:job.scanned};
 }
 const {page,indexes,docs,ledgerDocs,coverage,rows}=await IndexSnapshot.scan(db,job);
 const groups=new Map();
 for(const {row,data,link,confirmed,matches} of rows){
  if(!confirmed)continue;
  if(!groups.has(link.personId))groups.set(link.personId,[]);
  groups.get(link.personId).push({submittedAt:row.submittedAt,matches:matches&&row.submittedAt>=job.period.start&&row.submittedAt<job.period.end,sample:{formId:row.formId,responseId:row.responseId,revision:data.revision}});
 }
 let next;
 await db.runTransaction(async tx=>{
  const live=(await tx.get(ref)).data();Snapshot.ensure(live,actor);
  if(live.type!=='cohort'||live.phase!=='scan'||live.step!==input.step)fail(409,'Analysis progress changed. Start again.');
  await Snapshot.validate(tx,db,actor,live);
  await IndexSnapshot.validateBatch(tx,live,docs);
  const prep=await Ledger.prepare(tx,ref,ledgerDocs,live.ledgerCount),people=[...groups.keys()],members=people.length?await tx.getAll(...people.map(id=>ref.collection('members').doc(id))):[];
  const matrix={...live.matrix},counts={...live.counts};
  for(let i=0;i<people.length;i++){
   const old=members[i].data(),rows=groups.get(people[i]),first=old?.first||rows[0].submittedAt,cohort=sydneyYear(first),samples={...(old?.samples||{})},tags=new Set(old?.tags||[]),wasPeriod=Object.keys(samples).length>0;
   const rowCounts=[...(matrix[cohort]||Array(live.years.length).fill(0))];
   for(const row of rows){
    if(!row.matches)continue;
    const year=sydneyYear(row.submittedAt),column=live.years.indexOf(year);
    if(column<0)fail(409,'A submission falls outside the selected Sydney years.');
    if(!Object.hasOwn(samples,year)){samples[year]=row.sample;rowCounts[column]++;tags.add(`cell:${cohort}:${year}`);}
   }
   if(!wasPeriod&&Object.keys(samples).length){counts.identified++;const group=first>=live.period.start?'first-known':'returning';counts[group==='first-known'?'firstKnown':'returning']++;tags.add(group);}
   if(Object.keys(samples).length)matrix[cohort]=rowCounts;
   tx.set(members[i].ref,{first,samples,tags:[...tags]});
  }
  const nextCoverage=Object.fromEntries(Object.keys(coverage).map(name=>[name,live.coverage[name]+coverage[name]])),morePages=page.size>indexes.length,last=indexes.at(-1);
  next={phase:morePages?'scan':'validate',cursor:morePages?{submittedAt:last.data().submittedAt,id:last.id}:null,step:live.step+1,scanned:live.scanned+indexes.length,coverage:nextCoverage,counts,matrix,ledgerCount:prep.count};
  prep.write();tx.update(ref,next);
 });
 return {jobId:input.jobId,status:'running',step:next.step,scanned:next.scanned};
}
async function results(db,actor,input){
 Snapshot.checkId(input.jobId);const ref=Snapshot.ref(db,input.jobId),job=(await ref.get()).data();Snapshot.ensure(job,actor);
 if(job.type!=='cohort'||job.status!=='complete')fail(409,'Analysis is not complete.');
 const {cohortYear='',returnYear='',group='',cursor='',export:exporting=''}=input;
 if(typeof cohortYear!=='string'||typeof returnYear!=='string'||typeof group!=='string'||typeof cursor!=='string'||cursor&&!validPerson(cursor)||typeof exporting!=='string'||exporting&&!['xlsx','pdf'].includes(exporting))fail(400,'Choose a valid cohort page or aggregate export.');
 const selectedCell=!!(cohortYear||returnYear);
 if(selectedCell&&(!/^\d{4}$/.test(cohortYear)||!job.years.includes(returnYear)||!Object.hasOwn(job.matrix,cohortYear)))fail(400,'Choose a cohort cell in the current report.');
 if(group&&!['first-known','returning'].includes(group)||selectedCell&&group||exporting&&(selectedCell||group||cursor))fail(400,'Choose a valid cohort group or aggregate export.');
 const tag=selectedCell?`cell:${cohortYear}:${returnYear}`:group;
 if(cursor&&!tag)fail(400,'Choose a cohort group before selecting a page.');
 let members=[],page;
 if(tag){let query=ref.collection('members').where('tags','array-contains',tag).orderBy(FieldPath.documentId());if(cursor)query=query.startAfter(cursor);page=await query.limit(PAGE+1).get();members=page.docs.slice(0,PAGE);}
 const references=[];
 for(const member of members){
  const samples=member.data().samples||{},sample=selectedCell?samples[returnYear]:Object.values(samples)[0];
  if(sample)references.push(db.doc(`registrationForms/${sample.formId}/responses/${sample.responseId}`),db.doc(`_insightsState/fieldMappings/forms/${sample.formId}/revisions/${sample.revision}`));
 }
 const docs=await Reports.getDocuments(db,references),items=members.map(member=>{
  const samples=member.data().samples||{},sample=selectedCell?samples[returnYear]:Object.values(samples)[0],source=sample&&docs.get(`registrationForms/${sample.formId}/responses/${sample.responseId}`),mapping=sample&&docs.get(`_insightsState/fieldMappings/forms/${sample.formId}/revisions/${sample.revision}`),evidence=source?.exists&&Respondent.evidence(source.data(),mapping?.data());
  return {personId:member.id,names:evidence?.names||[],firstKnownAt:member.data().first};
 });
 await db.runTransaction(async tx=>{
  const live=(await tx.get(ref)).data();Snapshot.ensure(live,actor);
  if(live.type!=='cohort'||live.status!=='complete'||live.step!==job.step)fail(409,'Analysis changed. Start again.');
  await Snapshot.validate(tx,db,actor,live);await Ledger.validate(tx,db,ref,live.ledgerCount);
  const sourceDocs=[...docs.values()];for(let offset=0;offset<sourceDocs.length;offset+=200){const slice=sourceDocs.slice(offset,offset+200),current=await tx.getAll(...slice.map(doc=>doc.ref));if(current.some((doc,i)=>Snapshot.stamp(doc)!==Snapshot.stamp(slice[i])))fail(409,'Respondent data changed. Start again.');}
 });
 const rows=Object.entries(job.matrix).sort((a,b)=>a[0].localeCompare(b[0])).map(([cohortYear,counts])=>({cohortYear,counts}));
 return {coverage:job.coverage,counts:job.counts,historyFrom:job.historyFrom,from:job.from,to:job.to,filters:job.filters,years:job.years,rows,cohortYear,returnYear,group,items,next:page?.size>PAGE?members.at(-1).id:null,fingerprint:input.jobId+':'+job.step,generatedAt:job.completedAt.toDate().toISOString(),notice:'First-known year is based on current confirmed indexed submissions within the selected accessible history, not first-ever. Each cell counts distinct confirmed people with a matching period submission in that Sydney year; they may appear in several years. Form, event and programme filters select period submissions, while first-known history includes any accessible form or event. Partial years and missing, stale, unresolved, inaccessible or unindexed history can change results. This is not attendance. Names show one reviewed response per matching year.'};
}
module.exports={start,step,results};
