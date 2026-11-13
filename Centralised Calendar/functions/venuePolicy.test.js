const test=require('node:test'),assert=require('node:assert/strict');
const P=require('./venuePolicy'),{computeAllConflicts}=require('./conflictUtils'),{venueAvailability}=require('./venueAvailability');
const venues=['Entire MWA Precinct','Main Hall','Hall 2','Hall 3','Hall 4','Hall 5','Hall 6','Shed'].map((name,id)=>({id:String(id),name,bufferHours:1}));
const event=(venueId,audience='family',id=venueId)=>({id,venueId,audience,status:'confirmed',startAt:'2026-12-01T01:00:00Z',endAt:'2026-12-01T02:00:00Z'});
const reason=(a,b)=>P.venueConflictReason(a,b,venues[+a.venueId],venues[+b.venueId]);
test('EC matrix and all four audience choices are symmetric across every hall',async()=>{
 const client=await import('../src/utils/venuePolicy.js');
 for(const va of venues)for(const vb of venues)for(const aa of ['family','gents','ladies','kids'])for(const ba of ['family','gents','ladies','kids']){
 const a=event(va.id,aa),b=event(vb.id,ba);assert.equal(reason(a,b),reason(b,a));assert.equal(reason(a,b),client.venueConflictReason(a,b,va,vb));
 }
 for(const v of venues)assert(reason(event('0'),event(v.id)));
 for(const id of ['2','3','4','5','6'])assert(reason(event('1','ladies'),event(id,'ladies')));
 assert.equal(reason(event('1','ladies'),event('7')), '');
 for(const aa of ['family','gents','kids'])for(const lower of ['1','2','3'])for(const target of ['2','3'])assert(reason(event(lower,'ladies'),event(target,aa)));
 assert.equal(reason(event('2','ladies'),event('3','ladies')),'');
 assert.equal(reason(event('1'),event('2')),'');
 for(const downstairs of ['1','2','3'])for(const upper of ['4','5','6'])assert.equal(reason(event(downstairs),event(upper,'ladies')),'');
 for(const upper of ['4','5','6']){assert.equal(P.audienceError(venues[+upper],'ladies'),'');for(const aa of ['family','gents','kids'])assert(P.audienceError(venues[+upper],aa));}
});
test('time and buffer rules preserve non-overlapping availability and ignore cancelled records',async()=>{
 const a=event('2','ladies','a'),b={...event('3','kids','b'),startAt:'2026-12-01T02:30:00Z',endAt:'2026-12-01T04:00:00Z'};
 assert.deepEqual(computeAllConflicts([a,b],venues).get('a'),['b']);
 const client=await import('../src/utils/conflictUtils.js');assert.deepEqual(client.computeAllConflicts([a,b],venues),computeAllConflicts([a,b],venues));
 assert.deepEqual(computeAllConflicts([a,{...b,startAt:'2026-12-01T03:00:00Z'}],venues).get('a'),[]);
 assert.deepEqual(computeAllConflicts([a,{...b,status:'cancelled'}],venues).get('a'),[]);
});
test('availability exposes only restriction periods, honours audience and does not rely on calendar filters',()=>{
 const events=[{...event('2','ladies'),_buf:1,title:'Private title',contactName:'Private person',notes:'secret'}];
 const range={from:'2026-12-01T00:00:00Z',to:'2026-12-02T00:00:00Z'};
 const family=venueAvailability(venues,events,'family',range),ladies=venueAvailability(venues,events,'ladies',range);
 assert.equal(family.find(v=>v.venueId==='3').busy.length,1);assert.equal(ladies.find(v=>v.venueId==='3').busy.length,0);
 assert(family.find(v=>v.venueId==='4').restriction);assert.equal(ladies.find(v=>v.venueId==='4').restriction,'');
 assert.equal(family.find(v=>v.venueId==='3').busy[0].end,'2026-12-01T03:00:00.000Z');
 assert.doesNotMatch(JSON.stringify(family),/Private|secret|contactName|title|eventId/);
});
