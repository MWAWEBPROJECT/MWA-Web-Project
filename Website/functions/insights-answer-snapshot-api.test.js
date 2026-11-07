const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const Insights=require('./form-insights'),Mapping=require('./insights-mapping');
test('mapped-answer snapshot API preserves filtered legacy results and gates export and access',{skip:!process.env.FIRESTORE_EMULATOR_HOST,timeout:120000},async()=>{
 const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');
 const app=initializeApp({projectId:'demo-answers-snapshot-api'},randomUUID()),db=getFirestore(app),form='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const user={uid:'aggregate',email:'aggregate@example.invalid',email_verified:true,firebase:{sign_in_provider:'google.com'}},origin='http://localhost:5174',grant=db.doc('adminAllowlist/'+user.email);
 const previousSnapshot=process.env.MWA_INSIGHTS_MULTI_SNAPSHOT_ENABLED,previousCleanup=process.env.MWA_INSIGHTS_MULTI_CLEANUP_ENABLED;
 async function route(path,method,payload){
  let status=200,value;const res={status:n=>{status=n;return res;},json:v=>{value=v;return res;}};
  await Insights.handle({path:'/api/form-insights'+path,method,query:method==='GET'?payload:{},body:method==='POST'?payload:{},is:()=>true,get:name=>name==='Authorization'?['Bearer','synthetic'].join(' '):origin},res,{db,getAuth:()=>({verifyIdToken:async()=>user}),origins:new Set([origin])});
  return {status,value};
 }
 try{
  await db.doc('users/'+user.uid).set({role:'admin',email:user.email});await grant.set({uid:user.uid,modules:['form-insights','form-insights-export']});
  const fields=[{id:'choice',type:'radio',label:'Choice',options:['A','B'],required:false}];
  await db.doc(`_insightsState/fieldMappings/forms/${form}/revisions/1`).set({status:'reviewed',version:1,schemaHash:Mapping.hashSchema(Mapping.schema(fields)),entries:[{fieldId:'choice',role:'',concept:'choice'}]});
  await db.doc(`registrationForms/${form}/responses/one`).set({revision:1,fields,answers:{choice:'A'},createdAt:'2026-03-01T00:00:00.000Z',eventId:'',reference:'SYNTHETIC',formTitle:'Synthetic'});
  await Insights.indexResponse(db,form,'one');
  const filter={dateMode:'year',year:'2026',basis:'submission',search:'',concept:'choice',formId:form};
  const legacy=await route('/answers','GET',filter);assert.equal(legacy.status,200,JSON.stringify(legacy.value));
  process.env.MWA_INSIGHTS_MULTI_SNAPSHOT_ENABLED='false';process.env.MWA_INSIGHTS_MULTI_CLEANUP_ENABLED='false';
  assert.equal((await route('/analysis','POST',{action:'answers-status'})).value.enabled,false);
  assert.equal((await route('/analysis','POST',{action:'answers-start',...filter})).status,503);
  process.env.MWA_INSIGHTS_MULTI_SNAPSHOT_ENABLED='true';process.env.MWA_INSIGHTS_MULTI_CLEANUP_ENABLED='true';
  assert.equal((await route('/analysis','POST',{action:'answers-status'})).value.enabled,true);
  let state=await route('/analysis','POST',{action:'answers-start',...filter});assert.equal(state.status,200,JSON.stringify(state.value));
  const jobId=state.value.jobId;
  assert.equal((await route('/analysis','POST',{action:'answers-results',jobId})).status,409);
  while(state.value.status==='running'){state=await route('/analysis','POST',{action:'answers-step',jobId,step:state.value.step,search:''});assert.equal(state.status,200,JSON.stringify(state.value));}
  const result=await route('/analysis','POST',{action:'answers-results',jobId});
  assert.equal(result.status,200,JSON.stringify(result.value));assert.deepEqual(result.value.groups,legacy.value.groups);assert.deepEqual(result.value.coverage,legacy.value.coverage);
  const download=await route('/analysis','POST',{action:'answers-results',jobId,export:'xlsx'});assert.equal(download.status,200);assert.equal(download.value.fingerprint,result.value.fingerprint);
  await grant.update({modules:['form-insights']});
  assert.equal((await route('/analysis','POST',{action:'answers-results',jobId,export:'pdf'})).status,403);
  assert.equal((await route('/analysis','POST',{action:'answers-results',jobId})).status,200);
  await grant.update({modules:[]});assert.equal((await route('/analysis','POST',{action:'answers-results',jobId})).status,403);
 }finally{
  if(previousSnapshot===undefined)delete process.env.MWA_INSIGHTS_MULTI_SNAPSHOT_ENABLED;else process.env.MWA_INSIGHTS_MULTI_SNAPSHOT_ENABLED=previousSnapshot;
  if(previousCleanup===undefined)delete process.env.MWA_INSIGHTS_MULTI_CLEANUP_ENABLED;else process.env.MWA_INSIGHTS_MULTI_CLEANUP_ENABLED=previousCleanup;
  await db.terminate();await deleteApp(app);
 }
});
