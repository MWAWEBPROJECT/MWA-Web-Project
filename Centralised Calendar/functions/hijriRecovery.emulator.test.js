const test=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {initializeApp,deleteApp}=require('firebase-admin/app');
const {getFirestore,FieldValue}=require('firebase-admin/firestore');
const {createHijriRecovery,settingsGeneration}=require('./hijriRecovery');
const {rangesConflict,resolveBufferHours}=require('./conflictUtils');
const {auditEntry}=require('./auditModel');

const enabled=Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const HttpsError=class extends Error{constructor(code,message){super(message);this.code=code;}};

test('settings generations preserve nanoseconds and reject missing snapshots',()=>{
 assert.notEqual(settingsGeneration({exists:true,updateTime:{seconds:42,nanoseconds:1}}),settingsGeneration({exists:true,updateTime:{seconds:42,nanoseconds:2}}));
 assert.equal(settingsGeneration({exists:false}),null);
});

async function fixture({checkpoint,sendMail,failRefresh,now}={}){
 const app=initializeApp({projectId:'demo-hijri-'+randomUUID()},randomUUID()),db=getFirestore(app),sent=[];
 await db.doc('calendarSettings/hijri').set({overrides:[{date:'2027-01-02'}]});
 await db.doc('venues/hall').set({bufferHours:0});
 const booking=(date,extra={})=>({dateBasis:'hijri',hijriDate:{year:1448,month:7,day:1},status:'confirmed',venueId:'hall',startAt:date+'T10:00:00.000Z',endAt:date+'T11:00:00.000Z',title:'Synthetic booking',contactEmail:'test@example.invalid',conflictWith:[],...extra});
 await db.doc('events/moved').set(booking('2027-01-01',{conflictWith:['old']}));
 await db.doc('events/old').set(booking('2027-01-01',{dateBasis:'gregorian',conflictWith:['moved'],hasConflict:true}));
 await db.doc('events/new').set(booking('2027-01-02',{dateBasis:'gregorian'}));
 const deps={
  db,FieldValue,HttpsError,activeStatuses:['pending','confirmed'],maxVenues:100,auditEntry,checkpoint,now,
  resolveBookingDates:(event,overrides)=>({resolved:true,startAt:(overrides[0]?.date||'2027-01-01')+'T10:00:00.000Z',endAt:(overrides[0]?.date||'2027-01-01')+'T11:00:00.000Z'}),
  dateKeyOf:iso=>iso.slice(0,10),hijriInfoFor:()=>({year:1448,month:7,day:1}),
  notify:{moonSightingRequester:event=>({kind:'requester',to:event.contactEmail}),moonSightingAdmin:moved=>({kind:'digest',moved})},
  sendMail:async (message,options)=>{sent.push(message);return sendMail?sendMail(message,options):{sent:true};},
  resolveBufferHours,rangesConflict,logger:{error:()=>{},info:()=>{}},
  findOverlaps:async(venueId,startAt,endAt,excludeId,tx)=>{
   if(failRefresh)await failRefresh();
   const snapshot=await tx.get(db.collection('events').where('venueId','==',venueId).where('status','in',['pending','confirmed']));
   return snapshot.docs.filter(doc=>doc.id!==excludeId&&rangesConflict({startAt,endAt,_buf:0},{...doc.data(),_buf:0},0)).map(doc=>({id:doc.id}));
  }
 };
 const recovery=createHijriRecovery(deps);
 const start=async eventId=>{
  const settings=await db.doc('calendarSettings/hijri').get();
  return recovery.start(eventId,settings.data().overrides||[],settingsGeneration(settings));
 };
 const id=await start('synthetic-event');
 const retry=async()=>{await db.doc('_hijriRecoveryRuns/'+id).update({nextAttempt:0,leaseUntil:0});return recovery.process(id);};
 return {app,db,recovery,id,sent,retry,start,close:()=>deleteApp(app)};
}

test('Hijri recovery saves dates and audit atomically and resumes old/new conflict windows after refresh failure',{skip:!enabled},async()=>{
 let failure=true;
 const f=await fixture({failRefresh:async()=>{if(failure){failure=false;throw Error('synthetic refresh failure');}}});
 try{
  assert.equal(await f.recovery.process(f.id),false);
  assert.equal((await f.db.doc('events/moved').get()).data().startAt,'2027-01-02T10:00:00.000Z');
  assert.equal((await f.db.collection('auditLog').get()).size,1);
  assert.equal((await f.db.doc('_hijriRecoveryRuns/'+f.id).get()).data().phase,'drain');
  assert.equal(f.sent.length,0);
  assert.equal(await f.retry(),true);
  assert.deepEqual((await f.db.doc('events/old').get()).data().conflictWith,[]);
  assert.deepEqual((await f.db.doc('events/new').get()).data().conflictWith,['moved']);
  assert.deepEqual((await f.db.doc('events/moved').get()).data().conflictWith,['new']);
  assert.deepEqual(f.sent.map(m=>m.kind),['requester','digest']);
  assert.equal((await f.db.collection('auditLog').get()).size,1);
  assert.equal(await f.recovery.process(f.id),false);
  assert.equal(f.sent.length,2);
 }finally{await f.close();}
});

test('a crash after the date commit is recovered by the scheduled sweep',{skip:!enabled},async()=>{
 let failure=true;
 const f=await fixture({checkpoint:async stage=>{if(stage==='after-page-commit'&&failure){failure=false;throw Error('synthetic crash');}}});
 try{
  assert.equal(await f.recovery.process(f.id),false);
  assert.equal((await f.db.doc('events/moved').get()).data().startAt,'2027-01-02T10:00:00.000Z');
  await f.db.doc('_hijriRecoveryRuns/'+f.id).update({nextAttempt:0,leaseUntil:0});
  await f.recovery.sweep();
  assert.equal((await f.db.doc('_hijriRecoveryRuns/'+f.id).get()).data().state,'complete');
  assert.deepEqual(f.sent.map(m=>m.kind),['requester','digest']);
 }finally{await f.close();}
});

test('an audit write failure aborts date changes and durable tasks together',{skip:!enabled},async()=>{
 const f=await fixture();let fail=true;
 const original=f.db.runTransaction.bind(f.db);
 f.db.runTransaction=(callback,...options)=>original(tx=>callback(new Proxy(tx,{get(target,key){
  if(key==='set')return (ref,...args)=>{if(fail&&ref.path.startsWith('auditLog/')){fail=false;throw Error('synthetic audit failure');}return target.set(ref,...args);};
  const value=target[key];return typeof value==='function'?value.bind(target):value;
 }})),...options);
 try{
  assert.equal(await f.recovery.process(f.id),false);
  assert.equal((await f.db.doc('events/moved').get()).data().startAt,'2027-01-01T10:00:00.000Z');
  assert.equal((await f.db.collection('auditLog').get()).size,0);
  assert.equal((await f.db.collection('_hijriRecoveryRuns').doc(f.id).collection('pages').doc('0').collection('tasks').get()).size,0);
  assert.equal(await f.retry(),true);
  assert.equal((await f.db.collection('auditLog').get()).size,1);
 }finally{await f.close();}
});

test('conflict recovery uses current venue rather than linking unrelated venues',{skip:!enabled},async()=>{
 let failure=true;
 const f=await fixture({checkpoint:async stage=>{if(stage==='after-page-commit'&&failure){failure=false;throw Error('synthetic crash');}}});
 try{
  await f.recovery.process(f.id);
  await f.db.doc('venues/other').set({bufferHours:0});
  await f.db.doc('events/moved').update({venueId:'other'});
  await f.db.doc('events/old').update({startAt:'2027-01-02T10:00:00.000Z',endAt:'2027-01-02T11:00:00.000Z'});
  await f.retry();
  assert.deepEqual((await f.db.doc('events/old').get()).data().conflictWith,[]);
  assert.deepEqual((await f.db.doc('events/new').get()).data().conflictWith,[]);
  assert.deepEqual((await f.db.doc('events/moved').get()).data().conflictWith,[]);
  assert.equal(f.sent.length,0);
  const held=(await f.recovery.status()).held;
  assert.equal(held.length,2);assert.ok(held.every(item=>item.classification==='not-sent'));
 }finally{await f.close();}
});

test('conflict recovery clears stale links when a moved booking is cancelled',{skip:!enabled},async()=>{
 let failure=true;
 const f=await fixture({checkpoint:async stage=>{if(stage==='after-page-commit'&&failure){failure=false;throw Error('synthetic crash');}}});
 try{
  await f.recovery.process(f.id);
  await f.db.doc('events/moved').update({status:'cancelled',hasConflict:true,conflictWith:['old']});
  await f.retry();
  const moved=(await f.db.doc('events/moved').get()).data();
  assert.equal(moved.hasConflict,false);assert.deepEqual(moved.conflictWith,[]);
  assert.deepEqual((await f.db.doc('events/old').get()).data().conflictWith,[]);
  assert.equal(f.sent.length,0);assert.equal((await f.recovery.status()).held.length,2);
 }finally{await f.close();}
});

test('pagination resumes all changed dates and sends one admin digest per original page',{skip:!enabled},async()=>{
 const f=await fixture();
 try{
  const batch=f.db.batch();
  for(let i=0;i<100;i++)batch.set(f.db.doc('events/bulk-'+String(i).padStart(3,'0')),{
   dateBasis:'hijri',hijriDate:{year:1448,month:7,day:1},status:'pending',venueId:'hall',
   startAt:'2027-01-01T10:00:00.000Z',endAt:'2027-01-01T11:00:00.000Z',title:'Synthetic '+i,conflictWith:[]
  });
  await batch.commit();
  assert.equal(await f.recovery.process(f.id),true);
  assert.equal((await f.db.collection('auditLog').get()).size,101);
  const digests=f.sent.filter(message=>message.kind==='digest');
  assert.equal(digests.length,2);
  assert.equal(digests.reduce((count,message)=>count+message.moved.length,0),101);
 }finally{await f.close();}
});

test('accepted mail with lost acknowledgement is held, visible, and not resent',{skip:!enabled},async()=>{
 let failure=true;
 const f=await fixture({checkpoint:async stage=>{if(stage==='after-send'&&failure){failure=false;throw Error('synthetic lost acknowledgement');}}});
 try{
  assert.equal(await f.recovery.process(f.id),false);
  assert.equal(f.sent.filter(m=>m.kind==='requester').length,1);
  assert.equal(await f.retry(),true);
  const status=await f.recovery.status();
  assert.equal(status.held.length,1);assert.equal(status.held[0].eventId,'moved');
  assert.equal(f.sent.filter(m=>m.kind==='requester').length,1);
  assert.equal(f.sent.filter(m=>m.kind==='digest').length,1);
  await f.recovery.resolveReview(status.held[0].id,{uid:'admin',email:'admin@example.invalid'});
  assert.equal((await f.recovery.status()).held.length,0);
  assert.equal(await f.recovery.process(f.id),false);
  assert.equal(f.sent.length,2);
 }finally{await f.close();}
});

test('an aborted Gmail send maps through the mail wrapper to an uncertain hold',{skip:!enabled},async()=>{
 const gmail=require('./gmailBookingMail'),original=gmail.sendBookingGmail,{sendMail}=require('./mailer');
 let calls=0,result;
 const config={connected:true,mailbox:'admin@muhammadiwelfare.org.au',refreshToken:'fixture',accessToken:'synthetic',expiresAt:Date.now()+3600000};
 const db={doc:()=>({get:async()=>({data:()=>config})})};
 gmail.sendBookingGmail=(message,options)=>original(message,{...options,db,fetcher:async url=>{
  assert.match(url,/messages\/send$/);calls++;const error=Error('aborted');error.name='AbortError';throw error;
 }});
 const f=await fixture({sendMail:async(message,options)=>{
  if(message.kind==='digest')return {sent:true};
  result=await sendMail(message,options);return result;
 }});
 try{
  assert.equal(await f.recovery.process(f.id),true);
  assert.deepEqual(result,{sent:false,reason:'send-error'});assert.equal(calls,1);
  const held=(await f.recovery.status()).held;
  assert.equal(held.length,1);assert.equal(held[0].classification,'uncertain');
  await f.recovery.resolveReview(held[0].id,{uid:'admin',email:'admin@example.invalid'});
  const audit=(await f.db.collection('auditLog').get()).docs.map(doc=>doc.data()).find(entry=>entry.action==='hijri.notification_reviewed');
  assert.match(audit.note,/Hijri notification reviewed/);assert.doesNotMatch(audit.note,/uncertain/);
  assert.equal(await f.recovery.process(f.id),false);assert.equal(calls,1);
 }finally{gmail.sendBookingGmail=original;await f.close();}
});

test('lease expiry fences a delayed sender and duplicate workers do not resend',{skip:!enabled},async()=>{
 let release,entered;
 const waiting=new Promise(resolve=>{entered=resolve;}),blocked=new Promise(resolve=>{release=resolve;});
 const f=await fixture({sendMail:async message=>{if(message.kind==='requester'){entered();await blocked;}return {sent:true};}});
 try{
  const first=f.recovery.process(f.id);await waiting;
  assert.equal(await f.recovery.process(f.id),false);
  await f.db.doc('_hijriRecoveryRuns/'+f.id).update({nextAttempt:0,leaseUntil:0});
  assert.equal(await f.recovery.process(f.id),true);
  release();await first;
  assert.equal(f.sent.filter(m=>m.kind==='requester').length,1);
  assert.equal((await f.recovery.status()).held.length,1);
 }finally{release();await f.close();}
});

test('a suspended worker cannot start delivery after another worker holds its sending marker',{skip:!enabled},async()=>{
 let time=Date.now(),release,entered,paused=false;
 const waiting=new Promise(resolve=>{entered=resolve;}),blocked=new Promise(resolve=>{release=resolve;});
 const f=await fixture({now:()=>time,checkpoint:async stage=>{if(stage==='after-send-start'&&!paused){paused=true;entered();await blocked;}}});
 try{
  const first=f.recovery.process(f.id);await waiting;
  time+=8*60*1000+1;
  assert.equal(await f.recovery.process(f.id),true);
  release();await first;
  assert.equal(f.sent.filter(m=>m.kind==='requester').length,0);
  const held=(await f.recovery.status()).held;
  assert.equal(held.length,1);assert.equal(held[0].classification,'uncertain');
  assert.ok(held[0].sendingAt);assert.ok(held[0].notAfter<time);
 }finally{release();await f.close();}
});

test('an expired send window is deferred as definitely unsent without blocking remaining work',{skip:!enabled},async()=>{
 let time=Date.now(),advanced=false;
 const f=await fixture({now:()=>time,checkpoint:async stage=>{if(stage==='after-send-start'&&!advanced){advanced=true;time+=90001;}},sendMail:async(message,options)=>time>=options.notAfter?{sent:false,reason:'send-window-expired'}:{sent:true}});
 try{
  assert.equal(await f.recovery.process(f.id),true);
  const held=(await f.recovery.status()).held;
  assert.equal(held.length,1);assert.equal(held[0].classification,'not-sent');
  assert.match(held[0].reason,/not sent.*window expired/);
  assert.equal(f.sent.filter(m=>m.kind==='digest').length,1);
 }finally{await f.close();}
});

test('a send marker cannot be committed with insufficient remaining lease',{skip:!enabled},async()=>{
 let f,shortened=false;
 f=await fixture({checkpoint:async stage=>{if(stage==='before-send-start'&&!shortened){shortened=true;await f.db.doc('_hijriRecoveryRuns/'+f.id).update({leaseUntil:Date.now()+100000});}}});
 try{
  assert.equal(await f.recovery.process(f.id),false);
  const tasks=await f.db.doc('_hijriRecoveryRuns/'+f.id).collection('pages').doc('0').collection('tasks').get();
  const event=tasks.docs.find(doc=>doc.data().kind==='event').data();
  assert.equal(event.delivery,'pending');assert.equal(f.sent.length,0);
  assert.equal((await f.recovery.status()).held.length,0);
  assert.equal(await f.retry(),true);
 }finally{await f.close();}
});

test('shared worker deadline defers a send before its marker and bounds the scheduled sweep',{skip:!enabled},async()=>{
 const f=await fixture();
 try{
  await f.recovery.sweep({deadline:Date.now()-1});
  assert.equal((await f.db.doc('events/moved').get()).data().startAt,'2027-01-01T10:00:00.000Z');
  assert.equal(await f.recovery.process(f.id,{deadline:Date.now()+80000}),true);
  const tasks=await f.db.doc('_hijriRecoveryRuns/'+f.id).collection('pages').doc('0').collection('tasks').get();
  assert.equal(tasks.docs.find(doc=>doc.data().kind==='event').data().delivery,'pending');
  assert.equal(f.sent.length,0);assert.equal((await f.recovery.status()).held.length,0);
  await f.recovery.sweep();
  assert.equal((await f.db.doc('_hijriRecoveryRuns/'+f.id).get()).data().state,'complete');
  assert.equal(f.sent.length,2);
 }finally{await f.close();}
});

test('delivery rechecks the shared deadline inside the send marker transaction',{skip:!enabled},async()=>{
 let time=Date.now(),advanced=false;
 const f=await fixture({now:()=>time,checkpoint:async stage=>{if(stage==='before-send-start'&&!advanced){advanced=true;time+=31000;}}});
 try{
  assert.equal(await f.recovery.process(f.id,{deadline:time+120000}),true);
  const tasks=await f.db.doc('_hijriRecoveryRuns/'+f.id).collection('pages').doc('0').collection('tasks').get();
  assert.equal(tasks.docs.find(doc=>doc.data().kind==='event').data().delivery,'pending');
  assert.equal(f.sent.length,0);assert.equal((await f.recovery.status()).held.length,0);
  assert.equal(await f.retry(),true);assert.equal(f.sent.length,2);
 }finally{await f.close();}
});

test('a retried send-marker transaction rechecks elapsed budget without a hold or error pause',{skip:!enabled},async()=>{
 let time=Date.now(),armed=false,replayed=false;
 const f=await fixture({now:()=>time,checkpoint:async stage=>{if(stage==='before-send-start'&&!replayed)armed=true;}});
 const original=f.db.runTransaction.bind(f.db);
 f.db.runTransaction=(callback,...options)=>original(async tx=>{
  if(!armed||replayed)return callback(tx);
  armed=false;replayed=true;
  const first=new Proxy(tx,{get(target,key){
   if(key==='update')return (ref,patch)=>{assert.equal(patch.delivery,'sending');return target;};
   const value=target[key];return typeof value==='function'?value.bind(target):value;
  }});
  await callback(first);
  time+=31000;
  return callback(tx);
 },...options);
 try{
  assert.equal(await f.recovery.process(f.id,{deadline:time+120000}),true);
  const tasks=await f.db.doc('_hijriRecoveryRuns/'+f.id).collection('pages').doc('0').collection('tasks').get();
  assert.equal(tasks.docs.find(doc=>doc.data().kind==='event').data().delivery,'pending');
  const run=(await f.db.doc('_hijriRecoveryRuns/'+f.id).get()).data();
  assert.equal(run.leaseUntil,0);assert.ok(run.nextAttempt<=time);assert.equal(run.lastError,null);
  assert.equal(f.sent.length,0);assert.equal((await f.recovery.status()).held.length,0);
  assert.equal(await f.retry(),true);assert.equal(f.sent.length,2);
 }finally{await f.close();}
});

test('disconnected mail does not block date updates or conflict refresh on later pages',{skip:!enabled},async()=>{
 const f=await fixture({sendMail:async()=>({sent:false,reason:'not-configured'})});
 try{
  const batch=f.db.batch();
  for(let i=0;i<100;i++)batch.set(f.db.doc('events/bulk-'+String(i).padStart(3,'0')),{
   dateBasis:'hijri',hijriDate:{year:1448,month:7,day:1},status:i===0?'pending':'cancelled',venueId:'hall',
   startAt:'2027-01-01T10:00:00.000Z',endAt:'2027-01-01T11:00:00.000Z',title:'Synthetic '+i,conflictWith:[]
  });
  await batch.commit();
  assert.equal(await f.recovery.process(f.id),true);
  assert.equal((await f.db.doc('events/moved').get()).data().startAt,'2027-01-02T10:00:00.000Z');
  assert.equal((await f.db.collection('auditLog').get()).size,101);
  assert.equal((await f.db.doc('_hijriRecoveryRuns/'+f.id).get()).data().state,'complete');
  const held=(await f.recovery.status()).held;
  assert.equal(held.length,3);assert.ok(held.every(item=>item.classification==='not-sent'));
 }finally{await f.close();}
});

test('superseded settings finish committed conflict repair and hold stale notifications',{skip:!enabled},async()=>{
 let failure=true;
 const f=await fixture({checkpoint:async stage=>{if(stage==='after-page-commit'&&failure){failure=false;throw Error('synthetic crash');}}});
 try{
  await f.recovery.process(f.id);
  await f.db.doc('calendarSettings/hijri').set({overrides:[{date:'2027-01-03'}]});
  await f.retry();
  assert.equal((await f.db.doc('_hijriRecoveryRuns/'+f.id).get()).data().state,'superseded');
  assert.deepEqual((await f.db.doc('events/old').get()).data().conflictWith,[]);
  assert.deepEqual((await f.db.doc('events/new').get()).data().conflictWith,['moved']);
  assert.equal(f.sent.length,0);assert.equal((await f.recovery.status()).held.length,2);
  const newer=await f.start('newer-event');await f.recovery.process(newer);
  assert.equal((await f.db.doc('events/moved').get()).data().startAt,'2027-01-03T10:00:00.000Z');
  assert.deepEqual((await f.db.doc('events/new').get()).data().conflictWith,[]);
 }finally{await f.close();}
});

test('returning to prior settings never revives a superseded run',{skip:!enabled},async()=>{
 let failure=true;
 const f=await fixture({checkpoint:async stage=>{if(stage==='after-page-commit'&&failure){failure=false;throw Error('synthetic crash');}}});
 try{
  await f.recovery.process(f.id);
  await f.db.doc('calendarSettings/hijri').set({overrides:[{date:'2027-01-03'}]});
  const runB=await f.start('run-b');await f.recovery.process(runB);
  await f.db.doc('calendarSettings/hijri').set({overrides:[{date:'2027-01-02'}]});
  const runA2=await f.start('run-a2');await f.recovery.process(runA2);
  assert.equal(f.sent.length,4);
  await f.retry();
  assert.equal(f.sent.length,4);
  assert.equal((await f.db.doc('_hijriRecoveryRuns/'+f.id).get()).data().state,'superseded');
  const held=(await f.recovery.status()).held;
  assert.equal(held.length,2);assert.ok(held.every(item=>item.classification==='not-sent'));
  assert.deepEqual((await f.db.doc('events/new').get()).data().conflictWith,['moved']);
 }finally{await f.close();}
});

test('out-of-order settings events cannot scan against a newer generation',{skip:!enabled},async()=>{
 const f=await fixture();
 try{
  const old=await f.db.doc('calendarSettings/hijri').get();
  await f.db.doc('calendarSettings/hijri').set({overrides:[{date:'2027-01-03'}]});
  const newer=await f.start('newer-first');await f.recovery.process(newer);
  const delayed=await f.recovery.start('old-delivered-late',old.data().overrides,settingsGeneration(old));
  await f.recovery.process(delayed);
  assert.equal((await f.db.doc('_hijriRecoveryRuns/'+delayed).get()).data().state,'superseded');
  assert.equal((await f.db.doc('events/moved').get()).data().startAt,'2027-01-03T10:00:00.000Z');
  assert.equal(f.sent.length,2);
 }finally{await f.close();}
});

test('deleted and recreated settings cannot revive an earlier generation',{skip:!enabled},async()=>{
 let failure=true;
 const f=await fixture({checkpoint:async stage=>{if(stage==='after-page-commit'&&failure){failure=false;throw Error('synthetic crash');}}});
 try{
  await f.recovery.process(f.id);
  const ref=f.db.doc('calendarSettings/hijri');
  await ref.delete();
  const deleted={id:'deleted-event',data:{after:await ref.get()}};
  await f.recovery.handleSettingsEvent(deleted);
  assert.deepEqual((await ref.get()).data(),{overrides:[]});
  assert.equal((await f.db.collection('auditLog').where('action','==','hijri.settings_restored').get()).size,1);
  await f.recovery.handleSettingsEvent(deleted);
  assert.equal((await f.db.collection('auditLog').where('action','==','hijri.settings_restored').get()).size,1);
  assert.equal((await f.db.collection('_hijriRecoveryRuns').get()).size,1);
  await ref.set({overrides:[{date:'2027-01-02'}],other:'keep'});
  await f.recovery.handleSettingsEvent(deleted);
  assert.equal((await ref.get()).data().other,'keep');
  assert.equal((await f.db.collection('_hijriRecoveryRuns').get()).size,1);
  await f.retry();
  assert.equal((await f.db.doc('_hijriRecoveryRuns/'+f.id).get()).data().state,'superseded');
  assert.equal(f.sent.length,0);
  const held=(await f.recovery.status()).held;
  assert.equal(held.length,2);assert.ok(held.every(item=>item.classification==='not-sent'));
  assert.deepEqual((await f.db.doc('events/new').get()).data().conflictWith,['moved']);
 }finally{await f.close();}
});

test('ordinary deletion restores defaults and its creation event recomputes dates',{skip:!enabled},async()=>{
 const f=await fixture();
 try{
  await f.recovery.process(f.id);
  const ref=f.db.doc('calendarSettings/hijri');
  await ref.delete();
  await f.recovery.handleSettingsEvent({id:'delete-settings',data:{after:await ref.get()}});
  const restored=await ref.get();
  await f.recovery.handleSettingsEvent({id:'restore-settings',data:{after:restored}});
  assert.equal((await f.db.doc('events/moved').get()).data().startAt,'2027-01-01T10:00:00.000Z');
  assert.equal(f.sent.length,4);
  assert.deepEqual((await f.db.doc('events/old').get()).data().conflictWith,['moved']);
  assert.deepEqual((await f.db.doc('events/new').get()).data().conflictWith,[]);
 }finally{await f.close();}
});

test('concurrent settings recreation is never overwritten by materialization',{skip:!enabled},async()=>{
 const f=await fixture();
 try{
  const ref=f.db.doc('calendarSettings/hijri');
  await ref.delete();
  await Promise.all([f.recovery.ensureSettings(),ref.set({overrides:[{date:'2027-01-03'}],other:'keep'})]);
  assert.deepEqual((await ref.get()).data(),{overrides:[{date:'2027-01-03'}],other:'keep'});
 }finally{await f.close();}
});

test('an unrelated settings write supersedes old notices even when overrides are unchanged',{skip:!enabled},async()=>{
 let failure=true;
 const f=await fixture({checkpoint:async stage=>{if(stage==='after-page-commit'&&failure){failure=false;throw Error('synthetic crash');}}});
 try{
  await f.recovery.process(f.id);
  await f.db.doc('calendarSettings/hijri').update({other:'changed'});
  const newer=await f.start('same-overrides-new-generation');await f.recovery.process(newer);
  await f.retry();
  assert.equal((await f.db.doc('_hijriRecoveryRuns/'+f.id).get()).data().state,'superseded');
  assert.equal(f.sent.length,0);
  const held=(await f.recovery.status()).held;
  assert.equal(held.length,2);assert.ok(held.every(item=>item.classification==='not-sent'));
  assert.deepEqual((await f.db.doc('events/new').get()).data().conflictWith,['moved']);
 }finally{await f.close();}
});
