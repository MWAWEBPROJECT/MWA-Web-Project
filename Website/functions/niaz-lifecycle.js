const M=require('./niaz-model');
const A=require('./niaz-api');
const {dateKey,midnight}=require('./donation-records');
const iso=()=>new Date().toISOString();
async function triggerAction(db,kind,entityId,action){
 try{return await action();}
 catch(error){
  if(error.retryable||![400,409,412,413].includes(error.status))throw error;
  const key=M.hash(kind+':'+entityId+':'+error.message);
  await db.doc('_niazOutbox/'+key).set({state:'attention',kind:'integration-conflict',sourceKind:kind,entityId,status:error.status,lastError:error.message,createdAt:iso(),nextAttempt:0,acknowledgment:null},{merge:true});
  console.error('Niaz integration requires attention',{kind,entityId,status:error.status});
  return {attention:true};
 }
}
async function saveProgramme(db,input,actor){
 const seriesId=M.id(input.seriesId),sponsorId=M.id(input.sponsorId),key=M.hash(seriesId+':'+sponsorId),ref=db.doc('niazProgrammeSeries/'+key);
 const status=M.choice(input.status,['active','paused','cancelled'],'a programme commitment status');
 const reason=M.text(input.reason||'','programme review reason',1000,true);
 return db.runTransaction(async tx=>{
  const current=await tx.get(ref),sponsor=await tx.get(db.doc('niazSponsors/'+sponsorId)),events=await tx.get(db.collection('events').where('seriesId','==',seriesId).limit(1));
  if(!sponsor.exists||events.empty)throw M.fault(404,'Choose an existing sponsor and stable calendar series.');
  if((current.data()?.revision||0)!==input.revision)throw M.fault(409,'Programme changed; refresh.');
  const value={seriesId,sponsorId,status,reason,revision:input.revision+1,updatedAt:iso(),createdAt:current.data()?.createdAt||iso()};
  tx.set(ref,value);A.audit(db,tx,actor,'niaz.programme_'+status,key,{reason});return {id:key,...value};
 });
}
async function proposeYear(db,input,actor){
 const year=M.annualYear(input.year),ref=db.doc('niazProgrammeSeries/'+M.id(input.id)),programme=(await ref.get()).data();
 if(!programme||programme.status!=='active')throw M.fault(409,'Choose an active permanent commitment.');
 const events=await db.collection('events').where('seriesId','==',programme.seriesId).where('startAt','>=',new Date(midnight(year+'-01-01')).toISOString()).where('startAt','<',new Date(midnight((year+1)+'-01-01')).toISOString()).orderBy('startAt').limit(251).get();
 if(events.size>250)throw M.fault(413,'This series has over 250 occurrences; split the annual review.');
 let created=0;
 for(const event of events.docs){
  if(!M.eligible(event.data(),event.id))continue;
  const added=await db.runTransaction(async tx=>{
   const latest=await tx.get(ref),occurrence=await tx.get(event.ref),sponsor=await tx.get(db.doc('niazSponsors/'+programme.sponsorId)),key=M.assignmentKey(programme.sponsorId,event.id,'renewal'),assignment=db.doc('niazSponsorships/'+key),existing=await tx.get(assignment);
   if(latest.data()?.revision!==programme.revision||latest.data()?.status!=='active')throw M.fault(409,'Commitment changed during annual proposal.');
   if(!sponsor.data()?.active||!M.eligible(occurrence.data(),event.id))throw M.fault(409,'Sponsor or occurrence changed; review again.');
   if(existing.exists)return false;
   tx.create(assignment,{sponsorId:programme.sponsorId,eventId:event.id,seriesId:programme.seriesId,type:'permanent',origin:'renewal',role:'joint',status:'proposed',arrangementConfirmed:false,year,revision:1,createdAt:iso(),updatedAt:iso()});
   A.audit(db,tx,actor,'niaz.annual_proposed',key,{year});return true;
  });
  if(added)created++;
 }
 if(created)await db.runTransaction(async tx=>A.queue(db,tx,'annual:'+input.id+':'+year+':'+programme.revision,'annual-review',events.docs[0].id,{programmeId:input.id,year}));
 return {proposed:created,year};
}
async function reviewAssignment(db,input,actor){
 const id=M.id(input.id),status=M.choice(input.status,['approved','declined','paused','cancelled','fulfilled'],'an assignment status'),reason=M.text(input.reason||'','review reason',1000,true);
 return db.runTransaction(async tx=>{
  const ref=db.doc('niazSponsorships/'+id),saved=await tx.get(ref),current=saved.data();
  if(!current)throw M.fault(404,'Assignment unavailable.');
  if(current.revision!==input.revision)throw M.fault(409,'Assignment changed; refresh.');
  const event=await tx.get(db.doc('events/'+current.eventId)),sponsor=await tx.get(db.doc('niazSponsors/'+current.sponsorId));
  const programmeRef=current.type==='permanent'?db.doc('niazProgrammeSeries/'+M.hash(current.seriesId+':'+current.sponsorId)):null,programme=programmeRef?await tx.get(programmeRef):null;
  const approved=await tx.get(db.collection('niazSponsorships').where('eventId','==',current.eventId).where('status','==','approved').limit(501));
  if(approved.size>500)throw M.fault(413,'Too many assignments; request scoped review.');
  if(status==='approved'&&(!M.eligible(event.data(),event.id)||!sponsor.data()?.active))throw M.fault(409,'Sponsor or programme is unavailable.');
  if(status==='approved'&&approved.docs.some(doc=>doc.id!==id&&(doc.data().sponsorId===current.sponsorId||current.role==='sole')))throw M.fault(409,'An approved assignment conflicts. Choose joint sponsorship or an explicit reviewed reassignment instead.');
  if(status==='fulfilled'&&current.status!=='approved')throw M.fault(409,'Only approved assignments can be fulfilled.');
  tx.update(ref,{status:status==='fulfilled'?current.status:status,...(status==='fulfilled'?{fulfilmentStatus:'fulfilled'}:{}),reason,revision:current.revision+1,updatedAt:iso(),reviewedBy:actor.uid,reviewedAt:iso()});
  if(status==='approved')for(const doc of approved.docs)if(doc.id!==id&&doc.data().role==='sole')tx.update(doc.ref,{role:'joint',revision:(doc.data().revision||0)+1,updatedAt:iso()});
  if(status==='approved'&&programmeRef&&!programme.exists)tx.create(programmeRef,{seriesId:current.seriesId,sponsorId:current.sponsorId,status:'active',reason:'Imported permanent commitment reviewed; future annual occurrences need review.',revision:1,createdAt:iso(),updatedAt:iso()});
  A.audit(db,tx,actor,'niaz.assignment_'+status,id,{reason});A.queue(db,tx,'review:'+id+':'+current.revision,'review',current.eventId,{sponsorId:current.sponsorId,status});
  return {ok:true};
 });
}
async function transferProgramme(db,input,actor){
 const reason=M.text(input.reason||'','transfer reason',1000,true),newSponsorId=M.id(input.newSponsorId),oldRef=db.doc('niazProgrammeSeries/'+M.id(input.id));
 if(input.confirm!==true)throw M.fault(400,'Explicitly confirm the programme transfer.');
 return db.runTransaction(async tx=>{
  const old=await tx.get(oldRef),current=old.data();if(!current||current.revision!==input.revision)throw M.fault(409,'Programme changed; refresh before transferring.');
  if(current.sponsorId===newSponsorId)throw M.fault(400,'Choose a different sponsor.');
  const sponsor=await tx.get(db.doc('niazSponsors/'+newSponsorId)),newRef=db.doc('niazProgrammeSeries/'+M.hash(current.seriesId+':'+newSponsorId)),existing=await tx.get(newRef);
  if(!sponsor.data()?.active)throw M.fault(400,'Choose an active existing sponsor.');
  if(existing.exists)throw M.fault(409,'The target sponsor already has a commitment for this series. Review both records rather than merging automatically.');
  tx.update(oldRef,{status:'cancelled',revision:current.revision+1,reason,transferredTo:newRef.id,updatedAt:iso()});
  tx.create(newRef,{seriesId:current.seriesId,sponsorId:newSponsorId,status:'active',revision:1,reason,transferredFrom:oldRef.id,createdAt:iso(),updatedAt:iso()});
  A.audit(db,tx,actor,'niaz.programme_transferred',oldRef.id,{reason,targetId:newRef.id});
  return {id:newRef.id,existingOccurrencesUnchanged:true};
 });
}
async function onEventChanged(db,eventId,before,after){
 const significant=!after||['startAt','endAt','status','title','visibility','venueId','venueName','seriesId','departmentName'].some(key=>before?.[key]!==after[key]);
 if(!significant)return;
 const assignments=await db.collection('niazSponsorships').where('eventId','==',eventId).limit(501).get();
 if(assignments.size>500)throw M.fault(413,'Event lifecycle needs manual reconciliation: over 500 assignments.');
 const key=M.hash(JSON.stringify(Object.fromEntries(['startAt','endAt','status','title','visibility','venueId','venueName','seriesId','departmentName'].map(key=>[key,after?.[key]||null]))));
 await db.runTransaction(async tx=>{
  const ref=db.doc('niazEventCoverage/'+eventId),saved=await tx.get(ref);
  if(saved.exists&&saved.data().lifecycleVersion!==key){tx.update(ref,{eventReviewRequired:true,lifecycleVersion:key,revision:(saved.data().revision||0)+1,updatedAt:iso()});A.audit(db,tx,{uid:null},'niaz.coverage_review_required',eventId);}
 });
 for(const doc of assignments.docs)await db.runTransaction(async tx=>{
  const current=await tx.get(doc.ref);if(!current.exists||current.data().lifecycleVersion===key)return;
  tx.update(doc.ref,{eventReviewRequired:true,eventLifecycle:after?.status||'deleted',lifecycleVersion:key,updatedAt:iso(),revision:(current.data().revision||0)+1});
  A.queue(db,tx,'event:'+eventId+':'+key+':'+doc.id,!after||after.status!=='confirmed'?'cancellation':'reschedule',eventId,{sponsorId:current.data().sponsorId,eventVersion:key});
  A.audit(db,tx,{uid:null},'niaz.event_review_required',doc.id,{eventId});
 });
}
async function projectSandboxDonation(db,donationId,record){
 const entry=M.donationEntry(record,donationId);if(!entry)return {ignored:true};
 // TEST payments never enter live sponsorships or live coverage.
 const ledger=db.doc('_niazSandboxLedger/'+M.hash(donationId)),sponsorId=M.sponsorKey({email:record.email?.toLowerCase(),phone:record.mobile}),associationId=M.assignmentKey(sponsorId,entry.eventId,'sandbox-donation');
 return db.runTransaction(async tx=>{
  const source=await tx.get(db.doc('_stripeSandboxDonations/'+donationId));
  if(!source.exists)return {ignored:true};
  const latest=M.donationEntry(source.data(),donationId);
  if(!latest)return {ignored:true};
  if(JSON.stringify(latest)!==JSON.stringify(entry))throw Object.assign(M.fault(409,'Donation changed during projection; retry from current source.'),{retryable:true});
  const previous=await tx.get(ledger),current=previous.data(),association=db.doc('_niazSandboxAssociations/'+associationId),existing=await tx.get(association);
  if(current&&(current.eventId!==entry.eventId||current.sponsorId!==sponsorId))throw M.fault(409,'Donation designation or identity changed. Reconcile without silently reallocating contributions.');
  if(current&&JSON.stringify(current.entry)===JSON.stringify(entry))return {replayed:true};
  if(entry.netCents===0&&!current)return {ignored:true};
  const total=(existing.data()?.netCents||0)+entry.netCents-(current?.entry.netCents||0);
  if(total<0)throw M.fault(409,'Sandbox association reconciliation required.');
  tx.set(ledger,{entry,eventId:entry.eventId,sponsorId,source:'_stripeSandboxDonations/'+donationId,updatedAt:iso()});
  tx.set(association,{sponsorId,eventId:entry.eventId,origin:'event_donation',sandbox:true,netCents:total,status:total?'confirmed-test':'reversed-test',updatedAt:iso()});
  A.audit(db,tx,{uid:null},'niaz.sandbox_donation_projected',donationId,{eventId:entry.eventId,sandbox:true});
  A.queue(db,tx,'sandbox-payment:'+donationId+':'+M.hash(JSON.stringify(entry)),'sandbox-donation',entry.eventId,{sandbox:true,ledgerId:ledger.id});
  return {sandbox:true,netCents:total};
 });
}
async function pruneExpired(db,time=Date.now()){
 let removed=0;
 for(const collection of ['_niazImports','_niazLimits']){
  const expired=await db.collection(collection).where('expiresAt','<=',time).limit(100).get();
  for(const doc of expired.docs){
   const deleted=await db.runTransaction(async tx=>{const current=await tx.get(doc.ref);if(!current.exists||current.data().expiresAt>time)return false;tx.delete(doc.ref);return true;});
   if(deleted)removed++;
  }
 }
 return {removed};
}
async function prepareNotices(db,time=new Date()){
 await pruneExpired(db,time.getTime());
 const config=(await db.doc('_niazPrivate/settings').get()).data()||{};
 if(config.notificationEnabled!==true)return {disabled:true};
 const events=await db.collection('events').where('startAt','>=',time.toISOString()).where('startAt','<',new Date(time.getTime()+9*86400000).toISOString()).orderBy('startAt').limit(501).get();
 if(events.size>500)throw M.fault(413,'Reminder scan exceeds safe event bound.');
 let queued=0;
 for(const event of events.docs){
  const types=M.dueNotices(event.data(),time,config.threeDayFollowup);
  const coverage=(await db.doc('niazEventCoverage/'+event.id).get()).data()||{};
  for(const kind of types){
   if(kind==='three-day'&&coverage.arrangementConfirmed)continue;
   const key='reminder:'+kind+':'+event.id+':'+event.data().startAt,ref=db.doc('_niazOutbox/'+M.hash(key));
   const added=await db.runTransaction(async tx=>{const s=await tx.get(ref);if(s.exists)return false;tx.create(ref,{kind,eventId:event.id,eventStartAt:event.data().startAt,state:'pending',nextAttempt:0,createdAt:iso()});return true;});if(added)queued++;
  }
 }
 const date=dateKey(time);if(date.endsWith('-01')){
  const ref=db.doc('_niazOutbox/'+M.hash('monthly:'+date));
  const added=await db.runTransaction(async tx=>{if((await tx.get(ref)).exists)return false;tx.create(ref,{kind:'monthly',month:date.slice(0,7),state:'pending',nextAttempt:0,createdAt:iso()});return true;});if(added)queued++;
 }
 return {queued};
}
module.exports={saveProgramme,proposeYear,reviewAssignment,transferProgramme,onEventChanged,projectSandboxDonation,prepareNotices,pruneExpired,triggerAction};
