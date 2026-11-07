const {randomUUID,createHash}=require('node:crypto');
const {FieldPath}=require('firebase-admin/firestore');
const {isOwner,normalizeEmail,sessionAllowed}=require('./adminAccess');
const {accessActive,effectiveModules}=require('./moduleAccess');
const State=require('./insights-state');
const Programme=require('./insights-programmes');
const Respondent=require('./insights-respondent');
const Reports=require('./insights-respondent-reports');

const BATCH=100,PAGE=25,MAX_SCANNED=50000,TTL_MS=24*60*60*1000;
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const validPerson=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value);
const stamp=doc=>doc.exists?`${doc.updateTime.seconds}:${doc.updateTime.nanoseconds}`:'missing';
const ref=(db,id)=>db.doc('_insightsMultiJobs/'+id);
const versions=db=>[...State.versionRefs(db,'source'),...State.versionRefs(db,'index'),db.doc('_insightsState/respondentVersion')];
const expected=docs=>Object.fromEntries(docs.map(doc=>[doc.ref.path,stamp(doc)]));
function checkId(id){if(!validPerson(id))fail(400,'Choose a valid analysis snapshot.');}
function ensure(job,actor){
 if(!job||job.uid!==actor.uid||job.email!==actor.email)fail(404,'Analysis snapshot not found.');
 if(!job.expiresAt||typeof job.expiresAt.toMillis!=='function'||job.expiresAt.toMillis()<=Date.now())fail(409,'Analysis snapshot expired. Start again.');
 if(job.status==='cancelled'||job.status==='cleanup')fail(409,'Analysis snapshot is no longer available.');
}
async function validateAccess(tx,db,actor,module='form-insights-people'){
 const [user,entry,settings]=await Promise.all([tx.get(db.doc('users/'+actor.uid)),tx.get(db.doc('adminAllowlist/'+actor.email)),tx.get(db.doc('calendarSettings/auth'))]);
 if(user.data()?.role!=='admin'||normalizeEmail(user.data()?.email)!==actor.email||(!isOwner(actor.email)&&(!entry.exists||entry.data()?.uid!==actor.uid||!accessActive(entry.data())||!effectiveModules(entry.data()).includes(module)))||!sessionAllowed({provider:actor.provider||'',passwordLoginDisabled:settings.data()?.passwordLoginDisabled===true}))fail(403,'Insights access changed. Start again.');
 const modules=isOwner(actor.email)?null:effectiveModules(entry.data());
 return {calendarAccess:!modules||modules.includes('events-bookings'),peopleAccess:!modules||modules.includes('form-insights-people'),exportAccess:!modules||modules.includes('form-insights-export')};
}
async function validate(tx,db,actor,job,{exporting=false}={}){
 const access=await validateAccess(tx,db,actor,['inventory','aggregate','answers'].includes(job.type)?'form-insights':'form-insights-people');
 if(access.calendarAccess!==job.calendarAccess||['aggregate','answers'].includes(job.type)&&access.peopleAccess!==job.peopleAccess||exporting&&!access.exportAccess)fail(403,'Insights, people, export or calendar access changed. Start again.');
 const pairs=Object.entries({...job.versions,...job.calendarLedger});
 for(let offset=0;offset<pairs.length;offset+=200){
  const slice=pairs.slice(offset,offset+200),docs=await tx.getAll(...slice.map(([path])=>db.doc(path)));
  if(docs.some((doc,i)=>stamp(doc)!==slice[i][1]))fail(409,'Source, identity, calendar or programme data changed. Start again.');
 }
}
function tags(bits,n){
 const selected=[];for(let i=0;i<n;i++)if(bits&(1<<i))selected.push(i);
 const out=selected.length===n?['common']:selected.length===1?[`only:${selected[0]}`]:[];
 for(let i=0;i<selected.length;i++)for(let j=i;j<selected.length;j++)out.push(`pair:${selected[i]}:${selected[j]}`);
 return out;
}
function groupTag(group,n){
 if(group==='common')return group;
 let match=/^only:(\d{1,2})$/.exec(group);
 if(match&&Number(match[1])<n)return group;
 match=/^pair:(\d{1,2}):(\d{1,2})$/.exec(group);
 if(match&&Number(match[1])<n&&Number(match[2])<n)return `pair:${Math.min(Number(match[1]),Number(match[2]))}:${Math.max(Number(match[1]),Number(match[2]))}`;
 fail(400,'Choose a valid respondent group.');
}
async function start(db,actor,input){
 const eventIds=input.eventIds,formId=input.formId===undefined?'':input.formId;
 if(!Array.isArray(eventIds)||eventIds.length<2||eventIds.length>20||eventIds.some(id=>!validId(id))||new Set(eventIds).size!==eventIds.length||typeof formId!=='string'||formId&&!validId(formId))fail(400,'Choose 2 to 20 distinct events and a valid form.');
 const filters=Programme.filters(input),eventDocs=await db.getAll(...eventIds.map(id=>db.doc('events/'+id)));
 const events=eventDocs.map(doc=>Reports.eventProjection(doc,actor.modules.includes('events-bookings')));
 if(eventDocs.some(doc=>!doc.exists)||events.some(event=>!event))fail(403,'A selected event is unavailable with your current access.');
 const dimensions=Programme.active(filters)?await Programme.dimensions(db,eventDocs.filter(doc=>doc.exists)):null;
 if(dimensions&&eventIds.some(id=>!dimensions.map.has(id)||!Programme.matches(dimensions.map.get(id),filters)))fail(400,'All selected events must match the programme filters.');
 const id=randomUUID(),versionDocs=await db.getAll(...versions(db)),ledger=expected([...eventDocs,...(dimensions?.documents||[])]);
 const job={type:'multi',uid:actor.uid,email:actor.email,calendarAccess:actor.modules.includes('events-bookings'),eventIds,events,formId,filters,versions:expected(versionDocs),calendarLedger:ledger,status:'running',position:0,cursor:'',step:0,scanned:0,coverage:eventIds.map(()=>({submissions:0,identifiedRespondents:0,unresolved:0,staleIndex:0})),counts:{common:0,only:eventIds.map(()=>0)},matrix:Array(eventIds.length*eventIds.length).fill(0),createdAt:new Date(),expiresAt:new Date(Date.now()+TTL_MS)};
 await db.runTransaction(async tx=>{await validate(tx,db,actor,job);tx.create(ref(db,id),job);});
 return {jobId:id,status:'running',step:0,scanned:0};
}
async function step(db,actor,input){
 checkId(input.jobId);if(!Number.isSafeInteger(input.step)||input.step<0)fail(400,'Choose a valid analysis step.');
 const jobRef=ref(db,input.jobId),job=(await jobRef.get()).data();ensure(job,actor);
 if(job.type!=='multi'||job.status!=='running'||job.step!==input.step)fail(409,'Analysis progress changed. Refresh or start again.');
 let query=db.collection('_registrationInsights').where('eventId','==',job.eventIds[job.position]).orderBy(FieldPath.documentId());
 if(job.cursor)query=query.startAfter(job.cursor);
 const snapshot=await query.limit(BATCH+1).get(),indexDocs=snapshot.docs.slice(0,BATCH),selected=indexDocs.filter(doc=>!job.formId||doc.data().formId===job.formId);
 if(job.scanned+indexDocs.length>MAX_SCANNED)fail(422,`This analysis exceeds ${MAX_SCANNED} indexed records. Narrow the scope; no partial report is available.`);
 const refs=[];
 for(const doc of selected){
  const row=doc.data();if(!validId(row.formId)||!validId(row.responseId)||doc.id!==createHash('sha256').update(row.formId+':'+row.responseId).digest('hex'))fail(409,'An indexed response needs reconciliation.');
  refs.push(db.doc(`registrationForms/${row.formId}/responses/${row.responseId}`),db.doc('_respondentLinks/'+doc.id));
 }
 const docs=await Reports.getDocuments(db,refs),more=[];
 for(const index of selected)docs.set(index.ref.path,index);
 for(const index of selected){
  const link=docs.get('_respondentLinks/'+index.id)?.data();
  if(link?.status==='linked'&&Reports.refValid(link)&&validPerson(link.personId))more.push(...Reports.sourceRefs(db,link),db.doc('_respondents/'+link.personId));
 }
 for(const [path,doc] of await Reports.getDocuments(db,more.filter(item=>!docs.has(item.path)))){
  docs.set(path,doc);
 }
 const found=new Map();let unresolved=0,staleIndex=0;
 for(const index of selected){
  const row=index.data(),source=docs.get(`registrationForms/${row.formId}/responses/${row.responseId}`),link=docs.get('_respondentLinks/'+index.id)?.data();
  if(!source?.exists||source.data().eventId!==job.eventIds[job.position]){staleIndex++;continue;}
  if(!link||link.formId!==row.formId||link.responseId!==row.responseId||!Reports.refValid(link)||!validPerson(link.personId)||!Reports.currentLink(docs,link)||!docs.get('_respondents/'+link.personId)?.exists||docs.get('_respondents/'+link.personId).data()?.mergedInto){unresolved++;continue;}
  if(!found.has(link.personId))found.set(link.personId,{formId:row.formId,responseId:row.responseId,revision:link.revision});
 }
 const morePages=snapshot.size>BATCH,nextPosition=morePages?job.position:job.position+1;
 let next;
 await db.runTransaction(async tx=>{
  const live=(await tx.get(jobRef)).data();ensure(live,actor);
  if(live.status!=='running'||live.step!==input.step)fail(409,'Analysis progress changed. Refresh or start again.');
  await validate(tx,db,actor,live);
  const sourceDocs=[...docs.values()].filter(doc=>{
   if(Object.prototype.hasOwnProperty.call(live.versions,doc.ref.path)){
    if(stamp(doc)!==live.versions[doc.ref.path])fail(409,'Source or respondent data changed. Start again.');
    return false;
   }
   return true;
  });
  for(let offset=0;offset<sourceDocs.length;offset+=200){
   const slice=sourceDocs.slice(offset,offset+200),current=await tx.getAll(...slice.map(doc=>doc.ref));
   if(current.some((doc,i)=>stamp(doc)!==stamp(slice[i])))fail(409,'Source or respondent data changed. Start again.');
  }
  const people=[...found.keys()],members=people.length?await tx.getAll(...people.map(id=>jobRef.collection('members').doc(id))):[];
  const coverage=live.coverage.map(item=>({...item})),counts={common:live.counts.common,only:[...live.counts.only]},matrix=[...live.matrix],i=live.position,n=live.eventIds.length;
  coverage[i].submissions+=selected.length;coverage[i].unresolved+=unresolved;coverage[i].staleIndex+=staleIndex;
  for(let k=0;k<people.length;k++){
   const previous=members[k].data(),bits=previous?.bits||0,mask=1<<i;
   if(bits&mask)continue;
   const old=[];for(let j=0;j<n;j++)if(bits&(1<<j))old.push(j);
   if(old.length===0)counts.only[i]++;else if(old.length===1)counts.only[old[0]]--;
   if(old.length===n-1)counts.common++;
   matrix[i*n+i]++;for(const j of old){matrix[i*n+j]++;matrix[j*n+i]++;}
   coverage[i].identifiedRespondents++;
   const samples={...(previous?.samples||{}),[String(i)]:found.get(people[k])},nextBits=bits|mask;
   tx.set(members[k].ref,{bits:nextBits,samples,tags:tags(nextBits,n)});
  }
  next={position:nextPosition,cursor:morePages?indexDocs.at(-1).id:'',step:live.step+1,scanned:live.scanned+indexDocs.length,coverage,counts,matrix,status:nextPosition>=n?'complete':'running'};
  tx.update(jobRef,next);
 });
 return {jobId:input.jobId,status:next.status,step:next.step,scanned:next.scanned};
}
async function cancel(db,actor,input){
 checkId(input.jobId);const jobRef=ref(db,input.jobId);
 await db.runTransaction(async tx=>{const job=(await tx.get(jobRef)).data();if(job?.status==='cancelled'){if(job.uid!==actor.uid||job.email!==actor.email)fail(404,'Analysis snapshot not found.');await validateAccess(tx,db,actor,['inventory','aggregate','answers'].includes(job.type)?'form-insights':'form-insights-people');return;}ensure(job,actor);await validateAccess(tx,db,actor,['inventory','aggregate','answers'].includes(job.type)?'form-insights':'form-insights-people');tx.update(jobRef,{status:'cancelled'});});
 return {ok:true};
}
async function results(db,actor,input){
 checkId(input.jobId);const jobRef=ref(db,input.jobId),job=(await jobRef.get()).data();ensure(job,actor);
 if(job.type!=='multi'||job.status!=='complete')fail(409,'Analysis is not complete.');
 const group=input.group===undefined?'common':input.group,cursor=input.cursor===undefined?'':input.cursor;
 if(typeof group!=='string')fail(400,'Choose a valid respondent group.');
 const tag=groupTag(group,job.eventIds.length);
 if(typeof cursor!=='string'||cursor&&!validPerson(cursor))fail(400,'Choose a valid page.');
 let query=jobRef.collection('members').where('tags','array-contains',tag).orderBy(FieldPath.documentId());if(cursor)query=query.startAfter(cursor);
 const page=await query.limit(PAGE+1).get(),members=page.docs.slice(0,PAGE),references=[];
 for(const member of members)for(const sample of Object.values(member.data().samples||{}))references.push(db.doc(`registrationForms/${sample.formId}/responses/${sample.responseId}`),db.doc(`_insightsState/fieldMappings/forms/${sample.formId}/revisions/${sample.revision}`));
 const docs=await Reports.getDocuments(db,references),items=members.map(member=>{
  const names=[];for(const sample of Object.values(member.data().samples||{})){
   const source=docs.get(`registrationForms/${sample.formId}/responses/${sample.responseId}`),mapping=docs.get(`_insightsState/fieldMappings/forms/${sample.formId}/revisions/${sample.revision}`);
   const evidence=source?.exists&&Respondent.evidence(source.data(),mapping?.data());if(evidence)names.push(...evidence.names);
  }
  return {personId:member.id,names:[...new Set(names)]};
 });
 await db.runTransaction(async tx=>{
  const live=(await tx.get(jobRef)).data();ensure(live,actor);if(live.status!=='complete')fail(409,'Analysis changed. Start again.');await validate(tx,db,actor,live);
  const uniqueReferences=[...docs.values()].map(doc=>doc.ref);
  for(let offset=0;offset<uniqueReferences.length;offset+=200){
   const slice=uniqueReferences.slice(offset,offset+200),current=await tx.getAll(...slice);
   if(current.some(doc=>stamp(doc)!==stamp(docs.get(doc.ref.path))))fail(409,'Respondent data changed. Start again.');
  }
 });
 const matrix=job.eventIds.map((_,i)=>job.matrix.slice(i*job.eventIds.length,(i+1)*job.eventIds.length));
 return {events:job.events,counts:job.counts,matrix,coverage:job.coverage,group,items,next:page.size>PAGE?members.at(-1).id:null,notice:'Only current reviewed links identify respondents. Indexed/source coverage is incomplete; unresolved and unindexed responses are not identified people. Registrations are not attendance. Names show up to one reviewed response per event.'};
}
async function cleanupExpired(db,id){
 checkId(id);const jobRef=ref(db,id);
 const cleanup=await db.runTransaction(async tx=>{const snap=await tx.get(jobRef),job=snap.data();if(!job)return false;if(job.status!=='cleanup'&&job.status!=='cancelled'&&(!job.expiresAt||typeof job.expiresAt.toMillis!=='function'||job.expiresAt.toMillis()>Date.now()))fail(409,'This analysis has not expired or its expiry is invalid.');if(job.status!=='cleanup')tx.update(jobRef,{status:'cleanup'});return true;});
 if(!cleanup)return {done:true,deleted:0};
 const members=await jobRef.collection('members').limit(BATCH).get(),ledger=members.empty?await jobRef.collection('ledger').limit(BATCH).get():null,batch=db.batch();for(const member of members.docs)batch.delete(member.ref);
 if(ledger)for(const chunk of ledger.docs)batch.delete(chunk.ref);
 if(members.empty&&ledger.empty)batch.delete(jobRef);await batch.commit();
 return {done:members.empty&&ledger.empty,deleted:members.size+(ledger?.size||0)};
}
async function cleanupBatch(db){
 const jobs=await db.collection('_insightsMultiJobs').where('expiresAt','<=',new Date()).orderBy('expiresAt').limit(10).get();
 let deleted=0,pending=0;for(const job of jobs.docs){const result=await cleanupExpired(db,job.id);deleted+=result.deleted;if(!result.done)pending++;}
 return {jobs:jobs.size,deleted,pending};
}
module.exports={start,step,cancel,results,cleanupExpired,cleanupBatch,tags,TTL_MS,MAX_SCANNED,ref,versions,expected,ensure,validate,checkId,stamp};
