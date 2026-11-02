const {randomUUID}=require('node:crypto');
const {emailAddress,TEST_EMAIL,INTERVALS,today,startTimestamp,money}=require('./donations');
const idOf=v=>typeof v==='string'?v:v?.id;
async function queueMail(db,key,subject,text,extra={}){try{await db.doc('_stripeSandboxMail/'+key).create({subject,text,status:'queued',attempts:0,...extra});}catch(e){if(e.code!==6)throw e;}}
async function complete(db,stripe,ref){
 let d=(await ref.get()).data();if(!d?.sessionId)return;
 const s=await stripe.checkout.sessions.retrieve(d.sessionId,{expand:['payment_intent']});
 if(s.livemode||s.metadata?.mwaDonation!==ref.id||s.metadata?.integration!=='mwa-sandbox-v1'||s.amount_total!==d.amount||s.currency!=='aud')throw Error('Session mismatch');
 if(s.payment_status!=='paid'){if(s.status==='expired')await ref.update({status:'expired'});return;}
 const donorEmail=emailAddress(s.customer_details?.email||d.email||d.testEmail||TEST_EMAIL);
 await ref.update({customerId:idOf(s.customer),email:donorEmail});d.email=donorEmail;
 let note='No recurring donation was selected.';
 if(d.recurring){
  try{
   if(!d.scheduleId){
    if(d.recurringAttemptAt&&Date.now()-d.recurringAttemptAt>23*3600000)throw Error('Manual reconciliation required');
    if(d.recurring.firstDate<today())throw Error('Selected start date has passed');
    const start=d.scheduleStart??(d.recurring.firstDate===today()?'now':startTimestamp(d.recurring.firstDate));
    if(!d.recurringAttemptAt){await ref.update({recurringAttemptAt:Date.now(),scheduleStart:start});d=(await ref.get()).data();}
    const method=idOf(s.payment_intent?.payment_method);if(!method)throw Error('No saved payment method');
    const interval=INTERVALS[d.recurring.frequency];
    const price=await stripe.prices.create({currency:'aud',unit_amount:d.recurring.amount,recurring:interval,product_data:{name:'MWA '+d.fund+' — recurring sandbox donation'},metadata:{mwaDonation:ref.id}},{idempotencyKey:'mwa-price-'+ref.id});
    const schedule=await stripe.subscriptionSchedules.create({customer:idOf(s.customer),start_date:start,end_behavior:'release',default_settings:{default_payment_method:method,collection_method:'charge_automatically'},metadata:{mwaDonation:ref.id},phases:[{items:[{price:price.id,quantity:1}],duration:interval,metadata:{mwaDonation:ref.id}}]},{idempotencyKey:'mwa-schedule-'+ref.id});
    if(schedule.livemode)throw Error('Unexpected live schedule');
    await ref.update({scheduleId:schedule.id,recurringStatus:'scheduled'});d.scheduleId=schedule.id;
   }
   note=`Your additional recurring donation is scheduled: ${money(d.recurring.amount)} ${d.recurring.frequency}, starting ${d.recurring.firstDate} (Sydney). Future instalments have not yet been paid. Use the private management link below to cancel future instalments. If the first date is within two days, this email is your initial payment notice.`;
  }catch{
   await ref.update({recurringStatus:'needs_attention'});
   note='Your one-off payment succeeded, but recurring setup needs attention. Do not pay the one-off amount again. Contact the MWA administrator to resolve the schedule.';
  }
 }
 await queueMail(db,'confirmation_'+ref.id,'MWA sandbox donation confirmation',`TEST ONLY — no real money moved.\n\nOne-off donation successful: ${money(d.amount)} for ${d.fund}.\n\n${note}`,{to:d.email,...(d.recurring?{manageUrl:await require('./donation-management').managementLink(ref)}:{})});
 await ref.update({status:'paid'});
}
async function recurringUpdate(db,stripe,ref){
 const d=ref.data();if(!d.scheduleId||d.recurringStatus==='canceled')return;
 const schedule=await stripe.subscriptionSchedules.retrieve(d.scheduleId);
 if(schedule.livemode)throw Error('Unexpected live schedule');
 if(['canceled','aborted','completed'].includes(schedule.status)){await ref.ref.update({recurringStatus:schedule.status});return;}
 let next,amount=d.recurring.amount,subscriptionId=idOf(schedule.subscription)||idOf(schedule.released_subscription);
 if(subscriptionId){
  const sub=await stripe.subscriptions.retrieve(subscriptionId);if(sub.livemode)throw Error('Unexpected live subscription');
  if(!['active','trialing'].includes(sub.status)||sub.pause_collection){await ref.ref.update({recurringStatus:sub.status});return;}
  const item=sub.items.data[0];next=item.current_period_end||sub.current_period_end;amount=item.price.unit_amount*item.quantity;
  if(sub.cancel_at_period_end||(sub.cancel_at&&sub.cancel_at<=next)){await ref.ref.update({recurringStatus:'cancelling'});return;}
 }else if(schedule.status==='not_started'){next=schedule.phases[0]?.start_date;const item=schedule.phases[0]?.items[0];if(!item)return;const price=await stripe.prices.retrieve(idOf(item.price));amount=price.unit_amount*(item.quantity||1);}
 if(!next||!Number.isFinite(amount))return;
 const due=today(new Date(next*1000)),twoDays=today(new Date(Date.now()+2*86400000));
 await ref.ref.update({recurringStatus:schedule.status==='not_started'?'scheduled':'active',subscriptionId:subscriptionId||null,nextPaymentDate:due});
 if(due===twoDays)await queueMail(db,'reminder_'+ref.id+'_'+next+'_'+amount,'MWA sandbox recurring donation reminder',`TEST ONLY — no real money will move.\n\nYour next recurring donation of ${money(amount)} for ${d.fund} is scheduled for ${due} (Sydney), in two days. Use the private management link below to cancel future instalments.`,{manageUrl:await require('./donation-management').managementLink(ref.ref),to:d.email||d.testEmail||TEST_EMAIL,reminder:{donationId:ref.id,due,amount,next}});
}
async function events(db,stripe){
 const batch=await db.collection('_stripeSandboxEvents').where('status','==','pending').limit(20).get();
 for(const doc of batch.docs){try{
  const e=JSON.parse(doc.data().payload),obj=e.data.object;
  if(e.type.startsWith('checkout.session.')){const id=obj.metadata?.mwaDonation;if(id&&/^[a-f0-9-]{36}$/.test(id)){const ref=db.doc('_stripeSandboxDonations/'+id);const d=(await ref.get()).data();if(d?.sessionId===obj.id)await complete(db,stripe,ref);}}
  else if(e.type.startsWith('invoice.')){
   const invoice=await stripe.invoices.retrieve(obj.id);if(invoice.livemode)throw Error('Unexpected live invoice');
   const sub=idOf(invoice.parent?.subscription_details?.subscription)||idOf(invoice.subscription);
   if(sub){const found=await db.collection('_stripeSandboxDonations').where('customerId','==',idOf(invoice.customer)).limit(10).get();
    for(const d of found.docs){if(!d.data().scheduleId)continue;const sch=await stripe.subscriptionSchedules.retrieve(d.data().scheduleId);if(sub!==(idOf(sch.subscription)||idOf(sch.released_subscription)))continue;
     if(invoice.status==='paid')await queueMail(db,'invoice_paid_'+invoice.id,'MWA sandbox recurring donation receipt',`TEST ONLY — no real money moved.\n\nRecurring donation successful: ${money(invoice.amount_paid)} for ${d.data().fund}.`,{manageUrl:await require('./donation-management').managementLink(d.ref),to:d.data().email||d.data().testEmail||TEST_EMAIL});
     else if(['invoice.payment_failed','invoice.payment_action_required'].includes(e.type))await queueMail(db,'invoice_failed_'+invoice.id,'MWA sandbox recurring payment needs attention','TEST ONLY. Your recurring test payment did not complete. Contact the MWA administrator to review the payment.',{manageUrl:await require('./donation-management').managementLink(d.ref),to:d.data().email||d.data().testEmail||TEST_EMAIL});
    }
   }
  }
  await doc.ref.update({status:'processed',processedAt:new Date().toISOString()});
 }catch{const attempts=(doc.data().attempts||0)+1;await doc.ref.update({attempts,status:attempts>=6?'needs_attention':'pending'});}}
}
async function reminderCurrent(db,stripe,r){
 const d=(await db.doc('_stripeSandboxDonations/'+r.donationId).get()).data();if(!d?.scheduleId)return false;
 const sch=await stripe.subscriptionSchedules.retrieve(d.scheduleId);
 if(sch.livemode||['canceled','aborted','completed'].includes(sch.status))return false;
 const sid=idOf(sch.subscription)||idOf(sch.released_subscription);
 if(!sid){if(sch.status!=='not_started'||sch.phases[0]?.start_date!==r.next||today(new Date(Date.now()+2*86400000))!==r.due)return false;const item=sch.phases[0]?.items[0];if(!item)return false;const price=await stripe.prices.retrieve(idOf(item.price));return price.unit_amount*(item.quantity||1)===r.amount;}
 const sub=await stripe.subscriptions.retrieve(sid),item=sub.items.data[0],next=item.current_period_end||sub.current_period_end;
 return !sub.livemode&&['active','trialing'].includes(sub.status)&&!sub.pause_collection&&!sub.cancel_at_period_end&&(!sub.cancel_at||sub.cancel_at>next)&&next===r.next&&item.price.unit_amount*item.quantity===r.amount&&today(new Date(Date.now()+2*86400000))===r.due;
}
async function mail(db,stripe){
 const jobs=await db.collection('_stripeSandboxMail').where('status','==','queued').limit(10).get();if(jobs.empty)return;
 const token=await require('./enquiries-gmail').tokenFor(db);
 async function gmail(path,options={}){const r=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/'+path,{...options,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Mail unavailable');return r.json();}
 for(const doc of jobs.docs){try{
  const j=doc.data();
  if(j.reminder&&!await reminderCurrent(db,stripe,j.reminder)){await doc.ref.update({status:'suppressed'});continue;}
  const messageId=doc.id+'@sandbox.muhammadiwelfare.org.au';
  const previous=await gmail('messages?'+new URLSearchParams({q:'in:sent rfc822msgid:'+messageId,maxResults:'1'}));
  if(!previous.messages?.length){
   const raw=require('./donation-email').buildRaw({to:emailAddress(j.to||TEST_EMAIL),subject:j.subject,text:j.text,messageId,manageUrl:j.manageUrl});
   await gmail('messages/send',{method:'POST',body:JSON.stringify({raw})});
  }
  await doc.ref.update({status:'sent',sentAt:new Date().toISOString()});
 }catch{const attempts=(doc.data().attempts||0)+1;await doc.ref.update({attempts,status:attempts>=5?'needs_attention':'queued'});}}
}
async function run(db,stripe){
 const lock=db.doc('_stripeSandboxPrivate/worker'),lease=randomUUID();let acquired=false;
 await db.runTransaction(async tx=>{const s=await tx.get(lock);if(s.data()?.until>Date.now())return;tx.set(lock,{lease,until:Date.now()+300000},{merge:true});acquired=true;});if(!acquired)return;
 try{
  await events(db,stripe);
  const pending=await db.collection('_stripeSandboxDonations').where('status','==','awaiting_payment').limit(20).get();
  for(const d of pending.docs){try{await complete(db,stripe,d.ref);if(!d.data().sessionId&&Date.now()-d.data().createdAt>86400000)await d.ref.update({status:'expired'});}catch{await d.ref.update({lastCheckError:'Payment verification delayed'});}}
  const state=(await lock.get()).data();let q=db.collection('_stripeSandboxDonations').where('status','==','paid').orderBy('__name__');if(state.cursor)q=q.startAfter(state.cursor);
  const paid=await q.limit(20).get();for(const d of paid.docs){try{await recurringUpdate(db,stripe,d);}catch{await d.ref.update({lastCheckError:'Recurring verification delayed'});}}
  await lock.update({cursor:paid.size===20?paid.docs.at(-1).id:null});
  await mail(db,stripe);
 }finally{await db.runTransaction(async tx=>{const s=await tx.get(lock);if(s.data()?.lease===lease)tx.update(lock,{until:0});});}
}
module.exports={complete,recurringUpdate,reminderCurrent,events,run};
