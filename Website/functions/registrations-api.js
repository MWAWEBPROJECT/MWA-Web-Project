const V=require('./responseViewer');
const {createHash,randomUUID}=require('node:crypto');
const {resolveAdmin}=require('./moduleAccess');
const {midnight,validDate,publicEvent,eventList}=require('./donation-records');
const {bumpSourceVersionTx,bumpFormsVersionTx}=require('./insights-state');
const Poster=require('./registration-poster');
const model=import('./registration-model.mjs');
const fault=(status,message)=>Object.assign(Error(message),{status});
const hash=value=>createHash('sha256').update(value).digest('hex');
function text(value,label,max,required=false){
 if(typeof value!=='string'||value.length>max||(required&&!value.trim()))throw fault(400,'Check '+label+'.');
 return value.trim();
}
function listing(form,id){
 const description=form.description||'',descriptionRuns=Array.isArray(form.descriptionRuns)?form.descriptionRuns:(description?[{text:description,bold:false}]:[]);
 return {id,title:form.title,description,descriptionRuns,expiryDate:form.expiryDate,expiresAt:form.expiresAt};
}
function open(form,time=Date.now()){return form?.published===true&&form.expiresAt>new Date(time).toISOString();}
async function adminFor(req,db,getAuth){
 const match=/^Bearer (.+)$/.exec(req.get('Authorization')||'');
 if(!match)throw fault(401,'Sign in with an approved MWA admin account.');
 let token;try{token=await getAuth().verifyIdToken(match[1],true);}catch{throw fault(401,'Your session expired. Please sign in again.');}
 const actor=await resolveAdmin(db,token.uid,token,'form-builder');
 if(!actor){const viewer=await V.resolveViewer(db,token.uid,token);if(viewer)return viewer;throw fault(403,'Form Builder access is required to manage registration forms and responses.');}
 return actor;
}
function audit(db,tx,actor,id,action,details={}){
 tx.create(db.collection('auditLog').doc(),{module:'form-builder',entityType:'registration-form',entityId:id,action,userId:actor.uid,userEmail:actor.email,timestamp:new Date().toISOString(),...details});
}
function exportCutoff(value){
 if(typeof value!=='string'||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value||Date.parse(value)>Date.now()+60000)throw fault(400,'Invalid export start time.');
 return value;
}
function responseData(id,data){
 const {digest,originalAnswers,...response}=data;
 return {id,...response};
}
async function editResponse(db,formId,responseId,input,actor){
 if(!input||!Number.isSafeInteger(input.editRevision)||input.editRevision<0)throw fault(400,'A valid response edit revision is required.');
 if(!input.answers||typeof input.answers!=='object'||Array.isArray(input.answers)||Buffer.byteLength(JSON.stringify(input.answers))>80000)throw fault(400,'Check the size and format of your answers.');
 const ref=db.doc('registrationForms/'+formId+'/responses/'+responseId);
 return db.runTransaction(async tx=>{
  const snap=await tx.get(ref);
  if(!snap.exists)throw fault(404,'Response not found.');
  const current=snap.data();
  if((current.editRevision||0)!==input.editRevision)throw fault(409,'This response changed. Reload responses before editing it again.');
  for(const field of current.fields)if(field.type==='consent'&&JSON.stringify(current.answers[field.id])!==JSON.stringify(input.answers[field.id]))throw fault(400,'Submitted consent cannot be changed by an admin.');
  const errors=(await model).validateAnswers(current.fields,input.answers);
  if(Object.keys(errors).length)throw fault(400,Object.values(errors)[0]);
  const changedFields=current.fields.filter(field=>JSON.stringify(current.answers[field.id])!==JSON.stringify(input.answers[field.id])).map(field=>field.id);
  if(!changedFields.length)return {response:responseData(responseId,current)};
  const update={answers:input.answers,originalAnswers:current.originalAnswers||current.answers,editRevision:input.editRevision+1,editedAt:new Date().toISOString(),editedBy:actor.uid};
  await bumpSourceVersionTx(tx,db,formId);
  tx.update(ref,update);
  audit(db,tx,actor,formId,'registration.response_updated',{responseId,changedFields,editRevision:update.editRevision});
  return {response:responseData(responseId,{...current,...update})};
 });
}
async function save(db,id,input,actor,posterStorage,reauthorize){
 if(!input||!Number.isSafeInteger(input.revision)||input.revision<0)throw fault(400,'A valid form revision is required.');
 if(!validDate(input.expiryDate))throw fault(400,'Choose an expiry date. Forms close at the end of that day in Sydney.');
 const nextDay=new Date(Date.parse(input.expiryDate+'T00:00:00Z')+86400000).toISOString().slice(0,10);
 const expiresAt=new Date(midnight(nextDay)).toISOString();
 if(typeof input.published!=='boolean')throw fault(400,'Choose whether to publish this form.');
 if(input.posterSize!==undefined&&!['small','medium','large'].includes(input.posterSize))throw fault(400,'Choose a valid poster size.');
 if(input.posterAlt!==undefined&&(typeof input.posterAlt!=='string'||input.posterAlt.length>300))throw fault(400,'Poster description must be no more than 300 characters.');
 if(input.removePoster!==undefined&&typeof input.removePoster!=='boolean')throw fault(400,'Choose whether to remove the poster.');
 if(input.removePoster&&input.posterUpload)throw fault(400,'Choose either a replacement poster or remove the current poster.');
 if(input.published&&expiresAt<=new Date().toISOString())throw fault(400,'Choose an expiry date that has not passed.');
 let fields,introduction;try{const registrationModel=await model;fields=registrationModel.cleanFields(input.fields);introduction=registrationModel.cleanIntroduction(input.description,input.descriptionRuns);}catch(error){throw fault(400,error.message);}
 const form={title:text(input.title,'the form title',160,true),...introduction,
  purpose:text(input.purpose,'why answers are collected',1000,true),expiryDate:input.expiryDate,expiresAt,
  eventId:text(input.eventId??'','the linked event',128),published:input.published,fields};
 if(form.eventId&&!/^[A-Za-z0-9_-]{1,128}$/.test(form.eventId))throw fault(400,'Choose a valid calendar event.');
 const ref=db.doc('registrationForms/'+id);
 let uploadedKey,store,cleanupRef,uploadIntent,image;
 if(input.posterUpload){image=await Poster.validateImage(input.posterUpload);store=posterStorage||Poster.storage();uploadedKey=Poster.newKey(id);}
 let saved;
 try{
 if(uploadedKey){
  uploadIntent=db.collection('_registrationPosterCleanup').doc();
  await uploadIntent.create({key:uploadedKey,formId:id,state:'upload_pending',createdAt:new Date().toISOString()});
  await store.put(uploadedKey,image);
 }
 if(reauthorize){const current=await reauthorize();if(current.viewer||current.uid!==actor.uid)throw fault(403,'Form Builder access changed. Sign in again.');}
 saved=await db.runTransaction(async tx=>{
  const current=await tx.get(ref);
  const event=form.eventId?await tx.get(db.doc('events/'+form.eventId)):null;
  const intent=uploadIntent?await tx.get(uploadIntent):null;
  if(uploadIntent&&(!intent.exists||intent.data().key!==uploadedKey||intent.data().state!=='upload_pending'))throw fault(409,'Poster upload state changed. Reopen the form before saving.');
  // Form Builder access must not expose private calendar bookings.
  if(event&&!publicEvent(event.data(),form.eventId))throw fault(400,'Choose a confirmed public calendar event.');
  if((current.exists?current.data().revision:0)!==input.revision)throw fault(409,'This form changed. Reopen it before saving.');
  const previous=current.data()?.poster,alt=input.posterAlt!==undefined?input.posterAlt.trim():previous?.alt||'',poster=input.removePoster?null:(uploadedKey?{key:uploadedKey,size:input.posterSize||'medium',alt}:previous?{key:previous.key,size:input.posterSize||previous.size||'medium',alt}:null);
  if(previous?.key&&previous.key!==poster?.key){cleanupRef=db.collection('_registrationPosterCleanup').doc();tx.create(cleanupRef,{key:previous.key,formId:id,state:'cleanup_pending',createdAt:new Date().toISOString()});}
  const record={...form,...(poster?{poster}:{}),revision:input.revision+1,createdAt:current.exists?current.data().createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),updatedBy:actor.uid};
  if(!current.exists)await bumpFormsVersionTx(tx,db);
  if(uploadIntent)tx.delete(uploadIntent);
  tx.set(ref,record);
  const publicRef=db.doc('registrationListings/'+id);
  if(record.published)tx.set(publicRef,listing(record,id));else tx.delete(publicRef);
  audit(db,tx,actor,id,record.published?'registration.published':'registration.draft_saved');
  return {form:{id,...record},oldPosterKey:previous?.key&&previous.key!==poster?.key?previous.key:null};
 });}catch(error){
  if(uploadIntent)throw fault(error.status||503,(error.status?error.message:'The form save could not be confirmed.')+' Refresh the form; poster cleanup may be pending.');
  throw error;
 }
 if(saved.oldPosterKey){
  try{store=store||posterStorage||Poster.storage();await store.remove(saved.oldPosterKey);await cleanupRef.delete();}
  catch(error){console.error('Poster cleanup remains pending:',error.name);return {form:saved.form,posterCleanupPending:true};}
 }
 return {form:saved.form};
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
  await bumpSourceVersionTx(tx,db,id);
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
async function handle(req,res,{db,getAuth,origins,posterStorage}){
 try{
  const path=req.path.replace(/^\/api\/registrations/,'').replace(/\/$/,'')||'/';
  if(req.method!=='GET'&&(!origins.has(req.get('Origin'))||!req.is('application/json')))throw fault(403,'Use the MWA website to submit this request.');
  if(path==='/'&&req.method==='GET'){
   const collection=db.collection('registrationListings');
   const {docs,next}=await page(collection,collection.where('expiresAt','>',new Date().toISOString()).orderBy('expiresAt'),req.query.after);
   return res.json({items:docs.map(doc=>listing(doc.data(),doc.id)),next});
  }
  const publicMatch=/^\/([a-f0-9-]{36})(\/submit|\/poster)?$/.exec(path);
  if(publicMatch){
   const [,id,action]=publicMatch;
   if(action==='/submit'&&req.method==='POST')return res.status(201).json(await submit(db,id,req.body,req.ip||'unknown'));
   if(action==='/poster'&&req.method==='GET'){
    const ref=db.doc('registrationForms/'+id),before=await ref.get(),form=before.data();
    if(!before.exists||!open(form)||!form.poster?.key)throw fault(404,'Poster is not available.');
    const bytes=await (posterStorage||Poster.storage()).get(form.poster.key),after=await ref.get(),current=after.data();
    if(!after.exists||!open(current)||current.poster?.key!==form.poster.key)throw fault(404,'Poster is not available.');
    res.set('Cache-Control','private, no-store');res.set('Content-Type','image/webp');return res.send(bytes);
   }
   if(!action&&req.method==='GET'){
    const snap=await db.doc('registrationForms/'+id).get(),form=snap.data();
    if(!snap.exists||!open(form))throw fault(410,'This form is closed or no longer available.');
    let event=null;if(form.eventId){const linked=await db.doc('events/'+form.eventId).get();event=publicEvent(linked.data(),form.eventId);}
    return res.json({form:{...listing(form,id),...(form.poster?{poster:{size:form.poster.size,alt:form.poster.alt||''}}:{}),purpose:form.purpose,fields:form.fields,revision:form.revision,event}});
   }
   throw fault(405,'Method not allowed.');
  }
  const actor=await adminFor(req,db,getAuth);
  if(path==='/admin/session'&&req.method==='GET')return res.json({viewer:!!actor.viewer});
  if(path==='/admin/viewers'){
   if(actor.viewer||actor.email!=='admin@muhammadiwelfare.org.au')throw fault(403,'Only Super Admin can manage event viewers.');
   if(req.method==='GET'){let q=db.collection('_responseViewers').orderBy('__name__');if(req.query.after){if(typeof req.query.after!=='string'||!/^[^\s/@]+@[^\s/@]+\.[^\s/@]+$/.test(req.query.after))throw fault(400,'Invalid page reference.');q=q.startAfter(req.query.after);}const snap=await q.limit(51).get(),docs=snap.docs.slice(0,50);return res.json({items:docs.map(d=>({email:d.id,...d.data()})),next:snap.size>50?docs.at(-1).id:null});}
   if(req.method!=='POST')throw fault(405,'Method not allowed.');
   const email=String(req.body.email||'').trim().toLowerCase();if(!/^[^\s/@]+@[^\s/@]+\.[^\s/@]+$/.test(email))throw fault(400,'Enter a valid email.');
   const ref=db.doc('_responseViewers/'+email),eventId=req.body.eventId,formIds=req.body.formIds,fields=req.body.fields;
   if(!req.body.revoke){
    if(typeof eventId!=='string'||!Array.isArray(formIds)||!formIds.length||formIds.length>30||new Set(formIds).size!==formIds.length||!Number.isFinite(Date.parse(req.body.expiresAt))||Date.parse(req.body.expiresAt)<=Date.now())throw fault(400,'Choose one event, forms and a future expiry.');
    if((await db.doc('adminAllowlist/'+email).get()).exists)throw fault(400,'Existing admins must use module permissions.');
    for(const id of formIds){if(!/^[a-f0-9-]{36}$/.test(id))throw fault(400,'Invalid form.');const form=(await db.doc('registrationForms/'+id).get()).data();if(!form||form.eventId!==eventId||!Array.isArray(fields?.[id])||fields[id].some(key=>!form.fields.some(f=>f.id===key)))throw fault(400,'Choose permitted fields from forms belonging to one event.');}
   }
   await db.runTransaction(async tx=>{const old=await tx.get(ref);if((old.data()?.revision||0)!==(req.body.revision||0))throw fault(409,'Access changed. Refresh first.');tx.set(ref,req.body.revoke?{...old.data(),revoked:true,revision:(old.data()?.revision||0)+1}:{eventId,formIds,fields,expiresAt:new Date(req.body.expiresAt).toISOString(),uid:old.data()?.uid||null,revoked:false,revision:(old.data()?.revision||0)+1});audit(db,tx,actor,email,req.body.revoke?'registration.viewer_revoked':'registration.viewer_assigned');});
   return res.json({ok:true});
  }
  if(actor.viewer){
   if(path==='/admin'&&req.method==='GET'){
    const docs=await Promise.all(actor.grant.formIds.map(id=>db.doc('registrationForms/'+id).get()));
    return res.json({items:docs.filter(d=>d.exists&&V.permitted(actor.grant,d.id,d.data())).map(d=>({id:d.id,title:d.data().title,eventId:d.data().eventId,grantRevision:actor.grant.revision,fields:V.project(actor.grant,d.id,{fields:d.data().fields}).fields})),next:null});
   }
   const permittedRoute=/^\/admin\/([a-f0-9-]{36})\/(responses|export)$/.exec(path);
   if(!permittedRoute||(permittedRoute[2]==='responses'?req.method!=='GET':req.method!=='POST'))throw fault(403,'Only assigned event responses and downloads are available.');
   if(Number(req.method==='GET'?req.query.grantRevision:req.body?.grantRevision)!==actor.grant.revision)throw fault(409,'Your access changed. Refresh the form list before viewing or downloading responses.');
   const f=(await db.doc('registrationForms/'+permittedRoute[1]).get()).data();if(!V.permitted(actor.grant,permittedRoute[1],f))throw fault(403,'This form is not assigned to you.');
  }

  const adminPoster=/^\/admin\/([a-f0-9-]{36})\/poster$/.exec(path);
  if(adminPoster&&req.method==='GET'){
   const ref=db.doc('registrationForms/'+adminPoster[1]),before=await ref.get(),form=before.data();
   if(!before.exists||!form.poster?.key)throw fault(404,'Poster is not available.');
   const bytes=await (posterStorage||Poster.storage()).get(form.poster.key),after=await ref.get();
   if(!after.exists||after.data().poster?.key!==form.poster.key)throw fault(404,'Poster is not available.');
   const current=await adminFor(req,db,getAuth);if(current.viewer||current.uid!==actor.uid)throw fault(403,'Form Builder access is required.');
   res.set('Cache-Control','private, no-store');res.set('Content-Type','image/webp');return res.send(bytes);
  }
  if(path==='/admin/events'&&req.method==='GET')return res.json({items:await eventList(db,text(req.query.date,'the event date',10,true))});
  if(path==='/admin'&&req.method==='GET'){
   const collection=db.collection('registrationForms');
   const {docs,next}=await page(collection,collection.orderBy('createdAt','desc'),req.query.after);
   return res.json({items:docs.map(doc=>({id:doc.id,...doc.data()})),next});
  }
  if(path==='/admin'&&req.method==='POST')return res.status(201).json(await save(db,randomUUID(),req.body,actor,posterStorage,()=>adminFor(req,db,getAuth)));
  const editMatch=/^\/admin\/([a-f0-9-]{36})\/responses\/([A-Za-z0-9_-]{1,128})$/.exec(path);
  if(editMatch){
   if(req.method!=='PUT')throw fault(405,'Method not allowed.');
   return res.json(await editResponse(db,editMatch[1],editMatch[2],req.body,actor));
  }
  const match=/^\/admin\/([a-f0-9-]{36})(\/responses|\/export)?$/.exec(path);
  if(!match)throw fault(404,'Registration endpoint not found.');
  const [,id,action]=match;
  if(!action&&req.method==='PUT')return res.json(await save(db,id,req.body,actor,posterStorage,()=>adminFor(req,db,getAuth)));
  if(action==='/responses'&&req.method==='GET'){
   if(!(await db.doc('registrationForms/'+id).get()).exists)throw fault(404,'Form not found.');
   const collection=db.collection('registrationForms/'+id+'/responses');
   let query=collection.orderBy('createdAt','desc');
   if(req.query.asOf!==undefined)query=query.where('createdAt','<=',exportCutoff(req.query.asOf));
   const {docs,next}=await page(collection,query,req.query.after);
   if(actor.viewer)await db.runTransaction(async tx=>audit(db,tx,actor,id,'registration.viewer_read'));
   return res.json({items:docs.map(doc=>actor.viewer?V.project(actor.grant,id,{id:doc.id,...doc.data()}):responseData(doc.id,doc.data())),next});
  }
  if(action==='/export'&&req.method==='POST'){
   const asOf=exportCutoff(req.body?.asOf),count=req.body?.count,filtered=req.body?.filtered??false;
   if(!Number.isSafeInteger(count)||count<0||count>20000)throw fault(400,'Invalid response export count.');
   if(typeof filtered!=='boolean')throw fault(400,'Invalid response export filter setting.');
   await db.runTransaction(async tx=>{
    if(!(await tx.get(db.doc('registrationForms/'+id))).exists)throw fault(404,'Form not found.');
    audit(db,tx,actor,id,'registration.export_prepared',{format:req.body?.format==='pdf'?'pdf':'xlsx',reportedCount:count,asOf,filtered});
   });
   return res.json({ok:true});
  }
  throw fault(405,'Method not allowed.');
 }catch(error){
  if(!error.status)console.error('Registration service failed',error);
  return res.status(error.status||503).json({error:error.status?error.message:'The registrations service is temporarily unavailable. Please try again.'});
 }
}
module.exports={handle,save,submit,adminFor,open};
