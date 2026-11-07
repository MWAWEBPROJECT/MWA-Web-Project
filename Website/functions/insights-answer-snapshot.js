const Snapshot=require('./insights-multi-snapshot');
const Ledger=require('./insights-snapshot-ledger');
const IndexSnapshot=require('./insights-index-snapshot');
const Aggregate=require('./insights-aggregate-snapshot');
const Insights=require('./form-insights');
const Programme=require('./insights-programmes');
const Answer=require('./insights-answer-analysis');
const GROUP=30,MAX_ACCUMULATOR_BYTES=700000;
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};

async function start(db,actor,input){
 return Aggregate.start(db,actor,input,{type:'answers'});
}
async function step(db,actor,input){
 Snapshot.checkId(input.jobId);
 if(!Number.isSafeInteger(input.step)||input.step<0)fail(400,'Choose a valid analysis step.');
 const ref=Snapshot.ref(db,input.jobId),job=(await ref.get()).data();
 Snapshot.ensure(job,actor);
 if(job.type!=='answers'||job.status!=='running'||job.step!==input.step)fail(409,'Analysis progress changed. Start again.');
 const search=Aggregate.searchFor(job,input);
 if(job.phase==='calendar')return Aggregate.calendarStep(db,actor,input,job);
 if(job.phase==='validate'){
  await db.runTransaction(async tx=>{
   const live=(await tx.get(ref)).data();Snapshot.ensure(live,actor);
   if(live.type!=='answers'||live.phase!=='validate'||live.step!==input.step)fail(409,'Analysis progress changed. Start again.');
   Aggregate.searchFor(live,input);await Snapshot.validate(tx,db,actor,live);await Aggregate.validateCalendar(tx,db,ref,live);
   tx.update(ref,{status:'complete',phase:'complete',step:live.step+1,completedAt:new Date()});
  });
  return {jobId:input.jobId,status:'complete',step:input.step+1,scanned:job.scanned};
 }
 const {page,indexes,docs,ledgerDocs,dimensions}=await IndexSnapshot.scan(db,job,{includeIndexEvents:true});
 const selected=[],visible=new Map();
 for(const index of indexes){
  const row=index.data(),event=typeof row.eventId==='string'?docs.get('events/'+row.eventId):null;
  const projection=event&&Insights.projectEvent(event.exists?event.data():null,event.id,job.calendarAccess);
  if(projection)visible.set(event.id,projection);
  if(job.filters.eventId&&row.eventId!==job.filters.eventId||job.filters.formId&&row.formId!==job.filters.formId||search&&!(typeof row.search==='string'&&row.search.includes(search)))continue;
  if(dimensions){const dimension=row.eventId?dimensions.map.get(row.eventId):{categories:[],bookingType:'',series:''};if(!dimension||!Programme.matches(dimension,job.filters))continue;}
  selected.push({...row,id:index.id});
 }
 let next;
 await db.runTransaction(async tx=>{
  const live=(await tx.get(ref)).data();Snapshot.ensure(live,actor);
  if(live.type!=='answers'||live.phase!=='scan'||live.step!==input.step)fail(409,'Analysis progress changed. Start again.');
  Aggregate.searchFor(live,input);await Snapshot.validate(tx,db,actor,live);await IndexSnapshot.validateBatch(tx,live,docs);
  const prep=await Ledger.prepare(tx,ref,live.basis==='event'?ledgerDocs.filter(doc=>!doc.ref.path.startsWith('events/')):ledgerDocs,live.ledgerCount);
  const accumulator=Answer.accumulate(JSON.parse(live.answerAccumulator),selected,docs,live.concept,visible,live.calendarAccess,live.concept2);
  const encoded=JSON.stringify(accumulator);
  if(Buffer.byteLength(encoded,'utf8')>MAX_ACCUMULATOR_BYTES)fail(422,'This answer analysis has too many distinct definitions. Narrow the scope; no partial analysis is available.');
  const more=page.size>indexes.length,last=indexes.at(-1),position=live.basis==='event'&&!more?live.position+GROUP:live.position;
  const finished=live.basis==='event'?position>=live.eventIds.length:!more;
  const cursor=more?(live.basis==='event'?last.id:{submittedAt:last.data().submittedAt,id:last.id}):null;
  next={phase:finished?'validate':'scan',position,cursor,step:live.step+1,scanned:live.scanned+indexes.length,ledgerCount:prep.count,answerAccumulator:encoded};
  prep.write();tx.update(ref,next);
 });
 return {jobId:input.jobId,status:'running',step:next.step,scanned:next.scanned};
}
async function results(db,actor,input){
 Snapshot.checkId(input.jobId);const ref=Snapshot.ref(db,input.jobId),job=(await ref.get()).data();Snapshot.ensure(job,actor);
 if(job.type!=='answers'||job.status!=='complete')fail(409,'Analysis is not complete.');
 const exporting=input.export===undefined?'':input.export;
 if(typeof exporting!=='string'||exporting&&!['xlsx','pdf'].includes(exporting))fail(400,'Choose a supported export format.');
 await db.runTransaction(async tx=>{
  const live=(await tx.get(ref)).data();Snapshot.ensure(live,actor);
  if(live.type!=='answers'||live.status!=='complete'||live.step!==job.step)fail(409,'Analysis changed. Start again.');
  await Snapshot.validate(tx,db,actor,live,{exporting:!!exporting});await Aggregate.validateCalendar(tx,db,ref,live);
 });
 return {...Answer.summarizeAccumulator(JSON.parse(job.answerAccumulator),job.concept,job.concept2),snapshot:true,
  fingerprint:input.jobId+':'+job.step,generatedAt:job.completedAt.toDate().toISOString(),
  filters:{from:job.range.from,to:job.range.to,basis:job.basis,formId:job.filters.formId,eventFiltered:!!job.filters.eventId,searchUsed:job.searchUsed,categories:job.filters.categories,bookingType:job.filters.bookingType,series:job.filters.series}};
}
module.exports={start,step,results};
