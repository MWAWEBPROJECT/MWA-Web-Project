const {createHash}=require('node:crypto');
const Respondent=require('./insights-respondent');
const State=require('./insights-state');
const {publicEvent,validDate,midnight}=require('./donation-records');
const Programme=require('./insights-programmes');

const LIMIT=5000,PAGE_SIZE=25;
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const hash=value=>createHash('sha256').update(value).digest('hex');
const version=doc=>doc.exists?`${doc.updateTime.seconds}:${doc.updateTime.nanoseconds}`:'missing';
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const validPerson=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value);
const normalize=value=>String(value||'').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
const key=(formId,responseId)=>hash(formId+':'+responseId);
const ref=(db,formId,responseId)=>db.doc(`registrationForms/${formId}/responses/${responseId}`);

async function getDocuments(db,refs){
 const unique=[...new Map(refs.map(item=>[item.path,item])).values()],docs=[];
 for(let offset=0;offset<unique.length;offset+=200)docs.push(...await db.getAll(...unique.slice(offset,offset+200)));
 return new Map(docs.map(doc=>[doc.ref.path,doc]));
}
const signature=docs=>hash(JSON.stringify([...docs.values()].map(doc=>[doc.ref.path,version(doc)]).sort((a,b)=>a[0].localeCompare(b[0]))));
function dates(from,to){
 if(!validDate(from)||!validDate(to)||from>to||Date.parse(to)-Date.parse(from)>3660*86400000||to>='9999-12-31')fail(400,'Choose a valid Sydney date range of up to ten years.');
 const next=new Date(Date.parse(to+'T00:00:00Z')+86400000).toISOString().slice(0,10);
 return {start:new Date(midnight(from)).toISOString(),end:new Date(midnight(next)).toISOString()};
}
function paginate(items,cursor,scope,fingerprint){
 let offset=0;
 if(cursor){
  let data;try{data=JSON.parse(Buffer.from(cursor,'base64url').toString());}catch{}
  if(!data||data.scope!==scope||data.fingerprint!==fingerprint||!Number.isSafeInteger(data.offset)||data.offset<0||data.offset>items.length)fail(409,'Results or filters changed while paging. Run the search again.');
  offset=data.offset;
 }
 const rows=items.slice(offset,offset+PAGE_SIZE),next=offset+rows.length<items.length?Buffer.from(JSON.stringify({scope,fingerprint,offset:offset+rows.length})).toString('base64url'):null;
 return {items:rows,next};
}
function mask(values){
 return [...values.emails.map(value=>{const [local,domain]=value.split('@');return `${local.slice(0,1)}***@${domain}`;}),...values.mobiles.map(value=>'***'+value.slice(-4))];
}
async function snapshot(db,from,to,privateAccess,input,filterHistory=true){
 const range=dates(from,to);
 const query=db.collection('_registrationInsights').where('submittedAt','>=',range.start).where('submittedAt','<',range.end).orderBy('submittedAt').orderBy('__name__').limit(LIMIT+1);
 const indexed=await query.get();
 if(indexed.size>LIMIT)fail(422,`This history window exceeds ${LIMIT} indexed responses. Choose a narrower history window; no partial results were returned.`);
 const refs=[db.doc('_insightsState/respondentVersion'),...indexed.docs.map(doc=>doc.ref)];
 for(const doc of indexed.docs){
  const row=doc.data();
  if(!validId(row.formId)||!validId(row.responseId)||doc.id!==key(row.formId,row.responseId))fail(409,'An indexed response needs reconciliation. No partial results were returned.');
  refs.push(ref(db,row.formId,row.responseId),db.doc('_respondentLinks/'+doc.id));
 }
 const docs=await getDocuments(db,refs),more=[];
 for(const index of indexed.docs){
  if(version(index)!==version(docs.get(index.ref.path)))fail(409,'The response index changed. Run the report again.');
  const row=index.data(),source=docs.get(ref(db,row.formId,row.responseId).path),data=source.data(),link=docs.get('_respondentLinks/'+index.id).data();
  if(data&&Number.isSafeInteger(data.revision)&&data.revision>0)more.push(db.doc(`_insightsState/fieldMappings/forms/${row.formId}/revisions/${data.revision}`),State.versionRef(db,'source',row.formId));
  if(data&&validId(data.eventId))more.push(db.doc('events/'+data.eventId));
  if(link&&validPerson(link.personId))more.push(db.doc('_respondents/'+link.personId));
 }
 const extra=await getDocuments(db,more);for(const [path,doc] of extra)docs.set(path,doc);
 const filters=Programme.filters(input),active=Programme.active(filters),{formId='',eventId=''}=input||{};
 if(typeof formId!=='string'||typeof eventId!=='string'||(formId&&!validId(formId))||(eventId&&!validId(eventId)))fail(400,'Choose valid form and event references.');
 const events=[...docs.values()].filter(doc=>doc.ref.path.startsWith('events/')&&doc.exists&&(privateAccess||publicEvent(doc.data(),doc.id)));
 const dimensions=active?await Programme.dimensions(db,events):null;
 const rows=[];let staleIndex=0,unavailable=0,unmapped=0,unresolved=0;
 for(const index of indexed.docs){
  const row=index.data(),source=docs.get(ref(db,row.formId,row.responseId).path),data=source.data(),link=docs.get('_respondentLinks/'+index.id).data();
  if(!source.exists||typeof row.submittedAt!=='string'||!Number.isFinite(Date.parse(row.submittedAt))||new Date(row.submittedAt).toISOString()!==row.submittedAt||data.createdAt!==row.submittedAt||(data.eventId||'')!==(row.eventId||'')){staleIndex++;continue;}
  if(data.eventId){
   if(!validId(data.eventId)){unavailable++;continue;}
   const event=docs.get('events/'+data.eventId);
   if(!event?.exists||(!privateAccess&&!publicEvent(event.data(),event.id))){unavailable++;continue;}
  }
  const dimension=active?(data.eventId?dimensions.map.get(data.eventId):{categories:[],bookingType:'',series:''}):null;
  const matchesScope=(!formId||row.formId===formId)&&(!eventId||data.eventId===eventId)&&(!active||!!dimension&&Programme.matches(dimension,filters));
  if(filterHistory&&!matchesScope)continue;
  const mapping=Number.isSafeInteger(data.revision)?docs.get(`_insightsState/fieldMappings/forms/${row.formId}/revisions/${data.revision}`):null;
  const evidence=Respondent.evidence(data,mapping?.data());
  if(!evidence){unmapped++;continue;}
  const person=validPerson(link?.personId)?docs.get('_respondents/'+link.personId):null;
  const generation=docs.get(State.versionRef(db,'source',row.formId).path);
  const confirmed=link?.status==='linked'&&link.formId===row.formId&&link.responseId===row.responseId&&link.revision===data.revision&&
   link.sourceVersion===version(source)&&link.sourceGeneration===(generation?.data()?.generation||0)&&link.mappingVersion===mapping.data()?.version&&person?.exists&&!person.data()?.mergedInto;
  if(!confirmed)unresolved++;
  rows.push({formId:row.formId,responseId:row.responseId,submittedAt:row.submittedAt,reference:typeof data.reference==='string'?data.reference.slice(0,128):'',values:evidence,personId:confirmed?link.personId:null,matchesScope});
 }
 const again=await query.get();
 if(JSON.stringify(again.docs.map(doc=>[doc.id,version(doc)]))!==JSON.stringify(indexed.docs.map(doc=>[doc.id,version(doc)])))fail(409,'The response index changed. Run the report again.');
 const after=await getDocuments(db,[...docs.values()].map(doc=>doc.ref));
 if(signature(after)!==signature(docs))fail(409,'Source, mapping, identity or calendar data changed. Run the report again.');
 if(active&&(await Programme.dimensions(db,events)).fingerprint!==dimensions.fingerprint)fail(409,'Programme reviews changed. Run the report again.');
 return {rows,coverage:{indexed:indexed.size,staleIndex,unavailable,unmapped,unresolved},fingerprint:hash(JSON.stringify([signature(docs),dimensions?.fingerprint||'',filters,formId,eventId])),range};
}
function validateCursor(value){if(typeof (value||'')!=='string'||(value||'').length>1024)fail(400,'Choose a valid page.');}
function searchNeedle(kind,term){
 if(!['name','email','mobile'].includes(kind)||typeof term!=='string'||term.length>254)fail(400,'Choose a name, email or mobile search.');
 const needle=kind==='name'?normalize(term):kind==='email'?Respondent.email(term):Respondent.mobile(term);
 if(!needle||(kind==='name'&&needle.length<2))fail(400,'Enter at least two name characters or a valid complete email or mobile.');
 return needle;
}
function matches(kind,needle,values){
 return kind==='name'?values.names.some(name=>normalize(name).includes(needle)):kind==='email'?values.emails.includes(needle):values.mobiles.includes(needle);
}
async function lookup(db,input,privateAccess){
 const {from,to,kind,term}=input||{};validateCursor(input?.cursor);
 const needle=searchNeedle(kind,term);
 const snap=await snapshot(db,from,to,privateAccess,input),persons=new Map(),unresolved=[];
 for(const row of snap.rows){
  if(!matches(kind,needle,row.values))continue;
  if(row.personId){
   const person=persons.get(row.personId)||{kind:'confirmed',personId:row.personId,names:[],contactHints:[]};
   person.names=[...new Set([...person.names,...row.values.names])];person.contactHints=[...new Set([...person.contactHints,...mask(row.values)])];persons.set(row.personId,person);
  }else unresolved.push({kind:'unresolved',formId:row.formId,responseId:row.responseId,reference:row.reference,names:row.values.names,contactHints:mask(row.values)});
 }
 const items=[...persons.values()].sort((a,b)=>a.personId.localeCompare(b.personId)).concat(unresolved.sort((a,b)=>a.formId.localeCompare(b.formId)||a.responseId.localeCompare(b.responseId)));
 const scope=hash(JSON.stringify(['lookup',from,to,kind,privateAccess,items.map(item=>item.personId||item.formId+':'+item.responseId)]));
 return {coverage:snap.coverage,confirmedMatches:persons.size,unresolvedMatches:unresolved.length,...paginate(items,input.cursor,scope,snap.fingerprint),notice:'Search covers indexed submissions in the selected Sydney submission-date window only. Results without current reviewed identity links are unresolved candidates, not people. Unmapped, stale, unavailable, nonstandard-date and unindexed history is excluded; matching never confirms identity.'};
}
async function cohorts(db,input,privateAccess){
 const {historyFrom,from,to,group='first-known'}=input||{};validateCursor(input?.cursor);
 if(!validDate(historyFrom)||!validDate(from)||historyFrom>from||!['first-known','returning'].includes(group))fail(400,'Choose a history start on or before the period and a valid group.');
 const period=dates(from,to),snap=await snapshot(db,historyFrom,to,privateAccess,input,false),people=new Map();
 for(const row of snap.rows){
  if(!row.personId)continue;
  const person=people.get(row.personId)||{personId:row.personId,first:row.submittedAt,inPeriod:false,names:[]};
  if(row.submittedAt<person.first)person.first=row.submittedAt;
  if(row.matchesScope&&row.submittedAt>=period.start&&row.submittedAt<period.end){person.inPeriod=true;person.names=[...new Set([...person.names,...row.values.names])];}
  people.set(row.personId,person);
 }
 const eligible=[...people.values()].filter(item=>item.inPeriod),first=eligible.filter(item=>item.first>=period.start),returning=eligible.filter(item=>item.first<period.start);
 const selected=(group==='first-known'?first:returning).sort((a,b)=>a.personId.localeCompare(b.personId)).map(({personId,names,first})=>({personId,names,firstKnownAt:first}));
 const scope=hash(JSON.stringify(['cohorts',historyFrom,from,to,group,privateAccess]));
 return {coverage:snap.coverage,counts:{firstKnown:first.length,returning:returning.length,identified:eligible.length},group,historyFrom,from,to,...paginate(selected,input.cursor,scope,snap.fingerprint),notice:'First-known means earliest current confirmed indexed submission within the selected accessible history window, not first-ever. Form, event and programme filters select period submissions; prior history is checked across any accessible form or event. Missing, stale, unresolved, inaccessible, nonstandard-date and unindexed records may change these classifications. Submissions are not attendance.'};
}
async function cohortMatrix(db,input,privateAccess){
 const {historyFrom,from,to,cohortYear='',returnYear=''}=input||{};validateCursor(input?.cursor);
 if(!validDate(historyFrom)||!validDate(from)||historyFrom>from||!validDate(to)||from>to)fail(400,'Choose a history start on or before a valid Sydney period.');
 if((cohortYear||returnYear)&&(!/^\d{4}$/.test(cohortYear)||!/^\d{4}$/.test(returnYear)))fail(400,'Choose a valid cohort and return year.');
 const period=dates(from,to),snap=await snapshot(db,historyFrom,to,privateAccess,input,false),people=new Map(),year=value=>new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Sydney',year:'numeric'}).format(new Date(value));
 for(const row of snap.rows){
  if(!row.personId)continue;
  const person=people.get(row.personId)||{personId:row.personId,first:row.submittedAt,years:new Map()};
  if(row.submittedAt<person.first)person.first=row.submittedAt;
  if(row.matchesScope&&row.submittedAt>=period.start&&row.submittedAt<period.end){
   const y=year(row.submittedAt),names=person.years.get(y)||new Set();for(const name of row.values.names)names.add(name);person.years.set(y,names);
  }
  people.set(row.personId,person);
 }
 const start=Number(from.slice(0,4)),end=Number(to.slice(0,4)),years=Array.from({length:end-start+1},(_,i)=>String(start+i)),matrix=new Map();
 for(const person of people.values()){
  if(!person.years.size)continue;
  const cohort=year(person.first),counts=matrix.get(cohort)||Object.fromEntries(years.map(y=>[y,0]));
  for(const y of person.years.keys())counts[y]++;
  matrix.set(cohort,counts);
 }
 const rows=[...matrix].sort((a,b)=>a[0].localeCompare(b[0])).map(([cohort,counts])=>({cohortYear:cohort,counts:years.map(y=>counts[y])}));
 if(cohortYear&&(!matrix.has(cohortYear)||!years.includes(returnYear)))fail(400,'Choose a cohort cell in the current report.');
 const selected=cohortYear?[...people.values()].filter(person=>year(person.first)===cohortYear&&person.years.has(returnYear)).sort((a,b)=>a.personId.localeCompare(b.personId)).map(person=>({personId:person.personId,names:[...person.years.get(returnYear)],firstKnownAt:person.first})):[];
 const scope=hash(JSON.stringify(['cohort-matrix',historyFrom,from,to,cohortYear,returnYear,privateAccess]));
 const filters={...Programme.filters(input),formId:input.formId||'',eventId:input.eventId||''};
 const fingerprint=hash(JSON.stringify([snap.fingerprint,historyFrom,from,to,filters,privateAccess]));
 return {coverage:snap.coverage,historyFrom,from,to,filters,years,rows,cohortYear,returnYear,fingerprint,generatedAt:new Date().toISOString(),...paginate(selected,input.cursor,scope,snap.fingerprint),notice:'First-known year is based on current confirmed indexed submissions within the selected accessible history, not first-ever. Each cell counts distinct confirmed people with a matching period submission in that Sydney year; they may appear in several years. Form, event and programme filters select period submissions, while first-known history includes any accessible form or event. Partial years and missing, stale, unresolved, inaccessible or unindexed history can change results. This is not attendance.'};
}
module.exports={lookup,cohorts,cohortMatrix,LIMIT,PAGE_SIZE,searchNeedle,matches,mask,dates};
