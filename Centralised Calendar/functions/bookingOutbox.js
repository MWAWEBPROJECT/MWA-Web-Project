// Email delivery has no send-idempotency guarantee. Persist each send boundary; ambiguous delivery
// is held for operator review instead of silently sending duplicate messages.
async function deliver(db,id,prepare,send){
 const ref=db.doc('_bookingSubmissionJobs/'+id),now=Date.now();
 const job=await db.runTransaction(async tx=>{const s=await tx.get(ref),v=s.data();if(!v||v.state!=='pending'||v.nextAttempt>now)return null;tx.update(ref,{nextAttempt:now+300000});return v;});
 if(!job)return;
 try{
  const messages=await prepare(job),delivery={...job.delivery};let review=false,retry=false;
  for(let i=0;i<messages.length;i++){
   const status=delivery[i];if(status==='sent')continue;
   if(status==='sending'||status==='review'){review=true;delivery[i]='review';continue;}
   delivery[i]='sending';await ref.update({delivery});
   let result;try{result=await send(messages[i]);}catch{result={sent:false,reason:'send-error'};}
   delivery[i]=result.sent?'sent':['not-configured','invalid-configuration'].includes(result.reason)?'pending':'review';
   if(delivery[i]==='pending')retry=true;if(delivery[i]==='review')review=true;
   await ref.update({delivery});
  }
  await ref.update({state:review?'review':retry?'pending':'sent',nextAttempt:Date.now()+300000,updatedAt:new Date().toISOString()});
 }catch{await ref.update({nextAttempt:Date.now()+300000,lastError:'Preparation or delivery persistence failed; inspect delivery states before retry.'});}
}
module.exports={deliver};
