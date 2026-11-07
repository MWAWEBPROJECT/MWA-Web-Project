const {createHash,randomUUID}=require('node:crypto');
const {FieldPath}=require('firebase-admin/firestore');

const PAGE_SIZE=100,LEASE_MS=8*60*1000,RETRY_MS=5*60*1000,WORK_MS=7*60*1000,SEND_BUDGET_MS=90*1000,LEASE_MARGIN_MS=60*1000;
const hash=value=>createHash('sha256').update(value).digest('hex');
const projection=(source,fields)=>Object.fromEntries(fields.filter(key=>source[key]!==undefined).map(key=>[key,source[key]]));
const BEFORE_FIELDS=['venueId','status','startAt','endAt','conflictWith'];
const AFTER_FIELDS=['title','status','startAt','endAt','venueId','venueName','departmentName','timeMode','startPrayer','endPrayer','speakerName','programDetails','contactName','contactEmail','conflictWith'];
const settingsGeneration=snapshot=>snapshot.exists&&snapshot.updateTime
 ? `${snapshot.updateTime.seconds}:${snapshot.updateTime.nanoseconds}` : null;

function createHijriRecovery(deps){
 const {db,FieldValue,HttpsError,resolveBookingDates,dateKeyOf,hijriInfoFor,notify,sendMail,
  activeStatuses,findOverlaps,resolveBufferHours,maxVenues,auditEntry,logger}=deps;
 const checkpoint=deps.checkpoint||(()=>{});
 const now=deps.now||Date.now;
 const runs=db.collection('_hijriRecoveryRuns');
 const reviews=db.collection('_hijriNotificationReview');
 const runRef=id=>runs.doc(id);
 const pageRef=(ref,page)=>ref.collection('pages').doc(String(page));
 const leaseOk=(run,token)=>run?.state==='pending'&&run.leaseToken===token&&run.leaseUntil>now();
 const requireLease=(run,token)=>{if(!leaseOk(run,token))throw new Error('Hijri recovery lease lost.');};
 const taskRef=(ref,page,id)=>pageRef(ref,page).collection('tasks').doc(id);
 const reviewId=(id,page,task)=>hash(`${id}\0${page}\0${task}`);

 async function start(eventId,overrides,generation){
  if(typeof eventId!=='string'||!eventId)throw new Error('Hijri event ID is required.');
  if(typeof generation!=='string'||!/^\d+:\d+$/.test(generation))throw new Error('Hijri settings generation is required.');
  const id=hash(eventId),ref=runRef(id);
  await db.runTransaction(async tx=>{
   const current=await tx.get(ref);
   if(!current.exists)tx.create(ref,{state:'pending',phase:'scan',cursor:'',page:0,taskCursor:'',overrides,generation,leaseToken:'',leaseUntil:0,nextAttempt:0,createdAt:new Date().toISOString()});
  });
  return id;
 }
 async function ensureSettings(){
  const ref=db.doc('calendarSettings/hijri');
  const restored=await db.runTransaction(async tx=>{
   const current=await tx.get(ref);
   if(current.exists)return false;
   tx.create(ref,{overrides:[]});
   tx.create(db.collection('auditLog').doc(),auditEntry({entityType:'hijri',entityId:'settings',action:'hijri.settings_restored',note:'System restored empty Hijri settings after deletion.'}));
   return true;
  });
  if(restored)logger.info('System restored empty Hijri settings after deletion.');
 }
 async function claim(ref){
  const token=randomUUID(),time=now();
  return db.runTransaction(async tx=>{
   const snap=await tx.get(ref),run=snap.data();
   if(!run||run.state!=='pending'||run.nextAttempt>time||run.leaseUntil>time)return null;
   tx.update(ref,{leaseToken:token,leaseUntil:time+LEASE_MS,nextAttempt:time+LEASE_MS,lastError:null});
   return token;
  });
 }
 async function renew(ref,token){
  await db.runTransaction(async tx=>{
   const run=(await tx.get(ref)).data();requireLease(run,token);
   tx.update(ref,{leaseUntil:now()+LEASE_MS,nextAttempt:now()+LEASE_MS});
  });
 }
 async function scan(ref,token,run){
  let query=db.collection('events').where('dateBasis','==','hijri').orderBy(FieldPath.documentId()).limit(PAGE_SIZE);
  if(run.cursor)query=query.startAfter(run.cursor);
  const candidates=await query.get();
  await db.runTransaction(async tx=>{
   const [job,settings,...current]=await tx.getAll(ref,db.doc('calendarSettings/hijri'),...candidates.docs.map(doc=>doc.ref));
   const live=job.data();requireLease(live,token);
   if(live.phase!=='scan'||live.cursor!==run.cursor||live.page!==run.page)throw new Error('Hijri recovery progress changed.');
   if(settingsGeneration(settings)!==live.generation){
    tx.update(ref,{state:'superseded',leaseToken:'',leaseUntil:0,completedAt:new Date().toISOString()});
    return;
   }
   if(candidates.empty){
    tx.update(ref,{state:'complete',leaseToken:'',leaseUntil:0,completedAt:new Date().toISOString()});
    return;
   }
   const moved=[],tasks=[];
   for(const doc of current){
    if(!doc.exists)continue;
    const before=doc.data();
    if(before.dateBasis!=='hijri'||!before.hijriDate)continue;
    const resolved=resolveBookingDates(before,live.overrides);
    if(!resolved.resolved||(resolved.startAt===before.startAt&&resolved.endAt===before.endAt))continue;
    const after={...before,startAt:resolved.startAt,endAt:resolved.endAt};
    const active=activeStatuses.includes(before.status);
    const civilMoved=active&&dateKeyOf(before.startAt)!==dateKeyOf(after.startAt);
    const task={kind:'event',eventId:doc.id,before:projection(before,BEFORE_FIELDS),after:projection(after,AFTER_FIELDS),state:active?'conflict':'complete',delivery:civilMoved&&before.status==='confirmed'&&after.contactEmail?'pending':'none'};
    if(Buffer.byteLength(JSON.stringify(task),'utf8')>800000)throw new HttpsError('resource-exhausted','A Hijri recovery record is too large to save safely.');
    tasks.push({ref:taskRef(ref,live.page,'a_'+hash(doc.id)),task});
    if(civilMoved)moved.push({id:doc.id,title:before.title||'',status:before.status,venueId:after.venueId,fromStartAt:before.startAt,toStartAt:after.startAt,toEndAt:after.endAt});
    tx.update(doc.ref,{startAt:after.startAt,endAt:after.endAt,updatedAt:FieldValue.serverTimestamp()});
    tx.set(db.collection('auditLog').doc('hijri_'+hash(ref.id+'\0'+doc.id)),auditEntry({
     entityType:'event',entityId:doc.id,action:'hijri_date_resolved',
     note:'Resolved Gregorian date updated for a Hijri-sourced booking after a moon-sighting adjustment change.',
     diff:{from:{startAt:before.startAt,endAt:before.endAt},to:{startAt:after.startAt,endAt:after.endAt}}
    }));
   }
   if(moved.length)tasks.push({ref:taskRef(ref,live.page,'z_digest'),task:{kind:'digest',moved,state:'delivery',delivery:'pending'}});
   for(const item of tasks)tx.create(item.ref,item.task);
   tx.update(ref,{cursor:candidates.docs.at(-1).id,phase:'drain',taskCursor:'',nextAttempt:now()+LEASE_MS});
  });
  await checkpoint('after-page-commit');
 }
 async function advance(ref,token,taskId){
  await db.runTransaction(async tx=>{
   const snap=await tx.get(ref),run=snap.data();requireLease(run,token);
   if(run.phase!=='drain')throw new Error('Hijri recovery progress changed.');
   tx.update(ref,{taskCursor:taskId});
  });
 }
 async function refresh(ref,token,taskDoc){
  await db.runTransaction(async tx=>{
   const [job,taskSnap,venuesSnap]=await Promise.all([tx.get(ref),tx.get(taskDoc.ref),tx.get(db.collection('venues').limit(maxVenues+1))]);
   const run=job.data(),task=taskSnap.data();requireLease(run,token);
   if(!task||task.state!=='conflict')throw new Error('Hijri recovery task changed.');
   if(venuesSnap.size>maxVenues)throw new HttpsError('resource-exhausted','Too many venues to refresh booking conflicts safely.');
   const venues=venuesSnap.docs.map(doc=>({id:doc.id,...doc.data()})),byId=new Map(venues.map(venue=>[venue.id,venue]));
   const eventRef=db.collection('events').doc(task.eventId),eventSnap=await tx.get(eventRef),after=eventSnap.exists?eventSnap.data():null,before=task.before;
   const active=value=>value&&activeStatuses.includes(value.status);
   const neighbors=new Set([...(Array.isArray(before?.conflictWith)?before.conflictWith:[]),...(Array.isArray(after?.conflictWith)?after.conflictWith:[])]);
   let afterLinks=[];
   for(const event of [before,after]){
    if(!active(event))continue;
    const venue=byId.get(event.venueId);
    if(!venue)throw new HttpsError('not-found','A venue required for conflict recovery is unavailable.');
    const overlaps=await findOverlaps(event.venueId,event.startAt,event.endAt,task.eventId,tx,resolveBufferHours(venue),venues);
    for(const overlap of overlaps)neighbors.add(overlap.id);
    if(event===after)afterLinks=overlaps.map(item=>item.id).sort();
   }
   neighbors.delete(task.eventId);
   if(neighbors.size>449)throw new HttpsError('resource-exhausted','Too many bookings are affected by Hijri conflict recovery.');
   const neighborsSnap=neighbors.size?await tx.getAll(...[...neighbors].map(id=>db.collection('events').doc(id))):[];
   if(active(after))tx.update(eventRef,{conflictWith:afterLinks,hasConflict:afterLinks.length>0});
   else if(after&&(after.hasConflict||(Array.isArray(after.conflictWith)&&after.conflictWith.length)))tx.update(eventRef,{conflictWith:[],hasConflict:false});
   for(const doc of neighborsSnap){
    if(!doc.exists)continue;
    const other=doc.data();if(!active(other))continue;
    const links=new Set(Array.isArray(other.conflictWith)?other.conflictWith:[]);links.delete(task.eventId);
    if(active(after)&&afterLinks.includes(doc.id))links.add(task.eventId);
    const next=[...links].sort(),old=[...new Set(Array.isArray(other.conflictWith)?other.conflictWith:[])].sort();
    if(next.join(',')!==old.join(',')||Boolean(other.hasConflict)!==(next.length>0))tx.update(doc.ref,{conflictWith:next,hasConflict:next.length>0});
   }
   tx.update(taskDoc.ref,{state:task.delivery==='pending'?'delivery':'complete'});
  });
 }
 async function hold(ref,token,taskDoc,reason,{deferred=false}={}){
  await db.runTransaction(async tx=>{
   const [job,taskSnap]=await tx.getAll(ref,taskDoc.ref),run=job.data(),task=taskSnap.data();requireLease(run,token);
   if(!task||task.state!=='delivery')throw new Error('Hijri recovery task changed.');
   tx.set(reviews.doc(reviewId(ref.id,run.page,taskDoc.id)),{
    resolved:false,reason,classification:deferred?'not-sent':'uncertain',kind:task.kind,eventId:task.eventId||null,
    title:task.after?.title||null,recipient:task.after?.contactEmail||null,
    fromStartAt:task.before?.startAt||null,toStartAt:task.after?.startAt||null,
    moved:task.kind==='digest'?task.moved:[],sendingAt:task.sendingAt||null,notAfter:task.notAfter||null,createdAt:new Date().toISOString()
   });
   tx.update(taskDoc.ref,{state:deferred?'deferred':'review',delivery:deferred?'deferred':'review'});
  });
 }
 async function deliver(ref,token,taskDoc,run,deadline){
  const task=taskDoc.data();
  if(task.delivery==='sending'){await hold(ref,token,taskDoc,'Delivery outcome is unknown. Check the mailbox before taking action.');return;}
  if(task.delivery!=='pending')throw new Error('Hijri recovery delivery state is invalid.');
  const message=task.kind==='digest'?notify.moonSightingAdmin(task.moved):notify.moonSightingRequester(task.after,hijriInfoFor(dateKeyOf(task.after.startAt),run.overrides),task.before);
  if(!message)throw new Error('Hijri recovery message is unavailable.');
  await checkpoint('before-send-start');
  const notAfter=await db.runTransaction(async tx=>{
   const affected=task.kind==='digest'?task.moved:[{id:task.eventId,status:task.after.status,venueId:task.after.venueId,toStartAt:task.after.startAt,toEndAt:task.after.endAt}];
   const [job,current,settings,...events]=await tx.getAll(ref,taskDoc.ref,db.doc('calendarSettings/hijri'),...affected.map(item=>db.collection('events').doc(item.id)));
   requireLease(job.data(),token);
   if(current.data()?.state!=='delivery'||current.data()?.delivery!=='pending')throw new Error('Hijri recovery task changed.');
   const stale=events.some((doc,index)=>!doc.exists||doc.data().status!==affected[index].status||doc.data().venueId!==affected[index].venueId||doc.data().startAt!==affected[index].toStartAt||doc.data().endAt!==affected[index].toEndAt||(task.kind==='event'&&doc.data().contactEmail!==task.after.contactEmail));
   if(settingsGeneration(settings)!==run.generation||stale){
    tx.set(reviews.doc(reviewId(ref.id,run.page,taskDoc.id)),{resolved:false,classification:'not-sent',reason:'Settings or booking details changed before this notification could be sent. Review the current booking and mailbox.',kind:task.kind,eventId:task.eventId||null,title:task.after?.title||null,recipient:task.after?.contactEmail||null,fromStartAt:task.before?.startAt||null,toStartAt:task.after?.startAt||null,moved:task.kind==='digest'?task.moved:[],createdAt:new Date().toISOString()});
    tx.update(taskDoc.ref,{state:'review',delivery:'review'});
    return null;
   }
   const time=now(),notAfter=time+SEND_BUDGET_MS;
   if(notAfter>deadline)return null;
   if(job.data().leaseUntil<notAfter+LEASE_MARGIN_MS)throw new Error('Hijri recovery lease is too short to start delivery.');
   tx.update(taskDoc.ref,{delivery:'sending',sendingAt:new Date(time).toISOString(),notAfter});
   return notAfter;
  });
  if(notAfter===null)return;
  await checkpoint('after-send-start',{notAfter});
  const latest=(await taskDoc.ref.get()).data();
  if(latest?.delivery!=='sending')return;
  let result;
  try{result=await sendMail(message,{notAfter});}catch{result={sent:false,reason:'send-error'};}
  await checkpoint('after-send');
  if(!result.sent){
   const definitelyUnsent=['not-configured','invalid-configuration','mailbox-auth-failed','no-recipient','send-window-expired'].includes(result.reason);
   const reason=definitelyUnsent
    ? result.reason==='send-window-expired'
     ? 'The notification was not sent because its send window expired. Check current details before sending manually.'
     : 'The notification was not sent because the mailbox or recipient was unavailable. Check the details before sending manually.'
    : 'Delivery outcome is unknown. Check the mailbox before taking action.';
   await hold(ref,token,taskDoc,reason,{deferred:definitelyUnsent});
   return;
  }
  await db.runTransaction(async tx=>{
   const [job,current]=await tx.getAll(ref,taskDoc.ref);requireLease(job.data(),token);
   if(current.data()?.delivery!=='sending')throw new Error('Hijri recovery delivery state changed.');
   tx.update(taskDoc.ref,{state:'complete',delivery:'sent',sentAt:new Date().toISOString()});
  });
 }
 async function drain(ref,token,run,deadline){
  let query=pageRef(ref,run.page).collection('tasks').orderBy(FieldPath.documentId()).limit(1);
  if(run.taskCursor)query=query.startAfter(run.taskCursor);
  const snapshot=await query.get();
  if(snapshot.empty){
   await db.runTransaction(async tx=>{
    const snap=await tx.get(ref),current=snap.data();requireLease(current,token);
    if(current.phase!=='drain'||current.page!==run.page||current.taskCursor!==run.taskCursor)throw new Error('Hijri recovery progress changed.');
    tx.update(ref,{phase:'scan',page:current.page+1,taskCursor:''});
   });
   return true;
  }
  let task=snapshot.docs[0];
  if(task.data().state==='conflict'){await refresh(ref,token,task);task=await task.ref.get();}
  if(task.data().state==='delivery'){
   if(now()+SEND_BUDGET_MS>deadline)return false;
   await deliver(ref,token,task,run,deadline);task=await task.ref.get();
   if(task.data().delivery==='pending')return false;
  }
  if(!['complete','review','deferred'].includes(task.data().state))throw new Error('Hijri recovery task is incomplete.');
  await advance(ref,token,task.id);
  return true;
 }
 async function process(id,{deadline=now()+WORK_MS}={}){
  const ref=runRef(id),token=await claim(ref);if(!token)return false;
  try{
   while(now()<deadline){
    await renew(ref,token);
    const run=(await ref.get()).data();if(run.state!=='pending')return true;
    if(run.phase==='scan')await scan(ref,token,run);else if(run.phase==='drain'){if(!await drain(ref,token,run,deadline))break;}else throw new Error('Hijri recovery phase is invalid.');
    const current=(await ref.get()).data();if(current.state!=='pending')return true;
   }
  }catch(error){
   logger.error('Hijri recovery paused',{code:typeof error.code==='string'?error.code:'recovery-error',type:error.constructor?.name||'Error'});
   await db.runTransaction(async tx=>{const snap=await tx.get(ref),run=snap.data();if(run?.state==='pending'&&run.leaseToken===token)tx.update(ref,{leaseToken:'',leaseUntil:0,nextAttempt:now()+RETRY_MS,lastError:'Recovery paused. Review the function logs and retry status.'});});
   return false;
  }
  await db.runTransaction(async tx=>{const snap=await tx.get(ref),run=snap.data();if(run?.state==='pending'&&run.leaseToken===token)tx.update(ref,{leaseToken:'',leaseUntil:0,nextAttempt:now()});});
  return true;
 }
 async function sweep({deadline=now()+WORK_MS}={}){
  const snapshot=await runs.where('state','==','pending').where('nextAttempt','<=',now()).orderBy('nextAttempt').limit(10).get();
  for(const doc of snapshot.docs){if(now()>=deadline)break;await process(doc.id,{deadline});}
 }
 async function handleSettingsEvent(event,{deadline=now()+WORK_MS}={}){
  const after=event.data?.after;
  if(!after)throw new Error('Hijri settings event is missing its snapshot.');
  if(!after.exists){await ensureSettings();return;}
  await process(await start(event.id,after.data().overrides||[],settingsGeneration(after)),{deadline});
 }
 async function status(){
  const [pending,held]=await Promise.all([runs.where('state','==','pending').limit(51).get(),reviews.where('resolved','==',false).limit(51).get()]);
  return {pending:pending.docs.slice(0,50).map(doc=>({id:doc.id,lastError:doc.data().lastError||null})),held:held.docs.slice(0,50).map(doc=>({id:doc.id,...doc.data()})),morePending:pending.size>50,moreHeld:held.size>50};
 }
 async function resolveReview(id,actor){
  if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))throw new HttpsError('invalid-argument','Choose a valid notification review.');
  await db.runTransaction(async tx=>{
   const ref=reviews.doc(id),snap=await tx.get(ref);
   if(!snap.exists||snap.data().resolved)throw new HttpsError('failed-precondition','This notification review is no longer open.');
   tx.update(ref,{resolved:true,resolvedAt:new Date().toISOString(),resolvedBy:actor.uid});
   tx.create(db.collection('auditLog').doc(),auditEntry({entityType:'hijri',entityId:id,action:'hijri.notification_reviewed',userId:actor.uid,userEmail:actor.email,note:'Admin marked a Hijri notification reviewed. No message was sent by this action.'}));
  });
 }
 return {start,ensureSettings,handleSettingsEvent,process,sweep,status,resolveReview};
}

module.exports={createHijriRecovery,settingsGeneration,PAGE_SIZE,LEASE_MS,RETRY_MS};
