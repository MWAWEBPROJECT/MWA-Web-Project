const {createHash,randomUUID}=require('node:crypto');
const {resolveAdmin}=require('./moduleAccess');
const {midnight,validDate,publicEvent,eventList}=require('./donation-records');
const model=import('./registration-model.mjs');
const fault=(status,message)=>Object.assign(Error(message),{status});
const hash=value=>createHash('sha256').update(value).digest('hex');
function text(value,label,max,required=false){
 if(typeof value!=='string'||value.length>max||(required&&!value.trim()))throw fault(400,'Check '+label+'.');
 return value.trim();
}
function listing(form,id){return {id,title:form.title,description:form.description,expiryDate:form.expiryDate,expiresAt:form.expiresAt};}
function open(form,time=Date.now()){return form?.published===true&&form.expiresAt>new Date(time).toISOString();}
async function adminFor(req,db,getAuth){
 const match=/^Bearer (.+)$/.exec(req.get('Authorization')||'');
 if(!match)throw fault(401,'Sign in with an approved MWA admin account.');
 let token;try{token=await getAuth().verifyIdToken(match[1],true);}catch{throw fault(401,'Your session expired. Please sign in again.');}
 const actor=await resolveAdmin(db,token.uid,token,'form-builder');
 if(!actor)throw fault(403,'Form Builder access is required to manage registration forms and responses.');
 return actor;
}
function audit(db,tx,actor,id,action){
 tx.create(db.collection('auditLog').doc(),{module:'form-builder',entityType:'registration-form',entityId:id,action,userId:actor.uid,userEmail:actor.email,timestamp:new Date().toISOString()});
}
async function save(db,id,input,actor){
 if(!input||!Number.isSafeInteger(input.revision)||input.revision<0)throw fault(400,'A valid form revision is required.');
 if(!validDate(input.expiryDate))throw fault(400,'Choose an expiry date. Forms close at the end of that day in Sydney.');
 const nextDay=new Date(Date.parse(input.expiryDate+'T00:00:00Z')+86400000).toISOString().slice(0,10);
 const expiresAt=new Date(midnight(nextDay)).toISOString();
 if(typeof input.published!=='boolean')throw fault(400,'Choose whether to publish this form.');
 if(input.published&&expiresAt<=new Date().toISOString())throw fault(400,'Choose an expiry date that has not passed.');
 let fields;try{fields=(await model).cleanFields(input.fields);}catch(error){throw fault(400,error.message);}
 const form={title:text(input.title,'the form title',160,true),description:text(input.description??'','the introduction',2000),
  purpose:text(input.purpose,'why answers are collected',1000,true),expiryDate:input.expiryDate,expiresAt,
  eventId:text(input.eventId??'','the linked event',128),published:input.published,fields};
 if(form.eventId&&!/^[A-Za-z0-9_-]{1,128}$/.test(form.eventId))throw fault(400,'Choose a valid calendar event.');
 const ref=db.doc('registrationForms/'+id);
 return db.runTransaction(async tx=>{
  const current=await tx.get(ref);
  const event=form.eventId?await tx.get(db.doc('events/'+form.eventId)):null;
  // Form Builder access must not expose private calendar bookings.
  if(event&&!publicEvent(event.data(),form.eventId))throw fault(400,'Choose a confirmed public calendar event.');
  if((current.exists?current.data().revision:0)!==input.revision)throw fault(409,'This form changed. Reopen it before saving.');
  const record={...form,revision:input.revision+1,createdAt:current.exists?current.data().createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),updatedBy:actor.uid};
  tx.set(ref,record);
  const publicRef=db.doc('registrationListings/'+id);
  if(record.published)tx.set(publicRef,listing(record,id));else tx.delete(publicRef);
  audit(db,tx,actor,id,record.published?'registration.published':'registration.draft_saved');
  return {form:{id,...record}};
 });
}
async function submit(db,id,input,ip){
 if(!input||!Number.isSafeInteger(input.revision)||typeof input.requestId!=='string'||!/^[A-Za-z0-9_-]{16,80}$/.test(input.requestId)||input.website)throw fault(400,'Reload the form and check your answers.');
 if(!input.answers||typeof input.answers!=='object'||Array.isArray(input.answers)||Buffer.byteLength(JSON.stringify(input.answers))>80000)throw fault(400,'Check the size and format of your answers.');
 const responseId=hash(id+':'+input.requestId),digest=hash(JSON.stringify({revision:input.revision,answers:input.answers}));
 const formRef=db.doc('registrationForms/'+id),ref=formRef.collection('responses').doc(responseId);
 const rateRef=db.doc('_registrationRateLimits/'+hash(ip+':'+Math.floor(Date.now()/900000)));
 const reference='MWA-R-'+responseId.slice(0,12).toUpperCase();
 await db.runTransaction(async tx=>{
  const [formSnap,existing,limit]=await Promise.all([tx.get(formRef),tx.get(ref),tx.get(rateRef)]);
  if(existing.exists){if(existing.data().digest!==digest)throw fault(409,'This submission reference was already used. Reload before sending different answers.');return;}
  const form=formSnap.data();
  if(!formSnap.exists||!open(form))throw fault(410,'This form is closed or no longer available.');
  if(form.revision!==input.revision)throw fault(409,'The form changed. Reload it and review your answers.');
  const errors=(await model).validateAnswers(form.fields,input.answers);
  if(Object.keys(errors).length)throw fault(400,Object.values(errors)[0]);
  if((limit.data()?.count||0)>=10)throw fault(429,'Too many forms were submitted recently. Please try again later.');
  const answers=Object.fromEntries(form.fields.filter(field=>Object.hasOwn(input.answers,field.id)).map(field=>[field.id,input.answers[field.id]]));
  tx.create(ref,{reference,digest,answers,fields:form.fields,formTitle:form.title,purpose:form.purpose,eventId:form.eventId,revision:form.revision,createdAt:new Date().toISOString()});
  tx.set(rateRef,{count:(limit.data()?.count||0)+1,expiresAt:new Date(Date.now()+3600000)});
 });
 return {reference};
}
async function page(collection,query,after){
 if(after){
  if(typeof after!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(after))throw fault(400,'Invalid page reference.');
  const cursor=await collection.doc(after).get();
  if(!cursor.exists)throw fault(400,'This page is no longer available. Refresh the list.');
  query=query.startAfter(cursor);
 }
 const snap=await query.limit(51).get(),docs=snap.docs.slice(0,50);
 return {docs,next:snap.size>50?docs.at(-1).id:null};
}
async function handle(req,res,{db,getAuth,origins}){
 try{
  const path=req.path.replace(/^\/api\/registrations/,'').replace(/\/$/,'')||'/';
  if(req.method!=='GET'&&(!origins.has(req.get('Origin'))||!req.is('application/json')))throw fault(403,'Use the MWA website to submit this request.');
  if(path==='/'&&req.method==='GET'){
   const collection=db.collection('registrationListings');
   const {docs,next}=await page(collection,collection.where('expiresAt','>',new Date().toISOString()).orderBy('expiresAt'),req.query.after);
   return res.json({items:docs.map(doc=>listing(doc.data(),doc.id)),next});
  }
  const publicMatch=/^\/([a-f0-9-]{36})(\/submit)?$/.exec(path);
  if(publicMatch){
   const [,id,action]=publicMatch;
   if(action&&req.method==='POST')return res.status(201).json(await submit(db,id,req.body,req.ip||'unknown'));
   if(!action&&req.method==='GET'){
    const snap=await db.doc('registrationForms/'+id).get(),form=snap.data();
    if(!snap.exists||!open(form))throw fault(410,'This form is closed or no longer available.');
    let event=null;if(form.eventId){const linked=await db.doc('events/'+form.eventId).get();event=publicEvent(linked.data(),form.eventId);}
    return res.json({form:{...listing(form,id),purpose:form.purpose,fields:form.fields,revision:form.revision,event}});
   }
   throw fault(405,'Method not allowed.');
  }
  const actor=await adminFor(req,db,getAuth);
  if(path==='/admin/events'&&req.method==='GET')return res.json({items:await eventList(db,text(req.query.date,'the event date',10,true))});
  if(path==='/admin'&&req.method==='GET'){
   const collection=db.collection('registrationForms');
   const {docs,next}=await page(collection,collection.orderBy('createdAt','desc'),req.query.after);
   return res.json({items:docs.map(doc=>({id:doc.id,...doc.data()})),next});
  }
  if(path==='/admin'&&req.method==='POST')return res.status(201).json(await save(db,randomUUID(),req.body,actor));
  const match=/^\/admin\/([a-f0-9-]{36})(\/responses)?$/.exec(path);
  if(!match)throw fault(404,'Registration endpoint not found.');
  const [,id,action]=match;
  if(!action&&req.method==='PUT')return res.json(await save(db,id,req.body,actor));
  if(action&&req.method==='GET'){
   if(!(await db.doc('registrationForms/'+id).get()).exists)throw fault(404,'Form not found.');
   const collection=db.collection('registrationForms/'+id+'/responses');
   const {docs,next}=await page(collection,collection.orderBy('createdAt','desc'),req.query.after);
   return res.json({items:docs.map(doc=>{const {digest,...response}=doc.data();return {id:doc.id,...response};}),next});
  }
  throw fault(405,'Method not allowed.');
 }catch(error){
  if(!error.status)console.error('Registration service failed',error);
  return res.status(error.status||503).json({error:error.status?error.message:'The registrations service is temporarily unavailable. Please try again.'});
 }
}
module.exports={handle,save,submit,adminFor,open};
