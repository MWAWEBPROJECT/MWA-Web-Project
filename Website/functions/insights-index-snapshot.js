const {createHash}=require('node:crypto');
const {FieldPath}=require('firebase-admin/firestore');
const Snapshot=require('./insights-multi-snapshot'),Reports=require('./insights-respondent-reports');
const Programme=require('./insights-programmes'),Respondent=require('./insights-respondent'),State=require('./insights-state');
const {publicEvent}=require('./donation-records');

const BATCH=100;
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const validPerson=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value);
const key=(form,id)=>createHash('sha256').update(form+':'+id).digest('hex');

async function scan(db,job,{filterHistory=false,includeIndexEvents=false}={}){
 let query;
 if(job.basis==='event'){
  const ids=job.eventIds.slice(job.position,job.position+30);
  if(!ids.length)fail(409,'Analysis event scope changed. Start again.');
  query=db.collection('_registrationInsights').where('eventId','in',ids).orderBy(FieldPath.documentId());
  if(job.cursor)query=query.startAfter(job.cursor);
 }else{
  query=db.collection('_registrationInsights').where('submittedAt','>=',job.history.start).where('submittedAt','<',job.history.end).orderBy('submittedAt').orderBy(FieldPath.documentId());
  if(job.cursor)query=query.startAfter(job.cursor.submittedAt,job.cursor.id);
 }
 const page=await query.limit(BATCH+1).get(),indexes=page.docs.slice(0,BATCH),refs=[];
 if(job.scanned+indexes.length>Snapshot.MAX_SCANNED)fail(422,`This analysis exceeds ${Snapshot.MAX_SCANNED} indexed records. Narrow the scope; no partial report is available.`);
 for(const index of indexes){
  const row=index.data();
  if(!validId(row.formId)||!validId(row.responseId)||index.id!==key(row.formId,row.responseId))fail(409,'An indexed response needs reconciliation.');
  refs.push(db.doc(`registrationForms/${row.formId}/responses/${row.responseId}`),db.doc('_respondentLinks/'+index.id));
 }
 const docs=await Reports.getDocuments(db,refs);
 for(const index of indexes)docs.set(index.ref.path,index);
 const more=[];
 for(const index of indexes){
  const row=index.data(),source=docs.get(`registrationForms/${row.formId}/responses/${row.responseId}`),data=source.data(),link=docs.get('_respondentLinks/'+index.id).data();
  if(includeIndexEvents&&validId(row.eventId))more.push(db.doc('events/'+row.eventId));
  if(data&&Number.isSafeInteger(data.revision)&&data.revision>0)more.push(db.doc(`_insightsState/fieldMappings/forms/${row.formId}/revisions/${data.revision}`),State.versionRef(db,'source',row.formId));
  if(data&&validId(data.eventId))more.push(db.doc('events/'+data.eventId));
  if(link&&validPerson(link.personId))more.push(db.doc('_respondents/'+link.personId));
 }
 for(const [path,doc] of await Reports.getDocuments(db,more.filter(item=>!docs.has(item.path))))docs.set(path,doc);
 const eventDocs=[...docs.values()].filter(doc=>doc.ref.path.startsWith('events/')),visible=eventDocs.filter(doc=>doc.exists&&(job.calendarAccess||publicEvent(doc.data(),doc.id)));
 const dimensions=Programme.active(job.filters)?await Programme.dimensions(db,visible):null;
 const ledgerDocs=[...eventDocs,...(dimensions?.documents||[])];
 for(const doc of ledgerDocs){if(docs.has(doc.ref.path)&&Snapshot.stamp(docs.get(doc.ref.path))!==Snapshot.stamp(doc))fail(409,'Calendar or programme reviews changed. Start again.');docs.set(doc.ref.path,doc);}
 const rows=[],coverage={indexed:indexes.length,staleIndex:0,unavailable:0,unmapped:0,unresolved:0};
 for(const index of indexes){
  const row=index.data(),source=docs.get(`registrationForms/${row.formId}/responses/${row.responseId}`),data=source.data(),link=docs.get('_respondentLinks/'+index.id).data();
  if(!source.exists||typeof row.submittedAt!=='string'||!Number.isFinite(Date.parse(row.submittedAt))||new Date(row.submittedAt).toISOString()!==row.submittedAt||data.createdAt!==row.submittedAt||(data.eventId||'')!==(row.eventId||'')){coverage.staleIndex++;continue;}
  if(data.eventId){const event=validId(data.eventId)?docs.get('events/'+data.eventId):null;if(!event?.exists||(!job.calendarAccess&&!publicEvent(event.data(),event.id))){coverage.unavailable++;continue;}}
  const dimension=dimensions?(data.eventId?dimensions.map.get(data.eventId):{categories:[],bookingType:'',series:''}):null;
  const matches=(!job.filters.formId||row.formId===job.filters.formId)&&(!job.filters.eventId||data.eventId===job.filters.eventId)&&(!dimensions||!!dimension&&Programme.matches(dimension,job.filters));
  if(filterHistory&&!matches)continue;
  const mapping=Number.isSafeInteger(data.revision)?docs.get(`_insightsState/fieldMappings/forms/${row.formId}/revisions/${data.revision}`):null,evidence=Respondent.evidence(data,mapping?.data());
  if(!evidence){coverage.unmapped++;continue;}
  const person=validPerson(link?.personId)?docs.get('_respondents/'+link.personId):null,generation=docs.get(State.versionRef(db,'source',row.formId).path);
  const confirmed=link?.status==='linked'&&link.formId===row.formId&&link.responseId===row.responseId&&link.revision===data.revision&&link.sourceVersion===Snapshot.stamp(source)&&link.sourceGeneration===(generation?.data()?.generation||0)&&link.mappingVersion===mapping.data()?.version&&person?.exists&&!person.data()?.mergedInto;
  if(!confirmed)coverage.unresolved++;
  rows.push({index,row,source,data,link,mapping,person,confirmed,evidence,matches});
 }
 return {page,indexes,docs,ledgerDocs,coverage,rows,dimensions};
}

async function validateBatch(tx,live,docs){
 const all=[...docs.values()].filter(doc=>{
  if(Object.hasOwn(live.versions,doc.ref.path)){if(Snapshot.stamp(doc)!==live.versions[doc.ref.path])fail(409,'Source or identity data changed. Start again.');return false;}
  return true;
 });
 for(let offset=0;offset<all.length;offset+=200){const slice=all.slice(offset,offset+200),current=await tx.getAll(...slice.map(doc=>doc.ref));if(current.some((doc,i)=>Snapshot.stamp(doc)!==Snapshot.stamp(slice[i])))fail(409,'Source, identity or calendar data changed. Start again.');}
}
module.exports={scan,validateBatch};
