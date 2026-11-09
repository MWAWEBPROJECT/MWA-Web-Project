const {test}=require('node:test');
const assert=require('node:assert/strict');
const M=require('./niaz-model');
test('Sponsor contact matching normalises email and requires explicit consent',()=>{
 const value=M.sponsor({name:'Synthetic',email:'Demo@EXAMPLE.org',publicConsent:false});
 assert.equal(value.email,'demo@example.org');assert.equal(M.sponsorKey(value),M.sponsorKey({...value,name:'Updated'}));
 assert.throws(()=>M.sponsor({...value,publicConsent:undefined}),/consent|displayed/);
 assert.throws(()=>M.sponsor({...value,memberId:'123'}),/unavailable/);
});
test('Permanent commitments require a stable series ID',()=>{
 assert.throws(()=>M.assignment({type:'permanent'}),/stable/);
 assert.equal(M.assignment({type:'permanent',seriesId:'series-1'}).seriesId,'series-1');
 assert.notEqual(M.assignmentKey('s','e','coordinator'),M.assignmentKey('s','e','eoi'));
});
test('Public projection excludes proposals and private details; consent is current',()=>{
 const sponsor={name:'Synthetic',email:'private@example.org',active:true,publicConsent:false};
 assert.deepEqual(M.publicSponsor(sponsor,{status:'approved',type:'annual',role:'joint'}),{name:'Private sponsor',type:'annual',role:'joint'});
 assert.equal(M.publicSponsor(sponsor,{status:'proposed'}),null);
 assert.equal(M.publicSponsor({...sponsor,active:false},{status:'approved'}),null);
 assert.equal(M.publicSponsor({...sponsor,publicConsent:true},{status:'approved'}).name,'Synthetic');
});
test('Operational and finance badges stay separate and compatible',()=>{
 assert.deepEqual(M.badges([{status:'approved'},{status:'approved'}],{confirmedCents:300,targetCents:1000,mwaArranged:true,arrangementConfirmed:true,pendingEOIs:1}),['Jointly sponsored','EOI pending','Partially funded','MWA arranged','Arrangement confirmed']);
 assert.ok(!M.badges([],{confirmedCents:500}).includes('Fully funded'));
});
test('Sandbox projection never counts pending/setup/general donations; reversed net cannot be negative',()=>{
 const d={fund:'Niaz Contribution',niaz:{scope:'event',eventId:'event1'},amount:10000,status:'paid'};
 assert.equal(M.donationEntry({...d,status:'pending'},'transaction1').netCents,0);
 assert.equal(M.donationEntry(d,'transaction1').netCents,10000);
 assert.equal(M.donationEntry({...d,refundedCents:2500},'transaction1').netCents,7500);
 assert.equal(M.donationEntry({...d,niaz:{scope:'general'}},'transaction1'),null);
 assert.equal(M.donationEntry({...d,donationMode:'recurring_only'},'transaction1'),null);
 assert.throws(()=>M.donationEntry({...d,refundedCents:20000},'transaction1'),/exceeds/);
});
test('Sydney reminder civil days remain correct across DST and cancellation',()=>{
 const now=new Date('2026-10-03T23:30:00Z');
 const event={status:'confirmed',startAt:'2026-10-10T22:00:00Z'};
 assert.deepEqual(M.dueNotices(event,now),['seven-day']);
 assert.deepEqual(M.dueNotices({...event,status:'cancelled'},now),[]);
});
