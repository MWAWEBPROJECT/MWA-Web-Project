const test=require('node:test');
const assert=require('node:assert/strict');
const V=require('./bookingVerification');

const booking={
 title:'Community event',departmentId:'events',venueId:'hall',
 startAt:'2027-01-02T03:00:00Z',endAt:'2027-01-02T04:00:00Z',
 dateBasis:'g',contactName:' Visitor ',contactEmail:' VISITOR@example.org ',
 contactPhone:'+61 412 345 678',notes:' details '
};

test('canonical booking payload normalizes and bounds only persisted fields',()=>{
 const value=V.canonicalBookingPayload({...booking,ignored:'not persisted'});
 assert.equal(value.contactName,'Visitor');
 assert.equal(value.contactEmail,'visitor@example.org');
 assert.equal(value.contactPhone,'+61 412 345 678');
 assert.equal(value.startAt,'2027-01-02T03:00:00.000Z');
 assert.equal(value.ignored,undefined);
 assert.notEqual(V.payloadDigest(value),V.payloadDigest(V.canonicalBookingPayload({...booking,notes:'changed'})));
 assert.throws(()=>V.canonicalBookingPayload({...booking,title:'x'.repeat(201)}));
 assert.throws(()=>V.canonicalBookingPayload({...booking,endAt:'2027-01-02T02:00:00Z'}));
 assert.throws(()=>V.canonicalBookingPayload({...booking,dateBasis:'h',hijriDate:{day:31,month:1,year:1448}}));
});

test('email and mobile verification use the selected saved contact',()=>{
 assert.equal(V.selectedContact('email',booking),'visitor@example.org');
 assert.equal(V.selectedContact('mobile',booking),'+61412345678');
 assert.equal(V.selectedContact('mobile',V.canonicalBookingPayload({...booking,contactEmail:''})),'+61412345678');
 assert.throws(()=>V.selectedContact('email',V.canonicalBookingPayload({...booking,contactEmail:''})));
 assert.throws(()=>V.selectedContact('sms',booking));
 assert.throws(()=>V.selectedContact('mobile',{...booking,contactPhone:'0412345678'}));
});

test('email codes are unpredictable six-digit values and stored as keyed verifiers',()=>{
 const id=V.newChallengeId(),code=V.newEmailCode(),secret='x'.repeat(40);
 assert.match(id,/^[A-Za-z0-9_-]{40,50}$/);
 assert.match(code,/^\d{6}$/);
 const verifier=V.codeVerifier(secret,id,code);
 assert.notEqual(verifier,code);
 assert.equal(V.equalVerifier(verifier,V.codeVerifier(secret,id,code)),true);
 assert.equal(V.equalVerifier(verifier,V.codeVerifier(secret,id,'000000')),false);
 assert.throws(()=>V.codeVerifier('short',id,code),/not configured/);
});

test('rate-limit identifiers are keyed, scoped and do not expose contact values',()=>{
 const secret='x'.repeat(40);
 const first=V.rateLimitId(secret,'contact',' Visitor@Example.org ');
 assert.match(first,/^[a-f0-9]{64}$/);
 assert.equal(first,V.rateLimitId(secret,'contact','visitor@example.org'));
 assert.notEqual(first,V.rateLimitId('y'.repeat(40),'contact','visitor@example.org'));
 assert.notEqual(first,V.rateLimitId(secret,'ip','visitor@example.org'));
 assert.equal(first.includes('visitor'),false);
 assert.throws(()=>V.rateLimitId('short','contact','visitor@example.org'),/not configured/);
});

test('booking proof requires the same purpose, method, contact, payload, session and unexpired challenge',()=>{
 const secret='x'.repeat(40),payload=V.canonicalBookingPayload(booking),now=1000000;
 const challenge={
  purpose:'public-booking',method:'email',contact:'visitor@example.org',
  payloadDigest:V.payloadDigest(payload),sessionIdHash:'session-hash',expiresAt:now+1000,status:'verified'
 };
 const proof={method:'email',contact:'visitor@example.org',payload,sessionIdHash:'session-hash',now};
 assert.equal(V.isVerifiedChallenge(challenge,proof),true);
 assert.equal(V.isVerifiedChallenge({...challenge,status:'consumed'},proof),false);
 assert.equal(V.isVerifiedChallenge(challenge,{...proof,method:'mobile'}),false);
 assert.equal(V.isVerifiedChallenge(challenge,{...proof,contact:'attacker@example.org'}),false);
 assert.equal(V.isVerifiedChallenge(challenge,{...proof,payload:{...payload,notes:'changed'}}),false);
 assert.equal(V.isVerifiedChallenge(challenge,{...proof,sessionIdHash:'other-session'}),false);
 assert.equal(V.isVerifiedChallenge(challenge,{...proof,now:now+1000}),false);
});

test('lost-response replay is limited to the original session, payload and idempotency lifetime',()=>{
 const payload=V.canonicalBookingPayload(booking),now=1000000;
 const record={
  eventId:'created-event',sessionIdHash:'session-hash',
  payloadDigest:V.payloadDigest(payload),expiresAt:now+1000
 };
 const replay={sessionIdHash:'session-hash',payload,now};
 assert.equal(V.canReplay(record,replay),true);
 assert.equal(V.canReplay(record,{...replay,sessionIdHash:'other-session'}),false);
 assert.equal(V.canReplay(record,{...replay,payload:{...payload,notes:'changed'}}),false);
 assert.equal(V.canReplay(record,{...replay,now:now+1000}),false);
});
