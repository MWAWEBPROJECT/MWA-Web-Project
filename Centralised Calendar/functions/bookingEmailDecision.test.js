const test=require('node:test'),assert=require('node:assert/strict');
const {register}=require('./bookingEmailDecision'),notify=require('./notifications');
const updated='2026-10-30T01:00:00.000Z';
const booking={id:'booking123',title:'Community gathering',status:'pending',venueId:'hall',venueName:'Main Hall',startAt:'2026-11-10T01:00:00Z',endAt:'2026-11-10T03:00:00Z',contactEmail:'requester@example.org',updatedAt:updated};
function setup({conflicts=[],status='pending'}={}){
 const docs=new Map([['events/booking123',{...booking,status}]]),sent=[];let n=0;
 const db={doc:path=>({path}),collection:path=>({doc:()=>({path:path+'/'+(++n)})}),runTransaction:async fn=>{const writes=[];await fn({get:async ref=>({exists:docs.has(ref.path),data:()=>docs.get(ref.path)}),update:(ref,data)=>writes.push(()=>docs.set(ref.path,{...docs.get(ref.path),...data})),set:(ref,data)=>writes.push(()=>docs.set(ref.path,data))});writes.forEach(f=>f())}};
 class HttpsError extends Error{constructor(code,message){super(message);this.code=code}}
 const deps={db,onCall:(opts,fn)=>fn,HttpsError,FieldValue:{serverTimestamp:()=>updated},emailSecrets:[],requireAdmin:async(auth,module)=>{assert.equal(module,'events-bookings');if(!auth?.canBook)throw new HttpsError('permission-denied','No access');return {uid:'admin123',email:'admin@example.org'}},findOverlaps:async(...args)=>{assert.ok(args[4],'conflict lookup must use decision transaction');return conflicts},recomputeVenueConflicts:async()=>{},refreshConflictNeighborhood:async()=>{},sendAll:async messages=>sent.push(...messages),notify,getHijriOverrides:async()=>[],hijriInfoFor:()=>null,dateKeyOf:()=>'',logger:{error:()=>{}}};
 return {...register(deps),docs,sent};
}
const request=decision=>({auth:{canBook:true},data:{eventId:'booking123',decision,expectedUpdatedAt:updated}});
test('no-conflict email has approve/reject; conflict email has no approval link',()=>{
 const clear=notify.submissionAdmin(booking,null,[]);assert.match(clear.html,/decision=approve/);assert.match(clear.html,/decision=reject/);assert.match(clear.html,/refreshed.muhammadiwelfare.org.au/);
 const conflict=notify.submissionAdmin({...booking,hasConflict:true},null,[]);assert.doesNotMatch(conflict.html,/decision=approve/);assert.match(conflict.html,/aria-disabled="true"/);assert.match(conflict.html,/decision=reject/);assert.match(conflict.text,/conflict/);
 assert.doesNotMatch(notify.submissionRequester(booking,null).html,/decision=approve|decision=reject/);
});
test('approval commits once with verified actor audit and normal requester notification',async()=>{
 const e=setup();await e.decideBookingFromEmail(request('approve'));assert.equal(e.docs.get('events/booking123').status,'confirmed');assert.equal(e.sent.length,1);assert.equal(e.sent[0].to,booking.contactEmail);assert.equal(e.sent[0].attachments.length,1);assert.equal(e.docs.get('auditLog/1').userId,'admin123');
 await assert.rejects(()=>e.decideBookingFromEmail(request('approve')),{code:'failed-precondition'});assert.equal(e.sent.length,1);
});
test('current conflicts block approval but never block rejecting a pending request',async()=>{
 const e=setup({conflicts:[{id:'overlap'}]});await assert.rejects(()=>e.decideBookingFromEmail(request('approve')),{code:'failed-precondition'});assert.equal(e.docs.size,1);assert.equal(e.sent.length,0);
 await e.decideBookingFromEmail(request('reject'));assert.equal(e.docs.get('events/booking123').status,'rejected');assert.equal(e.sent.length,1);
});
test('anonymous, unassigned, stale and already-decided requests cannot mutate a booking',async()=>{
 const e=setup();await assert.rejects(()=>e.decideBookingFromEmail({...request('approve'),auth:null}),{code:'permission-denied'});
 await assert.rejects(()=>e.decideBookingFromEmail({...request('approve'),auth:{canBook:false}}),{code:'permission-denied'});
 await assert.rejects(()=>e.decideBookingFromEmail({auth:{canBook:true},data:{...request('approve').data,expectedUpdatedAt:'old'}}),{code:'failed-precondition'});
 await assert.rejects(()=>setup({status:'cancelled'}).decideBookingFromEmail(request('reject')),{code:'failed-precondition'});
 assert.equal(e.docs.get('events/booking123').status,'pending');assert.equal(e.sent.length,0);
});
