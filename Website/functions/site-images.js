const {randomUUID}=require('node:crypto');
const Poster=require('./registration-poster');
const model=require('./content-model.json');
function validPhoto(value){if(typeof value!=='string'||/[\r\n\\]/.test(value))return false;if(value==='')return true;if(/^\/(?:images|assets)\/[a-zA-Z0-9_./-]+$/.test(value)&&!value.includes('..'))return true;if(/^\/api\/site-images\/[a-f0-9-]{36}$/.test(value))return true;try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}}
async function handle(req,res,{db,editorFor,origins,storage,validateImage=Poster.validateImage}){
 const path=req.path.replace(/\/$/,'');
 const match=/^\/api\/site-images\/([a-f0-9-]{36})$/.exec(path);
 if(match&&req.method==='GET'){
  const snap=await db.doc('websiteImages/'+match[1]).get();if(!snap.exists||snap.data().state!=='ready')return res.status(404).json({error:'Image not found.'});
  const bytes=await (storage||Poster.storage()).get('website-images/'+match[1]+'.webp');
  return res.set('Content-Type','image/webp').set('Cache-Control','public, max-age=86400, immutable').send(bytes);
 }
 if(path!=='/api/site-images'||req.method!=='POST')return res.status(405).json({error:'Method not allowed.'});
 if(!origins.has(req.get('Origin')))return res.status(403).json({error:'Request origin is not allowed.'});
 const actor=await editorFor(req);if(!actor)return res.status(401).json({error:'Sign in with website CMS access to upload photographs.'});
 if(!req.is('application/json'))return res.status(415).json({error:'Use a JSON image upload.'});
 const {slot,image}=req.body||{};if(!model.fields.some(f=>f.kind==='image'&&f.key===slot))return res.status(400).json({error:'Choose a website photograph field.'});
 let bytes;try{bytes=await validateImage(image);}catch(e){return res.status(e.status||400).json({error:(e.message||'Choose a valid photograph.').replace(/poster/g,'photograph')});}
 const day=new Date().toISOString().slice(0,10),limit=db.doc('_websiteImageUploadLimits/'+actor.uid);
 await db.runTransaction(async tx=>{const snap=await tx.get(limit),record=snap.exists?snap.data():{};const count=record.day===day?record.count||0:0;if(count>=50)throw Object.assign(Error('Daily website image upload limit reached.'),{status:429});tx.set(limit,{day,count:count+1});});
 const id=randomUUID(),ref=db.doc('websiteImages/'+id),key='website-images/'+id+'.webp',store=storage||Poster.storage();
 await ref.set({state:'uploading',slot,createdAt:new Date().toISOString(),createdBy:actor.uid});
 try{await store.put(key,bytes);await ref.update({state:'ready',bytes:bytes.length});}catch(e){throw Object.assign(Error('Photograph upload could not be confirmed. Retry or contact the administrator.'),{status:503});}
 await db.collection('auditLog').add({module:'website-cms',entityType:'website-image',entityId:id,action:'website.image_uploaded',userId:actor.uid,userEmail:actor.email||'',timestamp:new Date().toISOString(),note:'Uploaded public website photograph for '+slot});
 return res.status(201).json({url:'/api/site-images/'+id,bytes:bytes.length});
}
module.exports={handle,validPhoto};
