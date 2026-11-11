const M=require('./niaz-model');
const {dateKey}=require('./donation-records');
// One transaction keeps MWA coverage and all occurrence assignments consistent.
async function saveEventPlan(db,input,actor){
 const eventId=M.id(input.eventId);
 if(typeof input.mwaArranged!=='boolean'||typeof input.arrangementConfirmed!=='boolean'||typeof input.acceptExtraEOIs!=='boolean')throw M.fault(400,'Choose event arrangement settings.');
 if(!Array.isArray(input.assignments)||!Array.isArray(input.baseline)||input.assignments.length>100||input.baseline.length>100)throw M.fault(400,'Review at most 100 sponsors for this event.');
 const rows=input.assignments.map(row=>({...M.assignment(row),id:row.id?M.id(row.id):null,sponsorId:M.id(row.sponsorId),revision:row.revision||0}));
 if(rows.some(row=>!['one_time','permanent','cash_donation','annual'].includes(row.type)))throw M.fault(400,'Choose a final sponsorship type.');
 if(new Set(rows.map(r=>r.sponsorId)).size!==rows.length)throw M.fault(400,'Each sponsor can be assigned only once.');
 if(!input.mwaArranged&&!rows.length)throw M.fault(400,'Assign a sponsor or choose MWA Arranged.');
 const notes=M.text(input.notes||'','internal arrangement notes',2000);
 const fundsRequiredCents=input.fundsRequiredCents==null?null:M.amount(input.fundsRequiredCents);
 return db.runTransaction(async tx=>{
  const eventRef=db.doc('events/'+eventId),coverageRef=db.doc('niazEventCoverage/'+eventId);
  const eventSnap=await tx.get(eventRef),coverageSnap=await tx.get(coverageRef),event=eventSnap.data(),coverage=coverageSnap.data()||{};
  if(!M.eligible(event,eventId))throw M.fault(409,'The programme is no longer available.');
  if(input.revision!==(coverage.revision||0))throw M.fault(409,'Event arrangements changed. Refresh before saving.');
  const existing=await tx.get(db.collection('niazSponsorships').where('eventId','==',eventId).where('status','==','approved').limit(101));
  if(existing.size>100)throw M.fault(413,'Request a scoped review for this event.');
  const current=new Map(existing.docs.map(doc=>[doc.id,doc]));
  if(input.baseline.length!==current.size||input.baseline.some(row=>!current.has(row.id)||current.get(row.id).data().revision!==row.revision))throw M.fault(409,'Sponsors changed. Refresh before saving.');
  const pending=[];
  for(const row of rows){
   if(row.id&&(!current.has(row.id)||current.get(row.id).data().sponsorId!==row.sponsorId||current.get(row.id).data().revision!==row.revision))throw M.fault(409,'Assignment changed. Refresh before saving.');
   const sponsor=await tx.get(db.doc('niazSponsors/'+row.sponsorId));
   if(!sponsor.data()?.active)throw M.fault(409,'Choose an active sponsor.');
   if(row.type==='permanent'&&row.seriesId!==event.seriesId)throw M.fault(400,'Permanent sponsorship must use this programme series.');
   const ref=row.id?db.doc('niazSponsorships/'+row.id):db.doc('niazSponsorships/'+M.assignmentKey(row.sponsorId,eventId));
   const previous=row.id?current.get(row.id):await tx.get(ref);
   if(!row.id&&previous.exists)throw M.fault(409,'This sponsor has an earlier assignment. Review its history before reassigning.');
   const programmeRef=row.type==='permanent'?db.doc('niazProgrammeSeries/'+M.hash(row.seriesId+':'+row.sponsorId)):null;
   const programme=programmeRef?await tx.get(programmeRef):null;
   pending.push({row,ref,previous:previous.data(),programmeRef,programme});
  }
  const stamp=new Date().toISOString();
  for(const doc of existing.docs)if(!rows.some(row=>row.id===doc.id))tx.update(doc.ref,{status:'cancelled',reason:'Removed from occurrence by coordinator arrangement review',revision:doc.data().revision+1,updatedAt:stamp,reviewedBy:actor.uid});
  for(const {row,ref,previous,programmeRef,programme} of pending){
   const {id,revision,...value}=row;
   tx.set(ref,{...previous,...value,eventId,role:input.mwaArranged||rows.length>1?'joint':row.role,origin:previous?.origin||'coordinator',status:'approved',revision:(previous?.revision||0)+1,year:Number(dateKey(event.startAt).slice(0,4)),createdAt:previous?.createdAt||stamp,approvedAt:previous?.approvedAt||stamp,approvedBy:previous?.approvedBy||actor.uid,updatedAt:stamp});
   if(programmeRef&&!programme.exists)tx.create(programmeRef,{seriesId:row.seriesId,sponsorId:row.sponsorId,status:'active',revision:1,createdAt:stamp,updatedAt:stamp,reason:'Coordinator assignment; future annual occurrences require review.'});
  }
  tx.set(coverageRef,{mwaArranged:input.mwaArranged,arrangementConfirmed:input.arrangementConfirmed,acceptExtraEOIs:input.acceptExtraEOIs,notes,fundsRequiredCents,eventReviewRequired:false,revision:(coverage.revision||0)+1,updatedAt:stamp},{merge:true});
  require('./niaz-api').audit(db,tx,actor,'niaz.event_plan_saved',eventId,{mwaArranged:input.mwaArranged,sponsorIds:rows.map(row=>row.sponsorId),removedAssignmentIds:existing.docs.filter(doc=>!rows.some(row=>row.id===doc.id)).map(doc=>doc.id)});
  return {ok:true};
 });
}
module.exports={saveEventPlan};
