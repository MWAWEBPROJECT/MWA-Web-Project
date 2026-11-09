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
 if(actor.email!==OWNER_EMAIL)throw M.fault(403,'Only the owner can configure notification delivery and recipients.');
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
async function prepareDelivery(db,job,config){
 const coordinators=[];for(const email of config.coordinatorEmails||[])if(await recipientAllowed(db,email))coordinators.push(email);
 if(!coordinators.length)throw M.fault(409,'No active Niaz coordinator recipients; delivery needs attention.');
 if(job.kind==='monthly')return coordinators.map(to=>({to,subject:'MWA Niaz monthly report '+job.month,body:null}));
 const event=(await db.doc('events/'+M.id(job.eventId)).get()).data();
 if(job.kind==='seven-day'||job.kind==='three-day'){
  if(!event||event.status!=='confirmed'||event.startAt!==job.eventStartAt)return [];
  const today=dateKey(new Date()),difference=Math.round((Date.parse(dateKey(event.startAt)+'T00:00:00Z')-Date.parse(today+'T00:00:00Z'))/86400000);
  if(difference<0)return [];
  const coverage=(await db.doc('niazEventCoverage/'+job.eventId).get()).data();
  if(job.kind==='three-day'&&!coverage?.eventReviewRequired&&coverage?.arrangementConfirmed)return [];
 }
 const body='MWA Niaz notice: '+job.kind+(job.decision?' - '+job.decision:'')+(job.status?' - '+job.status:'')+'\n\n'+(event?eventText(event):'This programme is no longer available. Contact the coordinator.')+'\n\nEOI approval, financial contribution and final arrangement confirmation remain separate. Review the current record in Niaz Administration.';
 const recipients=coordinators.map(to=>({to,subject:'MWA Niaz: '+job.kind,body}));
 if(['seven-day','three-day','decision','alternative','approval','review','reschedule','cancellation','reassignment'].includes(job.kind)){
  const assignments=job.sponsorId?[{sponsorId:job.sponsorId}]:(await db.collection('niazSponsorships').where('eventId','==',job.eventId).where('status','==','approved').limit(501).get()).docs.map(doc=>doc.data());
  if(assignments.length>500)throw M.fault(413,'Too many sponsor recipients; manual review needed.');
  for(const value of assignments){
   const sponsor=(await db.doc('niazSponsors/'+M.id(value.sponsorId)).get()).data();if(!sponsor?.active)continue;
   if(job.kind==='three-day'&&sponsor.emailPreferences?.optionalReminders===false)continue;
   const labels={'seven-day':'Please confirm your Niaz arrangements','three-day':'Niaz arrangement follow-up',decision:job.decision==='rejected'?'Your Niaz offer was declined':'Your Niaz offer was approved',alternative:'An alternative Niaz programme is proposed',approval:'Your Niaz sponsorship is approved',review:'Your Niaz sponsorship was reviewed',reschedule:'Your Niaz programme details changed',cancellation:'Your Niaz programme was cancelled',reassignment:'Your Niaz sponsorship arrangement changed'};
   const sponsorBody='Hello '+sponsor.name+',\n\n'+labels[job.kind]+'.\n\n'+(event?eventText(event):'This programme is no longer available.')+
    '\n\n'+(['seven-day','three-day'].includes(job.kind)?'Please contact MWA to confirm your food, serving and logistics arrangements.':job.kind==='cancellation'?'Please do not proceed with the previous programme arrangements. Contact MWA if you need assistance.':job.kind==='alternative'?'This is a proposal only. Contact MWA or submit a new EOI for the suggested programme; your existing sponsorship has not been moved automatically.':'Please contact MWA about the next steps and confirm any updated arrangements.')+
    '\n\nEOI approval, financial support and final arrangement confirmation are separate. Reply to this email to contact MWA. View your private requests at https://refreshed.muhammadiwelfare.org.au/niaz/ using your verified contact.';
   if(sponsor.email)recipients.push({to:sponsor.email,subject:'MWA Niaz - '+labels[job.kind]+(event?' - '+event.title:''),body:sponsorBody});
   else for(const to of coordinators)recipients.push({to,subject:'MWA Niaz contact gap',body:(event?eventText(event):job.eventId)+'\nSponsor '+sponsor.name+' has no email. Contact privately using the directory. No sponsor email was sent.'});
  }
 }
 const combined=new Map();
 for(const value of recipients){const key=value.to+':'+value.subject,previous=combined.get(key);combined.set(key,previous?{...value,body:previous.body+'\n\n'+value.body}:value);}
 return [...combined.values()];
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
