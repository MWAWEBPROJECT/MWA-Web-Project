const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const A=require('./registrations-api');
const site='https://refreshed.muhammadiwelfare.org.au';
test('expiry is exclusive at the next Sydney midnight and unpublished forms are never open',()=>{
 const expiresAt='2027-04-04T14:00:00.000Z';
 assert.equal(A.open({published:true,expiresAt},Date.parse(expiresAt)-1),true);
 assert.equal(A.open({published:true,expiresAt},Date.parse(expiresAt)),false);
 assert.equal(A.open({published:false,expiresAt},0),false);
});
test('Form Builder API persistence, permission isolation, expiry, idempotency and paging',{skip:!process.env.FIRESTORE_EMULATOR_HOST},async t=>{
 const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');
 const app=initializeApp({projectId:'demo-mwa-registrations'},'registration-tests'),db=getFirestore(app);
 const actor={uid:'forms-admin',email:'forms@example.com'},token={...actor,email_verified:true,firebase:{sign_in_provider:'google.com'}};
 const getAuth=()=>({verifyIdToken:async()=>token});
 const origins=new Set([site]);
 const input={revision:0,title:'Community workshop',description:'Join us',purpose:'Arrange the workshop.',expiryDate:'2027-04-04',eventId:'',published:false,fields:[{id:'name',type:'text',label:'Full name',required:true,description:''}]};
 async function route(path='',method='GET',body,authorized=false,origin=site){
  const [pathname,search]=path.split('?');let status=200,value;
  await A.handle({path:'/api/registrations'+pathname,method,body,ip:'route-test',query:Object.fromEntries(new URLSearchParams(search)),get:key=>key==='Origin'?origin:key==='Authorization'&&authorized?'Bearer fixture-token':'',is:()=>true},
   {status:code=>{status=code;return {json:data=>{value=data;}}},json:data=>{value=data;}},{db,getAuth,origins});
  return {status,value};
 }
 try{
  await db.doc('users/'+actor.uid).set({role:'admin'});
  const team=db.doc('adminAllowlist/'+actor.email);await team.set({modules:['form-builder']});
  await t.test('module access is independent of CMS and legacy access; expired and revoked sessions fail',async()=>{
   assert.equal((await route('/admin')).status,401);
   for(const entry of [{modules:['website-cms']},{},{modules:[]},{modules:['form-builder'],accessExpiresAt:new Date(0)}]){
    await team.set(entry);assert.equal((await route('/admin','GET',null,true)).status,403);
   }
   await team.set({modules:['form-builder']});assert.equal((await route('/admin','GET',null,true)).status,200);
  });
  const id=randomUUID();
  await t.test('required expiry, DST conversion and draft/public separation',async()=>{
   for(const patch of [{expiryDate:''},{expiryDate:'2027-02-30'},{expiryDate:'2020-01-01',published:true}]){
    await assert.rejects(A.save(db,id,{...input,...patch},actor),error=>error.status===400);
   }
   const draft=await A.save(db,id,input,actor);assert.equal(draft.form.expiresAt,'2027-04-04T14:00:00.000Z');
   assert.equal((await db.doc('registrationListings/'+id).get()).exists,false);
   assert.equal((await route('/'+id)).status,410);
   await A.save(db,id,{...draft.form,published:true},actor);
   const publicForm=await route('/'+id);assert.equal(publicForm.status,200);assert.equal(publicForm.value.form.updatedBy,undefined);
   assert.equal(publicForm.value.form.published,undefined);
   assert.equal((await route()).value.items.some(row=>row.id===id),true);
   await assert.rejects(A.save(db,id,{...input,published:true},actor),error=>error.status===409);
   const summer=await A.save(db,randomUUID(),{...input,expiryDate:'2027-01-15'},actor);assert.equal(summer.form.expiresAt,'2027-01-15T13:00:00.000Z');
  });
  await t.test('anonymous submission validates answers, preserves snapshots and deduplicates concurrent retries',async()=>{
   const response={revision:2,requestId:randomUUID(),answers:{name:'Synthetic Visitor'}};
   const results=await Promise.all([A.submit(db,id,response,'test'),A.submit(db,id,response,'test')]);
   assert.equal(results[0].reference,results[1].reference);
   const rows=await db.collection('registrationForms/'+id+'/responses').get();assert.equal(rows.size,1);
   await assert.rejects(A.submit(db,id,{...response,answers:{name:'Other'}},'test'),error=>error.status===409);
   for(const patch of [{revision:1},{answers:{name:''}},{answers:{name:'Visitor',unknown:'value'}},{website:'bot'}]){
    await assert.rejects(A.submit(db,id,{...response,requestId:randomUUID(),...patch},'test'),error=>[400,409].includes(error.status));
   }
   const current=(await db.doc('registrationForms/'+id).get()).data();
   await A.save(db,id,{...current,fields:[{...input.fields[0],label:'Changed name question'}]},actor);
   assert.equal(rows.docs[0].data().fields[0].label,'Full name');
   const fresh={...response,revision:3,requestId:randomUUID()};
   for(let i=0;i<10;i++)await A.submit(db,id,{...fresh,requestId:randomUUID()},'rate-ip');
   await assert.rejects(A.submit(db,id,{...fresh,requestId:randomUUID()},'rate-ip'),error=>error.status===429);
   assert.equal((await route('/admin/'+id+'/responses')).status,401);
   const adminResponses=await route('/admin/'+id+'/responses','GET',null,true);
   assert.equal(adminResponses.status,200);assert.equal(adminResponses.value.items.length,11);assert.equal(adminResponses.value.items[0].digest,undefined);
   assert.equal((await route('/'+id+'/submit','POST',fresh,false,'https://other.example')).status,403);
   await A.save(db,id,{...current,revision:3,published:false},actor);
   assert.equal((await route('/'+id)).status,410);
   await assert.rejects(A.submit(db,id,{...fresh,requestId:randomUUID()},'test'),error=>error.status===410);
   assert.equal((await route()).value.items.some(row=>row.id===id),false);
   assert.equal((await A.submit(db,id,response,'test')).reference,results[0].reference);
  });
  await t.test('linked events are rechecked and private fields never leave the server',async()=>{
   const eventId='linked-'+randomUUID(),event=db.doc('events/'+eventId),formId=randomUUID();
   await event.set({title:'Public gathering',startAt:'2027-02-01T22:00:00.000Z',status:'confirmed',visibility:'private',contactEmail:'private@example.com'});
   await assert.rejects(A.save(db,formId,{...input,published:true,eventId},actor),error=>error.status===400);
   await event.update({visibility:'public'});
   await A.save(db,formId,{...input,published:true,eventId},actor);
   let form=(await route('/'+formId)).value.form;assert.equal(form.event.title,'Public gathering');assert.equal(form.event.contactEmail,undefined);
   const options=await route('/admin/events?date=2027-02-02','GET',null,true);assert.equal(options.status,200);assert.equal(options.value.items.some(row=>row.id===eventId),true);
   await event.update({status:'cancelled'});form=(await route('/'+formId)).value.form;assert.equal(form.event,null);
  });
  await t.test('public, admin and response pagination use document cursors without truncation',async()=>{
   const batch=db.batch(),ids=[];
   for(let i=0;i<55;i++){
    const formId=randomUUID();ids.push(formId);
    const record={...input,revision:1,published:true,expiresAt:'2028-01-01T13:00:00.000Z',createdAt:'2026-11-03T00:00:00.000Z'};
    batch.set(db.doc('registrationForms/'+formId),record);
    batch.set(db.doc('registrationListings/'+formId),{id:formId,title:record.title,description:record.description,expiryDate:record.expiryDate,expiresAt:record.expiresAt});
    batch.set(db.doc('registrationForms/'+id+'/responses/'+('a'+i.toString().padStart(63,'0'))),{reference:'Synthetic '+i,answers:{name:'Paging'},fields:input.fields,createdAt:'2026-11-03T00:00:00.000Z'});
   }
   await batch.commit();
   for(const [path,admin] of [['',false],['/admin',true],['/admin/'+id+'/responses',true]]){
    const first=await route(path,'GET',null,admin);assert.equal(first.status,200);assert.equal(first.value.items.length,50);assert.ok(first.value.next);
    const second=await route(path+'?after='+first.value.next,'GET',null,admin);assert.equal(second.status,200);assert.ok(second.value.items.length>=5);assert.equal(second.value.next,null);
    assert.equal(new Set([...first.value.items,...second.value.items].map(row=>row.id)).size,first.value.items.length+second.value.items.length);
   }
  });
 }finally{await deleteApp(app);}
});
