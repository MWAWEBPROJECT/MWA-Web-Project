const {randomUUID}=require('node:crypto');
const M=require('./niaz-model'),A=require('./niaz-api'),{dateKey,midnight}=require('./donation-records');
const {resolveAdmin}=require('./moduleAccess'),{OWNER_EMAIL}=require('./adminAccess');
const iso=()=>new Date().toISOString();
async function recipientAllowed(db,email){
 const entry=(await db.doc('adminAllowlist/'+email).get()).data();
 if(!entry?.uid)return false;
 const token={email,email_verified:true,firebase:{sign_in_provider:'google.com'}};
 return !!(await resolveAdmin(db,entry.uid,token,'niaz')||await resolveAdmin(db,entry.uid,token,'niaz-read'));
}
async function settings(db,input,actor){
 if(actor.email!==OWNER_EMAIL)throw M.fault(403,'Only the Super Admin can configure notification delivery and recipients.');
 if(typeof input.notificationEnabled!=='boolean'||typeof input.threeDayFollowup!=='boolean'||!Array.isArray(input.coordinatorEmails)||input.coordinatorEmails.length>10)throw M.fault(400,'Choose valid notification settings.');
 const coordinatorEmails=[...new Set(input.coordinatorEmails.map(M.email))];
 for(const address of coordinatorEmails)if(!address||!await recipientAllowed(db,address))throw M.fault(400,'Each coordinator recipient must have active Niaz coordinator or oversight access.');
 if(input.notificationEnabled&&!coordinatorEmails.length)throw M.fault(400,'Select an authorised coordinator recipient before enabling delivery.');
 const value={notificationEnabled:input.notificationEnabled,threeDayFollowup:input.threeDayFollowup,coordinatorEmails,updatedAt:iso(),updatedBy:actor.uid,revision:(input.revision||0)+1};
 await db.runTransaction(async tx=>{const ref=db.doc('_niazPrivate/settings'),current=await tx.get(ref);if((current.data()?.revision||0)!==(input.revision||0))throw M.fault(409,'Notification settings changed; refresh before saving.');value.enabledAt=input.notificationEnabled?(current.data()?.notificationEnabled&&current.data()?.enabledAt?current.data().enabledAt:iso()):null;tx.set(ref,value);A.audit(db,tx,actor,'niaz.notifications_configured','settings',{enabled:value.notificationEnabled});});return value;
}
function eventText(event){
 return event.title+' | '+new Date(event.startAt).toLocaleString('en-AU',{timeZone:'Australia/Sydney'})+' (Sydney) | '+(event.venueName||'Contact coordinator for venue');
}
async function monthlyBody(db,month){
 const year=Number(month.slice(0,4)),m=Number(month.slice(5)),next=m===12?(year+1)+'-01-01':year+'-'+String(m+1).padStart(2,'0')+'-01';
 const events=await db.collection('events').where('startAt','>=',new Date(midnight(month+'-01')).toISOString()).where('startAt','<',new Date(midnight(next)).toISOString()).orderBy('startAt').limit(501).get();
 if(events.size>500)throw M.fault(413,'Monthly report exceeds event bound. Request a scoped report.');
 const lines=['MWA Niaz monthly operational report - '+month,'Financial coverage is unavailable until an authoritative live ledger is configured.'];
 for(const doc of events.docs){
  if(!M.eligible(doc.data(),doc.id))continue;
  const detail=await A.eventDetail(db,doc.id);
  lines.push(eventText(doc.data())+' | '+detail.badges.join(', ')+' | Follow-up: '+(detail.coverage.arrangementConfirmed?'No arrangement follow-up recorded':'Contact sponsor / arrange Niaz'));
 }
 return lines.join('\n\n');
}
// Only the three explicitly approved Niaz email workflows may reach Gmail.
async function prepareDelivery(db,job,config){
 const approval=job.kind==='decision'&&job.decision==='approved';
 if(!approval&&!['seven-day','three-day'].includes(job.kind))return [];
 const event=(await db.doc('events/'+M.id(job.eventId)).get()).data();
 if(!event||!M.eligible(event,job.eventId))return [];
 if(!approval){
  if(event.startAt!==job.eventStartAt)return [];
  const days=Math.round((Date.parse(dateKey(event.startAt)+'T00:00:00Z')-Date.parse(dateKey(new Date())+'T00:00:00Z'))/86400000);
  if(days<0||days>(job.kind==='seven-day'?7:3))return [];
 }
 if(job.kind==='seven-day'){
  const recipients=[];
  for(const email of config.coordinatorEmails||[])if(await recipientAllowed(db,email))recipients.push({to:email,subject:'MWA Niaz - Programme in seven days',body:eventText(event)+'\n\nFor your information: please review sponsorship and arrangements in Niaz Administration.'});
  if(!recipients.length)throw M.fault(409,'No active Niaz coordinator recipients; delivery needs attention.');
  return recipients;
 }
 let assignments;
 if(approval){
  if(!job.eoiId||!job.assignmentId)return []; // Do not replay old unbound approval jobs.
  const eoi=(await db.doc('niazEOIs/'+M.id(job.eoiId)).get()).data();
  const assignment=(await db.doc('niazSponsorships/'+M.id(job.assignmentId)).get()).data();
  if(!eoi||!assignment||assignment.status!=='approved'||assignment.eventId!==job.eventId||assignment.sponsorId!==job.sponsorId||!eoi.events.some(e=>e.eventId===job.eventId&&e.status==='approved'))return [];
  assignments=[assignment];
 }else{
  if(config.threeDayFollowup!==true)return [];
  const result=await db.collection('niazSponsorships').where('eventId','==',job.eventId).where('status','==','approved').limit(501).get();
  if(result.size>500)throw M.fault(413,'Too many sponsor recipients; manual review needed.');
  assignments=result.docs.map(doc=>doc.data());
 }
 const recipients=new Map();
 for(const assignment of assignments){
  const sponsor=(await db.doc('niazSponsors/'+M.id(assignment.sponsorId)).get()).data();
  if(!sponsor?.active||!sponsor.email||(!approval&&(sponsor.emailPreferences?.optionalReminders!==true||sponsor.emailPreferences?.consentVersion!=='niaz-reminders-v2')))continue;
  const title=approval?'Your Niaz sponsorship is approved':'Your Niaz programme is in three days';
  recipients.set(sponsor.email,{to:sponsor.email,subject:'MWA Niaz - '+title,body:'Hello '+sponsor.name+',\n\n'+title+'.\n\n'+eventText(event)+'\n\n'+(approval?'The Niaz Coordinator has approved your offer. Please contact MWA about any remaining arrangements.':'This is your requested follow-up. Please contact MWA if your arrangements need attention.')+'\n\nView your requests and reminder preference at https://refreshed.muhammadiwelfare.org.au/niaz/ using your verified contact.'});
 }
 return [...recipients.values()];
}
async function deliverJob(db,ref,send,time=Date.now()){
 const lease=randomUUID();let job;
 await db.runTransaction(async tx=>{
  const config=(await tx.get(db.doc('_niazPrivate/settings'))).data()||{},snapshot=await tx.get(ref),value=snapshot.data();
  if(config.notificationEnabled!==true||!value||!['pending','retry','sending'].includes(value.state)||value.nextAttempt>time||value.leaseUntil>time)return;
  if(config.enabledAt&&(!value.createdAt||Date.parse(value.createdAt)<Date.parse(config.enabledAt))){
   tx.update(ref,{state:'suppressed',leaseUntil:0,completedAt:iso(),suppressionReason:'Created before notification activation; historical backlog is not sent.'});
   tx.set(db.doc('niazNotificationLog/'+M.hash(ref.id+':activation-suppression')),{state:'suppressed',kind:value.kind,eventId:value.eventId||null,reason:'pre-activation',completedAt:iso()});
   return;
  }
  job=value;tx.update(ref,{state:'sending',lease,leaseUntil:time+240000,attempts:(value.attempts||0)+1});
 });
 if(!job)return {ignored:true};
 try{
  const config=(await db.doc('_niazPrivate/settings').get()).data()||{},recipients=await prepareDelivery(db,job,config);
  let monthly=null;if(job.kind==='monthly')monthly=await monthlyBody(db,job.month);
  let sent=0;
  for(const notice of recipients){
   const currentJob=(await ref.get()).data();
   if(currentJob?.lease!==lease||currentJob.leaseUntil<=Date.now())throw M.fault(409,'Notification delivery lease changed or expired.');
   const key=ref.id+':'+M.hash(notice.to+':'+notice.subject),log=db.doc('niazNotificationLog/'+M.hash(key));
   if((await log.get()).data()?.state==='sent'){sent++;continue;}
   const latestConfig=(await db.doc('_niazPrivate/settings').get()).data()||{};
   if(latestConfig.notificationEnabled!==true)throw M.fault(409,'Niaz delivery was disabled.');
   const stillAllowed=await prepareDelivery(db,job,latestConfig);
   if(!stillAllowed.some(value=>value.to===notice.to&&value.subject===notice.subject))continue;
   if(job.kind==='seven-day'||job.kind==='three-day'){
    const current=(await db.doc('events/'+job.eventId).get()).data();
    if(!current||current.status!=='confirmed'||current.startAt!==job.eventStartAt)continue;
   }
   const result=await send(db,{...notice,body:notice.body||monthly,key});
   await log.set({state:'sent',eventId:job.eventId||null,kind:job.kind,recipientHash:M.hash(notice.to),gmailId:result.gmailId,sentAt:iso()});
   sent++;
  }
  await db.runTransaction(async tx=>{const current=await tx.get(ref);if(current.data()?.lease===lease)tx.update(ref,{state:sent?'sent':'suppressed',leaseUntil:0,completedAt:iso()});});
  return {sent};
 }catch(error){
  await db.runTransaction(async tx=>{const current=await tx.get(ref);if(current.data()?.lease===lease)tx.update(ref,{state:error.deliveryUncertain||(job.attempts||0)>=4?'attention':'retry',nextAttempt:time+Math.min(3600000,2**(job.attempts||0)*60000),leaseUntil:0,lastError:error.deliveryUncertain?'Email send outcome is uncertain. Reconcile with the mailbox before any resend.':'Niaz notification requires retry or coordinator attention; no delivery success assumed.'});});
  console.error('Niaz notification delayed',{jobId:ref.id,status:error.status||503});return {delayed:true};
 }
}
async function run(db,send=require('./enquiries-gmail').sendServiceNotice){
 const config=(await db.doc('_niazPrivate/settings').get()).data()||{};if(config.notificationEnabled!==true)return {disabled:true};
 const jobs=await db.collection('_niazOutbox').where('state','in',['pending','retry','sending']).where('nextAttempt','<=',Date.now()).orderBy('nextAttempt').limit(10).get();
 for(const job of jobs.docs)await deliverJob(db,job.ref,send);
 return {processed:jobs.size};
}
module.exports={settings,recipientAllowed,eventText,monthlyBody,prepareDelivery,deliverJob,run};
