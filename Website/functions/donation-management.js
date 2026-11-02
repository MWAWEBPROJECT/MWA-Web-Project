const {randomBytes,timingSafeEqual}=require('node:crypto');
const {getAuth}=require('firebase-admin/auth');
const {resolveAdmin}=require('./moduleAccess');
const {SITE,TEST_EMAIL}=require('./donations');
const fault=(message,status=400)=>Object.assign(Error(message),{status});
const idOf=v=>typeof v==='string'?v:v?.id;
async function managementLink(ref){let token;await ref.firestore.runTransaction(async tx=>{const snap=await tx.get(ref);token=snap.data()?.manageToken;if(!token){token=randomBytes(32).toString('hex');tx.update(ref,{manageToken:token});}});return SITE+'/#donation-manage='+ref.id+'.'+token;}
function validToken(stored,provided){return typeof stored==='string'&&/^[a-f0-9]{64}$/.test(provided||'')&&stored.length===provided.length&&timingSafeEqual(Buffer.from(stored),Buffer.from(provided));}
async function cancelRecurring(db,stripe,ref,actor){
 const d=(await ref.get()).data();if(!d?.scheduleId)throw fault('Recurring setup is not ready yet. Please try again shortly.',409);
 const schedule=await stripe.subscriptionSchedules.retrieve(d.scheduleId);
 if(schedule.livemode!==false||idOf(schedule.customer)!==d.customerId)throw Error('Schedule mismatch');
 if(['not_started','active'].includes(schedule.status))await stripe.subscriptionSchedules.cancel(schedule.id,{invoice_now:false,prorate:false});
 else if(schedule.status==='released'){
  const sid=idOf(schedule.released_subscription);if(!sid)throw Error('Subscription missing');
  const sub=await stripe.subscriptions.retrieve(sid);if(sub.livemode!==false||idOf(sub.customer)!==d.customerId)throw Error('Subscription mismatch');
  if(sub.status!=='canceled')await stripe.subscriptions.cancel(sid,{invoice_now:false,prorate:false});
 }else if(!['canceled','aborted','completed'].includes(schedule.status))throw fault('This recurring donation needs administrator review.',409);
 // Use deterministic records so retries do not duplicate notifications/audits.
 if(d.recurringStatus!=='canceled'){const batch=db.batch();batch.update(ref,{recurringStatus:'canceled',cancelledAt:new Date().toISOString(),cancelledBy:actor.uid||'donor-link'});
 batch.set(db.doc('auditLog/donation_cancel_'+ref.id),{module:'donations',entityType:'donation',entityId:ref.id,action:'donation.recurring_cancelled',userId:actor.uid||null,userEmail:actor.email||null,timestamp:new Date().toISOString(),note:actor.uid?'Cancelled by authorised admin':'Cancelled using private donor management link'});
 await batch.commit();}
 try{await db.doc('_stripeSandboxMail/cancel_'+ref.id).create({to:d.email||d.testEmail||TEST_EMAIL,subject:'MWA Sandbox Recurring Donation Cancelled',text:'Your recurring sandbox donation has been cancelled. No new recurring instalments will be scheduled. Payments already completed or in progress are not refunded or reversed.\n\nThis is a sandbox notification; no real money moved.',status:'queued',attempts:0});}catch(e){if(e.code!==6)throw e;}
 return {cancelled:true};
}
async function handle(req,res,{db,stripe,path,verifyToken=(token)=>getAuth().verifyIdToken(token,true)}){
 if(!['manage','cancel','admin','admin-cancel','admin-export'].includes(path))return false;
 if(!['GET','POST'].includes(req.method))throw fault('Method not allowed.',405);
 const admin=path.startsWith('admin');let actor={};
 const bearer=/^Bearer (.+)$/.exec(req.get('Authorization')||'')?.[1];
 if(admin){let token;try{token=await verifyToken(bearer||'');}catch{throw fault('Admin sign-in required.',401);}actor=await resolveAdmin(db,token.uid,token,'donations');if(!actor)throw fault('Donation Administration access required.',403);}
 if(path==='admin'&&req.method==='GET'){
  res.json(await require('./donation-records').listRecords(db,req.query));return true;
 }
 if(path==='admin-export'){
  if(req.method!=='POST'||![SITE,'https://mwa-community-web.web.app','https://mwa-community-web.firebaseapp.com'].includes(req.get('Origin'))||!req.is('application/json'))throw fault('Open this action from the MWA website.',403);
  const {format,count}=req.body||{};if(!['xlsx','pdf'].includes(format)||!Number.isInteger(count)||count<0||count>20000)throw fault('Invalid export details.');
  await db.collection('auditLog').add({module:'donations',entityType:'export',entityId:format,action:'donation.export_prepared',userId:actor.uid,userEmail:actor.email,timestamp:new Date().toISOString(),note:format.toUpperCase()+' export prepared: '+count+' matching records. Browser download completion is not tracked.'});res.json({ok:true});return true;
 }
 const id=String(req.method==='GET'?req.query.id:req.body?.id||'');if(!/^[a-f0-9-]{36}$/.test(id))throw fault('Invalid donation reference.');
 const ref=db.doc('_stripeSandboxDonations/'+id),d=(await ref.get()).data();if(!d)throw fault('Donation not found.',404);
 if(!admin&&!validToken(d.manageToken,bearer))throw fault('This private management link is invalid. Contact MWA for help.',403);
 if(path==='manage'&&req.method==='GET'){res.json({fund:d.fund,recurring:d.recurring,status:d.recurringStatus,canCancel:!!d.scheduleId&&!['canceled','aborted','completed'].includes(d.recurringStatus),sandbox:true});return true;}
 if(req.method!=='POST'||!['cancel','admin-cancel'].includes(path))throw fault('Method not allowed.',405);
 if(![SITE,'https://mwa-community-web.web.app','https://mwa-community-web.firebaseapp.com'].includes(req.get('Origin'))||!req.is('application/json'))throw fault('Open this action from the MWA website.',403);
 if(req.body.confirm!==true)throw fault('Please confirm cancellation.');
 res.json(await cancelRecurring(db,stripe,ref,actor));return true;
}
module.exports={managementLink,validToken,cancelRecurring,handle};
