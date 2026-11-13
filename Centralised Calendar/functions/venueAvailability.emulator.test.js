const test=require('node:test'),assert=require('node:assert/strict');
test('real callable enforces venue audience and masked availability from bounded Firestore reads',{skip:!process.env.FIRESTORE_EMULATOR_HOST},async()=>{
 delete process.env.FIREBASE_CONFIG;process.env.GCLOUD_PROJECT='demo-mwa-venue-policy';
 const {getFirestore}=require('firebase-admin/firestore');const F=require('./index');const db=getFirestore();
 await db.doc('venues/main').set({name:'Main Hall',bufferHours:0});await db.doc('venues/h2').set({name:'Hall 2',bufferHours:0});await db.doc('venues/h4').set({name:'Hall 4',bufferHours:0});await db.doc('venues/shed').set({name:'Shed',bufferHours:0});
 await db.doc('events/ladies').set({venueId:'main',audience:'ladies',title:'secret title',contactEmail:'secret@example.invalid',status:'confirmed',visibility:'private',startAt:'2026-12-06T00:00:00.000Z',endAt:'2026-12-06T02:00:00.000Z'});
 const range={startAt:'2026-12-06T01:00:00.000Z',endAt:'2026-12-06T01:30:00.000Z'};
 const r=await F.checkSlotConflicts.run({data:{venueId:'h2',audience:'kids',...range}});assert.equal(r.hasConflict,true);assert.deepEqual(Object.keys(r).sort(),['count','hasConflict']);
 await assert.rejects(F.checkSlotConflicts.run({data:{venueId:'h4',audience:'gents',...range}}),/Ladies only/);
 assert.equal((await F.checkSlotConflicts.run({data:{venueId:'shed',audience:'family',...range}})).hasConflict,false);
 const day=await F.getVenueAvailability.run({data:{date:'2026-12-06',audience:'ladies'}});assert.equal(day.venues.find(v=>v.venueId==='h4').busy.length,1);assert.doesNotMatch(JSON.stringify(day),/secret|contactEmail/);
 await assert.rejects(F.getVenueAvailability.run({data:{date:'bad',audience:'family'}}));
});
