const test=require('node:test'),assert=require('node:assert/strict');
const Ledger=require('./insights-snapshot-ledger'),Snapshot=require('./insights-multi-snapshot');

test('bounded ledger detects changed or missing calendar and review records and cleans only temporary descendants',{skip:!process.env.FIRESTORE_EMULATOR_HOST,timeout:120000},async()=>{
 const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');
 const app=initializeApp({projectId:'demo-insights-ledger'},'ledger'),db=getFirestore(app),id='11111111-1111-4111-8111-111111111111',job=db.doc('_insightsMultiJobs/'+id);
 try{
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-insights-ledger/databases/(default)/documents`,{method:'DELETE'});
  const event=db.doc('events/a'),category=db.doc('_insightsState/programmeCategories/items/a'),assignment=db.doc('_insightsState/programmeAssignments/events/a');
  await event.set({title:'Synthetic'});await category.set({name:'Synthetic'});await job.set({expiresAt:new Date('2020-01-01'),status:'running',ledgerCount:0});
  const source=await db.getAll(event,category,assignment);
  await db.runTransaction(async tx=>{const prep=await Ledger.prepare(tx,job,source,0);assert.equal(prep.count,3);prep.write();tx.update(job,{ledgerCount:prep.count});});
  await db.runTransaction(async tx=>Ledger.validate(tx,db,job,3));
  await db.runTransaction(async tx=>{const prep=await Ledger.prepare(tx,job,source,3);assert.equal(prep.count,3);prep.write();});
  await assignment.set({version:1});
  await assert.rejects(db.runTransaction(async tx=>Ledger.validate(tx,db,job,3)),error=>error.status===409);
  const changed=await assignment.get();await assert.rejects(db.runTransaction(async tx=>Ledger.prepare(tx,job,[changed],3)),error=>error.status===409);
  await assert.rejects(db.runTransaction(async tx=>Ledger.validate(tx,db,job,2)),error=>error.status===409);
  await assert.rejects(db.runTransaction(async tx=>Ledger.prepare(tx,job,[await db.doc('users/a').get()],3)),error=>error.status===409);
  const tooMany=Array.from({length:Ledger.MAX_ENTRIES+1},(_,i)=>({exists:false,ref:db.doc('events/cap'+i)}));
  await assert.rejects(db.runTransaction(async tx=>Ledger.prepare(tx,job,tooMany,0)),error=>error.status===422);
  let result;do{result=await Snapshot.cleanupExpired(db,id);}while(!result.done);
  assert.equal((await event.get()).exists,true);assert.equal((await category.get()).exists,true);assert.equal((await assignment.get()).exists,true);
  assert.equal((await job.collection('ledger').get()).size,0);assert.equal((await job.get()).exists,false);
 }finally{await db.terminate();await deleteApp(app);}
});
