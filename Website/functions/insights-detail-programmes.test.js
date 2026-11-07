const test=require('node:test'),assert=require('node:assert/strict');
const API=require('./insights-detail-api');

test('detail programme and event-date filters stay within grants and revalidate calendar reviews',{skip:!process.env.FIRESTORE_EMULATOR_HOST},async()=>{
 const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');
 const app=initializeApp({projectId:'demo-detail-programmes'},'detail-programmes'),db=getFirestore(app),origin='https://refreshed.muhammadiwelfare.org.au';
 const owner={uid:'owner',email:'admin@muhammadiwelfare.org.au',email_verified:true,firebase:{sign_in_provider:'google.com'}},admin={uid:'reader',email:'reader@example.invalid',email_verified:true,firebase:{sign_in_provider:'google.com'}},form='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 async function route(actor,path,method='GET',body={}){let status=200,value;const res={status:code=>{status=code;return res;},json:data=>{value=data;return res;}};await API.handle({path:'/api/insights-detail'+path,method,query:{},body,is:()=>true,get:name=>name==='Authorization'?['Bearer','synthetic'].join(' '):origin},res,{db,getAuth:()=>({verifyIdToken:async()=>actor}),origins:new Set([origin])});return {status,value};}
 const response=(eventId,id)=>({reference:id,createdAt:'2026-02-01T00:00:00.000Z',revision:1,formTitle:'Synthetic',eventId,fields:[{id:'choice',type:'text',label:'Choice',options:[]}],answers:{choice:'Synthetic'}});
 async function prepare(filters={}){
  const start=await route(admin,'/start','POST',filters);assert.equal(start.status,201,JSON.stringify(start.value));
  const page=await route(admin,'/step','POST',start.value);assert.equal(page.status,200,JSON.stringify(page.value));assert.equal(page.value.status,'complete');assert.equal(Object.hasOwn(page.value,'ledger'),false);
  return {start:start.value,page:page.value};
 }
 try{
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-detail-programmes/databases/(default)/documents`,{method:'DELETE'});
  for(const person of [owner,admin])await db.doc('users/'+person.uid).set({role:'admin',email:person.email});
  await db.doc('adminAllowlist/'+admin.email).set({uid:admin.uid,modules:[]});
  await db.doc('registrationForms/'+form).set({title:'Synthetic'});
  await db.doc('events/public').set({title:'Public',visibility:'public',status:'confirmed',startAt:'2026-03-01T00:00:00.000Z',departmentId:'type-a',seriesId:'series-a'});
  await db.doc('events/private').set({title:'Private',visibility:'private',status:'confirmed',startAt:'2026-03-01T00:00:00.000Z',departmentId:'type-a',seriesId:'series-a'});
  await db.doc('_insightsState/programmeCategories/items/education').set({name:'Education'});
  const event=await db.doc('events/public').get();
  await db.doc('_insightsState/programmeAssignments/events/public').set({version:1,categoryIds:['education'],eventVersion:`${event.updateTime.seconds}:${event.updateTime.nanoseconds}`});
  for(const [id,eventId] of [['one','public'],['two','private'],['three',''],['four','missing']])await db.doc(`registrationForms/${form}/responses/${id}`).set(response(eventId,id));
  assert.equal((await route(owner,'/grants','POST',{email:admin.email,revision:0,revoke:false,formIds:[form],eventIds:[],expiryDate:'2099-01-15'})).status,200);
  assert.equal((await route(admin,'/programme-options')).value.categories[0].name,'Education');
  let result=await prepare({categories:['education'],bookingType:'type-a',series:'series-a',basis:'event',from:'2026-03-01',to:'2026-03-01'});
  assert.deepEqual(result.page.items.map(item=>item.reference),['one']);
  assert.equal((await route(admin,'/authorize','POST',{jobId:result.start.jobId,step:result.page.step})).status,200);
  result=await prepare({categories:['education','unknown'],bookingType:'type-a',series:'series-a'});assert.deepEqual(result.page.items.map(item=>item.reference),['one']);
  result=await prepare({categories:['education'],bookingType:'type-b'});assert.deepEqual(result.page.items,[]);
  result=await prepare({categories:['unknown']});assert.deepEqual(result.page.items.map(item=>item.reference),['three']);
  result=await prepare({basis:'event',from:'2026-03-01',to:'2026-03-01'});assert.deepEqual(result.page.items.map(item=>item.reference),['one']);
  await db.doc('events/public').update({startAt:'2026-04-01T00:00:00.000Z'});
  assert.equal((await route(admin,'/authorize','POST',{jobId:result.start.jobId,step:result.page.step})).status,409);
  result=await prepare({categories:['unknown']});assert.deepEqual(result.page.items.map(item=>item.reference),['one','three']);
  const fresh=await db.doc('events/public').get();
  await db.doc('_insightsState/programmeAssignments/events/public').set({version:2,categoryIds:['education'],eventVersion:`${fresh.updateTime.seconds}:${fresh.updateTime.nanoseconds}`});
  result=await prepare({categories:['education']});await db.doc('_insightsState/programmeCategories/items/education').update({name:'Changed'});
  assert.equal((await route(admin,'/authorize','POST',{jobId:result.start.jobId,step:result.page.step})).status,409);
  result=await prepare({categories:['education']});await db.doc('_insightsState/programmeAssignments/events/public').update({categoryIds:[]});
  assert.equal((await route(admin,'/authorize','POST',{jobId:result.start.jobId,step:result.page.step})).status,409);
  result=await prepare({categories:['unknown']});await db.doc('adminAllowlist/'+admin.email).update({modules:['events-bookings']});
  assert.equal((await route(admin,'/authorize','POST',{jobId:result.start.jobId,step:result.page.step})).status,403);
  result=await prepare({basis:'event',from:'2026-03-01',to:'2026-03-01'});assert.deepEqual(result.page.items.map(item=>item.reference),['two']);
  assert.equal((await route(admin,'/start','POST',{basis:'event'})).status,400);
  assert.equal((await route(admin,'/start','POST',{formId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'})).status,403);
  const batch=db.batch();for(let i=0;i<101;i++)batch.set(db.doc(`registrationForms/${form}/responses/batch-${String(i).padStart(3,'0')}`),response('public','batch-'+i));await batch.commit();
  const running=await route(admin,'/start','POST',{basis:'event',from:'2026-04-01',to:'2026-04-01'}),first=await route(admin,'/step','POST',running.value);assert.equal(first.value.status,'running');
  await db.doc('events/public').update({startAt:'2026-05-01T00:00:00.000Z'});
  assert.equal((await route(admin,'/step','POST',{jobId:running.value.jobId,step:first.value.step})).status,409);
  assert.equal((await route(owner,'/grants','POST',{email:admin.email,revision:1,revoke:true})).status,200);
  assert.equal((await route(admin,'/authorize','POST',{jobId:result.start.jobId,step:result.page.step})).status,403);
 }finally{await db.terminate();await deleteApp(app);}
});
