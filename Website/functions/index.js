const {resolveAdmin}=require('./moduleAccess');
const {initializeApp}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
const {getAuth}=require('firebase-admin/auth');
const {onRequest}=require('firebase-functions/v2/https');
const {validateContent}=require('./validateContent');
const model=require('./content-model.json');
const {sessionAllowed}=require('./adminAccess');
const {sources,selectedPosts,setVisibility,cleanVisibility}=require('./socialModeration');
initializeApp();const db=getFirestore();
const origins=new Set(['https://refreshed.muhammadiwelfare.org.au','https://mwa-community-web.web.app','https://mwa-community-web.firebaseapp.com','http://127.0.0.1:5174','http://localhost:5174']);
async function editorFor(req,moduleId='website-cms'){try{const match=/^Bearer (.+)$/.exec(req.get('Authorization')||'');if(!match)return null;const token=await getAuth().verifyIdToken(match[1],true);return await resolveAdmin(db,token.uid,token,moduleId)}catch{return null}}

exports.websiteCmsApi=onRequest({region:'australia-southeast1',maxInstances:3},async(req,res)=>{
 res.set('Cache-Control','no-store');res.set('X-Content-Type-Options','nosniff');
 const origin=req.get('Origin');if(origin&&origins.has(origin)){res.set('Access-Control-Allow-Origin',origin);res.set('Vary','Origin');res.set('Access-Control-Allow-Headers','Authorization, Content-Type');res.set('Access-Control-Allow-Methods','GET, PUT, POST, PATCH, OPTIONS')}
 if(req.method==='OPTIONS')return res.status(origin&&origins.has(origin)?204:403).end();
 try{
  if(/^\/api\/enquiries(?:\/|$)/.test(req.path))return require('./enquiries-api').handle(req,res,{db,getAuth,origins});
  const socialRoute=req.path.replace(/\/$/,'').endsWith('/social-moderation');
  if(socialRoute){
   const actor=await editorFor(req,'tools-automation');if(!actor)return res.status(401).json({error:'Sign in with an approved MWA admin account.'});
   if(req.method==='GET'){const [content,moderation]=await Promise.all([db.doc('websiteContent/main').get(),db.doc('calendarSettings/socialModeration').get()]);const hidden=moderation.exists?moderation.data().hiddenPostIds||[]:[];const posts=selectedPosts(content.exists?content.data().document?.content:model.defaults.content).map(post=>({...post,hidden:hidden.includes(post.id)}));return res.json({sources,posts});}
   if(req.method!=='PUT')return res.status(405).json({error:'Method not allowed.'});
   if(!origin||!origins.has(origin))return res.status(403).json({error:'Request origin is not allowed.'});
   if(!req.is('application/json'))return res.status(415).json({error:'Use a JSON visibility setting.'});
   try{cleanVisibility(req.body)}catch{return res.status(400).json({error:'Choose a valid post and visibility.'})}
   await setVisibility(db,actor,req.body);return res.json({ok:true});
  }
  const ref=db.doc('websiteContent/main');
  if(req.method==='GET'){const snapshot=await ref.get();const record=snapshot.exists?snapshot.data():null;const stored=record?.document||model.defaults;const document={...model.defaults,...stored,content:{...model.defaults.content,...stored.content}};return res.json({document,revision:record?.revision||0,updatedAt:record?.updatedAt||null,canEdit:!!await editorFor(req)})}
  if(req.method!=='PUT')return res.status(405).json({error:'Method not allowed.'});
  if(!origin||!origins.has(origin))return res.status(403).json({error:'Request origin is not allowed.'});
  const editor=await editorFor(req);if(!editor)return res.status(401).json({error:'Sign in with an approved MWA admin account.'});
  if(!req.is('application/json'))return res.status(415).json({error:'Use a JSON content document.'});
  const input=req.body;if(!input||!Number.isSafeInteger(input.revision)||input.revision<0)return res.status(400).json({error:'A valid content revision is required.'});
  const document=validateContent(input.document);if(!document)return res.status(400).json({error:'Check the content fields, logo and colour settings.'});
  const timestamp=new Date().toISOString();let revision;
  try{revision=await db.runTransaction(async transaction=>{const current=await transaction.get(ref);const existing=current.exists?current.data().revision:0;if(existing!==input.revision)throw Object.assign(new Error('revision-conflict'),{conflict:true});const next=existing+1;transaction.set(ref,{document,revision:next,updatedAt:timestamp,updatedBy:editor.uid});transaction.set(db.doc('calendarSettings/websiteAppearance'),{palette:document.palette,mode:document.mode,customPrimary:document.customPrimary,useCustomPrimary:document.useCustomPrimary,logo:document.logo,websiteUrl:'https://mwa-community-web.web.app',revision:next,updatedAt:timestamp});
const previous=current.exists?current.data().document:model.defaults;
const changes={};for(const key of ['palette','mode','customPrimary','useCustomPrimary'])if(previous?.[key]!==document[key])changes[key]={before:previous?.[key]??null,after:document[key]};
if(previous?.logo!==document.logo)changes.logo={before:'Previous logo',after:'Updated logo'};
for(const [key,value]of Object.entries(document.content))if(previous?.content?.[key]!==value)changes['content.'+key]={before:previous?.content?.[key]??null,after:value};
transaction.set(db.collection('auditLog').doc(),{module:'website-cms',entityType:'website',entityId:'main',action:'website.published',userId:editor.uid,userEmail:(editor.email||'').toLowerCase(),timestamp,note:'Published website revision '+next,diff:changes});return next})}catch(error){if(error.conflict)return res.status(409).json({error:'Newer content has been published. Export your draft and reload before publishing.'});throw error}
  return res.json({revision,updatedAt:timestamp});
 }catch{return res.status(503).json({error:'The website content store is unavailable. Your changes have not been published.'})}
});

exports.enquiriesMailWorker=require('firebase-functions/v2/scheduler').onSchedule({schedule:'every 2 minutes',region:'australia-southeast1',timeoutSeconds:240,maxInstances:1},()=>require('./enquiries-gmail').run(db));

exports.stripeSandboxWebhook=require('./stripe-sandbox').stripeSandboxWebhook;
