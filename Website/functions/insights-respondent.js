const {createHash,randomUUID}=require('node:crypto');
const Mapping=require('./insights-mapping');
const State=require('./insights-state');
const {isOwner,normalizeEmail,sessionAllowed}=require('./adminAccess');
const {hasModule,accessActive}=require('./moduleAccess');
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const digest=value=>createHash('sha256').update(value).digest('hex');
const sourceKey=(formId,responseId)=>digest(formId+':'+responseId);
const sourceRef=(db,formId,responseId)=>db.doc(`registrationForms/${formId}/responses/${responseId}`);
const mappingRef=(db,formId,revision)=>db.doc(`_insightsState/fieldMappings/forms/${formId}/revisions/${revision}`);
const linkRef=(db,key)=>db.doc(`_respondentLinks/${key}`);
const personRef=(db,id)=>db.doc(`_respondents/${id}`);
const bucketRef=(db,key)=>db.doc(`_respondentContacts/${key}`);
const mergeRef=(db,id)=>db.doc(`_respondentMerges/${id}`);
const identityRef=db=>db.doc('_insightsState/respondentVersion');
const version=doc=>doc.exists?`${doc.updateTime.seconds}:${doc.updateTime.nanoseconds}`:'';
const validForm=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value);
const validResponse=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const validPerson=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value);
function email(value){
 if(typeof value!=='string')return '';
 const result=value.normalize('NFKC').trim().toLowerCase();
 return result.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)?result:'';
}
function mobile(value){
 if(typeof value!=='string'||!/^\+?[\d\s().-]+$/.test(value.trim()))return '';
 let n=value.trim().replace(/[\s().-]/g,'');
 if(/^04\d{8}$/.test(n))n='+61'+n.slice(1);
 if(/^614\d{8}$/.test(n))n='+'+n;
 return /^\+[1-9]\d{7,14}$/.test(n)?n:'';
}
function evidence(response,mapping){
 const schema=Mapping.schema(response?.fields);
 if(!schema||mapping?.status!=='reviewed'||mapping.schemaHash!==Mapping.hashSchema(schema)||!Array.isArray(mapping.entries)||!response.answers||typeof response.answers!=='object'||Array.isArray(response.answers))return null;
 let entries;try{entries=Mapping.cleanEntries(mapping.entries,schema);}catch{return null;}
 const output={names:[],emails:[],mobiles:[]};
 for(const entry of entries){
  const value=response.answers[entry.fieldId];
  if(entry.role==='respondent-name'&&typeof value==='string'&&value.trim())output.names.push(value.trim());
  if(entry.role==='respondent-email'){const normal=email(value);if(normal)output.emails.push(normal);}
  if(entry.role==='respondent-mobile'){const normal=mobile(value);if(normal)output.mobiles.push(normal);}
 }
 if(new Set(output.names.map(value=>value.normalize('NFKC').toLowerCase().replace(/\s+/g,' '))).size>1||new Set(output.emails).size>1||new Set(output.mobiles).size>1)return null;
 return output;
}
function contacts(e){return [...new Set([...e.emails.map(value=>'email:'+value),...e.mobiles.map(value=>'mobile:'+value)])].sort().map(digest);}
async function inspected(db,actor,formId,responseId,scanId){
 if(!validForm(formId)||!validResponse(responseId))fail(400,'Choose valid source references.');
 const source=await sourceRef(db,formId,responseId).get(),data=source.data();
 if(!source.exists||!Number.isSafeInteger(data.revision))fail(404,'Source response or revision is unavailable.');
 const scan=await Mapping.scanStatus(db,actor,scanId);
 if(scan.status!=='complete'||scan.mode!=='inspect'||scan.formId!==formId||scan.revision!==data.revision||scan.result.status!=='available')fail(409,'Complete a fresh inspection of this response revision first.');
 const mapping=scan.result.mapping;
 if(!mapping||mapping.stale||mapping.status!=='reviewed')fail(409,'This revision needs a reviewed, current mapping.');
 const values=evidence(data,mapping);
 if(!values)fail(409,'The saved response snapshot conflicts with its reviewed mapping.');
 if(!values.names.length&&!values.emails.length&&!values.mobiles.length)fail(409,'This response has no usable mapped respondent information and remains unresolved.');
 return {source,data,scan,mapping,values,keys:contacts(values)};
}
async function isFresh(db,link){
 if(!link||link.status!=='linked')return false;
 const [source,mapping,marker]=await Promise.all([sourceRef(db,link.formId,link.responseId).get(),mappingRef(db,link.formId,link.revision).get(),State.versionRef(db,'source',link.formId).get()]);
 return source.exists&&version(source)===link.sourceVersion&&(marker.data()?.generation||0)===link.sourceGeneration&&mapping.data()?.version===link.mappingVersion&&!!evidence(source.data(),mapping.data());
}
async function inspect(db,actor,input){
 const initialIdentity=await identityRef(db).get();
 const target=await inspected(db,actor,input.formId,input.responseId,input.scanId);
 const key=sourceKey(input.formId,input.responseId),currentSnap=await linkRef(db,key).get(),current=currentSnap.data();
 const candidates=new Map();let stale=0;
 for(const hash of target.keys){
  const page=await bucketRef(db,hash).collection('links').orderBy('__name__').limit(51).get();
  if(page.size>50)fail(422,'More than 50 contact candidates require review. Narrow the source scope; no partial candidate list is shown.');
  for(const doc of page.docs){
   if(doc.id===key)continue;
   const link=(await linkRef(db,doc.id).get()).data();
   if(!await isFresh(db,link)){stale++;continue;}
   if(link.contactHashes?.includes(hash)){
    const [person,source,mapping]=await Promise.all([personRef(db,link.personId).get(),sourceRef(db,link.formId,link.responseId).get(),mappingRef(db,link.formId,link.revision).get()]);
    const value=evidence(source.data(),mapping.data());
    if(person.exists&&!person.data()?.mergedInto&&version(source)===link.sourceVersion&&value)candidates.set(link.personId,{id:link.personId,source:{formId:link.formId,responseId:link.responseId},names:value.names,match:'Exact contact candidate',sourceVersion:link.sourceVersion,mappingVersion:link.mappingVersion,sourceGeneration:link.sourceGeneration});
   }
  }
 }
 const [sourceAfter,marker,mapping]=await Promise.all([target.source.ref.get(),State.versionRef(db,'source',input.formId).get(),mappingRef(db,input.formId,target.data.revision).get()]);
 if(version(sourceAfter)!==version(target.source)||(marker.data()?.generation||0)!==target.scan.result.sourceGeneration||mapping.data()?.version!==target.mapping.version)fail(409,'The source or mapping changed. Inspect again.');
 const state=!current||current.status!=='linked'?'unresolved':await isFresh(db,current)?'linked':'review-required';
 if(version(await identityRef(db).get())!==version(initialIdentity))fail(409,'Respondent links changed. Inspect again.');
 const list=[...candidates.values()].sort((a,b)=>a.id.localeCompare(b.id));
 const reviewToken=digest(JSON.stringify({sourceVersion:version(target.source),mappingVersion:target.mapping.version,sourceGeneration:target.scan.result.sourceGeneration,currentVersion:version(currentSnap),candidates:list}));
 return {source:{formId:input.formId,responseId:input.responseId,revision:target.data.revision,reference:target.data.reference||'',names:target.values.names},status:state,personId:current?.status==='linked'?current.personId:null,candidates:list,reviewToken,linkVersion:version(currentSnap),candidateCount:candidates.size,staleCandidateCount:stale,unresolvedCount:state==='unresolved'||state==='review-required'?1:0,notice:'Counts cover this one response only. Exact contacts are suggestions, not confirmed identities. Participants and household size are separate.'};
}
async function validateReviewer(tx,db,actor){
 const [user,settings,listed]=await Promise.all([tx.get(db.doc('users/'+actor.uid)),tx.get(db.doc('calendarSettings/auth')),tx.get(db.doc('adminAllowlist/'+actor.email))]);
 if(user.data()?.role!=='admin'||normalizeEmail(user.data()?.email)!==actor.email||
    !sessionAllowed({provider:actor.provider||'',passwordLoginDisabled:settings.data()?.passwordLoginDisabled===true})||
    (!isOwner(actor.email)&&(!listed.exists||listed.data()?.uid!==actor.uid||!accessActive(listed.data())||!hasModule(actor.email,listed.data(),'form-insights-people'))))fail(403,'Respondent review access changed. Review again.');
}
async function history(db,input){
 const {personId,after='',personVersion=''}=input||{};
 if(!validPerson(personId)||typeof after!=='string'||(after&&!/^[a-f0-9]{64}$/.test(after)))fail(400,'Choose a valid respondent and history cursor.');
 const person=await personRef(db,personId).get();
 if(!person.exists)fail(404,'Respondent is unavailable.');
 if(person.data()?.mergedInto)fail(409,'This respondent was merged. Inspect a current linked response.');
 if(after&&personVersion!==version(person))fail(409,'Respondent history changed. Start again.');
 let query=db.collection('_respondentLinks').where('personId','==',personId).orderBy('__name__');
 if(after)query=query.startAfter(after);
 const page=await query.limit(51).get(),docs=page.docs.slice(0,50),items=[];
 for(const doc of docs){
  const link=doc.data();
  if(link.status==='linked')items.push({formId:link.formId,responseId:link.responseId,revision:link.revision,status:await isFresh(db,link)?'linked':'review-required'});
 }
 if(version(await person.ref.get())!==version(person))fail(409,'Respondent history changed. Start again.');
 return {personId,personVersion:version(person),lastMergeOperation:person.data()?.lastMergeOperation||null,items,next:page.size>50?docs.at(-1).id:null,notice:'Only explicitly linked respondent responses are shown. Stale links require review. This is not a participant, household or attendance history.'};
}
async function change(db,actor,input){
 const {formId,responseId,scanId,action}=input||{};
 if(!['create','link','unlink','reconfirm'].includes(action))fail(400,'Choose a valid respondent action.');
 if(!validForm(formId)||!validResponse(responseId))fail(400,'Choose valid source references.');
 if(action==='unlink'){
  const ref=linkRef(db,sourceKey(formId,responseId)),stamp=new Date().toISOString();
  await db.runTransaction(async tx=>{
   const current=await tx.get(ref),old=current.data(),coverageRef=db.doc('_insightsState/coverage'),coverage=await tx.get(coverageRef);
   await validateReviewer(tx,db,actor);
   if(!old||old.status!=='linked')fail(409,'This response has no link to remove.');
   const person=await tx.get(personRef(db,old.personId));
   const identity=await tx.get(identityRef(db));
   if(!person.exists||person.data()?.mergedInto)fail(409,'Respondent changed. Inspect again.');
   await State.bumpIndexVersionTx(tx,db,formId);
   tx.set(identityRef(db),{generation:(identity.data()?.generation||0)+1});
   tx.update(person.ref,{linkRevision:(person.data().linkRevision||0)+1});
   for(const hash of old.contactHashes||[])tx.delete(bucketRef(db,hash).collection('links').doc(ref.id));
   tx.set(ref,{...old,status:'unlinked',contactHashes:[],updatedAt:stamp,updatedBy:actor.uid});
   tx.set(coverageRef,{...(coverage.data()||{}),status:'incomplete',updatedAt:`${stamp}-${randomUUID()}`,reason:'Respondent links changed; coverage requires review.'});
   tx.create(db.collection('auditLog').doc(),{module:'form-insights',entityType:'respondent-link',action:'insights.respondent_unlink',formId,responseId,personId:old.personId,userId:actor.uid,userEmail:actor.email,timestamp:stamp});
  });
  return {ok:true,personId:null};
 }
 const target=await inspected(db,actor,formId,responseId,scanId),key=sourceKey(formId,responseId),ref=linkRef(db,key);
 const personId=action==='create'?randomUUID():input.personId;
 if(action==='link'&&!validPerson(personId))fail(400,'Choose a valid respondent.');
 let candidateKey='',reviewedCandidate=null;
 const preview=await inspect(db,actor,input);
 if(typeof input.reviewToken!=='string'||input.reviewToken!==preview.reviewToken)fail(409,'Review evidence changed. Inspect again before confirming.');
 if(action==='link'){
  const candidate=preview.candidates.find(item=>item.id===personId);
  if(!candidate)fail(409,'The candidate is no longer available. Inspect again.');
  reviewedCandidate=candidate;
  candidateKey=sourceKey(candidate.source.formId,candidate.source.responseId);
 }
 const stamp=new Date().toISOString();
 await db.runTransaction(async tx=>{
  const current=await tx.get(ref),source=await tx.get(target.source.ref),mapping=await tx.get(mappingRef(db,formId,target.data.revision)),marker=await tx.get(State.versionRef(db,'source',formId));
  const old=current.data(),resolvedPerson=action==='reconfirm'?old?.personId:personId;
  const selected=action!=='create'&&validPerson(resolvedPerson)?await tx.get(personRef(db,resolvedPerson)):null,candidate=action==='link'?(await tx.get(linkRef(db,candidateKey))).data():null;
  let candidateSource,candidateMapping,candidateMarker;
  if(candidate){
   [candidateSource,candidateMapping,candidateMarker]=await Promise.all([tx.get(sourceRef(db,candidate.formId,candidate.responseId)),tx.get(mappingRef(db,candidate.formId,candidate.revision)),tx.get(State.versionRef(db,'source',candidate.formId))]);
  }
  const coverageRef=db.doc('_insightsState/coverage'),coverage=await tx.get(coverageRef);
  const identity=await tx.get(identityRef(db));
  await validateReviewer(tx,db,actor);
  if(version(current)!==preview.linkVersion)fail(409,'The response link changed. Inspect again.');
  if(version(source)!==version(target.source)||(marker.data()?.generation||0)!==target.scan.result.sourceGeneration||mapping.data()?.version!==target.mapping.version||mapping.data()?.status!=='reviewed')fail(409,'Source or mapping changed. Inspect again.');
  if(action==='reconfirm'&&(!old||old.status!=='linked'))fail(409,'There is no existing link to reconfirm.');
  if(action!=='reconfirm'&&old?.status==='linked')fail(409,'Remove the existing link before linking again.');
  if(action!=='create'&&(!selected?.exists||selected.data()?.mergedInto))fail(409,'Respondent is unavailable or merged.');
  if(action==='link'&&(!candidate||candidate.status!=='linked'||candidate.personId!==personId||
     candidate.sourceVersion!==reviewedCandidate.sourceVersion||candidate.mappingVersion!==reviewedCandidate.mappingVersion||candidate.sourceGeneration!==reviewedCandidate.sourceGeneration||
     version(candidateSource)!==candidate.sourceVersion||(candidateMarker.data()?.generation||0)!==candidate.sourceGeneration||
     candidateMapping.data()?.version!==candidate.mappingVersion||!evidence(candidateSource.data(),candidateMapping.data())||
     !candidate.contactHashes?.some(hash=>target.keys.includes(hash))))fail(409,'The candidate changed. Inspect again.');
  await State.bumpIndexVersionTx(tx,db,formId);
  tx.set(identityRef(db),{generation:(identity.data()?.generation||0)+1});
  if(action==='create')tx.create(personRef(db,personId),{createdAt:stamp,createdBy:actor.uid,linkRevision:1});
  else tx.update(selected.ref,{linkRevision:(selected.data().linkRevision||0)+1});
  const oldHashes=old?.contactHashes||[];
  for(const hash of oldHashes)tx.delete(bucketRef(db,hash).collection('links').doc(key));
  const next={formId,responseId,revision:target.data.revision,personId:resolvedPerson,status:'linked',sourceVersion:version(source),sourceGeneration:marker.data()?.generation||0,mappingVersion:mapping.data().version,contactHashes:target.keys,updatedAt:stamp,updatedBy:actor.uid};
  tx.set(ref,next);
  for(const hash of target.keys)tx.set(bucketRef(db,hash).collection('links').doc(key),{personId:resolvedPerson});
  tx.set(coverageRef,{...(coverage.data()||{}),status:'incomplete',updatedAt:`${stamp}-${randomUUID()}`,reason:'Respondent links changed; coverage requires review.'});
  tx.create(db.collection('auditLog').doc(),{module:'form-insights',entityType:'respondent-link',action:'insights.respondent_'+action,formId,responseId,personId:resolvedPerson,userId:actor.uid,userEmail:actor.email,timestamp:stamp});
 });
 return {ok:true,personId:action==='reconfirm'?null:personId};
}
const MERGE_LIMIT=40;
async function mergeSnapshot(db,reader,sourceId,targetId,{undo=false}={}){
 if(!validPerson(sourceId)||!validPerson(targetId)||sourceId===targetId)fail(400,'Choose two different respondents.');
 const get=ref=>reader?reader.get(ref):ref.get();
 const [sourcePerson,targetPerson,sourceLinks,targetLinks]=await Promise.all([
  get(personRef(db,sourceId)),get(personRef(db,targetId)),
  get(db.collection('_respondentLinks').where('personId','==',sourceId).orderBy('__name__').limit(MERGE_LIMIT+1)),
  get(db.collection('_respondentLinks').where('personId','==',targetId).orderBy('__name__').limit(MERGE_LIMIT+1))
 ]);
 if(!sourcePerson.exists||!targetPerson.exists||targetPerson.data()?.mergedInto||
    (!undo&&sourcePerson.data()?.mergedInto)||(undo&&sourcePerson.data()?.mergedInto!==targetId))fail(409,'One respondent is unavailable or has already been merged.');
 const docs=[...sourceLinks.docs,...targetLinks.docs];
 if(docs.length>MERGE_LIMIT||sourceLinks.size>MERGE_LIMIT||targetLinks.size>MERGE_LIMIT)fail(422,`This merge exceeds the ${MERGE_LIMIT}-link inspection limit, including inactive links. Nothing was changed.`);
 const linked=docs.filter(doc=>doc.data().status==='linked'),details=[];
 for(const doc of linked){
  const link=doc.data();
  const [source,mapping,marker]=await Promise.all([get(sourceRef(db,link.formId,link.responseId)),get(mappingRef(db,link.formId,link.revision)),get(State.versionRef(db,'source',link.formId))]);
  const values=evidence(source.data(),mapping.data());
  if(!source.exists||version(source)!==link.sourceVersion||(marker.data()?.generation||0)!==link.sourceGeneration||
     mapping.data()?.version!==link.mappingVersion||!values)fail(409,'A linked response or mapping is stale or unresolved. Reinspect and reconfirm it before merging or undoing.');
  details.push({id:doc.id,link,linkVersion:version(doc),names:values.names,values,sourceVersion:version(source),mappingVersion:link.mappingVersion,sourceGeneration:link.sourceGeneration});
 }
 return {sourcePerson,targetPerson,docs,details};
}
function mergeFingerprint(snapshot){
 return digest(JSON.stringify({people:[version(snapshot.sourcePerson),version(snapshot.targetPerson)],links:snapshot.docs.map(doc=>[doc.id,version(doc)]),evidence:snapshot.details.map(row=>[row.id,row.sourceVersion,row.mappingVersion,row.sourceGeneration])}));
}
async function mergePreview(db,input){
 const snap=await mergeSnapshot(db,null,input.sourceId,input.targetId);
 const left=snap.details.filter(row=>row.link.personId===input.sourceId),right=snap.details.filter(row=>row.link.personId===input.targetId);
 if(!left.length||!right.length)fail(409,'Both respondents must have at least one current reviewed response link.');
 const sharedTypes=['emails','mobiles'].filter(type=>left.some(a=>right.some(b=>a.values[type].some(value=>b.values[type].includes(value)))));
 if(!sharedTypes.length)fail(409,'No current exact-contact candidate connects these respondents.');
 return {sourceId:input.sourceId,targetId:input.targetId,sourceCount:left.length,targetCount:right.length,inspectedLinks:snap.docs.length,limit:MERGE_LIMIT,reviewToken:mergeFingerprint(snap),
  sharedTypes:sharedTypes.map(type=>type==='emails'?'email':'mobile'),
  sources:snap.details.map(row=>({personId:row.link.personId,formId:row.link.formId,responseId:row.link.responseId,revision:row.link.revision,names:row.names})),
  notice:'Exact shared contact is a suggestion, not proof: household members may share it. Unmapped and unlinked responses are not counted. Source answers and consent do not change.'};
}
async function mergeConfirm(db,actor,input){
 if(typeof input.reviewToken!=='string')fail(400,'Review the complete merge preview first.');
 const id=randomUUID(),stamp=new Date().toISOString();
 await db.runTransaction(async tx=>{
  const snap=await mergeSnapshot(db,tx,input.sourceId,input.targetId),coverageRef=db.doc('_insightsState/coverage'),coverage=await tx.get(coverageRef),identity=await tx.get(identityRef(db));
  await validateReviewer(tx,db,actor);
  if(mergeFingerprint(snap)!==input.reviewToken)fail(409,'Merge evidence changed. Review the preview again.');
  const left=snap.details.filter(row=>row.link.personId===input.sourceId),right=snap.details.filter(row=>row.link.personId===input.targetId);
  if(!left.length||!right.length||!['emails','mobiles'].some(type=>left.some(a=>right.some(b=>a.values[type].some(value=>b.values[type].includes(value))))))fail(409,'The current shared-contact candidate is unavailable.');
  await State.bumpIndexVersionTx(tx,db,left[0].link.formId);
  tx.set(identityRef(db),{generation:(identity.data()?.generation||0)+1});
  const entries=snap.docs.map(doc=>{
   const data=doc.data(),moved=data.status==='linked'&&data.personId===input.sourceId;
   const next=moved?{...data,personId:input.targetId,mergeOperation:id,updatedAt:stamp,updatedBy:actor.uid}:data;
   if(moved){tx.set(doc.ref,next);for(const hash of data.contactHashes)tx.set(bucketRef(db,hash).collection('links').doc(doc.id),{personId:input.targetId});}
   return {id:doc.id,moved,expected:moved?digest(JSON.stringify(next)):version(doc)};
  });
  const sourceRevision=(snap.sourcePerson.data().linkRevision||0)+1,targetRevision=(snap.targetPerson.data().linkRevision||0)+1;
  tx.update(snap.sourcePerson.ref,{mergedInto:input.targetId,mergeOperation:id,lastMergeOperation:id,linkRevision:sourceRevision});
  tx.update(snap.targetPerson.ref,{lastMergeOperation:id,linkRevision:targetRevision});
  tx.create(mergeRef(db,id),{version:1,status:'merged',sourceId:input.sourceId,targetId:input.targetId,sourceRevision,targetRevision,entries,createdAt:stamp,createdBy:actor.uid});
  tx.set(coverageRef,{...(coverage.data()||{}),status:'incomplete',updatedAt:`${stamp}-${id}`,reason:'Respondent links changed; coverage requires review.'});
  tx.create(db.collection('auditLog').doc(),{module:'form-insights',entityType:'respondent-merge',action:'insights.respondent_merge',operationId:id,sourceId:input.sourceId,targetId:input.targetId,count:left.length,userId:actor.uid,userEmail:actor.email,timestamp:stamp});
 });
 return {ok:true,operationId:id};
}
async function mergeUndo(db,actor,input){
 if(!validPerson(input.operationId))fail(400,'Choose a valid merge operation.');
 const stamp=new Date().toISOString();
 await db.runTransaction(async tx=>{
  const operation=await tx.get(mergeRef(db,input.operationId)),ledger=operation.data();
  if(!ledger||ledger.status!=='merged'||ledger.version!==1)fail(409,'This merge is unavailable or already undone.');
  const snap=await mergeSnapshot(db,tx,ledger.sourceId,ledger.targetId,{undo:true}),coverageRef=db.doc('_insightsState/coverage'),coverage=await tx.get(coverageRef),identity=await tx.get(identityRef(db));
  await validateReviewer(tx,db,actor);
  if(snap.sourcePerson.data()?.mergeOperation!==input.operationId||snap.sourcePerson.data()?.linkRevision!==ledger.sourceRevision||snap.targetPerson.data()?.linkRevision!==ledger.targetRevision)fail(409,'A respondent changed after this merge. Undo would overwrite later work.');
  const docs=new Map(snap.docs.map(doc=>[doc.id,doc]));
  if(docs.size!==ledger.entries.length||ledger.entries.some(entry=>{
   const doc=docs.get(entry.id);return !doc||(entry.moved?digest(JSON.stringify(doc.data()))!==entry.expected:version(doc)!==entry.expected);
  }))fail(409,'A response link changed after this merge. Undo would overwrite later work.');
  const moving=ledger.entries.filter(entry=>entry.moved);
  if(!moving.length)fail(409,'This merge has no recoverable links.');
  await State.bumpIndexVersionTx(tx,db,docs.get(moving[0].id).data().formId);
  tx.set(identityRef(db),{generation:(identity.data()?.generation||0)+1});
  for(const entry of moving){
   const doc=docs.get(entry.id),data=doc.data(),next={...data,personId:ledger.sourceId,updatedAt:stamp,updatedBy:actor.uid};delete next.mergeOperation;
   tx.set(doc.ref,next);for(const hash of data.contactHashes)tx.set(bucketRef(db,hash).collection('links').doc(doc.id),{personId:ledger.sourceId});
  }
  tx.update(snap.sourcePerson.ref,{mergedInto:null,mergeOperation:null,linkRevision:ledger.sourceRevision+1});
  tx.update(snap.targetPerson.ref,{linkRevision:ledger.targetRevision+1});
  tx.update(operation.ref,{status:'undone',version:2,undoneAt:stamp,undoneBy:actor.uid});
  tx.set(coverageRef,{...(coverage.data()||{}),status:'incomplete',updatedAt:`${stamp}-${input.operationId}`,reason:'Respondent links changed; coverage requires review.'});
  tx.create(db.collection('auditLog').doc(),{module:'form-insights',entityType:'respondent-merge',action:'insights.respondent_merge_undo',operationId:input.operationId,sourceId:ledger.sourceId,targetId:ledger.targetId,count:moving.length,userId:actor.uid,userEmail:actor.email,timestamp:stamp});
 });
 return {ok:true};
}
module.exports={email,mobile,evidence,contacts,inspect,history,change,isFresh,mergePreview,mergeConfirm,mergeUndo};
