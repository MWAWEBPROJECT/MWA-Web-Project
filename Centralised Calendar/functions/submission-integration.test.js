const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
test('contact-first callable: rejected proofs create nothing; concurrent retries create one booking and durable job',{skip:!process.env.FIRESTORE_EMULATOR_HOST},async()=>{
 delete process.env.FIREBASE_CONFIG;process.env.GCLOUD_PROJECT='demo-mwa-submission';process.env.BOOKING_OTP_HMAC_KEY='synthetic-test-key-not-a-real-secret-123456789';
 const mail=require('./mailer');mail.sendMail=async()=>({sent:true});mail.sendAll=async messages=>messages.filter(Boolean).map(()=>({sent:true}));
 const api=require('./index'),{getFirestore,Timestamp}=require('firebase-admin/firestore'),db=getFirestore(),V=require('./bookingVerification');
 await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-mwa-submission/databases/(default)/documents`,{method:'DELETE'});
 await db.doc('venues/hall').set({name:'Hall',bufferHours:1});await db.doc('departments/events').set({name:require('./bookingTypePolicy.json').publicBookingTypeName});
 const p={title:'Synthetic booking',venueId:'hall',departmentId:'events',contactName:'Fixture',contactEmail:'fixture@example.invalid',startAt:new Date(Date.now()+20*86400000).toISOString(),endAt:new Date(Date.now()+20*86400000+3600000).toISOString()};
 const clashes=()=>api.checkSlotConflicts.run({data:{venueId:p.venueId,startAt:p.startAt,endAt:p.endAt},auth:null});
 const call=(data,auth=null)=>api.submitBooking.run({data,auth,app:{appId:'fixture'},rawRequest:{ip:'fixture'}});
 try{
 assert.deepEqual(await clashes(),{hasConflict:false,count:0});
 await assert.rejects(call(p));assert.equal((await db.collection('events').get()).size,0);
 const sessionId='synthetic-session-123456789';
 const challenge=await api.startBookingVerification.run({data:{method:'email',contactEmail:p.contactEmail,sessionId},app:{appId:'fixture'},rawRequest:{ip:'fixture'}});
 assert.ok(challenge.challengeId);assert.equal((await db.collection('events').get()).size,0);
 const ref=db.doc('_bookingVerificationChallenges/'+challenge.challengeId),saved=(await ref.get()).data();assert.equal(saved.scope,'contact');
 await ref.update({status:'verified',verifiedAt:Timestamp.now()});
 const request={...p,verificationChallengeId:challenge.challengeId,verificationSessionId:sessionId};
 await assert.rejects(call({...request,contactEmail:'someoneelse@example.invalid'}));
 const results=await Promise.all([call(request),call(request)]);assert.equal(results[0].id,results[1].id);
 assert.equal((await db.collection('events').get()).size,1);assert.equal((await db.collection('_bookingSubmissionJobs').get()).size,1);assert.equal((await db.collection('auditLog').get()).size,1);
 await assert.rejects(call({...request,title:'different request'}));
 const overlap=await clashes();assert.equal(overlap.hasConflict,true);assert.equal(overlap.count,1);assert.equal(overlap.overlaps,undefined);
 const publicPage=await api.getPublicEvents.run({data:{from:p.startAt,to:p.endAt},auth:null});assert.equal(publicPage.events.length,1);
 // A signed-in volunteer can submit an Events Booking, never an admin booking type.
 const auth={uid:'volunteer',token:{email:'volunteer@example.invalid',email_verified:true,firebase:{sign_in_provider:'google.com'}}};
 const result=await call({...p,title:'Signed in visitor'},auth);assert.ok(result.id);
 await db.doc('departments/private').set({name:'Maintenance'});
 await assert.rejects(call({...p,departmentId:'private'},auth));
 }finally{await db.terminate();}
});
