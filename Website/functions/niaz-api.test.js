const {test}=require('node:test');
const assert=require('node:assert/strict');
const M=require('./niaz-model'),A=require('./niaz-api'),L=require('./niaz-lifecycle');
function database(seed={}){
 const store=new Map(Object.entries(seed)),clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));let writes=0;
 function ref(path){
  const id=path.split('/').at(-1);
  return {path,id,get:async()=>snapshot(path),create:async value=>{if(store.has(path))throw Error('already exists');store.set(path,clone(value));},set:async(value,opts)=>{store.set(path,opts?.merge?{...store.get(path),...clone(value)}:clone(value));},update:async value=>{store.set(path,{...store.get(path),...clone(value)});}};
 }
 function snapshot(path){return {id:path.split('/').at(-1),ref:ref(path),exists:store.has(path),data:()=>clone(store.get(path))};}
 function matches(v,op,value){return op==='=='?v===value:op==='>='?v>=value:op==='<='?v<=value:op==='<'?v<value:op==='>'?v>value:op==='in'?value.includes(v):op==='array-contains'?Array.isArray(v)&&v.includes(value):false;}
 function query(collection,filters=[],order='__name__',after='',limit=Infinity){
  const q={doc:(id)=>ref(collection+'/'+(id||'audit-'+(++writes))),where:(...filter)=>query(collection,[...filters,filter],order,after,limit),orderBy:key=>query(collection,filters,key,after,limit),startAfter:value=>query(collection,filters,order,value,limit),limit:value=>query(collection,filters,order,after,value),get:async()=>{
   const docs=[...store.keys()].filter(path=>path.startsWith(collection+'/')&&path.split('/').length===collection.split('/').length+1).map(snapshot).filter(doc=>filters.every(([key,op,value])=>matches(doc.data()[key],op,value))).sort((a,b)=>String(order==='__name__'?a.id:a.data()[order]).localeCompare(String(order==='__name__'?b.id:b.data()[order]))).filter(doc=>!after||(order==='__name__'?doc.id:doc.data()[order])>after).slice(0,limit);
   return {docs,size:docs.length,empty:!docs.length};
  }};return q;
 }
 return {store,getAll:async(...refs)=>Promise.all(refs.map(ref=>ref.get())),doc:ref,collection:name=>query(name),runTransaction:async fn=>{
  const pending=[];let wrote=false;
  const tx={getAll:async(...refs)=>{assert.equal(wrote,false,'Firestore forbids transaction reads after writes');return Promise.all(refs.map(ref=>ref.get()));},get:async object=>{assert.equal(wrote,false,'Firestore forbids transaction reads after writes');return object.get();},set:(r,v,o)=>{wrote=true;pending.push(()=>r.set(v,o));},create:(r,v)=>{wrote=true;pending.push(()=>r.create(v));},update:(r,v)=>{wrote=true;pending.push(()=>r.update(v));},delete:r=>{wrote=true;pending.push(()=>store.delete(r.path));}};
  const result=await fn(tx);for(const action of pending)await action();return result;
 }};
}
const actor={uid:'synthetic-admin',email:'synthetic@example.org'};
const event={title:'Synthetic programme',status:'confirmed',visibility:'public',departmentName:'MWA Programs',startAt:'2027-01-11T08:00:00.000Z',endAt:'2027-01-11T10:00:00.000Z',seriesId:'series1'};
const person={uid:null,email:'demo@example.org',phone:'',ownerKey:'verified-contact-1'};
test('Directory revisions, contact duplicates and sole conflicts cannot silently overwrite',async()=>{
 const db=database({'events/event1':event,'events/event2':event});
 const s=await A.saveSponsor(db,{name:'Demo',email:'demo@example.org',publicConsent:false,revision:0},actor);
 await assert.rejects(A.saveSponsor(db,{...s,name:'Stale',revision:0},actor),/changed/);
 await A.assign(db,{sponsorId:s.id,eventId:'event1',type:'one_time',role:'sole',revision:0},actor);
 await A.assign(db,{sponsorId:s.id,eventId:'event2',type:'permanent',seriesId:'series1',role:'joint',revision:0},actor);
 assert.equal((await db.collection('niazSponsorships').where('sponsorId','==',s.id).get()).size,2);
 const other=await A.saveSponsor(db,{name:'Other',email:'other@example.org',publicConsent:false,revision:0},actor);
 await assert.rejects(A.assign(db,{sponsorId:other.id,eventId:'event1',type:'annual',role:'sole',revision:0},actor),/already/);
 await A.assign(db,{sponsorId:other.id,eventId:'event1',type:'annual',role:'joint',revision:0},actor);
 const view=await A.eventDetail(db,'event1',{publicOnly:true});assert.equal(view.sponsors.length,2);assert.ok(!JSON.stringify(view).includes('@'));
});
test('Multi-event EOI requires intake on sponsored events; decisions independent and no displacement',async()=>{
 const db=database({'events/event1':event,'events/event2':event});
 const old=await A.saveSponsor(db,{name:'Original',email:'old@example.org',publicConsent:false,revision:0},actor);
 const assignment=await A.assign(db,{sponsorId:old.id,eventId:'event1',type:'annual',revision:0},actor);
 const input={name:'Demo',eventIds:['event1','event2'],type:'annual',intent:'joint',requestId:'request-1',publicConsent:false};
 await assert.rejects(A.submitEOI(db,input,person),/additional/);
 await A.saveCoverage(db,'event1',{revision:0,mwaArranged:false,arrangementConfirmed:false,acceptExtraEOIs:true},actor,false);
 const eoi=await A.submitEOI(db,input,person);assert.equal(eoi.events.length,2);
 await A.decideEOI(db,eoi.id,{revision:1,eventId:'event1',decision:'approved',reason:'Joint offer'},actor);
 const saved=db.store.get('niazEOIs/'+eoi.id);assert.equal(saved.events[1].status,'pending');assert.equal(db.store.get('niazSponsorships/'+assignment.id).status,'approved');
 await A.decideEOI(db,eoi.id,{revision:2,eventId:'event2',decision:'rejected',reason:'Other arrangement'},actor);
 assert.equal(db.store.get('niazEOIs/'+eoi.id).status,'reviewed');
});
test('Dry-run 251 rows detects repeat, errors and ambiguity; resumable import never creates duplicates',async()=>{
 const db=database({'events/event1':event});
 const rows=Array.from({length:251},(_,index)=>({name:'Synthetic '+index,email:'row'+index+'@example.org',eventDate:'2027-01-11',eventId:'event1',type:index%3===0?'permanent':index%3===1?'annual':'one_time',seriesId:'series1',publicConsent:'false'}));
 rows.push({...rows[0]},{...rows[0],memberId:'arbitrary-member'});
 const preview=await A.previewImport(db,rows,actor);
 assert.equal(preview.rows.filter(row=>row.duplicate).length,1);assert.equal(preview.rows.filter(row=>row.error).length,1);assert.equal([...db.store.keys()].filter(key=>key.startsWith('niazSponsors/')).length,0);
 let progress={offset:0};while(progress.state!=='complete')progress=await A.importStep(db,preview.jobId,progress.offset,actor);
 assert.equal([...db.store.keys()].filter(key=>key.startsWith('niazSponsors/')).length,251);
 assert.equal([...db.store.keys()].filter(key=>key.startsWith('niazSponsorships/')).length,251);
 const second=await A.previewImport(db,rows.slice(0,251),actor);assert.equal(second.rows.every(row=>row.duplicate),true);
});
test('Permanent rollover is proposed only; paused series cannot renew',async()=>{
 const db=database({'events/event1':event,'niazSponsors/sponsor1':{name:'Demo',active:true,publicConsent:true}});
 const programme=await L.saveProgramme(db,{seriesId:'series1',sponsorId:'sponsor1',status:'active',reason:'Annual review required',revision:0},actor);
 assert.equal((await L.proposeYear(db,{id:programme.id,year:2027},actor)).proposed,1);
 const proposed=[...db.store.entries()].find(([key])=>key.startsWith('niazSponsorships/'))[1];assert.equal(proposed.status,'proposed');
 assert.deepEqual((await A.eventDetail(db,'event1',{publicOnly:true})).sponsors,[]);
 assert.equal((await L.proposeYear(db,{id:programme.id,year:2027},actor)).proposed,0);
});
test('Sandbox ledger idempotency/repeated contributions/reversal stays isolated from live coverage',async()=>{
 const db=database({'events/event1':event});
 const d={fund:'Niaz Contribution',niaz:{scope:'event',eventId:'event1'},email:'demo@example.org',amount:10000,status:'paid'};
 db.store.set('_stripeSandboxDonations/txn1',{...d,status:'pending'});
 assert.equal((await L.projectSandboxDonation(db,'txn1',{...d,status:'pending'})).ignored,true);
 db.store.set('_stripeSandboxDonations/txn1',d);
 await L.projectSandboxDonation(db,'txn1',d);assert.equal((await L.projectSandboxDonation(db,'txn1',d)).replayed,true);
 db.store.set('_stripeSandboxDonations/txn2',{...d,amount:5000});await L.projectSandboxDonation(db,'txn2',{...d,amount:5000});
 const association=[...db.store.entries()].find(([key])=>key.startsWith('_niazSandboxAssociations/'))[1];assert.equal(association.netCents,15000);
 db.store.set('_stripeSandboxDonations/txn1',{...d,refundedCents:10000});await L.projectSandboxDonation(db,'txn1',{...d,refundedCents:10000});
 assert.equal([...db.store.entries()].find(([key])=>key.startsWith('_niazSandboxAssociations/'))[1].netCents,5000);
 assert.equal([...db.store.keys()].some(key=>key.startsWith('niazSponsorships/')||key.startsWith('niazEventCoverage/')),false);
 assert.equal((await L.projectSandboxDonation(db,'general',{...d,niaz:{scope:'general'}})).ignored,true);
});
test('Finance TEST sponsor preview groups verified payments and joint supporters without changing actual sponsorship',async()=>{
 const db=database({'events/event1':event,'niazSponsors/actual':{name:'Actual private sponsor',active:true,publicConsent:false},'niazSponsorships/actual':{sponsorId:'actual',eventId:'event1',status:'approved',role:'joint'}});
 const donation={name:'Synthetic TEST donor',email:'test@example.org',mobile:'+61412345678',fund:'Niaz Contribution',niaz:{scope:'event',eventId:'event1'},amount:10000,status:'paid'};
 for(const [id,record] of [['test1',donation],['test2',{...donation,amount:5000,refundedCents:1000}],['test3',{...donation,name:'Second TEST donor',email:'second@example.org'}]]){
  db.store.set('_stripeSandboxDonations/'+id,record);await L.projectSandboxDonation(db,id,record);
 }
 const before=JSON.stringify([...db.store]),originalGetAll=db.getAll;let batches=0;
 db.getAll=async(...refs)=>{batches++;return originalGetAll(...refs);};
 const detail=await A.eventDetail(db,'event1',{finance:true}),preview=detail.sandboxSponsorPreview;
 assert.equal(preview.sandbox,true);assert.equal(preview.unavailable,0);assert.equal(preview.items.length,2);
 const first=preview.items.find(row=>row.name===donation.name);
 assert.equal(first.netCents,14000);assert.deepEqual(first.references,['MWA-TEST1','MWA-TEST2']);assert.equal(first.role,'joint');assert.equal(first.status,'confirmed-test');
 assert.equal(batches,1);assert.equal(JSON.stringify([...db.store]),before,'Preview reads must not write or claim sponsorship');
 assert.equal(detail.assignments.length,1);assert.equal(detail.assignments[0].sponsor.name,'Actual private sponsor');
 assert.equal(detail.coverage.confirmedCents,undefined);assert.equal(db.store.has('niazEventCoverage/event1'),false);
 assert.ok(!JSON.stringify(preview).includes('@'));assert.ok(!JSON.stringify(preview).includes(donation.mobile));
 const publicDetail=await A.eventDetail(db,'event1',{publicOnly:true,finance:true});
 assert.deepEqual(publicDetail.sponsors.map(row=>row.name),['Private sponsor']);assert.equal(publicDetail.sandboxSponsorPreview,undefined);assert.equal(publicDetail.sandboxContributions,undefined);
 const reader=await A.eventDetail(db,'event1');assert.equal(reader.sandboxSponsorPreview,undefined);assert.equal(reader.sandboxContributions,undefined);
 assert.equal(batches,1,'Non-finance/public readers never fetch private donation sources');
});
test('TEST sponsor preview excludes full refunds and waits for matching source/ledger reconciliation',async()=>{
 const db=database({'events/event1':event});
 const donation={name:'Synthetic TEST donor',email:'test@example.org',fund:'Niaz Contribution',niaz:{scope:'event',eventId:'event1'},amount:10000,status:'paid'};
 db.store.set('_stripeSandboxDonations/test1',donation);await L.projectSandboxDonation(db,'test1',donation);
 const preview=async()=>(await A.eventDetail(db,'event1',{finance:true})).sandboxSponsorPreview;
 assert.equal((await A.eventDetail(db,'event1',{publicOnly:true})).sponsors.length,0);
 const eoi=await A.submitEOI(db,{name:'Additional supporter',eventIds:['event1'],type:'one_time',intent:'joint',requestId:'test-preview-intake',publicConsent:false},person);
 assert.equal(eoi.events[0].status,'pending','Positive TEST coverage must not close actual EOI intake');
 for(const patch of [{refundedCents:10000},{status:'pending'},{email:'changed@example.org'},{fund:'General Donation'},{niaz:{scope:'event',eventId:'event2'}},{refundedCents:20000}]){
  db.store.set('_stripeSandboxDonations/test1',{...donation,...patch});
  assert.deepEqual(await preview(),{sandbox:true,items:[],unavailable:1});
 }
 db.store.delete('_stripeSandboxDonations/test1');assert.deepEqual(await preview(),{sandbox:true,items:[],unavailable:1});
 const reversed={...donation,refundedCents:10000};db.store.set('_stripeSandboxDonations/test1',reversed);await L.projectSandboxDonation(db,'test1',reversed);
 assert.deepEqual(await preview(),{sandbox:true,items:[],unavailable:0});
 assert.equal((await db.collection('_niazSandboxLedger').get()).size,1,'Reversal history is retained');
 assert.equal((await db.collection('niazSponsorships').get()).size,0);
});
test('TEST preview stays finance-gated on the authenticated event HTTP route',async()=>{
 const uid='synthetic-reader',email='reader@example.org',db=database({'events/event1':event,['users/'+uid]:{role:'admin',email},'calendarSettings/auth':{}});
 const donation={name:'Finance-only TEST name',email:'test@example.org',fund:'Niaz Contribution',niaz:{scope:'event',eventId:'event1'},amount:10000,status:'paid'};
 db.store.set('_stripeSandboxDonations/test1',donation);await L.projectSandboxDonation(db,'test1',donation);
 const opts={db,getAuth:()=>({verifyIdToken:async()=>({uid,email,email_verified:true,firebase:{sign_in_provider:'google.com'}})}),origins:new Set(['https://refreshed.muhammadiwelfare.org.au'])};
 for(const module of ['niaz-read','niaz','niaz-finance']){
  db.store.set('adminAllowlist/'+email,{uid,modules:[module]});
  const req={path:'/api/niaz/event',method:'GET',query:{eventId:'event1'},get:key=>({'Authorization':'Bearer synthetic','Origin':'https://refreshed.muhammadiwelfare.org.au'}[key])};
  const res={code:200,set(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
  await A.handle(req,res,opts);assert.equal(res.code,200);
  assert.equal(JSON.stringify(res.body).includes(donation.name),module==='niaz-finance');
  assert.equal(res.body.sandboxSponsorPreview?.items.length,module==='niaz-finance'?1:undefined);
 }
});
test('TEST sponsor preview is bounded and empty finance detail needs no source fetch',async()=>{
 const db=database({'events/event1':event});db.getAll=async()=>assert.fail('No unbounded/empty source read');
 assert.deepEqual((await A.eventDetail(db,'event1',{finance:true})).sandboxSponsorPreview,{sandbox:true,items:[],unavailable:0});
 for(let i=0;i<501;i++)db.store.set('_niazSandboxLedger/'+i,{eventId:'event1'});
 await assert.rejects(A.eventDetail(db,'event1',{finance:true}),error=>error.status===413);
 assert.equal((await A.eventDetail(db,'event1')).sandboxSponsorPreview,undefined);
});
test('Own-contact history never returns another sponsor; event edits flag review without reallocation',async()=>{
 const db=database({'events/event1':event,'niazSponsors/owner':{ownerKey:person.ownerKey,active:true},'niazSponsors/other':{ownerKey:'someone-else',active:true},'niazSponsorships/a':{sponsorId:'owner',eventId:'event1',status:'approved',revision:1},'niazSponsorships/b':{sponsorId:'other',eventId:'event1',status:'approved',revision:1}});
 const own=await A.own(db,person);assert.equal(own.assignments.length,1);assert.equal(own.assignments[0].id,'a');
 await L.onEventChanged(db,'event1',event,{...event,status:'cancelled'});
 assert.equal(db.store.get('niazSponsorships/a').eventReviewRequired,true);assert.equal(db.store.get('niazSponsorships/a').status,'approved');
 assert.ok([...db.store.entries()].filter(([key])=>key.startsWith('_niazOutbox/')).every(([,value])=>value.kind==='cancellation'));
 assert.equal((await L.prepareNotices(db)).disabled,true);
 db.store.set('events/event1',{...event,status:'cancelled'});
 assert.ok((await A.eventDetail(db,'event1')).badges.includes('Event review required'));
 await assert.rejects(A.eventDetail(db,'event1',{publicOnly:true}),/unavailable/);
});
module.exports={database};
test('Explicit reassignment needs confirmation/reason; alternatives and future transfers never silently move occurrences',async()=>{
 const db=database({'events/event1':event,'events/event2':event,'niazSponsors/old':{active:true,name:'Original'},'niazSponsors/new':{active:true,name:'Target'},'niazSponsorships/old':{sponsorId:'old',eventId:'event1',status:'approved',revision:1}});
 await db.doc('niazEventCoverage/event1').set({acceptExtraEOIs:true});
 const eoi=await A.submitEOI(db,{name:'Applicant',eventIds:['event1'],type:'one_time',intent:'consideration',requestId:'reassign-1',publicConsent:false},person);
 assert.ok((await A.eventDetail(db,'event1')).badges.includes('EOI pending'));
 const input={revision:1,eventId:'event1',decision:'approved',reassignIds:['old'],reason:'Reviewed change'};
 await assert.rejects(A.decideEOI(db,eoi.id,input,actor),/confirm/);
 await A.decideEOI(db,eoi.id,{...input,confirmReassignment:true},actor);
 assert.equal(db.store.get('niazSponsorships/old').status,'reassigned');
 await A.proposeAlternative(db,{id:eoi.id,revision:2,eventId:'event2',reason:'Optional next programme'},actor);
 assert.equal([...db.store.values()].filter(value=>value.eventId==='event2'&&value.status==='approved').length,0);
 const programme=await L.saveProgramme(db,{sponsorId:'old',seriesId:'series1',status:'active',reason:'Existing permanent commitment',revision:0},actor);
 await assert.rejects(L.transferProgramme(db,{id:programme.id,revision:1,newSponsorId:'new',reason:'Reviewed'},actor),/confirm/);
 const result=await L.transferProgramme(db,{id:programme.id,revision:1,newSponsorId:'new',reason:'Reviewed',confirm:true},actor);
 assert.equal(result.existingOccurrencesUnchanged,true);assert.equal(db.store.get('niazProgrammeSeries/'+programme.id).status,'cancelled');
});
test('EOI edits require own identity and stay locked after any reviewed event',async()=>{
 const db=database({'niazEOIs/request':{ownerKey:person.ownerKey,revision:1,events:[{eventId:'event1',status:'pending'}]}});
 await assert.rejects(A.editOwnEOI(db,{id:'request',revision:1,notes:'Synthetic'}, {...person,ownerKey:'someone-else'}),/unavailable/);
 await A.editOwnEOI(db,{id:'request',revision:1,notes:'Updated'},person);
 assert.equal(db.store.get('niazEOIs/request').notes,'Updated');
 db.store.set('niazEOIs/request',{...db.store.get('niazEOIs/request'),events:[{eventId:'event1',status:'approved'}]});
 await assert.rejects(A.editOwnEOI(db,{id:'request',revision:2,notes:'Again'},person),/cannot be edited/);
});
test('Seven-day coordinator queue deduplicates; synthetic send is logged once and cancelled events are suppressed',async(t)=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2027-01-08T08:00:00.000Z')});
 const N=require('./niaz-notifications'),email='coordinator@example.org',uid='coordinator';
 const db=database({'events/event1':event,'users/coordinator':{email,role:'admin'},['adminAllowlist/'+email]:{uid,modules:['niaz']},'_niazPrivate/settings':{notificationEnabled:true,coordinatorEmails:[email]},'niazSponsors/sponsor1':{name:'Synthetic',email:'sponsor@example.org',active:true},'niazSponsorships/a':{eventId:'event1',sponsorId:'sponsor1',status:'approved'}});
 const first=await L.prepareNotices(db,new Date('2027-01-04T08:00:00.000Z'));assert.equal(first.queued,1);
 assert.equal((await L.prepareNotices(db,new Date('2027-01-04T08:00:00.000Z'))).queued,0);
 const key=[...db.store.keys()].find(key=>key.startsWith('_niazOutbox/')),sent=[];
 const send=async(_,value)=>{sent.push(value);return {gmailId:'synthetic-'+sent.length};};
 await N.deliverJob(db,db.doc(key),send);assert.equal(sent.length,1);
 await N.deliverJob(db,db.doc(key),send);assert.equal(sent.length,1);
 assert.equal([...db.store.keys()].filter(key=>key.startsWith('niazNotificationLog/')).length,1);
 assert.equal((await L.prepareNotices(db,new Date('2027-01-01T08:00:00.000Z'))).queued,0);
 const cancelled=db.doc('_niazOutbox/cancelled');await cancelled.set({state:'pending',kind:'seven-day',eventId:'event1',eventStartAt:event.startAt});
 db.store.set('events/event1',{...event,status:'cancelled'});await N.deliverJob(db,cancelled,send);assert.equal(sent.length,1);assert.equal(db.store.get(cancelled.path).state,'suppressed');
});
test('Verified-contact self-service excludes internal notes and approval identities; paginates own history',async()=>{
 const db=database({'events/event1':event,'niazSponsors/owner':{ownerKey:person.ownerKey,active:true,name:'Own',notes:'Internal directory note',emailPreferences:{optionalReminders:false}},
  'niazEOIs/request':{ownerKey:person.ownerKey,revision:1,events:[{eventId:'event1',status:'approved',reason:'Joint approved',decidedBy:'private-admin'}],requestHash:'internal-hash',notes:'Own offer'},
  ...Object.fromEntries(Array.from({length:102},(_,index)=>['niazSponsorships/a'+String(index).padStart(3,'0'),{sponsorId:'owner',eventId:'event1',status:'approved',approvedBy:'private-admin',notes:'Internal assignment note',reason:'Internal review reason'}]))});
 const first=await A.own(db,person),second=await A.own(db,person,{assignmentAfter:first.assignmentNext});
 assert.equal(first.assignments.length,100);assert.equal(second.assignments.length,2);assert.equal(second.assignmentNext,null);
 assert.equal(first.sponsor.emailPreferences.optionalReminders,false);
 const output=JSON.stringify(first);for(const value of ['Internal directory note','Internal assignment note','Internal review reason','private-admin','internal-hash'])assert.ok(!output.includes(value),value);
 assert.ok(output.includes('Own offer'));assert.ok(output.includes('Joint approved'));
});
test('Additional EOI cannot overwrite an existing EOI assignment or revive archived sponsors',async()=>{
 const db=database({'events/event1':event,'niazEventCoverage/event1':{acceptExtraEOIs:true}});
 const input={name:'Applicant',eventIds:['event1'],type:'one_time',intent:'joint',requestId:'original',publicConsent:false};
 const first=await A.submitEOI(db,input,person);await A.decideEOI(db,first.id,{revision:1,eventId:'event1',decision:'approved',reason:'Approved original'},actor);
 const second=await A.submitEOI(db,{...input,requestId:'second'},person);
 await assert.rejects(A.decideEOI(db,second.id,{revision:1,eventId:'event1',decision:'approved',reason:'Would overwrite'},actor),/already has/);
 assert.equal(db.store.get('niazEOIs/'+second.id).events[0].status,'pending');
 const sponsorId=M.sponsorKey(person);db.store.set('niazSponsors/'+sponsorId,{...db.store.get('niazSponsors/'+sponsorId),active:false});
 await assert.rejects(A.submitEOI(db,{...input,requestId:'third'},person),/archived/);
 assert.equal(db.store.get('niazSponsors/'+sponsorId).active,false);
});
test('Sponsor directory edits preserve optional-email preferences; ambiguous contact mappings fail closed',async()=>{
 const db=database({'events/event1':event});
 const original=await A.saveSponsor(db,{name:'Own',email:person.email,publicConsent:false,revision:0},actor);
 db.store.set('niazSponsors/'+original.id,{...db.store.get('niazSponsors/'+original.id),emailPreferences:{optionalReminders:false}});
 const updated=await A.saveSponsor(db,{...original,name:'Updated'},actor);assert.equal(updated.emailPreferences.optionalReminders,false);
 db.store.set('_niazContacts/'+M.sponsorKey(person),{sponsorId:'reviewed-import'});
 await assert.rejects(A.submitEOI(db,{name:'Applicant',eventIds:['event1'],requestId:'request',publicConsent:false,type:'one_time'},person),/reviewed sponsor/);
});
test('Notification partial failure retries the same key without repeating logged recipients; settings stop delivery',async(t)=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2027-01-08T08:00:00.000Z')});
 const N=require('./niaz-notifications'),email='coordinator@example.org';
 const db=database({'events/event1':event,'users/coordinator':{email,role:'admin'},['adminAllowlist/'+email]:{uid:'coordinator',modules:['niaz']},'_niazPrivate/settings':{notificationEnabled:true,coordinatorEmails:[email,'second@example.org']},
  'users/second':{email:'second@example.org',role:'admin'},'adminAllowlist/second@example.org':{uid:'second',modules:['niaz']},'niazSponsors/sponsor1':{name:'Own',email:'sponsor@example.org',active:true},'_niazOutbox/notice':{state:'pending',nextAttempt:0,kind:'seven-day',eventId:'event1',eventStartAt:event.startAt,sponsorId:'sponsor1'}});
 const keys=[],ref=db.doc('_niazOutbox/notice');let failed=false;
 const send=async(_,notice)=>{keys.push(notice.key);if(notice.to==='second@example.org'&&!failed){failed=true;throw Error('Synthetic uncertain provider response');}return {gmailId:'synthetic-id'};};
 assert.equal((await N.deliverJob(db,ref,send)).delayed,true);assert.equal(db.store.get(ref.path).state,'retry');
 db.store.set(ref.path,{...db.store.get(ref.path),nextAttempt:0});
 assert.equal((await N.deliverJob(db,ref,send)).sent,2);assert.equal(keys.length,3);assert.equal(keys[1],keys[2]);assert.equal(db.store.get(ref.path).state,'sent');
 await ref.set({state:'pending',nextAttempt:0,kind:'seven-day',eventId:'event1',eventStartAt:event.startAt});
 db.store.set('_niazPrivate/settings',{notificationEnabled:false});assert.equal((await N.deliverJob(db,ref,send)).ignored,true);assert.equal(keys.length,3);
});
test('Optional reminders respect preferences; essential notices remain; reschedule and recipient revocation suppress stale sends',async(t)=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2027-01-08T08:00:00.000Z')});
 const N=require('./niaz-notifications'),email='coordinator@example.org';
 const db=database({'events/event1':event,'users/coordinator':{email,role:'admin'},['adminAllowlist/'+email]:{uid:'coordinator',modules:['niaz']},'_niazPrivate/settings':{notificationEnabled:true,coordinatorEmails:[email]},
  'niazSponsors/sponsor1':{name:'Own',email:'sponsor@example.org',active:true,emailPreferences:{optionalReminders:false}},'niazSponsorships/a':{sponsorId:'sponsor1',eventId:'event1',status:'approved'}});
 const config=db.store.get('_niazPrivate/settings');
 assert.equal((await N.prepareDelivery(db,{kind:'three-day',eventId:'event1',eventStartAt:event.startAt},config)).length,0);
 assert.equal((await N.prepareDelivery(db,{kind:'seven-day',eventId:'event1',eventStartAt:event.startAt},config)).length,1);
 const ref=db.doc('_niazOutbox/reschedule');await ref.set({state:'pending',kind:'seven-day',eventId:'event1',eventStartAt:event.startAt,nextAttempt:0});
 const sent=[];await N.deliverJob(db,ref,async(_,notice)=>{sent.push(notice);db.store.set('events/event1',{...event,startAt:'2027-02-01T08:00:00.000Z'});return {gmailId:'synthetic'};});
 assert.equal(sent.length,1);
 db.store.set('adminAllowlist/'+email,{uid:'coordinator',modules:[]});
 db.store.set('events/event1',event);
 await assert.rejects(N.prepareDelivery(db,{kind:'seven-day',eventId:'event1',eventStartAt:event.startAt},config),/No active/);
});
test('Expired notification leases become retryable; repeated failures require attention instead of success',async(t)=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2027-01-08T08:00:00.000Z')});
 const N=require('./niaz-notifications'),email='coordinator@example.org';
 const db=database({'events/event1':event,'users/coordinator':{email,role:'admin'},['adminAllowlist/'+email]:{uid:'coordinator',modules:['niaz']},'_niazPrivate/settings':{notificationEnabled:true,coordinatorEmails:[email]},
  '_niazOutbox/failed':{state:'sending',leaseUntil:Date.now()-1,nextAttempt:0,attempts:4,kind:'seven-day',eventId:'event1',eventStartAt:event.startAt}});
 const ref=db.doc('_niazOutbox/failed');
 assert.equal((await N.deliverJob(db,ref,async()=>{throw Error('Synthetic unavailable provider');})).delayed,true);
 assert.equal(db.store.get(ref.path).state,'attention');assert.equal(db.store.get(ref.path).leaseUntil,0);
 assert.equal((await N.deliverJob(db,ref,async()=>assert.fail('Attention must not auto-send'))).ignored,true);
});
test('Verified EOI preserves coordinator contacts and fields, flags name differences, and replays with refreshed proof',async()=>{
 const phone='+61412345678',email='demo@example.org',mobilePerson={email:'',phone,ownerKey:'phone-verified'};
 const db=database({'events/event1':event});
 const original=await A.saveSponsor(db,{id:'reviewed',name:'Directory Name',email,phone,notes:'Private coordinator notes',publicConsent:false,revision:0},actor);
 db.store.set('niazSponsors/reviewed',{...db.store.get('niazSponsors/reviewed'),customReviewedField:'retain'});
 const input={name:'Applicant Name',eventIds:['event1'],requestId:'stable-request',type:'one_time',publicConsent:true,verification:{challengeId:'first-proof'}};
 const first=await A.submitEOI(db,input,mobilePerson),saved=db.store.get('niazSponsors/reviewed');
 assert.equal(first.sponsorId,'reviewed');assert.equal(first.applicantName,'Applicant Name');
 for(const key of ['name','email','phone','notes'])assert.equal(saved[key],original[key],key);
 assert.equal(saved.customReviewedField,'retain');assert.equal(saved.ownerKey,mobilePerson.ownerKey);assert.equal(saved.nameReviewRequired,true);assert.equal(saved.publicConsent,true);
 const replay=await A.submitEOI(db,{...input,verification:{challengeId:'refreshed-proof'}},mobilePerson);
 assert.equal(replay.id,first.id);assert.equal((await db.collection('niazEOIs').get()).size,1);
 await assert.rejects(A.submitEOI(db,{...input,name:'Changed offer'},mobilePerson),/details changed/);
});
test('Activation suppresses and logs historical backlog instead of sending it',async(t)=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2027-01-08T08:00:00.000Z')});
 const N=require('./niaz-notifications'),email='coordinator@example.org';
 const db=database({'events/event1':event,'users/coordinator':{email,role:'admin'},['adminAllowlist/'+email]:{uid:'coordinator',modules:['niaz']},'_niazPrivate/settings':{notificationEnabled:true,enabledAt:'2026-11-09T07:00:00Z',coordinatorEmails:[email]},
  '_niazOutbox/old':{state:'pending',nextAttempt:0,kind:'decision',eventId:'event1',createdAt:'2026-11-08T07:00:00Z'},
  '_niazOutbox/new':{state:'pending',nextAttempt:0,kind:'seven-day',eventId:'event1',eventStartAt:event.startAt,createdAt:'2026-11-09T07:00:01Z'}});
 const sent=[],send=async(_,notice)=>{sent.push(notice);return {gmailId:'synthetic'};};
 await N.deliverJob(db,db.doc('_niazOutbox/old'),send);assert.equal(sent.length,0);assert.equal(db.store.get('_niazOutbox/old').state,'suppressed');
 assert.equal((await db.collection('niazNotificationLog').get()).docs[0].data().reason,'pre-activation');
 await N.deliverJob(db,db.doc('_niazOutbox/new'),send);assert.equal(sent.length,1);assert.equal(db.store.get('_niazOutbox/new').state,'sent');
});
test('Ephemeral imports and rate-limit records expire without deleting sponsor or audit history',async()=>{
 const db=database({'_niazImports/expired':{expiresAt:1,rows:[{name:'Synthetic private preview'}]},'_niazImports/active':{expiresAt:Date.now()+60000},'_niazLimits/expired':{expiresAt:1},'niazSponsors/sponsor':{active:false},'auditLog/history':{module:'niaz'}});
 assert.equal((await L.pruneExpired(db)).removed,2);
 for(const key of ['_niazImports/active','niazSponsors/sponsor','auditLog/history'])assert.ok(db.store.has(key));
 assert.equal((await L.pruneExpired(db)).removed,0);
});
test('Uncertain service-email send never blindly repeats while Gmail search indexing is delayed',async()=>{
 const G=require('./enquiries-gmail'),previousFetch=global.fetch;
 const db=database({'_enquiryPrivate/mailbox':{connected:true,refreshToken:'synthetic',accessToken:'synthetic',expiresAt:Date.now()+3600000}});
 let posts=0,visible=false;
 global.fetch=async(url,options)=>{
  assert.ok(String(url).startsWith('https://gmail.googleapis.com/'),'No real provider call permitted');
  if(options.method==='POST'){posts++;throw Error('Synthetic response lost after possible send');}
  return {ok:true,json:async()=>visible?{messages:[{id:'reconciled-synthetic'}]}:{}};
 };
 const notice={to:'synthetic@example.org',subject:'Synthetic',body:'Synthetic service notice',key:'stable-delivery-key'};
 try{
  await assert.rejects(G.sendServiceNotice(db,notice),error=>error.deliveryUncertain===true);
  await assert.rejects(G.sendServiceNotice(db,notice),error=>error.deliveryUncertain===true);assert.equal(posts,1);
  visible=true;const result=await G.sendServiceNotice(db,notice);assert.equal(result.reconciled,true);assert.equal(posts,1);
 }finally{global.fetch=previousFetch;}
});
test('Provider-uncertain notice goes to attention rather than assuming retry is safe',async(t)=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2027-01-08T08:00:00.000Z')});
 const N=require('./niaz-notifications'),email='coordinator@example.org';
 const db=database({'events/event1':event,'users/coordinator':{email,role:'admin'},['adminAllowlist/'+email]:{uid:'coordinator',modules:['niaz']},'_niazPrivate/settings':{notificationEnabled:true,coordinatorEmails:[email]},'_niazOutbox/uncertain':{state:'pending',kind:'seven-day',eventId:'event1',eventStartAt:event.startAt}});
 await N.deliverJob(db,db.doc('_niazOutbox/uncertain'),async()=>{throw Object.assign(Error('Synthetic uncertain delivery'),{deliveryUncertain:true});});
 assert.equal(db.store.get('_niazOutbox/uncertain').state,'attention');
 assert.ok(db.store.get('_niazOutbox/uncertain').lastError.includes('Reconcile'));
});
test('Import preview batches unique reads and each import transaction uses one getAll',async()=>{
 const db=database({'events/event1':event}),counts={bulk:0,queries:0,txBulk:0,txGet:0};
 const getAll=db.getAll;db.getAll=async(...refs)=>{counts.bulk++;return getAll(...refs);};
 const collection=db.collection;db.collection=name=>{
  const wrap=query=>new Proxy(query,{get(target,key){
   if(key==='get')return async()=>{counts.queries++;return target.get();};
   if(['where','orderBy','startAfter','limit'].includes(key))return (...args)=>wrap(target[key](...args));
   return target[key];
  }});
  return wrap(collection(name));
 };
 const transaction=db.runTransaction;db.runTransaction=fn=>transaction(tx=>{
  const bulk=tx.getAll,get=tx.get;tx.getAll=async(...refs)=>{counts.txBulk++;return bulk(...refs);};tx.get=async ref=>{counts.txGet++;return get(ref);};return fn(tx);
 });
 const rows=Array.from({length:251},(_,i)=>({name:'Synthetic '+i,email:'batch'+i+'@example.org',eventDate:'2027-01-11',eventId:'event1',type:'annual',role:'joint',publicConsent:false}));
 const preview=await A.previewImport(db,rows,actor);assert.equal(counts.queries,1);assert.equal(counts.bulk,3);
 let result={offset:0};while(result.state!=='complete')result=await A.importStep(db,preview.jobId,result.offset,actor);
 assert.equal(counts.txBulk,7);assert.equal(counts.txGet,14);assert.equal(result.offset,251);
 await assert.rejects(A.previewImport(db,Array(501).fill(rows[0]),actor),/500/);
});
test('Coordinator saves retain name-review flags and cannot override verified sponsor consent',async()=>{
 const db=database({}),original=await A.saveSponsor(db,{name:'Demo',email:'demo@example.org',publicConsent:false,revision:0},actor);
 db.store.set('niazSponsors/'+original.id,{...db.store.get('niazSponsors/'+original.id),ownerKey:'verified-owner',nameReviewRequired:true});
 const updated=await A.saveSponsor(db,{...original,name:'Reviewed directory name'},actor);
 assert.equal(updated.nameReviewRequired,true);
 await assert.rejects(A.saveSponsor(db,{...updated,publicConsent:true},actor),/manage their own/);
 assert.equal(db.store.get('niazSponsors/'+original.id).publicConsent,false);
});
test('Coordinator saves preserve recorded consent evidence unless consent changes',async()=>{
 const db=database({}),original=await A.saveSponsor(db,{name:'Demo',email:'demo@example.org',publicConsent:false,revision:0},actor);
 const ref='niazSponsors/'+original.id;
 db.store.set(ref,{...original,consentVersion:'historical-v1',consentAt:'2025-01-01T00:00:00Z'});
 const unchanged=await A.saveSponsor(db,{...original,notes:'Edited notes'},actor);
 assert.equal(unchanged.consentVersion,'historical-v1');assert.equal(unchanged.consentAt,'2025-01-01T00:00:00Z');
 const changed=await A.saveSponsor(db,{...unchanged,publicConsent:true},actor);
 assert.equal(changed.consentVersion,'niaz-2026-11-v1');assert.notEqual(changed.consentAt,unchanged.consentAt);
 db.store.set(ref,{...changed,ownerKey:'verified-owner',consentVersion:'verified-old-version'});
 assert.equal((await A.saveSponsor(db,{...changed,name:'Updated name'},actor)).consentVersion,'verified-old-version');
 const legacy={...db.store.get(ref)};delete legacy.consentVersion;delete legacy.consentAt;db.store.set(ref,legacy);
 const unknown=await A.saveSponsor(db,legacy,actor);assert.equal(unknown.consentVersion,null);assert.equal(unknown.consentAt,null);
});
test('Coordinator EOI queue enriches programme metadata in bulk without changing decisions/pagination',async()=>{
 const db=database({'events/event1':event,'niazEOIs/offer':{events:[{eventId:'event1',status:'pending',reason:'Original reason'},{eventId:'deleted',status:'rejected'}]}});
 const result=await A.eoiList(db);
 assert.equal(result.items[0].events[0].eventTitle,event.title);assert.equal(result.items[0].events[0].eventStartAt,event.startAt);
 assert.equal(result.items[0].events[0].reason,'Original reason');assert.equal(result.items[0].events[1].eventTitle,'Programme no longer available');assert.equal(result.items[0].events[1].eventStartAt,null);
 assert.equal(result.next,null);assert.equal(db.store.get('niazEOIs/offer').events[0].eventTitle,undefined);
});
test('Attention acknowledgment is audited/idempotent, retains conflicts and never schedules delivery',async(t)=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2027-01-08T08:00:00.000Z')});
 const original={kind:'integration-conflict',state:'attention',lastError:'Reconciliation required',attempts:3,nextAttempt:123,leaseUntil:0};
 const db=database({'_niazOutbox/conflict':original,'_niazOutbox/pending':{state:'pending'},'_niazPrivate/settings':{notificationEnabled:true}});
 await A.acknowledgeAttention(db,{id:'conflict'},actor);
 const saved=db.store.get('_niazOutbox/conflict');assert.deepEqual({...saved,acknowledgment:undefined},{...original,acknowledgment:undefined});
 assert.equal(saved.acknowledgment.by,actor.uid);assert.ok(saved.acknowledgment.at);
 assert.equal((await A.acknowledgeAttention(db,{id:'conflict'},actor)).alreadyAcknowledged,true);
 const logs=await db.collection('auditLog').get();assert.equal(logs.size,1);assert.equal(logs.docs[0].data().action,'niaz.attention_acknowledged');
 assert.equal(logs.docs[0].data().userId,actor.uid);
 const N=require('./niaz-notifications');let sends=0;
 assert.deepEqual(await N.deliverJob(db,db.doc('_niazOutbox/conflict'),async()=>{sends++;}),{ignored:true});assert.equal(sends,0);
 await assert.rejects(A.acknowledgeAttention(db,{id:'pending'},actor),/Only attention/);
 await assert.rejects(A.acknowledgeAttention(db,{id:'missing'},actor),/unavailable/);
});
test('Attention HTTP action requires current Niaz management and POST',async()=>{
 const email='manager@example.org',uid='manager',db=database({'users/manager':{role:'admin',email},['adminAllowlist/'+email]:{uid,modules:['niaz']},'_niazOutbox/conflict':{state:'attention',kind:'integration-conflict'}});
 const token={uid,email,email_verified:true,firebase:{sign_in_provider:'google.com'}};
 const opts={db,getAuth:()=>({verifyIdToken:async()=>token}),origins:new Set(['https://refreshed.muhammadiwelfare.org.au'])};
 const req={path:'/api/niaz/attention-acknowledge',method:'POST',body:{id:'conflict'},query:{},get:key=>({Authorization:'Bearer synthetic',Origin:'https://refreshed.muhammadiwelfare.org.au'}[key]),is:()=>true};
 const response=()=>({code:200,set(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}});
 let res=response();await A.handle(req,res,opts);assert.equal(res.code,200);assert.equal(res.body.acknowledged,true);assert.equal(db.store.get('_niazOutbox/conflict').acknowledgment.by,uid);
 for(const modules of [['niaz-read'],['niaz-finance'],[]]){
  db.store.set('adminAllowlist/'+email,{uid,modules});res=response();await A.handle(req,res,opts);assert.equal(res.code,403);
 }
 assert.equal((await db.collection('auditLog').get()).size,1);
});
test('Approved EOI sends only to its active sponsor and is suppressed after assignment removal',async()=>{
 const N=require('./niaz-notifications');
 const db=database({'events/event1':event,'niazSponsors/sponsor':{name:'Synthetic Sponsor',email:'sponsor@example.org',active:true},'niazEOIs/request':{events:[{eventId:'event1',status:'approved'}]},'niazSponsorships/assignment':{eventId:'event1',sponsorId:'sponsor',status:'approved'}});
 const job={kind:'decision',decision:'approved',eventId:'event1',sponsorId:'sponsor',eoiId:'request',assignmentId:'assignment'};
 const notices=await N.prepareDelivery(db,job,{});assert.equal(notices.length,1);assert.equal(notices[0].to,'sponsor@example.org');assert.ok(notices[0].body.includes('/niaz/'));
 db.store.set('niazSponsorships/assignment',{eventId:'event1',sponsorId:'sponsor',status:'cancelled'});assert.deepEqual(await N.prepareDelivery(db,job,{}),[]);
});

test('Deterministic integration conflicts record attention while transient failures propagate for retry',async()=>{
 const db=database({}),failure=M.fault(409,'Synthetic reconciliation required');
 assert.equal((await L.triggerAction(db,'sandbox-donation','txn',async()=>{throw failure;})).attention,true);
 const conflict=(await db.collection('_niazOutbox').get()).docs[0];
 assert.equal(conflict.data().state,'attention');
 await A.acknowledgeAttention(db,{id:conflict.id},actor);
 assert.equal(db.store.get(conflict.ref.path).acknowledgment.by,actor.uid);
 await L.triggerAction(db,'sandbox-donation','txn',async()=>{throw failure;});
 assert.equal((await db.collection('_niazOutbox').get()).size,1);
 assert.equal(db.store.get(conflict.ref.path).acknowledgment,null);
 assert.equal(db.store.get(conflict.ref.path).state,'attention');
 await A.acknowledgeAttention(db,{id:conflict.id},actor);
 assert.equal((await db.collection('auditLog').get()).size,2);
 assert.equal(db.store.get(conflict.ref.path).lastError,failure.message);
 await assert.rejects(L.triggerAction(db,'event','event1',async()=>{throw Error('Transient unavailable');}),/Transient/);
 await assert.rejects(L.triggerAction(db,'sandbox-donation','txn',async()=>{throw Object.assign(M.fault(409,'Source changed'),{retryable:true});}),/Source changed/);
});

test('Only opted-in three-day sponsors and seven-day coordinators receive reminders; all other mail is blocked',async(t)=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2027-01-08T08:00:00Z')});
 const N=require('./niaz-notifications'),email='coordinator@example.org';
 const db=database({'events/event1':event,'users/coordinator':{email,role:'admin'},['adminAllowlist/'+email]:{uid:'coordinator',modules:['niaz']},'_niazPrivate/settings':{notificationEnabled:true,threeDayFollowup:true,coordinatorEmails:[email]},'niazSponsors/s':{name:'Synthetic',email:'sponsor@example.org',active:true,emailPreferences:{optionalReminders:true,consentVersion:'niaz-reminders-v2'}},'niazSponsorships/a':{sponsorId:'s',eventId:'event1',status:'approved'},'niazEventCoverage/event1':{arrangementConfirmed:true,eventReviewRequired:true}});
 const config=db.store.get('_niazPrivate/settings');assert.equal((await L.prepareNotices(db,new Date())).queued,1);
 const job={kind:'three-day',eventId:'event1',eventStartAt:event.startAt};assert.deepEqual((await N.prepareDelivery(db,job,config)).map(n=>n.to),['sponsor@example.org']);
 db.store.get('niazSponsors/s').emailPreferences.optionalReminders=false;assert.deepEqual(await N.prepareDelivery(db,job,config),[]);
 for(const kind of ['monthly','cancellation','reschedule','eoi','approval','review','annual-review','sandbox-donation','reassignment','alternative'])assert.deepEqual(await N.prepareDelivery(db,{kind,eventId:'event1'},config),[],kind);
 assert.deepEqual(await N.prepareDelivery(db,{kind:'decision',decision:'rejected',eventId:'event1'},config),[]);
});
test('Event plan atomically retains joint sponsors under MWA and rejects stale edits or inactive assignments',async()=>{
 const P=require('./niaz-event-plan');const db=database({'events/event1':event,'niazSponsors/s':{active:true},'niazSponsorships/a':{sponsorId:'s',eventId:'event1',status:'approved',type:'one_time',role:'sole',revision:1}});
 const input={eventId:'event1',revision:0,mwaArranged:true,arrangementConfirmed:false,acceptExtraEOIs:true,notes:'Kitchen plan',fundsRequiredCents:15000,baseline:[{id:'a',revision:1}],assignments:[{id:'a',sponsorId:'s',revision:1,type:'one_time',role:'sole'}]};
 await P.saveEventPlan(db,input,actor);assert.equal(db.store.get('niazSponsorships/a').role,'joint');assert.equal(db.store.get('niazEventCoverage/event1').fundsRequiredCents,15000);
 await assert.rejects(P.saveEventPlan(db,input,actor),/changed/);
 await P.saveEventPlan(db,{...input,revision:1,baseline:[{id:'a',revision:2}],assignments:[]},actor);assert.equal(db.store.get('niazSponsorships/a').status,'cancelled');assert.ok(db.store.has('niazSponsors/s'));
 const before=JSON.stringify([...db.store]);await assert.rejects(P.saveEventPlan(db,{...input,revision:2,baseline:[],assignments:[{sponsorId:'missing',type:'one_time'}]},actor),/active/);assert.equal(JSON.stringify([...db.store]),before);
});
test('Discretionary EOI creates an active sponsor with explicit reminder preference and resolves at approval',async()=>{
 const db=database({'events/event1':event});const request=await A.submitEOI(db,{name:'Synthetic',eventIds:['event1'],requestId:'discretion',type:'discretion',publicConsent:true,optionalReminders:true},person);
 const sponsor=db.store.get('niazSponsors/'+request.sponsorId);assert.equal(sponsor.active,true);assert.equal(sponsor.emailPreferences.optionalReminders,true);
 await A.decideEOI(db,request.id,{eventId:'event1',revision:1,decision:'approved',type:'one_time',role:'sole',reason:'Finalised'},actor);
 const assignment=(await db.collection('niazSponsorships').get()).docs[0].data();assert.equal(assignment.type,'one_time');assert.equal((await A.eventDetail(db,'event1',{publicOnly:true})).sponsors[0].name,'Synthetic');
});

test('Direct coordinator assignment and reviewed import are immediately approved, without an EOI or approval email',async()=>{
 const db=database({'events/event1':event,'events/event2':event});
 const sponsor=await A.saveSponsor(db,{name:'Admin-created',email:'admin-created@example.org',publicConsent:true,revision:0},actor);
 const assigned=await A.assign(db,{sponsorId:sponsor.id,eventId:'event1',type:'one_time',role:'sole',revision:0},actor);assert.equal(assigned.status,'approved');
 const preview=await A.previewImport(db,[{name:'Imported',email:'imported@example.org',eventDate:'2027-01-11',eventId:'event2',type:'one_time',role:'sole',publicConsent:false}],actor);await A.importStep(db,preview.jobId,0,actor);
 const imported=(await db.collection('niazSponsorships').where('eventId','==','event2').get()).docs[0].data();assert.equal(imported.status,'approved');assert.equal((await db.collection('niazEOIs').get()).size,0);assert.equal((await db.collection('_niazOutbox').get()).size,0);
});
