const test=require('node:test'),assert=require('node:assert/strict');
const C=require('./enquiries-core');
test('public form validates input, honeypot and idempotency key',()=>{
 const input={name:'Visitor',email:'VISITOR@example.com',message:'A community enquiry',topic:'Membership',requestId:'0123456789abcdef'};
 assert.equal(C.submission(input).email,'visitor@example.com');
 for(const patch of [{email:'bad\r\nBcc: someone@example.com'},{message:'Hi'},{requestId:'short'},{website:'bot'}])assert.throws(()=>C.submission({...input,...patch}),e=>e.status===400);
});
test('incoming mail suppresses loops and flags mismatched/failed-auth senders',()=>{
 const thread={email:'visitor@example.com',status:'resolved'};
 const aligned={name:'Authentication-Results',value:'mx.google.com; spf=pass smtp.mailfrom=example.com; dkim=pass header.i=@example.com; dmarc=pass header.from=example.com'};
 const msg=(from,headers=[aligned],labelIds=[])=>({labelIds,payload:{headers:[{name:'From',value:from},...headers]}});
 assert.equal(C.inboundDecision(thread,msg('Visitor <visitor@example.com>')),'accept');
 assert.equal(C.inboundDecision({...thread,status:'spam'},msg(thread.email)),'suppressed');
 assert.equal(C.inboundDecision(thread,msg('other@example.com')),'review');
 assert.equal(C.inboundDecision(thread,msg(thread.email,[{name:'Authentication-Results',value:'mx.google.com; dmarc=fail'}])),'review');
 assert.equal(C.inboundDecision(thread,msg(thread.email,[])),'review');
 assert.equal(C.inboundDecision(thread,msg(thread.email,[{name:'Authentication-Results',value:'mx.google.com; dmarc=neutral header.from=example.com'}])),'review');
 assert.equal(C.inboundDecision(thread,msg(thread.email,[{name:'Authentication-Results',value:'attacker.example; dmarc=pass header.from=example.com'}])),'review');
 assert.equal(C.inboundDecision(thread,msg(thread.email,[{name:'Authentication-Results',value:'mx.google.com; dmarc=pass header.from=attacker.example'}])),'review');
 assert.equal(C.inboundDecision(thread,msg(thread.email,[aligned,{name:'Authentication-Results',value:'mx.google.com; dmarc=pass header.from=example.com'}])),'review');
 assert.equal(C.inboundDecision(thread,msg(C.OWNER)),'ignore');
 assert.equal(C.inboundDecision(thread,msg(thread.email,[{name:'Auto-Submitted',value:'auto-replied'}])),'ignore');
 assert.equal(C.inboundDecision(thread,msg(thread.email,[],['SENT'])),'ignore');
});
test('MIME retains original text, strips quotes and lists attachments',()=>{
 const text='Thank you\n\nOn Tuesday MWA wrote:\n> Earlier response';
 const value=C.mailText({parts:[{mimeType:'text/plain',body:{data:Buffer.from(text).toString('base64url')}},{filename:'photo.jpg',mimeType:'image/jpeg'}]});
 assert.equal(value.body,'Thank you');assert.equal(value.originalText,text);assert.deepEqual(value.attachments,['photo.jpg']);
});
test('notification emails include an authenticated dashboard button and safe MIME',()=>{
 const id='a'.repeat(32),job=C.notifyJob({reference:'MWA-123',name:'<visitor>',email:'visitor@example.com',topic:'General enquiry'},id,'New enquiry');
 const raw=Buffer.from(C.rawEmail({...job,messageId:C.rfcId('test')}),'base64url').toString();
 assert.match(raw,/multipart\/alternative/);assert.match(raw,/Reply-To: admin@muhammadiwelfare.org.au/);
 const decoded=raw.split('Content-Transfer-Encoding: base64\r\n\r\n').slice(1).map(part=>Buffer.from(part.split('\r\n--')[0],'base64').toString()).join('\n');
 assert.match(decoded,/Open enquiry &amp; respond/);assert.match(decoded,/&lt;visitor&gt;/);assert.match(decoded,new RegExp('/enquiries/\\?thread='+id));
});
test('server workflow transactions and mail reconciliation', {skip:!process.env.FIRESTORE_EMULATOR_HOST},async()=>{
 const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');
 const A=require('./enquiries-api'),G=require('./enquiries-gmail');
 const app=initializeApp({projectId:'demo-mwa-enquiries'},'enquiry-tests'),db=getFirestore(app);
 await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-mwa-enquiries/databases/(default)/documents`,{method:'DELETE'});
 const visitor={name:'Test visitor',email:'visitor@example.com',message:'Please share membership information.',topic:'Membership',requestId:'idempotency-test-1234'};
 const actor={email_verified:true,uid:'team-admin',email:'team@example.com',name:'Team Admin',firebase:{sign_in_provider:'google.com'}};
 const input={...visitor};const id=C.hash('submission:'+visitor.requestId).slice(0,32),ref=db.doc('enquiries/'+id);
 const originalFetch=global.fetch;
 try{
  const result=await A.submit(db,input,'test-ip');assert.match(result.reference,/^MWA-/);
  await A.submit(db,input,'test-ip');assert.equal((await ref.collection('messages').get()).size,1);assert.equal((await db.collection('enquiryOutbox').get()).size,1);
  await assert.rejects(A.submit(db,{...input,message:'Different content'},'test-ip'),e=>e.status===409);
  for(let n=0;n<4;n++)await A.submit(db,{...input,requestId:'rate-test-key-000'+n},'test-ip');
  await assert.rejects(A.submit(db,{...input,requestId:'rate-test-key-9999'},'test-ip'),e=>e.status===429);
  const req={get:()=> 'Bearer valid'},auth=()=>({verifyIdToken:async()=>actor});
  await assert.rejects(A.adminFor(req,db,auth),e=>e.status===403);
  await db.doc('users/'+actor.uid).set({role:'admin',email:actor.email});await assert.rejects(A.adminFor(req,db,auth),e=>e.status===403);
  await db.doc('adminAllowlist/'+actor.email).set({uid:actor.uid});assert.equal((await A.adminFor(req,db,auth)).uid,actor.uid);
  await db.doc('calendarSettings/auth').set({passwordLoginDisabled:true});
  await assert.rejects(A.adminFor(req,db,()=>({verifyIdToken:async()=>({...actor,firebase:{sign_in_provider:'password'}})})),e=>e.status===403);
  const reply={body:'Thank you for contacting MWA.',kind:'reply',version:1,requestId:'reply-idempotency-1234'};
  const saved=await A.sendMessage(db,id,reply,actor);await A.sendMessage(db,id,reply,actor);assert.equal((await ref.collection('messages').get()).size,2);
  await assert.rejects(A.sendMessage(db,id,{...reply,requestId:'other-reply-key-1234'},actor),e=>e.status===409);
  const job=await db.doc('enquiryOutbox/reply_'+id+'_'+saved.messageId).get();let sends=0;
  global.fetch=async(url,options)=>{const address=String(url);let data;if(address.includes('/messages?'))data={messages:[]};else if(address.endsWith('/messages/send')){sends++;data={id:'sent1',threadId:'gmailThread1'}}else if(address.includes('/threads/'))data={messages:[]};else throw Error('Unexpected mock request '+address);return {ok:true,json:async()=>data};};
  await G.deliver(db,'fake-token',job);assert.equal(sends,1);assert.equal((await job.ref.get()).data().status,'sent');assert.equal((await ref.get()).data().pendingReplyId,null);
  await G.deliver(db,'fake-token',job);assert.equal(sends,1);
  let thread=(await ref.get()).data();await A.updateThread(db,id,{action:'status',status:'resolved',version:thread.version},actor);
  const inbound={id:'incoming1',threadId:'gmailThread1',internalDate:String(Date.now()),payload:{mimeType:'text/plain',headers:[{name:'From',value:visitor.email},{name:'Authentication-Results',value:'mx.google.com; dmarc=pass header.from=example.com'}],body:{data:Buffer.from('Thank you. One more question.').toString('base64url')}}};
  await G.importMessage(db,inbound);await G.importMessage(db,inbound);thread=(await ref.get()).data();assert.equal(thread.status,'new');assert.equal((await ref.collection('messages').get()).size,3);assert.equal((await db.doc('enquiryOutbox/incoming_incoming1').get()).exists,true);
  await A.updateThread(db,id,{action:'status',status:'spam',version:thread.version},actor);
  await G.importMessage(db,{...inbound,id:'incoming2'});assert.equal((await db.doc('enquiryOutbox/incoming_incoming2').get()).exists,false);assert.equal((await ref.get()).data().status,'spam');
  await assert.rejects(A.sendMessage(db,id,{...reply,version:(await ref.get()).data().version,requestId:'spam-reply-key-1234'},actor),e=>e.status===409);
  await G.importMessage(db,{...inbound,id:'incoming3',payload:{...inbound.payload,headers:[{name:'From',value:'stranger@example.com'}]}});assert.equal((await ref.collection('messages').doc('gmail_incoming3').get()).data().kind,'review');
  const audits=await db.collection('auditLog').where('module','==','enquiries').get();assert.ok(audits.size>=10);assert.ok(audits.docs.some(d=>d.data().userId===actor.uid));
  // Sending may have succeeded before the worker died: reconcile by Message-ID,
  // without sending another copy, then finish the durable queue record.
  thread=(await ref.get()).data();await A.updateThread(db,id,{action:'status',status:'in_progress',version:thread.version},actor);
  const second=await A.sendMessage(db,id,{...reply,version:(await ref.get()).data().version,requestId:'reconcile-reply-1234'},actor);
  global.fetch=async url=>({ok:true,json:async()=>String(url).includes('/messages?')?{messages:[{id:'sent-before-crash',threadId:'gmailThread1'}]}:{messages:[]}});
  await G.deliver(db,'fake-token',await db.doc('enquiryOutbox/reply_'+id+'_'+second.messageId).get());assert.equal((await ref.collection('messages').doc(second.messageId).get()).data().delivery,'sent');
 }finally{global.fetch=originalFetch;await deleteApp(app)}
});
