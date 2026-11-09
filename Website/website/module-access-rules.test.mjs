import test from 'node:test';import assert from 'node:assert/strict';
import {initializeApp,deleteApp} from 'firebase/app';
import {getFirestore,connectFirestoreEmulator,doc,getDoc,getDocs,collection,setDoc,terminate} from 'firebase/firestore';
const host=process.env.FIRESTORE_EMULATOR_HOST,project='demo-mwa-access';
test('module permissions, expiry, owner protection and direct-write denial',{skip:!host},async()=>{
 const [hostname,port]=host.split(':'),clients=[];
 async function seed(path,fields){const res=await fetch(`http://${host}/v1/projects/${project}/databases/(default)/documents/${path}`,{method:'PATCH',headers:{Authorization:'Bearer owner','Content-Type':'application/json'},body:JSON.stringify({fields})});assert.equal(res.ok,true,await res.text());}
 const str=v=>({stringValue:v}),list=v=>({arrayValue:{values:v.map(str)}});
 function client(uid,email,verified=true){const app=initializeApp({projectId:project,apiKey:'fake'},`${uid}-${clients.length}`),db=getFirestore(app);connectFirestoreEmulator(db,hostname,Number(port),{mockUserToken:{sub:uid,user_id:uid,email,email_verified:verified,firebase:{sign_in_provider:'google.com'}}});clients.push({app,db});return db;}
 try{
  await seed('events/private',{title:str('Private booking')});await seed('auditLog/private',{note:str('Private audit')});
  for(const [uid,email,modules,expires]of [['events','events@example.org',['events-bookings']],['cms','cms@example.org',['website-cms']],['tools','tools@example.org',['tools-automation']],['expired','expired@example.org',['events-bookings','tools-automation'],new Date(Date.now()-60000).toISOString()],['owner','admin@muhammadiwelfare.org.au',[],new Date(0).toISOString()],['legacy','legacy@example.org',null]]){
   await seed('users/'+uid,{role:str('admin'),email:str(email)});await seed('adminAllowlist/'+email,{email:str(email),uid:str(uid),...(modules?{modules:list(modules)}:{}),...(expires?{accessExpiresAt:{timestampValue:expires}}:{})});
   const db=client(uid,email);
   await getDoc(doc(db,'adminAllowlist/'+email));
   if(['events','owner','legacy'].includes(uid))assert.equal((await getDoc(doc(db,'events/private'))).exists(),true);else await assert.rejects(getDoc(doc(db,'events/private')),/permission/i);
   if(['tools','owner','legacy'].includes(uid)){await getDoc(doc(db,'auditLog/private'));await getDocs(collection(db,'adminAllowlist'));}else{await assert.rejects(getDoc(doc(db,'auditLog/private')),/permission/i);await assert.rejects(getDocs(collection(db,'adminAllowlist')),/permission/i)}
   for(const path of ['adminAllowlist/'+email,'users/'+uid,'events/private','calendarSettings/hijri'])await assert.rejects(setDoc(doc(db,path),{role:'admin',modules:['tools-automation']}),/permission/i);
   for(const path of ['registrationForms/private','registrationForms/private/responses/private','registrationListings/private','_registrationRateLimits/private','_responseViewers/private','_bookingProofs/private','_bookingChallenges/private','_bookingSubmissionJobs/private','_registrationInsights/private']){
    await assert.rejects(getDoc(doc(db,path)),/permission/i);
    await assert.rejects(setDoc(doc(db,path),{answers:{name:'forged'}}),/permission/i);
   }
   for(const name of ['niazSponsors','niazSponsorships','niazEOIs','niazProgrammeSeries','niazEventCoverage','niazNotificationLog','_niazPrivate','_niazOutbox','_niazServiceNotices','_niazImports','_niazContacts','_niazLimits','_niazSandboxLedger','_niazSandboxAssociations']){
    await assert.rejects(getDoc(doc(db,name+'/private')),/permission/i);
    await assert.rejects(setDoc(doc(db,name+'/private'),{status:'approved',confirmedCents:100000}),/permission/i);
   }
  }
  await seed('users/unverified',{role:str('admin'),email:str('unverified@example.org')});await seed('adminAllowlist/unverified@example.org',{uid:str('unverified'),modules:list(['events-bookings'])});await assert.rejects(getDoc(doc(client('unverified','unverified@example.org',false),'events/private')),/permission/i);assert.equal((await getDoc(doc(client('unverified','unverified@example.org',true),'events/private'))).exists(),true);
  await seed('users/wrong-uid',{role:str('admin'),email:str('bound@example.org')});await seed('users/correct-uid',{role:str('admin'),email:str('bound@example.org')});await seed('adminAllowlist/bound@example.org',{uid:str('correct-uid'),modules:list(['events-bookings'])});await assert.rejects(getDoc(doc(client('wrong-uid','bound@example.org'),'events/private')),/permission/i);assert.equal((await getDoc(doc(client('correct-uid','bound@example.org'),'events/private'))).exists(),true);
  const revoked=client('revoked','revoked@example.org');await seed('users/revoked',{role:str('admin'),email:str('revoked@example.org')});await assert.rejects(getDoc(doc(revoked,'events/private')),/permission/i);
 }finally{for(const {app,db}of clients){await terminate(db);await deleteApp(app)}}
});
