const test=require('node:test'),assert=require('node:assert/strict');
const P=require('./insights-programmes'),I=require('./form-insights');

test('programme dimension filters do not infer categories from booking type or series',()=>{
 const values={categories:[],bookingType:'programs',series:'series-one'};
 assert.equal(P.matches(values,P.filters({categories:['unknown']})),true);
 assert.equal(P.matches(values,P.filters({categories:['programs']})),false);
 assert.equal(P.matches(values,P.filters({bookingType:'programs',series:'series-one'})),true);
 assert.equal(P.matches({...values,categories:['education']},P.filters({categories:['unknown']})),false);
 assert.equal(P.matches({...values,categories:['education']},P.filters({categories:['other','education'],bookingType:'programs'})),true);
 assert.throws(()=>P.filters({categories:['unsafe/path']}),{status:400});
 assert.deepEqual(P.eventDimensions({data:()=>({departmentId:'programs',seriesId:'series-one'})}),values);
 assert.deepEqual(P.eventDimensions({data:()=>({departmentId:'invalid/path',seriesId:null})}),{categories:[],bookingType:'',series:''});
});

test('programme review uses private records, rechecks event versions and requires Super Admin',{skip:!process.env.FIRESTORE_EMULATOR_HOST},async()=>{
 const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');
 const app=initializeApp({projectId:'demo-mwa-programmes'},'programme-test'),db=getFirestore(app),origin='https://example.invalid';
 const token={uid:'owner',email:'admin@muhammadiwelfare.org.au',email_verified:true,firebase:{sign_in_provider:'google.com'}};
 async function route(method,query={},body={}){
  let status=200,value;const res={status:code=>{status=code;return res},json:data=>{value=data;return res}};
  await I.handle({path:'/api/form-insights/programmes',method,query,body,is:()=>true,get:name=>name==='Authorization'?['Bearer','synthetic'].join(' '):origin},res,{db,getAuth:()=>({verifyIdToken:async()=>token}),origins:new Set([origin])});
  return {status,value};
 }
 try{
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-mwa-programmes/databases/(default)/documents`,{method:'DELETE'});
  const event=db.doc('events/synthetic');await db.doc('users/owner').set({role:'admin',email:token.email});await event.set({title:'Synthetic event',departmentId:'booking-type',seriesId:'series',status:'confirmed',visibility:'public'});
  const category=await route('POST',{}, {action:'create',name:'Education'});
  assert.equal(category.status,201);assert.equal((await route('POST',{}, {action:'create',name:'education'})).status,409);
  const before=await route('GET',{eventId:'synthetic'});assert.equal(before.value.assignment.version,0);
  const params={action:'review',eventId:'synthetic',eventVersion:before.value.event.version,version:0,categoryIds:[category.value.id]};
  assert.equal((await route('POST',{},params)).status,200);assert.equal((await route('POST',{},params)).status,409);
  const saved=await route('GET',{eventId:'synthetic'});assert.deepEqual(saved.value.assignment.categoryIds,[category.value.id]);assert.equal(saved.value.assignment.stale,false);
  const first=await P.dimensions(db,[await event.get()]);assert.deepEqual(first.map.get('synthetic'),{categories:[category.value.id],bookingType:'booking-type',series:'series'});
  assert.deepEqual((await event.get()).data(),{title:'Synthetic event',departmentId:'booking-type',seriesId:'series',status:'confirmed',visibility:'public'});
  await event.update({title:'Updated synthetic event'});assert.equal((await route('GET',{eventId:'synthetic'})).value.assignment.stale,true);
  const stale=await P.dimensions(db,[await event.get()]);assert.deepEqual(stale.map.get('synthetic').categories,[]);assert.notEqual(first.fingerprint,stale.fingerprint);
  assert.equal((await route('POST',{}, {...params,version:1})).status,409);
  const fresh=await route('GET',{eventId:'synthetic'});assert.equal((await route('POST',{}, {...params,eventVersion:fresh.value.event.version,version:1,categoryIds:[]})).status,200);
  assert.deepEqual((await route('GET',{eventId:'synthetic'})).value.assignment.categoryIds,[]);
  await db.doc('calendarSettings/auth').set({passwordLoginDisabled:true});token.firebase.sign_in_provider='password';
  assert.equal((await route('POST',{}, {action:'create',name:'Denied password'})).status,403);
  token.firebase.sign_in_provider='google.com';
  await db.doc('users/owner').set({role:'member',email:token.email});
  await assert.rejects(P.createCategory(db,{uid:token.uid,email:token.email,provider:'google.com'},{name:'Denied reviewer'}),{status:403});
  token.uid='ordinary';token.email='ordinary@example.invalid';await db.doc('users/ordinary').set({role:'admin',email:token.email});await db.doc('adminAllowlist/'+token.email).set({uid:token.uid,modules:['form-insights']});
  assert.equal((await route('GET')).status,403);assert.equal((await route('POST',{}, {action:'create',name:'Denied'})).status,403);
 }finally{await db.terminate();await deleteApp(app);}
});
