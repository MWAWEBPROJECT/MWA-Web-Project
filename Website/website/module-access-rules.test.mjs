import test from 'node:test';import assert from 'node:assert/strict';
import {initializeApp,deleteApp} from 'firebase/app';
import {getFirestore,connectFirestoreEmulator,doc,getDoc,getDocs,collection,setDoc,terminate} from 'firebase/firestore';
const host=process.env.FIRESTORE_EMULATOR_HOST,project='demo-mwa-access';
test('module permissions, expiry, owner protection and direct-write denial',{skip:!host},async()=>{
 const [hostname,port]=host.split(':'),clients=[];
 async function seed(path,fields){const res=await fetch(`http://${host}/v1/projects/${project}/databases/(default)/documents/${path}`,{method:'PATCH',headers:{Authorization:'Bearer owner','Content-Type':'application/json'},body:JSON.stringify({fields})});assert.equal(res.ok,true,await res.text());}
 const str=v=>({stringValue:v}),list=v=>({arrayValue:{values:v.map(str)}});
 function client(uid,email){const app=initializeApp({projectId:project,apiKey:'fake'},uid),db=getFirestore(app);connectFirestoreEmulator(db,hostname,Number(port),{mockUserToken:{sub:uid,user_id:uid,email,email_verified:true,firebase:{sign_in_provider:'google.com'}}});clients.push({app,db});return db;}
 try{
  await seed('events/private',{title:str('Private booking')});await seed('auditLog/private',{note:str('Private audit')});
  for(const [uid,email,modules,expires]of [['events','events@example.org',['events-bookings']],['cms','cms@example.org',['website-cms']],['tools','tools@example.org',['tools-automation']],['expired','expired@example.org',['events-bookings','tools-automation'],new Date(Date.now()-60000).toISOString()],['owner','admin@muhammadiwelfare.org.au',[],new Date(0).toISOString()],['legacy','legacy@example.org',null]]){
   await seed('users/'+uid,{role:str('admin')});await seed('adminAllowlist/'+email,{email:str(email),...(modules?{modules:list(modules)}:{}),...(expires?{accessExpiresAt:{timestampValue:expires}}:{})});
   const db=client(uid,email);
   await getDoc(doc(db,'adminAllowlist/'+email));
   if(['events','owner','legacy'].includes(uid))assert.equal((await getDoc(doc(db,'events/private'))).exists(),true);else await assert.rejects(getDoc(doc(db,'events/private')),/permission/i);
   if(['tools','owner','legacy'].includes(uid)){await getDoc(doc(db,'auditLog/private'));await getDocs(collection(db,'adminAllowlist'));}else{await assert.rejects(getDoc(doc(db,'auditLog/private')),/permission/i);await assert.rejects(getDocs(collection(db,'adminAllowlist')),/permission/i)}
   for(const path of ['adminAllowlist/'+email,'users/'+uid,'events/private','calendarSettings/hijri'])await assert.rejects(setDoc(doc(db,path),{role:'admin',modules:['tools-automation']}),/permission/i);
   for(const path of ['registrationForms/private','registrationForms/private/responses/private','registrationListings/private','_registrationRateLimits/private']){
    await assert.rejects(getDoc(doc(db,path)),/permission/i);
    await assert.rejects(setDoc(doc(db,path),{answers:{name:'forged'}}),/permission/i);
   }
  }
  const revoked=client('revoked','revoked@example.org');await seed('users/revoked',{role:str('admin')});await assert.rejects(getDoc(doc(revoked,'events/private')),/permission/i);
 }finally{for(const {app,db}of clients){await terminate(db);await deleteApp(app)}}
});
