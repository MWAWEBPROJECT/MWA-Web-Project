const {createHash,randomUUID}=require('node:crypto');
const State=require('./insights-state');

const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const roles={
 'respondent-name':['text','textarea'],
 'respondent-email':['email','text'],
 'respondent-mobile':['phone','text'],
 'participant-name':['text','textarea'],
 'household-size':['number'],
};
const mappingRef=(db,formId,revision)=>db.doc(`_insightsState/fieldMappings/forms/${formId}/revisions/${revision}`);
const validId=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value);
function validRevision(value){
 const number=typeof value==='string'&&/^[1-9]\d{0,8}$/.test(value)?Number(value):value;
 if(!Number.isSafeInteger(number)||number<1||number>999999999)fail(400,'Choose a valid form revision.');
 return number;
}
function schema(fields){
 if(!Array.isArray(fields)||!fields.length||fields.length>30)return null;
 const ids=new Set(),result=[];
 for(const field of fields){
  if(!field||typeof field.id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(field.id)||ids.has(field.id)||typeof field.type!=='string'||typeof field.label!=='string'||field.label.length>200||typeof field.required!=='boolean'||(field.description!==undefined&&typeof field.description!=='string')||(field.terms!==undefined&&typeof field.terms!=='string')||(field.options!==undefined&&(!Array.isArray(field.options)||field.options.length>20||field.options.some(option=>typeof option!=='string'||option.length>100))))return null;
  ids.add(field.id);
  result.push({id:field.id,type:field.type,label:field.label,description:field.description??'',required:field.required,options:field.options??[],terms:field.terms??''});
 }
 return result;
}
const hashSchema=fields=>createHash('sha256').update(JSON.stringify(fields)).digest('hex');
const jobRef=(db,id)=>db.doc(`_insightsState/mappingScans/jobs/${id}`);
const formVersion=snapshot=>snapshot.exists?`${snapshot.updateTime.seconds}:${snapshot.updateTime.nanoseconds}`:'';
const validJob=id=>typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id);
function checkJob(job,actor){if(!job||job.startedBy!==actor.uid)fail(404,'Mapping scan not found.');}
function sameScope(job,marker,form){return (marker.data()?.generation||0)===job.sourceGeneration&&formVersion(form)===job.formVersion;}
async function startScan(db,actor,input){
 const {formId,mode}=input||{};
 if(!validId(formId)||!['discover','inspect'].includes(mode))fail(400,'Choose a valid form and scan type.');
 const revision=mode==='inspect'?validRevision(input.revision):null,id=randomUUID(),ref=jobRef(db,id);
 await db.runTransaction(async tx=>{
  const [marker,form]=await Promise.all([tx.get(State.versionRef(db,'source',formId)),tx.get(db.doc(`registrationForms/${formId}`))]);
  const current=form.exists&&form.data().revision===revision,fields=current?schema(form.data().fields):null;
  const job={id,formId,mode,revision,status:'running',startedBy:actor.uid,startedAt:new Date().toISOString(),sourceGeneration:marker.data()?.generation||0,formVersion:formVersion(form),currentRevision:form.exists&&Number.isSafeInteger(form.data().revision)&&form.data().revision>0&&form.data().revision<=999999999?form.data().revision:null,after:'',scanned:0,unknownRevisionResponses:0,fields,schemaHash:fields?hashSchema(fields):'',malformed:current&&!fields,conflict:false};
  tx.create(ref,job);
  if(mode==='discover'&&job.currentRevision)tx.set(ref.collection('revisions').doc(String(job.currentRevision).padStart(9,'0')),{revision:job.currentRevision,current:true,responseSnapshots:0});
 });
 return scanStatus(db,actor,id);
}
async function stepScan(db,actor,id){
 if(!validJob(id))fail(400,'Choose a valid mapping scan.');
 const ref=jobRef(db,id),snapshot=await ref.get(),job=snapshot.data();checkJob(job,actor);
 if(job.status!=='running')return scanStatus(db,actor,id);
 let query=db.collection(`registrationForms/${job.formId}/responses`);
 if(job.mode==='inspect')query=query.where('revision','==',job.revision);
 query=job.mode==='discover'?query.orderBy('__name__').select('revision'):query.orderBy('__name__').select('revision','fields');
 if(job.after)query=query.startAfter(job.after);
 const response=await query.limit(101).get(),docs=response.docs.slice(0,100),counts=new Map();
 let fields=job.fields,digest=job.schemaHash,malformed=job.malformed,conflict=job.conflict,unknown=job.unknownRevisionResponses;
 for(const doc of docs){
  const value=doc.data();
  if(job.mode==='discover'){
   const revision=value.revision;
   if(!Number.isSafeInteger(revision)||revision<1||revision>999999999)unknown++;
   else counts.set(revision,(counts.get(revision)||0)+1);
  }else{
   const candidate=schema(value.fields);
   if(!candidate)malformed=true;
   else if(!digest){fields=candidate;digest=hashSchema(candidate);}
   else if(hashSchema(candidate)!==digest)conflict=true;
  }
 }
 await db.runTransaction(async tx=>{
  const [current,marker,form]=await Promise.all([tx.get(ref),tx.get(State.versionRef(db,'source',job.formId)),tx.get(db.doc(`registrationForms/${job.formId}`))]);
  const live=current.data();checkJob(live,actor);
  if(live.status!=='running'||live.after!==job.after||live.scanned!==job.scanned)fail(409,'Scan advanced or was cancelled. Refresh its status.');
  if(!sameScope(live,marker,form)){tx.update(ref,{status:'invalidated',finishedAt:new Date().toISOString()});return;}
  const refs=[...counts.keys()].map(revision=>ref.collection('revisions').doc(String(revision).padStart(9,'0')));
  const existing=await Promise.all(refs.map(item=>tx.get(item)));
  refs.forEach((item,index)=>{const revision=[...counts.keys()][index],old=existing[index].data();tx.set(item,{revision,current:old?.current||false,responseSnapshots:(old?.responseSnapshots||0)+counts.get(revision)});});
  const finished=response.size<=docs.length;
  tx.update(ref,{after:docs.length?docs.at(-1).id:job.after,scanned:job.scanned+docs.length,unknownRevisionResponses:unknown,fields,schemaHash:digest,malformed,conflict,status:finished?'complete':'running',...(finished?{finishedAt:new Date().toISOString()}:{})});
 });
 return scanStatus(db,actor,id);
}
async function cancelScan(db,actor,id){
 if(!validJob(id))fail(400,'Choose a valid mapping scan.');
 const ref=jobRef(db,id);
 await db.runTransaction(async tx=>{const snap=await tx.get(ref),job=snap.data();checkJob(job,actor);if(job.status!=='running')fail(409,'Only a running scan can be cancelled.');tx.update(ref,{status:'cancelled',finishedAt:new Date().toISOString()});});
 return scanStatus(db,actor,id);
}
async function scanStatus(db,actor,id,after=''){
 if(!validJob(id))fail(400,'Choose a valid mapping scan.');
 if(after&&!/^\d{9}$/.test(after))fail(400,'Invalid revision page cursor.');
 const ref=jobRef(db,id),snapshot=await ref.get(),job=snapshot.data();checkJob(job,actor);
 const [marker,form]=await Promise.all([State.versionRef(db,'source',job.formId).get(),db.doc(`registrationForms/${job.formId}`).get()]);
 const status=['running','complete'].includes(job.status)&&!sameScope(job,marker,form)?'invalidated':job.status;
 const result={jobId:id,formId:job.formId,mode:job.mode,revision:job.revision,status,scanned:job.scanned,startedAt:job.startedAt,finishedAt:job.finishedAt||null};
 if(status!=='complete')return result;
 if(job.mode==='discover'){
  let query=ref.collection('revisions').orderBy('__name__');if(after)query=query.startAfter(after);
  const page=await query.limit(101).get(),docs=page.docs.slice(0,100);
  const [markerAfter,formAfter]=await Promise.all([State.versionRef(db,'source',job.formId).get(),db.doc(`registrationForms/${job.formId}`).get()]);
  if(!sameScope(job,markerAfter,formAfter))return {...result,status:'invalidated'};
  return {...result,revisions:docs.map(doc=>doc.data()),next:page.size>docs.length?docs.at(-1).id:null,unknownRevisionResponses:job.unknownRevisionResponses,notice:'Only the current form and existing response snapshots can be discovered. Earlier revisions without responses may be missing.'};
 }
 const state=job.malformed||!job.fields?'unavailable':job.conflict?'conflict':'available';
 const mapping=(await mappingRef(db,job.formId,job.revision).get()).data()||null;
 return {...result,result:{status:state,revision:job.revision,...(state==='available'?{fields:job.fields,schemaHash:job.schemaHash,sourceGeneration:job.sourceGeneration,formVersion:job.formVersion,source:job.currentRevision===job.revision?'current form and available response snapshots':'response snapshots',snapshotCount:job.scanned}:{reason:state==='conflict'?'Field snapshots disagree for this revision; review is unavailable until the discrepancy is resolved.':'A complete field snapshot for this revision is unavailable.'}),mapping:mapping?{...mapping,stale:state!=='available'||mapping.schemaHash!==job.schemaHash}:null}};
}
async function completedInspection(db,actor,id,formId,revision){
 const scan=await scanStatus(db,actor,id);
 if(scan.status!=='complete'||scan.mode!=='inspect'||scan.formId!==formId||scan.revision!==revision||scan.result.status!=='available')fail(409,'Complete a current inspection of this revision before continuing.');
 return scan.result;
}
function cleanEntries(entries,fields){
 if(!Array.isArray(entries)||entries.length!==fields.length)fail(400,'Review every question in this revision.');
 const byId=new Map(fields.map(field=>[field.id,field])),seen=new Map();
 for(const entry of entries){
  if(!entry||typeof entry!=='object'||Array.isArray(entry)||Object.keys(entry).some(key=>!['fieldId','role','concept'].includes(key)))fail(400,'Check the mapping entries.');
  const field=byId.get(entry.fieldId);
  if(!field||seen.has(entry.fieldId))fail(400,'Mappings must refer to distinct questions in this revision.');
  const role=entry.role??'',concept=entry.concept??'';
  if(typeof role!=='string'||(role&&(!Object.hasOwn(roles,role)||!roles[role].includes(field.type))))fail(400,'Choose a compatible semantic role for each question.');
  if(typeof concept!=='string'||(concept&&!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(concept)))fail(400,'Concept keys must use lowercase letters, numbers, underscores or hyphens.');
  if(field.type==='consent'&&(role||concept))fail(400,'Consent questions cannot be mapped in this foundation.');
  seen.set(entry.fieldId,{fieldId:entry.fieldId,role,concept});
 }
 return fields.map(field=>seen.get(field.id));
}
async function write(db,actor,input){
 const {formId,action}=input||{},revision=validRevision(input?.revision);
 if(!validId(formId)||!['save','copy','review'].includes(action))fail(400,'Choose a valid mapping action and form.');
 if(!Number.isSafeInteger(input.version)||input.version<0)fail(400,'Reload the mapping before saving.');
 const revisionData=await completedInspection(db,actor,input.scanId,formId,revision);
 const ref=mappingRef(db,formId,revision);
 let entries,copiedFromRevision=null,previousVersion=null;
 if(action==='save')entries=cleanEntries(input.entries,revisionData.fields);
 if(action==='copy'){
  const earlier=validRevision(input.copyFromRevision);
  if(earlier>=revision)fail(400,'Choose an earlier revision to copy.');
  const previous=await completedInspection(db,actor,input.copyScanId,formId,earlier);
  if(previous.status!=='available'||!previous.mapping||previous.mapping.stale)fail(409,'The earlier mapping or its verified field snapshot is unavailable.');
  if(previous.sourceGeneration!==revisionData.sourceGeneration||previous.formVersion!==revisionData.formVersion)fail(409,'The form or responses changed while preparing the copy. Reload both revisions.');
  const oldFields=new Map(previous.fields.map(field=>[field.id,field])),oldEntries=new Map(previous.mapping.entries.map(entry=>[entry.fieldId,entry]));
  entries=revisionData.fields.map(field=>{
   const old=oldFields.get(field.id),entry=oldEntries.get(field.id);
   return old&&entry&&hashSchema([old])===hashSchema([field])?{fieldId:field.id,role:entry.role,concept:entry.concept}:{fieldId:field.id,role:'',concept:''};
  });
  entries=cleanEntries(entries,revisionData.fields);copiedFromRevision=earlier;previousVersion=previous.mapping.version;
 }
 const coverage=db.doc('_insightsState/coverage'),marker=State.versionRef(db,'source',formId),time=new Date().toISOString();
 let result;
 await db.runTransaction(async tx=>{
  const [existing,sourceMarker,coverageSnapshot,formSnapshot,previousSnapshot]=await Promise.all([tx.get(ref),tx.get(marker),tx.get(coverage),tx.get(db.doc(`registrationForms/${formId}`)),copiedFromRevision?tx.get(mappingRef(db,formId,copiedFromRevision)):Promise.resolve(null)]);
  const current=existing.data();
  if((current?.version||0)!==input.version)fail(409,'This mapping changed. Reload it before saving.');
  if((sourceMarker.data()?.generation||0)!==revisionData.sourceGeneration)fail(409,'Responses changed during review. Reload the revision.');
  const formVersion=formSnapshot.exists?`${formSnapshot.updateTime.seconds}:${formSnapshot.updateTime.nanoseconds}`:'';
  if(formVersion!==revisionData.formVersion)fail(409,'The form changed during review. Reload the revision.');
  if(previousSnapshot&&(previousSnapshot.data()?.version||0)!==previousVersion)fail(409,'The earlier mapping changed. Reload it before copying.');
  if(action==='review'){
   if(!current||current.status!=='draft'||current.schemaHash!==revisionData.schemaHash)fail(409,'Save a current draft before reviewing this revision.');
   entries=cleanEntries(current.entries,revisionData.fields);
   copiedFromRevision=current.copiedFromRevision||null;
  }
  await State.bumpIndexVersionTx(tx,db,formId);
  result={formId,revision,version:input.version+1,status:action==='review'?'reviewed':'draft',schemaHash:revisionData.schemaHash,entries,copiedFromRevision,updatedAt:time,updatedBy:actor.uid,...(action==='review'?{reviewedAt:time,reviewedBy:actor.uid}:{})};
  tx.set(ref,result);
  tx.set(coverage,{...(coverageSnapshot.data()||{}),status:'incomplete',updatedAt:`${time}-${randomUUID()}`,reason:'Field mapping changes require a fresh coverage review.'});
  tx.create(db.collection('auditLog').doc(),{module:'form-insights',entityType:'field-mapping',entityId:formId,revision,action:action==='review'?'insights.mapping_reviewed':action==='copy'?'insights.mapping_copied':'insights.mapping_draft_saved',userId:actor.uid,userEmail:actor.email,timestamp:time});
 });
 return result;
}
module.exports={roles,startScan,stepScan,cancelScan,scanStatus,write,cleanEntries,schema,hashSchema};
