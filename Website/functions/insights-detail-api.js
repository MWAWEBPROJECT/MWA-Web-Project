const {randomUUID,createHash}=require('node:crypto');
const {FieldPath}=require('firebase-admin/firestore');
const {resolveAdmin,accessActive,effectiveModules}=require('./moduleAccess');
const {isOwner,isValidEmail,normalizeEmail,sessionAllowed}=require('./adminAccess');
const {midnight,validDate,publicEvent}=require('./donation-records');
const State=require('./insights-state');
const Scope=require('./insights-detail-scope');
const Programme=require('./insights-programmes');
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const grantRef=(db,email)=>db.doc('_insightsDetailGrants/'+email);
const jobRef=(db,id)=>db.doc('_insightsDetailJobs/'+id);
const LIMIT=20000,BATCH=100,LEDGER_BYTES=700000;
const validEventId=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(id);
const stamp=doc=>doc.exists?`${doc.updateTime.seconds}:${doc.updateTime.nanoseconds}`:'missing';
function addLedger(ledger,docs){
 const result={...ledger};
 for(const doc of docs){
  const version=stamp(doc),path=doc.ref.path;
  if(Object.hasOwn(result,path)&&result[path]!==version)fail(409,'Calendar or programme reviews changed. Start again.');
  result[path]=version;
 }
 if(Buffer.byteLength(JSON.stringify(result),'utf8')>LEDGER_BYTES)fail(422,'The calendar review ledger is too large for one complete preparation. Narrow the scope; no partial export is available.');
 return result;
}
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const audit=(db,tx,actor,action,details={})=>tx.create(db.collection('auditLog').doc(),{module:'form-insights',entityType:'detail-export',action,userId:actor.uid,userEmail:actor.email,timestamp:new Date().toISOString(),...details});
const sourceRefs=db=>[...State.versionRefs(db,'source'),State.formsVersionRef(db)];
const generations=docs=>docs.map(doc=>doc.data()?.generation||0);
async function versions(db){return generations(await db.getAll(...sourceRefs(db)));}
async function txVersions(tx,db){return generations(await tx.getAll(...sourceRefs(db)));}
function expiry(date){
 if(!validDate(date)||date>='9999-12-31')fail(400,'Choose a valid Sydney expiry date.');
 const next=new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString().slice(0,10),value=new Date(midnight(next)).toISOString();
 if(Date.parse(value)<=Date.now())fail(400,'Choose a future expiry date.');
 return value;
}
async function currentGrant(db,actor){
 if(isOwner(actor.email))return null;
 const grant=(await grantRef(db,actor.email).get()).data();
 if(!Scope.activeGrant(grant,actor,grant?.revision))fail(403,'Response-detail export is not assigned or has expired.');
 return grant;
}
async function validateTx(tx,db,actor,job){
 const user=await tx.get(db.doc('users/'+actor.uid)),entry=await tx.get(db.doc('adminAllowlist/'+actor.email)),settings=await tx.get(db.doc('calendarSettings/auth'));
 if(user.data()?.role!=='admin'||normalizeEmail(user.data()?.email)!==actor.email||
    (!isOwner(actor.email)&&(!entry.exists||entry.data()?.uid!==actor.uid||!accessActive(entry.data())))||
    !sessionAllowed({provider:actor.provider,passwordLoginDisabled:settings.data()?.passwordLoginDisabled===true}))fail(403,'Admin access changed. Discard this export.');
 const snap=isOwner(actor.email)?null:await tx.get(grantRef(db,actor.email));
 if(!Scope.activeGrant(snap?.data(),actor,job.grantRevision))fail(403,'Your response-detail assignment changed or expired. Discard this export.');
 if(snap&&!equal(Scope.cleanScope(snap.data()),job.assignedScope||job.scope))fail(409,'Your assigned scope changed. Discard this export.');
 if(snap&&job.mode!=='view'&&snap.data().permission==='view')fail(403,'Your assignment permits viewing only.');
 if(!equal(await txVersions(tx,db),job.versions))fail(409,'Source responses changed during export. Start again.');
 if(job.calendarFiltered){
  const calendarAccess=isOwner(actor.email)||effectiveModules(entry.data()).includes('events-bookings');
  if(calendarAccess!==job.calendarAccess)fail(403,'Calendar access changed. Start again.');
  const entries=Object.entries(job.ledger||{});
  for(let offset=0;offset<entries.length;offset+=200){
   const slice=entries.slice(offset,offset+200),docs=await tx.getAll(...slice.map(([path])=>db.doc(path)));
   if(docs.some((doc,index)=>stamp(doc)!==slice[index][1]))fail(409,'Calendar or programme reviews changed. Start again.');
  }
 }
}
function validJobId(id){return typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id);}
function ensureJob(job,actor){
 if(!job||job.uid!==actor.uid||job.email!==actor.email)fail(404,'Export preparation not found.');
 if(!Number.isFinite(Date.parse(job.createdAt))||Date.now()-Date.parse(job.createdAt)>86400000)fail(409,'Export preparation expired. Start again.');
}

async function handle(req,res,{db,getAuth,origins}){
 try{
  const match=/^Bearer (.+)$/.exec(req.get('Authorization')||'');
  if(!match)fail(401,'Sign in to export response details.');
  let token;try{token=await getAuth().verifyIdToken(match[1],true);}catch{fail(401,'Sign in again.');}
  const resolved=await resolveAdmin(db,token.uid,token);if(!resolved)fail(403,'An active verified admin account is required.');
  const actor={...resolved,provider:token.firebase?.sign_in_provider||''};
  const path=req.path.replace(/^\/api\/insights-detail/,'').replace(/\/$/,'')||'/';
  if(req.method!=='GET'&&(!origins.has(req.get('Origin'))||!req.is('application/json')))fail(403,'Use the MWA website.');
  if(path==='/grants'){
   if(!isOwner(actor.email))fail(403,'Only Super Admin can manage detail-export assignments.');
   if(req.method==='GET'){
    const after=req.query.after||'';if(after&&!isValidEmail(after))fail(400,'Invalid page reference.');
    let q=db.collection('_insightsDetailGrants').orderBy('__name__');if(after)q=q.startAfter(after);
    const snap=await q.limit(51).get(),docs=snap.docs.slice(0,50);
    return res.json({items:docs.map(doc=>doc.data()),next:snap.size>50?docs.at(-1).id:null});
   }
   if(req.method!=='POST')fail(405,'Method not allowed.');
   const input=req.body||{},email=normalizeEmail(input.email);
   if(!isValidEmail(email)||isOwner(email)||!Number.isSafeInteger(input.revision)||input.revision<0||typeof input.revoke!=='boolean')fail(400,'Choose an existing admin and valid assignment revision.');
   if(!input.revoke&&!['view','export'].includes(input.permission||'export'))fail(400,'Choose view-only or view-and-export access.');
   const scope=input.revoke?null:Scope.cleanScope(input),expiresAt=input.revoke?null:expiry(input.expiryDate);
   if(!input.revoke){
    for(const id of scope.formIds)if(!(await db.doc('registrationForms/'+id).get()).exists)fail(400,'A selected form is unavailable.');
    for(const id of scope.eventIds)if(!(await db.doc('events/'+id).get()).exists)fail(400,'A selected event is unavailable.');
   }
   await db.runTransaction(async tx=>{
    const ref=grantRef(db,email),old=await tx.get(ref),admin=await tx.get(db.doc('adminAllowlist/'+email));
    if((old.data()?.revision||0)!==input.revision)fail(409,'Assignment changed. Reload before saving.');
    if(input.revoke&&!old.exists)fail(404,'Assignment not found.');
    let uid=old.data()?.uid;
    if(!input.revoke){
     const entry=admin.data();uid=entry?.uid;
     if(!admin.exists||typeof uid!=='string'||!uid||!accessActive(entry))fail(400,'Choose an active, bound existing admin.');
     const user=await tx.get(db.doc('users/'+uid));
     if(user.data()?.role!=='admin'||normalizeEmail(user.data()?.email)!==email)fail(400,'The selected admin account is not currently bound.');
    }
    const next=input.revoke?{...old.data(),revoked:true,revision:input.revision+1}:{email,uid,...scope,permission:input.permission||'export',expiresAt,expiryDate:input.expiryDate,revoked:false,revision:input.revision+1};
    tx.set(ref,next);audit(db,tx,actor,input.revoke?'insights.detail_grant_revoked':'insights.detail_grant_assigned',{targetUid:uid,formCount:next.formIds.length,eventCount:next.eventIds.length,revision:next.revision});
   });
   return res.json({ok:true});
  }
  if(path==='/session'&&req.method==='GET'){
   const grant=await currentGrant(db,actor);
   return res.json({owner:isOwner(actor.email),grant:grant?{formIds:grant.formIds,eventIds:grant.eventIds,permission:grant.permission||'export',expiresAt:grant.expiresAt,revision:grant.revision}:null});
  }
  if(path==='/programme-options'&&req.method==='GET'){
   await currentGrant(db,actor);
   return res.json({categories:await Programme.catalog(db)});
  }
  if(path==='/start'&&req.method==='POST'){
   const grant=await currentGrant(db,actor),mode=req.body?.mode||'export';
   if(!['view','export'].includes(mode))fail(400,'Choose a valid detail operation.');
   if(mode==='export'&&grant?.permission==='view')fail(403,'Your assignment permits viewing only.');
   const assignedScope=isOwner(actor.email)?Scope.cleanScope(req.body):Scope.cleanScope(grant);
   let scope=assignedScope;
   const {formId='',eventId='',search='',from='',to='',basis='submission'}=req.body||{};
   if([formId,eventId,search,from,to].some(value=>typeof value!=='string')||search.length>200)fail(400,'Choose valid filters and search text of at most 200 characters.');
   if(!['submission','event'].includes(basis))fail(400,'Choose submission date or current event date.');
   if((from||to)&&(!validDate(from)||!validDate(to)||from>to||to>='9999-12-31'))fail(400,'Choose a valid Sydney date range.');
   if(basis==='event'&&!from)fail(400,'Choose both Sydney event dates.');
   const programme=Programme.filters(req.body||{}),calendarFiltered=basis==='event'||Programme.active(programme);
   if(formId||eventId){
    const selected=Scope.cleanScope({formIds:formId?[formId]:[],eventIds:eventId?[eventId]:[]});
    if((formId&&assignedScope.formIds.length&&!assignedScope.formIds.includes(formId))||(eventId&&assignedScope.eventIds.length&&!assignedScope.eventIds.includes(eventId)))fail(403,'The selected filter is outside your assigned scope.');
    scope={formIds:formId?selected.formIds:assignedScope.formIds,eventIds:eventId?selected.eventIds:assignedScope.eventIds};
   }
   const start=from?new Date(midnight(from)).toISOString():'',end=to?new Date(midnight(new Date(Date.parse(to+'T00:00:00Z')+86400000).toISOString().slice(0,10))).toISOString():'';
   const id=randomUUID(),job={uid:actor.uid,email:actor.email,scope,assignedScope,mode,searchHash:createHash('sha256').update(search).digest('hex'),from,to,start,end,basis,programme,calendarFiltered,calendarAccess:actor.modules.includes('events-bookings'),ledger:{},grantRevision:grant?.revision||null,versions:await versions(db),position:0,cursor:'',scanned:0,count:0,step:0,status:'running',createdAt:new Date().toISOString()};
   await db.runTransaction(async tx=>{
    await validateTx(tx,db,actor,job);tx.create(jobRef(db,id),job);
    audit(db,tx,actor,mode==='view'?'insights.detail_view_started':'insights.detail_export_started',{formCount:scope.formIds.length,eventCount:scope.eventIds.length,jobId:id});
   });
   return res.status(201).json({jobId:id,step:0});
  }
  if(['/step','/authorize','/cancel'].includes(path)&&req.method==='POST'){
   const {jobId,step}=req.body||{};if(!validJobId(jobId)||!Number.isSafeInteger(step)||step<0)fail(400,'Invalid export preparation.');
   const ref=jobRef(db,jobId),job=(await ref.get()).data();ensureJob(job,actor);
   if(job.step!==step)fail(409,'Export progress changed. Start again.');
   if(path==='/cancel'){
    await db.runTransaction(async tx=>{const snap=await tx.get(ref),live=snap.data();ensureJob(live,actor);if(live.step!==step)fail(409,'Export progress changed.');tx.update(ref,{status:'cancelled',step:step+1});audit(db,tx,actor,'insights.detail_export_cancelled',{jobId});});
    return res.json({ok:true});
   }
   if(path==='/authorize'){
    if(job.mode==='view')fail(403,'Viewing access does not authorize an export.');
    if(job.status!=='complete')fail(409,'Export preparation is incomplete.');
    await db.runTransaction(async tx=>{
     const snap=await tx.get(ref),live=snap.data();ensureJob(live,actor);
     if(live.step!==step||live.status!=='complete')fail(409,'Export preparation changed.');
     await validateTx(tx,db,actor,live);tx.update(ref,{status:'downloaded',step:step+1});
     audit(db,tx,actor,'insights.detail_export_authorized',{jobId,count:live.count,formCount:live.scope.formIds.length,eventCount:live.scope.eventIds.length});
    });
    return res.json({ok:true});
   }
   if(job.status!=='running')fail(409,'Export preparation is not running.');
   const search=req.body?.search||'';
   if(typeof search!=='string'||search.length>200||createHash('sha256').update(search).digest('hex')!==job.searchHash)fail(409,'Search changed. Start browsing again.');
   await currentGrant(db,actor);
   const byForm=job.scope.formIds.length>0,ids=byForm?job.scope.formIds:job.scope.eventIds,id=ids[job.position];
   if(!id)fail(409,'Invalid export progress. Start again.');
   let query;
   if(byForm){
    if(!(await db.doc('registrationForms/'+id).get()).exists)fail(409,'An assigned form is unavailable. No complete export can be prepared.');
    query=db.collection('registrationForms/'+id+'/responses').orderBy(FieldPath.documentId());
    if(job.cursor)query=query.startAfter(job.cursor);
   }else{
    query=db.collectionGroup('responses').where('eventId','==',id).orderBy(FieldPath.documentId());
    if(job.cursor)query=query.startAfter(db.doc(job.cursor));
   }
   const snapshot=await query.limit(BATCH+1).get(),docs=snapshot.docs.slice(0,BATCH),rows=[];
   let eventMap=new Map(),dimensions=null,ledger=job.ledger||{};
   if(job.calendarFiltered){
    const ids=[...new Set(docs.filter(doc=>{const parts=doc.ref.path.split('/');return parts.length===4&&parts[0]==='registrationForms'&&parts[2]==='responses'&&Scope.matches(job.scope,parts[1],doc.data().eventId);}).map(doc=>doc.data().eventId).filter(Boolean))];
    if(ids.some(id=>!validEventId(id)))fail(422,'A saved event reference is invalid. No complete filtered result can be prepared.');
    const events=ids.length?await db.getAll(...ids.map(id=>db.doc('events/'+id))):[];
    ledger=addLedger(ledger,events);
    const visible=events.filter(doc=>doc.exists&&(job.calendarAccess||publicEvent(doc.data(),doc.id)));
    eventMap=new Map(visible.map(doc=>[doc.id,doc]));
    if(Programme.active(job.programme)){
     dimensions=await Programme.dimensions(db,visible);
     ledger=addLedger(ledger,dimensions.documents);
    }
   }
   for(const doc of docs){
    const parts=doc.ref.path.split('/');
    if(parts.length!==4||parts[0]!=='registrationForms'||parts[2]!=='responses')continue;
    const data=doc.data();
    if(Scope.matches(job.scope,parts[1],data.eventId)){
     if(job.calendarFiltered){
      const event=data.eventId?eventMap.get(data.eventId):null;
      if(data.eventId&&!event)continue;
      if(job.basis==='event'){
       const eventAt=event?.data()?.startAt;
       if(typeof eventAt!=='string'||!Number.isFinite(Date.parse(eventAt))||Date.parse(eventAt)<Date.parse(job.start)||Date.parse(eventAt)>=Date.parse(job.end))continue;
      }
      if(dimensions){
       const dimension=data.eventId?dimensions.map.get(data.eventId):{categories:[],bookingType:'',series:''};
       if(!dimension||!Programme.matches(dimension,job.programme))continue;
      }
     }
     const row=Scope.projectResponse(parts[1],doc.id,data);
     if(job.start&&(job.basis||'submission')==='submission'&&(typeof row.createdAt!=='string'||new Date(row.createdAt).toISOString()!==row.createdAt))fail(422,'A response has a nonstandard submission timestamp. No complete date-filtered result can be prepared.');
     if(job.start&&(job.basis||'submission')==='submission'&&(Date.parse(row.createdAt)<Date.parse(job.start)||Date.parse(row.createdAt)>=Date.parse(job.end)))continue;
     if(!search||JSON.stringify(row.answers).normalize('NFKC').toLowerCase().includes(search.normalize('NFKC').toLowerCase()))rows.push(row);
    }
   }
   if(job.scanned+docs.length>LIMIT||job.count+rows.length>LIMIT)fail(422,'More than 20,000 source responses require inspection. Narrow the assignment; no partial export is available.');
   const more=snapshot.size>BATCH,nextPosition=more?job.position:job.position+1;
   const next={position:nextPosition,cursor:more?(byForm?docs.at(-1).id:docs.at(-1).ref.path):'',scanned:job.scanned+docs.length,count:job.count+rows.length,step:step+1,status:nextPosition>=ids.length?'complete':'running',...(job.calendarFiltered?{ledger}:{})};
   await db.runTransaction(async tx=>{
    const snap=await tx.get(ref),live=snap.data();ensureJob(live,actor);
    if(live.step!==step||live.status!=='running')fail(409,'Export progress changed. Start again.');
    await validateTx(tx,db,actor,{...live,...(job.calendarFiltered?{ledger}:{})});tx.update(ref,next);
   });
   const {ledger:privateLedger,...publicProgress}=next;
   return res.json({items:rows,...publicProgress});
  }
  fail(404,'Detail-export endpoint not found.');
 }catch(error){
  if(!error.status)console.error('Insights detail export failed',error);
  return res.status(error.status||503).json({error:error.status?error.message:'Response-detail export is temporarily unavailable.'});
 }
}
module.exports={handle,expiry};
