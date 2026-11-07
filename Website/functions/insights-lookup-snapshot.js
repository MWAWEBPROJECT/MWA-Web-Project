const {randomUUID,randomBytes,createHash,timingSafeEqual}=require('node:crypto');
const {FieldPath}=require('firebase-admin/firestore');
const Snapshot=require('./insights-multi-snapshot'),Ledger=require('./insights-snapshot-ledger'),IndexSnapshot=require('./insights-index-snapshot');
const Lookup=require('./insights-respondent-lookup'),Programme=require('./insights-programmes'),Reports=require('./insights-respondent-reports');

const PAGE=25,MAX_MEMBER_BYTES=500000;
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const digest=(salt,value)=>createHash('sha256').update(salt).update('\0').update(value).digest('hex');
function needleFor(job,term){
 const needle=Lookup.searchNeedle(job.kind,term),actual=Buffer.from(digest(job.salt,needle),'hex'),expected=Buffer.from(job.searchHash,'hex');
 if(actual.length!==expected.length||!timingSafeEqual(actual,expected))fail(409,'Search changed. Start again.');
 return needle;
}
async function start(db,actor,input){
 const {from,to,kind,term,formId='',eventId=''}=input||{};
 if(typeof formId!=='string'||typeof eventId!=='string'||formId&&!validId(formId)||eventId&&!validId(eventId))fail(400,'Choose valid form and event references.');
 const history=Lookup.dates(from,to),needle=Lookup.searchNeedle(kind,term),salt=randomBytes(32).toString('hex'),jobId=randomUUID(),ref=Snapshot.ref(db,jobId);
 const job={type:'lookup',uid:actor.uid,email:actor.email,calendarAccess:actor.modules.includes('events-bookings'),from,to,kind,salt,searchHash:digest(salt,needle),history,filters:{...Programme.filters(input),formId,eventId},versions:Snapshot.expected(await db.getAll(...Snapshot.versions(db))),calendarLedger:{},ledgerCount:0,status:'running',phase:'scan',cursor:null,step:0,scanned:0,coverage:{indexed:0,staleIndex:0,unavailable:0,unmapped:0,unresolved:0},confirmedMatches:0,unresolvedMatches:0,createdAt:new Date(),expiresAt:new Date(Date.now()+Snapshot.TTL_MS)};
 await db.runTransaction(async tx=>{await Snapshot.validate(tx,db,actor,job);tx.create(ref,job);});
 return {jobId,status:'running',step:0,scanned:0};
}
async function step(db,actor,input){
 Snapshot.checkId(input.jobId);if(!Number.isSafeInteger(input.step)||input.step<0)fail(400,'Choose a valid analysis step.');
 const ref=Snapshot.ref(db,input.jobId),job=(await ref.get()).data();Snapshot.ensure(job,actor);
 if(job.type!=='lookup'||job.status!=='running'||job.step!==input.step)fail(409,'Analysis progress changed. Start again.');
 const needle=needleFor(job,input.term);
 if(job.phase==='validate'){
  await db.runTransaction(async tx=>{
   const live=(await tx.get(ref)).data();Snapshot.ensure(live,actor);
   if(live.type!=='lookup'||live.phase!=='validate'||live.step!==input.step)fail(409,'Analysis progress changed. Start again.');
   needleFor(live,input.term);await Snapshot.validate(tx,db,actor,live);await Ledger.validate(tx,db,ref,live.ledgerCount);
   tx.update(ref,{status:'complete',phase:'complete',step:live.step+1,completedAt:new Date()});
  });
  return {jobId:input.jobId,status:'complete',step:input.step+1,scanned:job.scanned};
 }
 const {page,indexes,docs,ledgerDocs,coverage,rows}=await IndexSnapshot.scan(db,job,{filterHistory:true}),groups=new Map();
 for(const {index,row,source,data,link,mapping,person,confirmed,evidence} of rows){
  if(!Lookup.matches(job.kind,needle,evidence))continue;
  const id=confirmed?'c_'+link.personId:'u_'+index.id;
  const value=groups.get(id)||{kind:confirmed?'confirmed':'unresolved',...(confirmed?{personId:link.personId}:{formId:row.formId,responseId:row.responseId,reference:typeof data.reference==='string'?data.reference.slice(0,128):''}),names:[],contactHints:[],sample:Snapshot.expected([source,index,mapping,docs.get('_respondentLinks/'+index.id),...(confirmed?[person]:[])])};
  value.names=[...new Set([...value.names,...evidence.names])];value.contactHints=[...new Set([...value.contactHints,...Lookup.mask(evidence)])];groups.set(id,value);
 }
 let next;
 await db.runTransaction(async tx=>{
  const live=(await tx.get(ref)).data();Snapshot.ensure(live,actor);
  if(live.type!=='lookup'||live.phase!=='scan'||live.step!==input.step)fail(409,'Analysis progress changed. Start again.');
  needleFor(live,input.term);await Snapshot.validate(tx,db,actor,live);await IndexSnapshot.validateBatch(tx,live,docs);
  const prep=await Ledger.prepare(tx,ref,ledgerDocs,live.ledgerCount),ids=[...groups.keys()],members=ids.length?await tx.getAll(...ids.map(id=>ref.collection('members').doc(id))):[];
  let confirmedMatches=live.confirmedMatches,unresolvedMatches=live.unresolvedMatches;
  for(let i=0;i<ids.length;i++){
   const value=groups.get(ids[i]),old=members[i].data();
   if(old){value.names=[...new Set([...old.names,...value.names])];value.contactHints=[...new Set([...old.contactHints,...value.contactHints])];value.sample=old.sample;}
   else if(value.kind==='confirmed')confirmedMatches++;else unresolvedMatches++;
   if(Buffer.byteLength(JSON.stringify(value),'utf8')>MAX_MEMBER_BYTES)fail(422,'A respondent has too many distinct matching values for this analysis. Narrow the scope; no partial report is available.');
   tx.set(members[i].ref,value);
  }
  const nextCoverage=Object.fromEntries(Object.keys(coverage).map(name=>[name,live.coverage[name]+coverage[name]])),more=page.size>indexes.length,last=indexes.at(-1);
  next={phase:more?'scan':'validate',cursor:more?{submittedAt:last.data().submittedAt,id:last.id}:null,step:live.step+1,scanned:live.scanned+indexes.length,coverage:nextCoverage,confirmedMatches,unresolvedMatches,ledgerCount:prep.count};
  prep.write();tx.update(ref,next);
 });
 return {jobId:input.jobId,status:'running',step:next.step,scanned:next.scanned};
}
async function results(db,actor,input){
 Snapshot.checkId(input.jobId);const ref=Snapshot.ref(db,input.jobId),job=(await ref.get()).data();Snapshot.ensure(job,actor);
 if(job.type!=='lookup'||job.status!=='complete')fail(409,'Analysis is not complete.');
 const cursor=input.cursor||'';
 if(typeof cursor!=='string'||cursor&&!/^(c_[a-f0-9-]{36}|u_[a-f0-9]{64})$/.test(cursor))fail(400,'Choose a valid search page.');
 let query=ref.collection('members').orderBy(FieldPath.documentId());if(cursor)query=query.startAfter(cursor);
 const page=await query.limit(PAGE+1).get(),members=page.docs.slice(0,PAGE),sample={};
 for(const member of members)for(const [path,version] of Object.entries(member.data().sample||{})){
  if(Object.hasOwn(sample,path)&&sample[path]!==version)fail(409,'Respondent data changed. Start again.');
  sample[path]=version;
 }
 await db.runTransaction(async tx=>{
  const live=(await tx.get(ref)).data();Snapshot.ensure(live,actor);
  if(live.type!=='lookup'||live.status!=='complete'||live.step!==job.step)fail(409,'Analysis changed. Start again.');
  await Snapshot.validate(tx,db,actor,live);await Ledger.validate(tx,db,ref,live.ledgerCount);
  const pairs=Object.entries(sample);
  for(let offset=0;offset<pairs.length;offset+=200){const slice=pairs.slice(offset,offset+200),current=await tx.getAll(...slice.map(([path])=>db.doc(path)));if(current.some((doc,i)=>Snapshot.stamp(doc)!==slice[i][1]))fail(409,'Respondent data changed. Start again.');}
 });
 const items=members.map(member=>{const {sample,...item}=member.data();return item;});
 return {coverage:job.coverage,confirmedMatches:job.confirmedMatches,unresolvedMatches:job.unresolvedMatches,items,next:page.size>PAGE?members.at(-1).id:null,notice:'Search covers indexed submissions in the selected Sydney submission-date window only. Results without current reviewed identity links are unresolved candidates, not people. Unmapped, stale, unavailable, nonstandard-date and unindexed history is excluded; matching never confirms identity.'};
}
module.exports={start,step,results};
