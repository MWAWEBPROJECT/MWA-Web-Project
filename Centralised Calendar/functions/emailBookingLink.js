const {randomBytes,createHash}=require('node:crypto');
const ORIGIN='https://refreshed.muhammadiwelfare.org.au';
const hash=value=>createHash('sha256').update(value).digest('hex');
const revision=e=>e.updatedAt?.toDate?e.updatedAt.toDate().toISOString():e.updatedAt||'';
const millis=value=>value?.toMillis?value.toMillis():new Date(value).getTime();
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function failure(message){const error=new Error(message);error.safe=true;throw error;}
async function issueLink(db,eventId,event){
 const token=randomBytes(32).toString('hex');
 await db.doc('_bookingEmailActions/'+hash(token)).create({eventId,revision:revision(event),expiresAt:new Date(Date.now()+48*3600000),createdAt:new Date(),used:false,deliveredTo:['Events@muhammadiwelfare.org.au','admin@muhammadiwelfare.org.au']});
 const url=decision=>ORIGIN+'/booking-response?t='+token+'&decision='+decision;
 return {approve:url('approve'),reject:url('reject')};
}
function service({db,FieldValue,findOverlaps,recomputeVenueConflicts,refreshConflictNeighborhood,sendAll,notify,getHijriOverrides,hijriInfoFor,dateKeyOf,logger}){
 function tokenRef(token){if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))failure('This approval link is invalid.');return db.doc('_bookingEmailActions/'+hash(token));}
 async function inspect(token,decision,tx){
  if(!['approve','reject'].includes(decision))failure('This action is invalid.');
  const ref=tokenRef(token),snap=await(tx?tx.get(ref):ref.get());
  if(!snap.exists)failure('This approval link is invalid.');
  const grant=snap.data();
  if(grant.used)failure('This email link has already been used. No further action was taken.');
  if(!Number.isFinite(millis(grant.expiresAt))||millis(grant.expiresAt)<=Date.now())failure('This email link has expired. Please review the booking through the admin calendar.');
  const eventRef=db.doc('events/'+grant.eventId),eventSnap=await(tx?tx.get(eventRef):eventRef.get());
  if(!eventSnap.exists)failure('This booking no longer exists.');
  const event=eventSnap.data();
  if(event.status!=='pending')failure('This booking has already been decided. No further action was taken.');
  if(revision(event)!==grant.revision)failure('The booking details changed after this email was sent. Please review the latest booking in the admin calendar.');
  return {ref,grant,eventRef,event};
 }
 async function decide(token,decision){
  let saved,before,id,grantRef;const status=decision==='approve'?'confirmed':'rejected';
  await db.runTransaction(async tx=>{
   const {ref,grant,eventRef,event}=await inspect(token,decision,tx);before=event;
   if(decision==='approve'&&(await findOverlaps(event.venueId,event.startAt,event.endAt,grant.eventId,tx)).length)failure('This booking now conflicts with another booking and cannot be approved. You may still use the Reject link in the email.');
   const patch={status,decidedBy:'email-link',decidedByEmail:null,decisionSource:'events-admin-email-link',decidedAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp(),decisionNote:'',...(decision==='approve'?{hasConflict:false,conflictWith:[]}:{})};
   tx.update(eventRef,patch);tx.update(ref,{used:true,usedAt:FieldValue.serverTimestamp(),decision});
   tx.set(db.collection('auditLog').doc(),{module:'events-bookings',entityType:'event',entityId:grant.eventId,action:'status_'+status,userId:null,userEmail:null,timestamp:new Date().toISOString(),note:'Confirmed using single-use link delivered to Events/Admin inboxes; individual identity not authenticated.',diff:{from:event.status,to:status},authMethod:'email-link'});
   saved={...event,...patch};id=grant.eventId;grantRef=ref;
  });
  await refreshConflictNeighborhood([{id,before,after:saved}]).catch(error=>logger.error('Email-link conflict refresh failed',error));
  let sent=false;
  try{const hijri=hijriInfoFor(dateKeyOf(saved.startAt),await getHijriOverrides());const message=notify.decisionRequester(saved,hijri,status,'');if(message&&status==='confirmed')message.attachments=[notify.icsAttachment(saved,id)];const results=await sendAll([message]);sent=results?.[0]?.sent===true;}catch(error){logger.error('Email-link decision notification failed',error);}
  await grantRef.update({notificationSent:sent}).catch(()=>{});
  return {status,sent};
 }
 return {inspect,decide};
}
function page(title,content){return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>'+esc(title)+' | MWA</title><style>body{margin:0;background:#f3f7f4;color:#18372c;font:16px/1.6 system-ui,sans-serif}main{max-width:580px;margin:8vh auto;padding:32px;background:white;border:1px solid #d6e2d9;border-radius:20px}h1{font-size:28px;line-height:1.2}small{color:#52675b}button{background:#176446;color:#fff;padding:14px 22px;border:0;border-radius:9px;font:600 16px system-ui;cursor:pointer}a{color:#176446}@media(max-width:640px){main{margin:20px;padding:24px}}</style></head><body><main><small>MUHAMMADI WELFARE ASSOCIATION</small><h1>'+esc(title)+'</h1>'+content+'</main></body></html>';}
function register(deps){
 const actions=service(deps);
 return {bookingEmailAction:deps.onRequest({secrets:deps.emailSecrets},async(req,res)=>{
  res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"});
  if(!['GET','POST'].includes(req.method))return res.status(405).send('Method not allowed');
  const data=req.method==='POST'?req.body:req.query,token=data?.t,decision=data?.decision;
  try{
   if(req.method==='POST'){
    const origin=req.get('origin');if(origin&&origin!==ORIGIN&&origin!=='https://mwa-community-web.web.app')failure('Please open the original email link to confirm this request.');
    if(data?.confirm!=='yes')failure('Please use the confirmation button.');
    const result=await actions.decide(token,decision);
    return res.status(200).send(page(result.status==='confirmed'?'Booking approved':'Booking rejected','<p>The booking has been '+(result.status==='confirmed'?'approved':'rejected')+'.</p><p>'+(result.sent?'The confirmation email has been sent to the requester.':'The decision is saved, but email delivery could not be confirmed. Please contact the MWA team.')+'</p><a href="'+ORIGIN+'/">Return to MWA Home</a>'));
   }
   const {event}=await actions.inspect(token,decision);
   const date=new Date(event.startAt).toLocaleString('en-AU',{timeZone:'Australia/Sydney',dateStyle:'full',timeStyle:'short'});
   return res.status(200).send(page(decision==='approve'?'Confirm booking approval':'Confirm booking rejection','<p><strong>'+esc(event.title)+'</strong><br>'+esc(event.venueName)+'<br>'+esc(date)+' (Sydney)</p><p>No sign-in is needed. Confirm below to '+(decision==='approve'?'approve':'reject')+' this request and notify the requester.</p><form method="post" action="/booking-response"><input type="hidden" name="t" value="'+esc(token)+'"><input type="hidden" name="decision" value="'+esc(decision)+'"><button name="confirm" value="yes" type="submit">'+(decision==='approve'?'Confirm approval':'Confirm rejection')+'</button></form><p><small>This link expires after 48 hours and can be used once. Availability is checked again before approval.</small></p>'));
  }catch(error){if(!error.safe)deps.logger.error('Email action failed',{message:error.message});return res.status(error.safe?400:500).send(page('Unable to complete this action','<p>'+esc(error.safe?error.message:'Please try again later or contact the MWA team.')+'</p><a href="'+ORIGIN+'/calendar/">Open MWA calendar</a>'));}
 })};
}
module.exports={issueLink,service,register,hash};
