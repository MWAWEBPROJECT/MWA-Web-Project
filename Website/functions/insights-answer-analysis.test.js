const test=require('node:test'),assert=require('node:assert/strict');
const I=require('./form-insights'),Mapping=require('./insights-mapping');
test('reviewed mapped answers separate incompatible definitions, preserve options and protect aggregate permissions',{skip:!process.env.FIRESTORE_EMULATOR_HOST},async()=>{
 const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');
 const app=initializeApp({projectId:'demo-answer-analysis'},'answer-analysis'),db=getFirestore(app),origin='http://localhost:5174',form='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const user={uid:'aggregate',email:'aggregate@example.invalid',email_verified:true,firebase:{sign_in_provider:'google.com'}},grant=db.doc('adminAllowlist/'+user.email);
 async function route(query){let status=200,value;const res={status:n=>{status=n;return res;},json:v=>{value=v;return res;}};await I.handle({path:'/api/form-insights/answers',method:'GET',query:{dateMode:'year',year:'2026',concept:'meal',...query},get:name=>name==='Authorization'?['Bearer','synthetic'].join(' '):origin},res,{db,getAuth:()=>({verifyIdToken:async()=>user}),origins:new Set([origin])});return {status,value};}
 const field=(type,options=[],label='Meal')=>({id:'answer',type,label,description:'',required:false,options});
 async function mapping(revision,fields,status='reviewed',concept='meal',role=''){
  await db.doc(`_insightsState/fieldMappings/forms/${form}/revisions/${revision}`).set({version:1,status,schemaHash:Mapping.hashSchema(Mapping.schema(fields)),entries:fields.map(item=>({fieldId:item.id,role,concept}))});
 }
 async function add(id,revision,fields,value,eventId=''){
  const answers=value===undefined?{}:{answer:value};await db.doc(`registrationForms/${form}/responses/${id}`).set({reference:'SYNTHETIC',formTitle:'Synthetic',revision,fields,answers,eventId,createdAt:'2026-02-01T00:00:00.000Z'});await I.indexResponse(db,form,id);
 }
 try{
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-answer-analysis/databases/(default)/documents`,{method:'DELETE'});
  await db.doc('users/'+user.uid).set({role:'admin',email:user.email});await grant.set({uid:user.uid,modules:['form-insights']});
  const a=[field('checkboxes',['A','B'])],b=[field('checkboxes',['A','C'])],c=[field('number')],d=[field('text')],e=[field('radio',['Yes','No'])];
  for(const [rev,fields,status] of [[1,a,'reviewed'],[2,b,'reviewed'],[3,c,'reviewed'],[4,d,'reviewed'],[5,e,'draft']])await mapping(rev,fields,status);
  await add('one',1,a,['A','B']);await add('two',1,a,['A']);await add('missing',1,a,undefined);await add('invalid',1,a,['SECRET FREE TEXT']);await add('old',2,b,['C']);await add('number',3,c,'4');await add('text',4,d,'PRIVATE TEXT');await add('draft',5,e,'Yes');
  await db.doc('events/private').set({title:'SECRET EVENT',visibility:'private',status:'confirmed',startAt:'2026-03-01T00:00:00.000Z'});await add('private',1,a,['A'],'private');
  let result=await route({});assert.equal(result.status,200,JSON.stringify(result.value));
  assert.equal(result.value.groups.length,3);const first=result.value.groups.find(group=>group.type==='checkboxes'&&group.options.some(option=>option.label==='B'));
  assert.deepEqual([first.eligible,first.answered,first.missing,first.invalid],[4,2,1,1]);assert.deepEqual(first.options.map(x=>x.count),[2,1]);
  assert.equal(result.value.groups.find(group=>group.type==='number').mean,4);assert.equal(result.value.coverage.unreviewed,1);assert.equal(result.value.coverage.unsupported,1);assert.equal(result.value.coverage.unavailableEvent,1);
  assert.doesNotMatch(JSON.stringify(result.value),/PRIVATE TEXT|SECRET FREE TEXT|SECRET EVENT|private/);
  assert.equal((await route({search:'PRIVATE'})).status,403);assert.equal((await route({export:'xlsx'})).status,403);
  await grant.update({modules:['form-insights','form-insights-export']});
  const downloadable=await route({export:'xlsx'});assert.equal(downloadable.status,200);assert.equal(downloadable.value.fingerprint,result.value.fingerprint);
  await grant.update({modules:['form-insights']});
  await db.doc(`_insightsState/fieldMappings/forms/${form}/revisions/2`).update({status:'draft',version:2});
  result=await route({});assert.notEqual(result.value.fingerprint,downloadable.value.fingerprint);assert.equal(result.value.groups.length,2);assert.equal(result.value.coverage.unreviewed,2);
  await db.doc(`registrationForms/${form}/responses/one`).update({'answers.answer':['B']});result=await route({});assert.deepEqual(result.value.groups.find(g=>g.type==='checkboxes').options.map(x=>x.count),[1,1]);
  await db.doc('events/public').set({title:'Public',visibility:'public',status:'confirmed',startAt:'2026-04-01T00:00:00.000Z'});
  await add('event',1,a,['B'],'public');
  await db.doc('_insightsState/programmeCategories/items/education').set({name:'Education'});
  const publicEvent=await db.doc('events/public').get();
  await db.doc('_insightsState/programmeAssignments/events/public').set({categoryIds:['education'],version:1,eventVersion:`${publicEvent.updateTime.seconds}:${publicEvent.updateTime.nanoseconds}`});
  await db.doc('adminAllowlist/'+user.email).update({modules:['form-insights','form-insights-export']});
  let scoped=await route({categories:'education,other'});assert.equal(scoped.status,200);assert.equal(scoped.value.coverage.indexed,1);
  assert.equal((await route({categories:'education,other',export:'xlsx'})).value.fingerprint,scoped.value.fingerprint);
  assert.equal((await route({categories:'education',bookingType:'different'})).value.coverage.indexed,0);
  assert.equal((await route({categories:'unknown'})).value.coverage.indexed,8);
  await db.doc('_insightsState/programmeAssignments/events/public').update({version:2,categoryIds:[]});
  assert.notEqual((await route({categories:'education,other'})).value.fingerprint,scoped.value.fingerprint);
  await db.doc('_insightsState/programmeAssignments/events/public').update({version:3,categoryIds:['education']});
  await db.doc('adminAllowlist/'+user.email).update({modules:['form-insights']});
  result=await route({basis:'event',dateMode:'month',month:'2026-04'});assert.equal(result.value.coverage.indexed,1);
  await db.doc('events/public').update({startAt:'2026-05-01T00:00:00.000Z'});assert.equal((await route({basis:'event',dateMode:'month',month:'2026-04'})).value.coverage.indexed,0);assert.equal((await route({basis:'event',dateMode:'month',month:'2026-05'})).value.coverage.indexed,1);
  const pair=[field('checkboxes',['A','B']),{...field('radio',['X','Y'],'Time'),id:'time'}];
  await db.doc(`_insightsState/fieldMappings/forms/${form}/revisions/6`).set({version:1,status:'reviewed',schemaHash:Mapping.hashSchema(Mapping.schema(pair)),entries:[{fieldId:'answer',role:'',concept:'meal'},{fieldId:'time',role:'',concept:'time'}]});
  for(const [id,answers] of [['pair1',{answer:['A','B'],time:'X'}],['pair2',{answer:['A'],time:'Y'}],['pairmissing',{answer:['A']}],['pairinvalid',{answer:['PRIVATE'],time:'X'}]]){
   await db.doc(`registrationForms/${form}/responses/${id}`).set({reference:'SYNTHETIC',formTitle:'Synthetic',revision:6,fields:pair,answers,eventId:'',createdAt:'2026-06-01T00:00:00.000Z'});await I.indexResponse(db,form,id);
  }
  const numeric=[field('number'),pair[1]];
  for(const [revision,fields,status] of [[7,numeric,'reviewed'],[8,pair,'draft']]){
   await db.doc(`_insightsState/fieldMappings/forms/${form}/revisions/${revision}`).set({version:1,status,schemaHash:Mapping.hashSchema(Mapping.schema(fields)),entries:[{fieldId:'answer',role:'',concept:'meal'},{fieldId:'time',role:'',concept:'time'}]});
   await db.doc(`registrationForms/${form}/responses/pair${revision}`).set({reference:'SYNTHETIC',formTitle:'Synthetic',revision,fields,answers:{answer:revision===7?'7':['A'],time:'X'},eventId:'',createdAt:'2026-06-01T00:00:00.000Z'});await I.indexResponse(db,form,`pair${revision}`);
  }
  const cross=await route({concept2:'time'});assert.equal(cross.status,200);assert.equal(cross.value.crossTabs.length,1);
  assert.deepEqual([cross.value.crossTabs[0].eligible,cross.value.crossTabs[0].answered,cross.value.crossTabs[0].missing,cross.value.crossTabs[0].invalid],[4,2,1,1]);
  assert.deepEqual(cross.value.crossTabs[0].counts,[[1,1],[1,0]]);
  assert.ok(cross.value.coverage.unsupported>=1);assert.ok(cross.value.coverage.unreviewed>=1);
  assert.doesNotMatch(JSON.stringify(cross.value),/PRIVATE/);
  const SnapshotAnswer=require('./insights-answer-snapshot'),snapshotActor={uid:user.uid,email:user.email,provider:'google.com',modules:['form-insights']};
  for(const scope of [{},{concept2:'time'},{basis:'event'},{categories:'education'},{categories:'unknown'}]){
   const query={dateMode:'year',year:'2026',concept:'meal',search:'',...scope},legacy=await route(query);
   assert.equal(legacy.status,200,JSON.stringify(legacy.value));
   let state=await SnapshotAnswer.start(db,snapshotActor,query);
   while(state.status==='running')state=await SnapshotAnswer.step(db,snapshotActor,{jobId:state.jobId,step:state.step,search:''});
   const snapshot=await SnapshotAnswer.results(db,snapshotActor,{jobId:state.jobId});
   const ordered=values=>[...values].sort((a,b)=>a.id.localeCompare(b.id));
   assert.deepEqual(snapshot.coverage,legacy.value.coverage);
   assert.deepEqual(ordered(snapshot.groups),ordered(legacy.value.groups));
   assert.deepEqual(ordered(snapshot.crossTabs||[]),ordered(legacy.value.crossTabs||[]));
  }
  assert.equal((await route({concept2:'meal'})).status,400);assert.equal((await route({concept2:'time',export:'xlsx'})).status,403);
  await grant.update({modules:['form-insights','form-insights-export']});
  assert.equal((await route({concept2:'time',export:'xlsx'})).value.fingerprint,cross.value.fingerprint);
  assert.notEqual((await route({})).value.fingerprint,cross.value.fingerprint);
  await grant.update({modules:['form-insights']});
  const getAll=db.getAll.bind(db);let intercept=true;
  db.getAll=async(...refs)=>{const docs=await getAll(...refs);if(intercept&&refs.some(item=>item.path.includes('/fieldMappings/'))){intercept=false;await db.doc(`_insightsState/fieldMappings/forms/${form}/revisions/1`).update({status:'draft',version:2});}return docs;};
  assert.equal((await route({})).status,409);db.getAll=getAll;await db.doc(`_insightsState/fieldMappings/forms/${form}/revisions/1`).update({status:'reviewed',version:3});
  intercept=true;db.getAll=async(...refs)=>{const docs=await getAll(...refs);if(intercept){intercept=false;await grant.update({modules:[]});}return docs;};
  assert.equal((await route({})).status,403);db.getAll=getAll;await grant.update({modules:['form-insights']});
  await grant.update({modules:[]});assert.equal((await route({})).status,403);
 }finally{await db.terminate();await deleteApp(app);}
});
