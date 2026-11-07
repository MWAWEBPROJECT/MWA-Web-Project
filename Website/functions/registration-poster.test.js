const test=require('node:test'),assert=require('node:assert/strict');
const sharp=require('sharp');
const Poster=require('./registration-poster');

test('poster storage requires explicitly configured R2 settings',()=>{
 assert.throws(()=>Poster.configuration({}),error=>error.status===503&&/not configured/.test(error.message));
 assert.throws(()=>Poster.configuration({MWA_R2_ACCOUNT_ID:'bad',MWA_R2_POSTER_BUCKET:'poster-bucket',MWA_R2_ACCESS_KEY_ID:'fixture',MWA_R2_SECRET_ACCESS_KEY:'fixture'}),error=>error.status===503);
});

test('poster validates and re-encodes raster bytes with bounded dimensions',async()=>{
 const png=await sharp({create:{width:24,height:40,channels:3,background:'red'}}).png().toBuffer();
 const output=await Poster.validateImage({type:'image/png',data:png.toString('base64')});
 const info=await sharp(output).metadata();
 assert.equal(info.format,'webp');assert.equal(info.width,24);assert.equal(info.height,40);
 await assert.rejects(Poster.validateImage({type:'image/jpeg',data:png.toString('base64')}),error=>error.status===400);
 await assert.rejects(Poster.validateImage({type:'image/png',data:Buffer.from('<svg></svg>').toString('base64')}),error=>error.status===400);
 await assert.rejects(Poster.validateImage({type:'image/png',data:'AA=A'}),error=>error.status===400);
 const tooWide=await sharp({create:{width:4097,height:1,channels:3,background:'red'}}).png().toBuffer();
 await assert.rejects(Poster.validateImage({type:'image/png',data:tooWide.toString('base64')}),error=>error.status===400);
});

test('form poster saves and delivery respect publication, authorization, replacement and revision',{skip:!process.env.FIRESTORE_EMULATOR_HOST},async()=>{
 const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore'),{randomUUID}=require('node:crypto'),api=require('./registrations-api');
 const app=initializeApp({projectId:'demo-poster-validation'},'posters'),db=getFirestore(app),id=randomUUID(),uid='poster-admin',email='poster@example.invalid';
 const actor={uid,email},token={uid,email,email_verified:true,firebase:{sign_in_provider:'google.com'}},objects=new Map(),origins=new Set(['http://localhost:5174']);
 const store={put:async(key,bytes)=>{objects.set(key,bytes);},get:async key=>objects.get(key),remove:async key=>objects.delete(key)};
 const png=await sharp({create:{width:24,height:40,channels:3,background:'red'}}).png().toBuffer(),posterUpload={type:'image/png',data:png.toString('base64')};
 const base={revision:0,title:'Poster test',description:'Introduction',purpose:'Test',expiryDate:'2099-01-01',eventId:'',published:false,fields:[{id:'name',type:'text',label:'Name',required:true,description:''}]};
 async function route(path,authorized=false,storage=store){
  let code=200,value,headers={};
  const res={status(n){code=n;return this;},json(data){value=data;return this;},set(k,v){headers[k]=v;return this;},send(data){value=data;return this;}};
  await api.handle({path:'/api/registrations'+path,method:'GET',query:{},get:key=>key==='Authorization'&&authorized?'Bearer fixture':'',is:()=>true},res,{db,getAuth:()=>({verifyIdToken:async()=>token}),origins,posterStorage:storage});
  return {code,value,headers};
 }
 try{
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-poster-validation/databases/(default)/documents`,{method:'DELETE'});
  await db.doc('users/'+uid).set({role:'admin',email});await db.doc('adminAllowlist/'+email).set({uid,modules:['form-builder']});
  let result=await api.save(db,id,{...base,posterUpload},actor,store),key=result.form.poster.key;
  assert.equal(result.form.poster.size,'medium');assert.ok(objects.has(key));
  assert.equal((await route('/'+id+'/poster')).code,404);
  assert.equal((await route('/admin/'+id+'/poster')).code,401);
  assert.equal((await route('/admin/'+id+'/poster',true)).value.equals(objects.get(key)),true);
  result=await api.save(db,id,{...result.form,published:true,posterSize:'large'},actor,store);
  const form=(await route('/'+id)).value.form;assert.deepEqual(form.poster,{size:'large',alt:''});assert.equal(JSON.stringify(form).includes(key),false);
  const served=await route('/'+id+'/poster');assert.equal(served.code,200);assert.equal(served.headers['Cache-Control'],'private, no-store');assert.equal(served.value.equals(objects.get(key)),true);
  const changing={...store,get:async k=>{await db.doc('registrationForms/'+id).update({published:false});return store.get(k);}};
  assert.equal((await route('/'+id+'/poster',false,changing)).code,404);
  await db.doc('registrationForms/'+id).update({published:true});
  const revoked={...store,get:async k=>{await db.doc('adminAllowlist/'+email).update({modules:[]});return store.get(k);}};
  assert.equal((await route('/admin/'+id+'/poster',true,revoked)).code,403);
  await db.doc('adminAllowlist/'+email).update({modules:['form-builder']});
  await assert.rejects(api.save(db,id,{...base,posterUpload},actor,store),error=>error.status===409&&/cleanup may be pending/.test(error.message));assert.equal(objects.size,2);
  let pending=await db.collection('_registrationPosterCleanup').get();assert.equal(pending.size,1);assert.equal(pending.docs[0].data().state,'upload_pending');assert.notEqual(pending.docs[0].data().key,key);
  const interrupted={...store,put:async(k,bytes)=>{const intents=await db.collection('_registrationPosterCleanup').where('key','==',k).get();assert.equal(intents.size,1);assert.equal(intents.docs[0].data().state,'upload_pending');objects.set(k,bytes);throw Error('Synthetic interrupted upload');}};
  await assert.rejects(api.save(db,id,{...result.form,posterUpload},actor,interrupted),error=>error.status===503&&/cleanup may be pending/.test(error.message));
  pending=await db.collection('_registrationPosterCleanup').get();assert.equal(pending.size,2);assert.equal((await db.doc('registrationForms/'+id).get()).data().poster.key,key);
  result=await api.save(db,id,{...result.form,posterUpload},actor,store);assert.notEqual(result.form.poster.key,key);assert.equal(objects.has(key),false);
  const failingCleanup={...store,remove:async()=>{throw Error('Synthetic cleanup failure');}};
  result=await api.save(db,id,{...result.form,removePoster:true},actor,failingCleanup);assert.equal(result.posterCleanupPending,true);assert.equal(result.form.poster,undefined);assert.equal((await route('/'+id+'/poster')).code,404);
  pending=await db.collection('_registrationPosterCleanup').get();assert.equal(pending.size,3);assert.ok(pending.docs.some(doc=>doc.data().state==='cleanup_pending'&&doc.data().formId===id));
  let release,started;
  const entered=new Promise(resolve=>{started=resolve;}),waiting=new Promise(resolve=>{release=resolve;});
  const delayed={...store,put:async(k,bytes)=>{started(k);await waiting;objects.set(k,bytes);}};
  const save=api.save(db,id,{...result.form,posterUpload},actor,delayed);
  const delayedKey=await entered,delayedIntents=await db.collection('_registrationPosterCleanup').where('key','==',delayedKey).get();
  assert.equal(delayedIntents.size,1);
  await delayedIntents.docs[0].ref.update({state:'cleanup_pending'});release();
  await assert.rejects(save,error=>error.status===409&&/cleanup may be pending/.test(error.message));
  assert.ok(objects.has(delayedKey));assert.equal((await db.doc('registrationForms/'+id).get()).data().poster,undefined);
  assert.equal((await delayedIntents.docs[0].ref.get()).data().state,'cleanup_pending');
  await assert.rejects(api.save(db,randomUUID(),{...base,posterUpload},actor),error=>error.status===503&&/not configured/.test(error.message));
 }finally{await deleteApp(app);}
});
