'use strict';
const Images=require('./gallery-storage');
const {FieldPath}=require('firebase-admin/firestore');
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const validId=id=>/^[a-f0-9]{64}$/.test(id||'');
const emptyFeatured=()=>({heroIds:[],categoryIds:{}});
function featuredInput(input){
 if(!input||!Number.isSafeInteger(input.revision)||input.revision<0)fail(400,'Reload featured photographs before saving.');
 const {heroIds,categoryIds}=input;
 if(!Array.isArray(heroIds)||heroIds.length>8||heroIds.some(id=>!validId(id))||new Set(heroIds).size!==heroIds.length)fail(400,'Choose up to eight distinct public hero photographs.');
 if(!categoryIds||typeof categoryIds!=='object'||Array.isArray(categoryIds)||Object.keys(categoryIds).length>20)fail(400,'Choose valid category photographs.');
 for(const [category,ids] of Object.entries(categoryIds)){
  if(!category||category.length>80||!Array.isArray(ids)||ids.length>6||ids.some(id=>!validId(id))||new Set(ids).size!==ids.length)fail(400,'Choose up to six distinct photographs per category.');
 }
 return {revision:input.revision,heroIds,categoryIds};
}
function metadata(input){
 const result={};for(const [key,max] of Object.entries({title:160,caption:1000,event:160,category:80,tags:400})){
  if(typeof input[key]!=='string'||input[key].length>max)fail(400,'Check photograph '+key+'.');result[key]=input[key].trim();
 }
 if(!result.title)fail(400,'Enter a photograph title.');
 if(!['public','hidden'].includes(input.visibility))fail(400,'Choose a valid visibility.');result.visibility=input.visibility;
 if(input.date!==null&&input.date!==''){
  const parsed=typeof input.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(input.date)?new Date(input.date+'T12:00:00Z'):null;
  if(!parsed||!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==input.date)fail(400,'Choose a valid date.');
 }
 result.date=input.date||null;return result;
}
const projection=(id,p)=>({id,title:p.title,caption:p.caption,event:p.event,category:p.category,tags:p.tags,date:p.date,width:p.width,height:p.height,thumb:'/api/gallery/image/'+id+'/thumb',src:'/api/gallery/image/'+id+'/preview'});
async function handle(req,res,{db,editorFor,origins,storeFactory=Images.storage}){
 const path=req.path.replace(/\/$/,''),image=/^\/api\/gallery\/image\/([a-f0-9]{64})\/(thumb|preview|original)$/.exec(path);
 if(image&&req.method==='GET'){
  const [,id,variant]=image,snap=await db.doc('galleryPhotos/'+id).get(),p=snap.data();if(!p||p.state!=='ready')fail(404,'Photograph not found.');
  if((variant==='original'||p.visibility!=='public')&&!await editorFor(req,'gallery'))fail(404,'Photograph not found.');
  const bytes=await storeFactory().get(id,variant);res.set('Cache-Control','private, no-store').set('Content-Type',variant==='original'?p.type:'image/webp');
  if(variant==='original')res.set('Content-Disposition',`attachment; filename="mwa-${id.slice(0,12)}.${p.type.split('/')[1]}"`);return res.send(bytes);
 }
 const admin=path.startsWith('/api/gallery/admin'),actor=admin?await editorFor(req,'gallery'):null;
 if(admin&&!actor)fail(403,'Gallery access is required.');
 if(req.method==='GET'&&(path==='/api/gallery/featured'||path==='/api/gallery/admin/featured')){
  const snap=await db.doc('gallerySettings/main').get(),stored=snap.data()||emptyFeatured();
  const heroIds=Array.isArray(stored.heroIds)?stored.heroIds:[],categoryIds=stored.categoryIds&&typeof stored.categoryIds==='object'?stored.categoryIds:{};
  if(admin)return res.json({heroIds,categoryIds,revision:stored.revision||0});
  const ids=[...new Set([...heroIds,...Object.values(categoryIds).flat()])].filter(validId),records=await Promise.all(ids.map(async id=>[id,(await db.doc('galleryPhotos/'+id).get()).data()])),publicById=new Map(records.filter(([,photo])=>photo?.state==='ready'&&photo.visibility==='public'));
  return res.json({heroIds:heroIds.filter(id=>publicById.has(id)),categoryIds:Object.fromEntries(Object.entries(categoryIds).map(([category,chosen])=>[category,chosen.filter(id=>publicById.get(id)?.category===category)]))});
 }
 if(req.method==='GET'&&(path==='/api/gallery'||path==='/api/gallery/admin')){
  const after=req.query.after||'';if(after&&!validId(after))fail(400,'Invalid page cursor.');
  let query=db.collection('galleryPhotos').orderBy(FieldPath.documentId()).limit(101);if(after)query=query.startAfter(after);
  const snap=await query.get(),ready=snap.docs.filter(d=>d.data().state==='ready'&&(admin||d.data().visibility==='public'));
  return res.json({items:ready.map(d=>({...projection(d.id,d.data()),...(admin?{visibility:d.data().visibility,revision:d.data().revision}:{})})),next:snap.docs.length>100?snap.docs[99].id:null});
 }
 if(!admin)fail(404,'Gallery route not found.');if(!origins.has(req.get('Origin')))fail(403,'Request origin is not allowed.');
 if(!req.is('application/json'))fail(415,'Use a JSON gallery request.');
 const audit=(tx,id,action,entityType='gallery-photo')=>tx.set(db.collection('auditLog').doc(),{module:'gallery',entityType,entityId:id,action,userId:actor.uid,userEmail:actor.email,timestamp:new Date().toISOString()});
 if(path==='/api/gallery/admin/featured'&&req.method==='PUT'){
  const values=featuredInput(req.body),ids=[...new Set([...values.heroIds,...Object.values(values.categoryIds).flat()])];
  const records=await Promise.all(ids.map(async id=>[id,(await db.doc('galleryPhotos/'+id).get()).data()]));
  const byId=new Map(records);
  if(records.some(([,photo])=>!photo||photo.state!=='ready'||photo.visibility!=='public'))fail(400,'Featured photographs must be public and available.');
  for(const [category,chosen] of Object.entries(values.categoryIds))if(chosen.some(id=>byId.get(id)?.category!==category))fail(400,'Category thumbnails must belong to their category.');
  const ref=db.doc('gallerySettings/main');
  await db.runTransaction(async tx=>{const snap=await tx.get(ref),current=snap.data()||{};if((current.revision||0)!==values.revision)fail(409,'Featured photographs changed. Refresh and try again.');tx.set(ref,{heroIds:values.heroIds,categoryIds:values.categoryIds,revision:values.revision+1,updatedAt:new Date().toISOString(),updatedBy:actor.uid});audit(tx,'featured','gallery.featured.updated','gallery-settings')});
  return res.json({ok:true,revision:values.revision+1});
 }
 if(path==='/api/gallery/admin/upload'&&req.method==='POST'){
  const values=metadata(req.body||{}),image=req.body.image;if(!image||typeof image.data!=='string'||image.data.length>Math.ceil(Images.MAX_BYTES/3)*4+4||!/^[A-Za-z0-9+/]*={0,2}$/.test(image.data))fail(400,'Choose a JPEG, PNG or WebP up to 5 MB.');
  const bytes=Buffer.from(image.data,'base64');if(bytes.toString('base64')!==image.data)fail(400,'Invalid image encoding.');
  const day=new Date().toISOString().slice(0,10),limit=db.doc('_galleryUploadLimits/'+actor.uid);await db.runTransaction(async tx=>{const p=(await tx.get(limit)).data()||{},count=p.day===day?p.count||0:0;if(count>=300)fail(429,'Daily gallery upload limit reached.');tx.set(limit,{day,count:count+1});});
  const prepared=await Images.prepare(bytes,image.type),ref=db.doc('galleryPhotos/'+prepared.id),existing=await ref.get();if(existing.exists&&existing.data().state==='ready')return res.json({id:prepared.id,duplicate:true});
  const store=storeFactory();await store.put(prepared.id,'original',prepared.original,prepared.type);await store.put(prepared.id,'preview',prepared.preview);await store.put(prepared.id,'thumb',prepared.thumb);
  await db.runTransaction(async tx=>{const current=await tx.get(ref);if(current.exists&&current.data().state==='ready')return;tx.set(ref,{...values,type:prepared.type,width:prepared.width,height:prepared.height,state:'ready',revision:1,createdAt:new Date().toISOString(),updatedBy:actor.uid});audit(tx,prepared.id,'gallery.uploaded');});
  return res.status(201).json({id:prepared.id});
 }
 const match=/^\/api\/gallery\/admin\/([a-f0-9]{64})$/.exec(path);if(match&&req.method==='PATCH'){
  const id=match[1],ref=db.doc('galleryPhotos/'+id),deleting=req.body.action==='delete',values=deleting?null:metadata(req.body);
  if(!Number.isSafeInteger(req.body.revision))fail(400,'Reload the photograph before editing.');
  await db.runTransaction(async tx=>{const p=(await tx.get(ref)).data();if(!p||p.state!=='ready')fail(404,'Photograph not found.');if(p.revision!==req.body.revision)fail(409,'Photograph changed. Refresh and try again.');tx.update(ref,{...(deleting?{state:'deleted',visibility:'hidden'}:values),revision:p.revision+1,updatedAt:new Date().toISOString(),updatedBy:actor.uid});audit(tx,id,deleting?'gallery.deleted':'gallery.updated');});
  let cleanupPending=false;if(deleting){const store=storeFactory(),results=await Promise.allSettled(['original','preview','thumb'].map(v=>store.remove(id,v)));cleanupPending=results.some(r=>r.status==='rejected');await ref.update({cleanupPending});}return res.json({ok:true,cleanupPending});
 }
 fail(405,'Gallery method not allowed.');
}
module.exports={handle,metadata,projection,validId,featuredInput};
