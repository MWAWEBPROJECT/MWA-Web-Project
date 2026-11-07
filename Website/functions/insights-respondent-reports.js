const {createHash}=require('node:crypto');
const Respondent=require('./insights-respondent');
const State=require('./insights-state');
const {publicEvent,validDate,midnight}=require('./donation-records');
const Programme=require('./insights-programmes');

const LIMIT=250,PAGE_SIZE=25;
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const hash=value=>createHash('sha256').update(value).digest('hex');
const version=doc=>doc.exists?`${doc.updateTime.seconds}:${doc.updateTime.nanoseconds}`:'missing';
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const validPerson=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value);
const sourceKey=(formId,responseId)=>hash(formId+':'+responseId);

function eventProjection(doc,privateAccess){
 if(!doc.exists)return privateAccess?{title:'Unavailable calendar event',date:null}:null;
 const data=doc.data(),visible=privateAccess?{title:String(data.title||'Untitled calendar event').slice(0,200),startAt:data.startAt}:publicEvent(data,doc.id);
 if(!visible)return null;
 return {title:typeof visible.title==='string'?visible.title.slice(0,200):'Untitled calendar event',date:typeof visible.startAt==='string'&&Number.isFinite(Date.parse(visible.startAt))?visible.startAt:null};
}
async function getDocuments(db,refs){
 const unique=[...new Map(refs.map(ref=>[ref.path,ref])).values()],docs=[];
 for(let offset=0;offset<unique.length;offset+=200)docs.push(...await db.getAll(...unique.slice(offset,offset+200)));
 return new Map(docs.map(doc=>[doc.ref.path,doc]));
}
function signature(docs){
 return hash(JSON.stringify([...docs.values()].map(doc=>[doc.ref.path,version(doc)]).sort((a,b)=>a[0].localeCompare(b[0]))));
}
async function verifyDocuments(db,docs){
 const after=await getDocuments(db,[...docs.values()].map(doc=>doc.ref));
 if(signature(after)!==signature(docs))fail(409,'Respondent, source, mapping or calendar data changed. Run this report again.');
}
async function eventChoices(db,input,privateAccess){
 const {from,to}=input||{};
 if(!validDate(from)||!validDate(to)||from>to||Date.parse(to)-Date.parse(from)>3660*86400000)fail(400,'Choose an event date range of up to ten years.');
 const next=new Date(Date.parse(to+'T00:00:00Z')+86400000).toISOString().slice(0,10);
 const query=db.collection('events').where('startAt','>=',new Date(midnight(from)).toISOString()).where('startAt','<',new Date(midnight(next)).toISOString()).orderBy('startAt').orderBy('__name__').limit(LIMIT+1);
 const first=await query.get();
 if(first.size>LIMIT)fail(422,`Event inventory exceeds the ${LIMIT}-record scan limit. Narrow the date range; no partial list was returned.`);
 const filters=Programme.filters(input),visible=first.docs.filter(doc=>eventProjection(doc,privateAccess));
 const dimensions=Programme.active(filters)?await Programme.dimensions(db,visible):null;
 const events=visible.filter(doc=>!dimensions||Programme.matches(dimensions.map.get(doc.id),filters)).map(doc=>({id:doc.id,...eventProjection(doc,privateAccess)}));
 const after=await query.get();
 if(JSON.stringify(first.docs.map(doc=>[doc.id,version(doc)]))!==JSON.stringify(after.docs.map(doc=>[doc.id,version(doc)])))fail(409,'Calendar events changed. Choose the events again.');
 if(dimensions&&(await Programme.dimensions(db,visible)).fingerprint!==dimensions.fingerprint)fail(409,'Programme reviews changed. Choose the events again.');
 return {events,notice:'Events are selected by their current calendar date in Australia/Sydney. Events without a current date are not listed; a known reference may be entered separately.'};
}
function decodeCursor(cursor,scope,fingerprint){
 if(!cursor)return 0;
 let value;try{value=JSON.parse(Buffer.from(cursor,'base64url').toString());}catch{}
 if(!value||!Number.isSafeInteger(value.offset)||value.offset<0||value.scope!==scope||value.fingerprint!==fingerprint)fail(409,'Report data or filters changed while paging. Run the report again.');
 return value.offset;
}
function page(items,input,scope,fingerprint){
 const offset=decodeCursor(input.cursor,scope,fingerprint);
 if(offset>items.length)fail(409,'Report data changed while paging. Run the report again.');
 const rows=items.slice(offset,offset+PAGE_SIZE),next=offset+rows.length<items.length?Buffer.from(JSON.stringify({offset:offset+rows.length,scope,fingerprint})).toString('base64url'):null;
 return {items:rows,next};
}
function sourceRefs(db,link){
 return [
  db.doc(`registrationForms/${link.formId}/responses/${link.responseId}`),
  db.doc(`_insightsState/fieldMappings/forms/${link.formId}/revisions/${link.revision}`),
  State.versionRef(db,'source',link.formId)
 ];
}
function currentLink(docs,link){
 if(!link||link.status!=='linked'||!validPerson(link.personId)||!validId(link.formId)||!validId(link.responseId)||!Number.isSafeInteger(link.revision))return false;
 const source=docs.get(`registrationForms/${link.formId}/responses/${link.responseId}`),mapping=docs.get(`_insightsState/fieldMappings/forms/${link.formId}/revisions/${link.revision}`);
 const markerPath=`_insightsState/sourceVersions/markers/${String(State.shardFor(link.formId)).padStart(2,'0')}`;
 const generation=docs.get(markerPath);
 return !!source?.exists&&version(source)===link.sourceVersion&&(generation?.data()?.generation||0)===link.sourceGeneration&&mapping?.data()?.version===link.mappingVersion&&!!Respondent.evidence(source.data(),mapping.data());
}
function refValid(link){
 return validId(link.formId)&&validId(link.responseId)&&Number.isSafeInteger(link.revision)&&link.revision>0;
}
function notice(){
 return 'Only current explicitly reviewed response links identify respondents. Indexed/source coverage is incomplete; candidates, stale, unlinked and unindexed responses are not identified people. Differences do not prove absence. Registrations are not attendance, participants or households. Dates are current calendar dates, not historical dates at submission.';
}
async function timeline(db,input,privateAccess){
 if(!validPerson(input.personId)||typeof (input.cursor||'')!=='string'||(input.cursor||'').length>1024)fail(400,'Choose a valid respondent and page.');
 const {formId='',eventId=''}=input;
 if(typeof formId!=='string'||typeof eventId!=='string'||(formId&&!validId(formId))||(eventId&&!validId(eventId)))fail(400,'Choose valid form and event references.');
 const query=db.collection('_respondentLinks').where('personId','==',input.personId).orderBy('__name__').limit(LIMIT+1);
 const [person,links]=await Promise.all([db.doc('_respondents/'+input.personId).get(),query.get()]);
 if(!person.exists)fail(404,'Respondent is unavailable.');
 if(person.data()?.mergedInto)fail(409,'This respondent was merged. Inspect a current linked response.');
 if(links.size>LIMIT)fail(422,`This history exceeds ${LIMIT} link records including inactive records. No partial timeline was returned.`);
 const linked=links.docs.filter(doc=>doc.data().status==='linked'),refs=[person.ref,db.doc('_insightsState/respondentVersion'),...links.docs.map(doc=>doc.ref)];
 for(const doc of linked){if(!refValid(doc.data()))fail(409,'A respondent link is malformed and needs review.');refs.push(...sourceRefs(db,doc.data()));}
 let docs=await getDocuments(db,refs);
 if(version(docs.get(person.ref.path))!==version(person)||links.docs.some(doc=>version(docs.get(doc.ref.path))!==version(doc)))fail(409,'Respondent history changed. Run it again.');
 const eventRefs=[];
 for(const doc of linked){const link=doc.data(),source=docs.get(`registrationForms/${link.formId}/responses/${link.responseId}`);if(source?.exists&&validId(source.data().eventId))eventRefs.push(db.doc('events/'+source.data().eventId));}
 const events=await getDocuments(db,eventRefs);for(const [path,doc] of events)docs.set(path,doc);
 const filters=Programme.filters(input),visible=[...events.values()].filter(doc=>eventProjection(doc,privateAccess)&&doc.exists),dimensions=Programme.active(filters)?await Programme.dimensions(db,visible):null;
 const items=linked.map(doc=>{
  const link=doc.data(),source=docs.get(`registrationForms/${link.formId}/responses/${link.responseId}`),data=source?.data()||{},fresh=currentLink(docs,link);
  if((formId&&link.formId!==formId)||(eventId&&data.eventId!==eventId))return null;
  const event=validId(data.eventId)?eventProjection(events.get('events/'+data.eventId),privateAccess):null;
  const dimension=data.eventId?dimensions?.map.get(data.eventId):{categories:[],bookingType:'',series:''};
  if(dimensions&&(!dimension||!Programme.matches(dimension,filters)))return null;
  return {formId:link.formId,responseId:link.responseId,revision:link.revision,status:fresh?'confirmed':'review-required',reference:typeof data.reference==='string'?data.reference.slice(0,128):'',formTitle:(!data.eventId||event)&&typeof data.formTitle==='string'?data.formTitle.slice(0,200):'',submittedAt:typeof data.createdAt==='string'&&Number.isFinite(Date.parse(data.createdAt))?data.createdAt:null,event:event||{title:data.eventId?'Event unavailable or not accessible':'No saved event',date:null}};
 }).filter(Boolean).sort((a,b)=>(b.submittedAt||'').localeCompare(a.submittedAt||'')||a.formId.localeCompare(b.formId)||a.responseId.localeCompare(b.responseId));
 const repeat=await query.get();
 if(JSON.stringify(repeat.docs.map(d=>[d.id,version(d)]))!==JSON.stringify(links.docs.map(d=>[d.id,version(d)])))fail(409,'Respondent history changed. Run it again.');
 await verifyDocuments(db,docs);
 if(dimensions&&(await Programme.dimensions(db,visible)).fingerprint!==dimensions.fingerprint)fail(409,'Programme reviews changed. Run this report again.');
 const fingerprint=hash(JSON.stringify([signature(docs),dimensions?.fingerprint||''])),scope=hash(JSON.stringify(['timeline',input.personId,privateAccess,filters,formId,eventId]));
 return {personId:input.personId,confirmed:items.filter(item=>item.status==='confirmed').length,reviewRequired:items.filter(item=>item.status!=='confirmed').length,inactive:links.size-linked.length,...page(items,input,scope,fingerprint),notice:notice()};
}
async function compare(db,input,privateAccess){
 const {eventA,eventB,group='common'}=input||{};
 const {formId=''}=input||{};
 if(typeof formId!=='string'||(formId&&!validId(formId)))fail(400,'Choose a valid form reference.');
 const eventIds=input.eventIds===undefined?[eventA,eventB]:input.eventIds,legacy=input.eventIds===undefined;
 if(!Array.isArray(eventIds)||eventIds.length<2||eventIds.length>20||eventIds.some(id=>!validId(id))||new Set(eventIds).size!==eventIds.length||typeof (input.cursor||'')!=='string'||(input.cursor||'').length>1024)fail(400,'Choose 2 to 20 distinct event references and a valid page.');
 const selectedGroup=legacy?group==='a-only'?'only:0':group==='b-only'?'only:1':group:group;
 if(typeof selectedGroup!=='string')fail(400,'Choose a valid respondent group.');
 const onlyMatch=/^only:([0-9]|1[0-9])$/.exec(selectedGroup),pairMatch=/^pair:([0-9]|1[0-9]):([0-9]|1[0-9])$/.exec(selectedGroup);
 if(selectedGroup!=='common'&&!onlyMatch&&!pairMatch||onlyMatch&&Number(onlyMatch[1])>=eventIds.length||pairMatch&&(Number(pairMatch[1])>=eventIds.length||Number(pairMatch[2])>=eventIds.length))fail(400,'Choose a valid respondent group.');
 const queries=eventIds.map(id=>db.collection('_registrationInsights').where('eventId','==',id).orderBy('__name__').limit(LIMIT+1));
 const snapshots=await Promise.all(queries.map(query=>query.get()));
 if(snapshots.some(snap=>snap.size>LIMIT))fail(422,`An event exceeds ${LIMIT} indexed responses. No partial comparison was returned.`);
 const allIndexed=snapshots.flatMap(snap=>snap.docs);
 for(const doc of allIndexed){
  const row=doc.data();
  if(!validId(row.formId)||!validId(row.responseId)||doc.id!==sourceKey(row.formId,row.responseId))fail(409,'An indexed response is malformed and needs reconciliation.');
 }
 const indexed=allIndexed.filter(doc=>!formId||doc.data().formId===formId),refs=[...eventIds.map(id=>db.doc('events/'+id)),db.doc('_insightsState/respondentVersion'),...indexed.map(doc=>doc.ref)];
 for(const doc of indexed){
  const row=doc.data();
  refs.push(db.doc(`registrationForms/${row.formId}/responses/${row.responseId}`),db.doc('_respondentLinks/'+doc.id));
 }
 let docs=await getDocuments(db,refs);
 for(const doc of indexed)if(version(docs.get(doc.ref.path))!==version(doc))fail(409,'The response index changed. Run this comparison again.');
 const selected=eventIds.map(id=>eventProjection(docs.get('events/'+id),privateAccess));
 if(selected.some(event=>!event))fail(403,'One or both events are unavailable with your current access.');
 const filters=Programme.filters(input),visible=eventIds.map(id=>docs.get('events/'+id)).filter(doc=>doc.exists),dimensions=Programme.active(filters)?await Programme.dimensions(db,visible):null;
 if(dimensions&&eventIds.some(id=>!dimensions.map.has(id)||!Programme.matches(dimensions.map.get(id),filters)))fail(400,'All selected events must match the programme filters.');
 const linkRefs=[];
 for(const doc of indexed){
  const link=docs.get('_respondentLinks/'+doc.id)?.data();
  if(link?.status==='linked'&&refValid(link)&&validPerson(link.personId))linkRefs.push(...sourceRefs(db,link),db.doc('_respondents/'+link.personId));
 }
 const linkedDocs=await getDocuments(db,linkRefs);
 for(const [path,doc] of linkedDocs){if(docs.has(path)&&version(docs.get(path))!==version(doc))fail(409,'Respondent data changed. Run this comparison again.');docs.set(path,doc);}
 const buckets=snapshots.map((snap,index)=>{
  const persons=new Map();let unresolved=0,staleIndex=0;
  const selectedDocs=snap.docs.filter(doc=>!formId||doc.data().formId===formId);
  for(const doc of selectedDocs){
   const row=doc.data(),source=docs.get(`registrationForms/${row.formId}/responses/${row.responseId}`),link=docs.get('_respondentLinks/'+doc.id)?.data();
   if(!source?.exists||source.data().eventId!==eventIds[index]){staleIndex++;continue;}
   if(!link||link.formId!==row.formId||link.responseId!==row.responseId||!refValid(link)||!validPerson(link.personId)||!currentLink(docs,link)||!docs.get('_respondents/'+link.personId)?.exists||docs.get('_respondents/'+link.personId).data()?.mergedInto){unresolved++;continue;}
   const mapping=docs.get(`_insightsState/fieldMappings/forms/${link.formId}/revisions/${link.revision}`),names=Respondent.evidence(source.data(),mapping.data()).names;
   const previous=persons.get(link.personId)||{personId:link.personId,names:[]};
   previous.names=[...new Set([...previous.names,...names])];persons.set(link.personId,previous);
  }
  return {persons,submissions:selectedDocs.length,unresolved,staleIndex};
 });
 const common=[...buckets[0].persons.keys()].filter(id=>buckets.every(bucket=>bucket.persons.has(id)));
 const only=buckets.map((bucket,index)=>[...bucket.persons.keys()].filter(id=>buckets.every((other,n)=>n===index||!other.persons.has(id))));
 const matrix=buckets.map(left=>buckets.map(right=>[...left.persons.keys()].filter(id=>right.persons.has(id)).length));
 const ids=(selectedGroup==='common'?common:onlyMatch?only[Number(onlyMatch[1])]:[...buckets[Number(pairMatch[1])].persons.keys()].filter(id=>buckets[Number(pairMatch[2])].persons.has(id))).sort(),items=ids.map(id=>({personId:id,names:[...new Set(buckets.flatMap(bucket=>bucket.persons.get(id)?.names||[]))]}));
 const repeats=await Promise.all(queries.map(query=>query.get()));
 if(repeats.some((snap,index)=>JSON.stringify(snap.docs.map(d=>[d.id,version(d)]))!==JSON.stringify(snapshots[index].docs.map(d=>[d.id,version(d)]))))fail(409,'The response index changed. Run this comparison again.');
 await verifyDocuments(db,docs);
 if(dimensions&&(await Programme.dimensions(db,visible)).fingerprint!==dimensions.fingerprint)fail(409,'Programme reviews changed. Run this comparison again.');
 const fingerprint=hash(JSON.stringify([signature(docs),dimensions?.fingerprint||''])),scope=hash(JSON.stringify(['compare',eventIds,group,privateAccess,filters,formId]));
 return {events:selected,counts:legacy?{common:common.length,aOnly:only[0].length,bOnly:only[1].length}:{common:common.length,only:only.map(items=>items.length)},...(legacy?{}:{matrix}),coverage:buckets.map(({persons,submissions,unresolved,staleIndex})=>({submissions,identifiedRespondents:persons.size,unresolved,staleIndex})),group,...page(items,input,scope,fingerprint),notice:notice()};
}
module.exports={timeline,compare,eventChoices,LIMIT,PAGE_SIZE,eventProjection,getDocuments,currentLink,refValid,sourceRefs};
