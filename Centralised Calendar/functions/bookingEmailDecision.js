// Email links never mutate data. This callable runs only after authenticated confirmation.
function register({db,onCall,HttpsError,requireAdmin,FieldValue,emailSecrets,findOverlaps,recomputeVenueConflicts,refreshConflictNeighborhood,sendAll,notify,getHijriOverrides,hijriInfoFor,dateKeyOf,logger}){
 return {decideBookingFromEmail:onCall({cors:true,secrets:emailSecrets},async request=>{
  const actor=await requireAdmin(request.auth,'events-bookings');
  const {eventId,decision,expectedUpdatedAt,note=''}=request.data||{};
  if(typeof eventId!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(eventId)||!['approve','reject'].includes(decision)||typeof expectedUpdatedAt!=='string'||typeof note!=='string'||note.length>2000)throw new HttpsError('invalid-argument','Invalid booking decision.');
  const status=decision==='approve'?'confirmed':'rejected',ref=db.doc('events/'+eventId);let saved,before;
  await db.runTransaction(async tx=>{
   const snap=await tx.get(ref);
   if(!snap.exists)throw new HttpsError('not-found','This booking no longer exists.');
   before=snap.data();
   if(before.status!=='pending')throw new HttpsError('failed-precondition','This request has already been decided. Refresh to see its current status.');
   const updated=before.updatedAt?.toDate?before.updatedAt.toDate().toISOString():before.updatedAt||'';
   if(updated!==expectedUpdatedAt)throw new HttpsError('failed-precondition','This booking changed. Refresh and review its latest details.');
   if(decision==='approve'){
    const overlaps=await findOverlaps(before.venueId,before.startAt,before.endAt,eventId,tx);
    if(overlaps.length)throw new HttpsError('failed-precondition','Approval is unavailable because this booking has a conflict. You can still reject it or review it in the calendar.');
   }
   const patch={status,decidedBy:actor.uid,decidedByEmail:actor.email,decidedAt:FieldValue.serverTimestamp(),decisionNote:note,updatedAt:FieldValue.serverTimestamp(),...(decision==='approve'?{hasConflict:false,conflictWith:[]}:{})};
   tx.update(ref,patch);
   tx.set(db.collection('auditLog').doc(),{module:'events-bookings',entityType:'event',entityId:eventId,action:'status_'+status,userId:actor.uid,userEmail:actor.email,timestamp:new Date().toISOString(),note:'Email action confirmation'+(note?': '+note:''),diff:{from:before.status,to:status}});
   saved={...before,...patch};
  });
  await refreshConflictNeighborhood([{id:eventId,before,after:saved}]).catch(error=>logger.error('Email decision conflict refresh failed',error));
  const hijri=hijriInfoFor(dateKeyOf(saved.startAt),await getHijriOverrides());
  const message=notify.decisionRequester(saved,hijri,status,note);
  if(message&&status==='confirmed')message.attachments=[notify.icsAttachment(saved,eventId)];
  await sendAll([message]);return {id:eventId,status};
 })};
}
module.exports={register};
