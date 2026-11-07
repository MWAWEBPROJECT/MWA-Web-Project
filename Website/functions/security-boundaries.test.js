const test=require('node:test'),assert=require('node:assert/strict');
const {inboundDecision}=require('./enquiries-core');
const {resolveAdmin}=require('./moduleAccess');
test('unverified and mismatched UID cannot borrow a module grant',async()=>{
 const records={'users/a':{role:'admin',email:'member@example.org'},'adminAllowlist/member@example.org':{uid:'a',modules:['enquiries']}};
 const db={doc:p=>({get:async()=>({exists:!!records[p],data:()=>records[p]})})};
 const token={email:'member@example.org',email_verified:false};
 assert.equal(await resolveAdmin(db,'a',token,'enquiries'),null);
 token.email_verified=true;assert.ok(await resolveAdmin(db,'a',token,'enquiries'));
 records['adminAllowlist/member@example.org'].uid='b';assert.equal(await resolveAdmin(db,'a',token,'enquiries'),null);
});
test('email reply identity requires trusted receiver aligned DMARC',()=>{
 const thread={email:'person@example.org',status:'new'};
 const decide=auth=>inboundDecision(thread,{payload:{headers:[{name:'From',value:thread.email},{name:'Authentication-Results',value:auth}]}});
 for(const auth of ['', 'mx.google.com; spf=softfail; dmarc=none','attacker.example; dmarc=pass header.from=example.org','mx.google.com; dmarc=pass header.from=other.org'])assert.equal(decide(auth),'review');
 assert.equal(decide('mx.google.com; dkim=pass; dmarc=pass (p=NONE) header.from=example.org'),'accept');
});
