const {randomUUID}=require('node:crypto');
const M=require('./niaz-model');
const {resolveAdmin}=require('./moduleAccess');
const {dateKey,midnight,validDate}=require('./donation-records');
const now=()=>new Date().toISOString();
const snapData=snap=>snap.exists?{id:snap.id,...snap.data()}:null;
function audit(db,tx,actor,action,entityId,details={}){
 tx.create(db.collection('auditLog').doc(),{module:'niaz',entityType:'niaz',entityId,action,userId:actor.uid||null,userEmail:actor.email||'',timestamp:now(),...details});
}
function queue(db,tx,key,kind,eventId,extra={}){
 if(kind!=='decision'||extra.decision!=='approved')return; // Other Niaz mail is deliberately disabled.
 tx.set(db.doc('_niazOutbox/'+M.hash(key)),{kind,eventId,...extra,state:'pending',nextAttempt:0,createdAt:now()},{merge:true});
}
function revision(current,input){if(!Number.isSafeInteger(input.revision)||input.revision!==(current?.revision||0))throw M.fault(409,'This record changed. Refresh before saving.');}
async function list(db,collection,after='',where){
 let query=db.collection(collection);if(where)query=query.where(...where);
 query=query.orderBy('__name__');if(after)query=query.startAfter(M.id(after));
 const snapshot=await query.limit(101).get(),docs=snapshot.docs.slice(0,100);
 return {items:docs.map(snapData),next:snapshot.size>100?docs.at(-1).id:null};
}
async function currentEvent(tx,db,eventId){
 const snap=await tx.get(db.doc('events/'+M.id(eventId)));
 if(!snap.exists||!M.eligible(snap.data(),snap.id))throw M.fault(409,'Choose an existing confirmed public MWA programme.');
 return snapData(snap);
}
async function saveSponsor(db,input,actor){
 const value=M.sponsor(input),key=input.id?M.id(input.id):M.sponsorKey(value),ref=db.doc('niazSponsors/'+key);
 return db.runTransaction(async tx=>{
  const current=snapData(await tx.get(ref)),contacts=[];
  for(const contactKey of M.contactKeys(value)){const ref=db.doc('_niazContacts/'+contactKey);contacts.push({ref,contact:snapData(await tx.get(ref))});}
  revision(current,input);
  if(current?.ownerKey&&current.publicConsent!==value.publicConsent)throw M.fault(403,'Verified sponsors manage their own public-name consent. Ask them to update it in their private sponsorship view.');
  if(contacts.some(({contact})=>contact&&contact.sponsorId!==key))throw M.fault(409,'Contact matches another sponsor. Review the existing sponsor rather than merging automatically.');
  if(current?.ownerKey&&(current.email!==value.email||current.phone!==value.phone))throw M.fault(409,'Verified identity contacts cannot be reassigned through sponsor editing.');
  const oldContacts=current?M.contactKeys(current).filter(contactKey=>!M.contactKeys(value).includes(contactKey)):[];
  const consentUnchanged=!!current&&current.publicConsent===value.publicConsent;
  const record={...value,consentVersion:consentUnchanged?current.consentVersion??null:value.consentVersion,nameReviewRequired:current?.nameReviewRequired===true,emailPreferences:current?.emailPreferences||{optionalReminders:true},revision:(current?.revision||0)+1,createdAt:current?.createdAt||now(),updatedAt:now(),consentAt:consentUnchanged?current.consentAt??null:now(),verification:current?.verification||'coordinator-recorded',ownerKey:current?.ownerKey||null};
  tx.set(ref,record);for(const contact of contacts)tx.set(contact.ref,{sponsorId:key});
  for(const contactKey of oldContacts)tx.delete(db.doc('_niazContacts/'+contactKey));
  audit(db,tx,actor,'niaz.sponsor_saved',key,{publicConsent:value.publicConsent});
  return {id:key,...record};
 });
}
async function eoiList(db,after=''){
 const result=await list(db,'niazEOIs',after);
 const metadata=await readDocuments(db,db,result.items.flatMap(row=>(row.events||[]).map(event=>'events/'+M.id(event.eventId))));
 return {...result,items:result.items.map(row=>({...row,events:(row.events||[]).map(event=>({...event,eventTitle:metadata.get('events/'+event.eventId)?.title||'Programme no longer available',eventStartAt:metadata.get('events/'+event.eventId)?.startAt||null}))}))};
}
async function contextualList(db,collection,after='',where){
 const result=await list(db,collection,after,where);
 const refs=result.items.flatMap(row=>['niazSponsors/'+row.sponsorId,...(row.eventId?['events/'+row.eventId]:[])]);
 const metadata=await readDocuments(db,db,refs);
 const items=await Promise.all(result.items.map(async row=>{
  const sponsor=metadata.get('niazSponsors/'+row.sponsorId),event=row.eventId?metadata.get('events/'+row.eventId):null;
  let title=event?.title;
  if(!row.eventId&&row.seriesId){const series=await db.collection('events').where('seriesId','==',row.seriesId).limit(1).get();title=series.docs[0]?.data().title;}
  return {...row,name:sponsor?.name||'Sponsor unavailable',email:sponsor?.email||'',phone:sponsor?.phone||'',eventTitle:title||'Programme unavailable',eventStartAt:event?.startAt||null};
 }));return {...result,items};
}
async function acknowledgeAttention(db,input,actor){
 const ref=db.doc('_niazOutbox/'+M.id(input.id));
 return db.runTransaction(async tx=>{
  const current=snapData(await tx.get(ref));
  if(!current)throw M.fault(404,'Notification record unavailable.');
  if(current.state!=='attention')throw M.fault(409,'Only attention records can be acknowledged. Refresh the delivery status.');
  if(current.acknowledgment)return {acknowledged:true,alreadyAcknowledged:true};
  const acknowledgment={at:now(),by:actor.uid};
  tx.update(ref,{acknowledgment});
  audit(db,tx,actor,'niaz.attention_acknowledged',current.id,{kind:current.kind,state:current.state});
  return {acknowledged:true};
 });
}
async function assign(db,input,actor){
 const value=M.assignment(input),sponsorId=M.id(input.sponsorId),eventId=M.id(input.eventId),key=M.assignmentKey(sponsorId,eventId),ref=db.doc('niazSponsorships/'+key);
 return db.runTransaction(async tx=>{
  const sponsor=snapData(await tx.get(db.doc('niazSponsors/'+sponsorId))),event=await currentEvent(tx,db,eventId),current=snapData(await tx.get(ref));
  const existingSponsors=await tx.get(db.collection('niazSponsorships').where('eventId','==',eventId).where('status','==','approved').limit(501));
  const programmeRef=value.type==='permanent'?db.doc('niazProgrammeSeries/'+M.hash(value.seriesId+':'+sponsorId)):null,programme=programmeRef?await tx.get(programmeRef):null;
  if(!sponsor?.active)throw M.fault(400,'Choose an active sponsor.');
  if(value.seriesId&&event.seriesId!==value.seriesId)throw M.fault(400,'The occurrence does not belong to that calendar series.');
  revision(current,input);
  if(existingSponsors.size>500)throw M.fault(413,'Too many assignments for this programme.');
  if(value.role==='sole'&&existingSponsors.docs.some(doc=>doc.id!==key))throw M.fault(409,'This event already has sponsors. Use joint sponsorship or an explicit reviewed reassignment.');
  if(existingSponsors.docs.some(doc=>doc.id!==key&&doc.data().sponsorId===sponsorId))throw M.fault(409,'This sponsor already has an approved assignment for the event. Review that assignment instead.');
  const record={...value,sponsorId,eventId,origin:'coordinator',status:'approved',arrangementConfirmed:false,revision:(current?.revision||0)+1,year:Number(dateKey(event.startAt).slice(0,4)),approvedBy:actor.uid,approvedAt:now(),createdAt:current?.createdAt||now(),updatedAt:now()};
  tx.set(ref,record);audit(db,tx,actor,'niaz.assignment_saved',key);
  for(const doc of existingSponsors.docs)if(doc.id!==key&&doc.data().role==='sole')tx.update(doc.ref,{role:'joint',revision:(doc.data().revision||0)+1,updatedAt:now()});
  if(programmeRef&&!programme.exists)tx.create(programmeRef,{seriesId:value.seriesId,sponsorId,status:'active',reason:'Permanent commitment approved; future annual occurrences require review.',revision:1,createdAt:now(),updatedAt:now()});
  queue(db,tx,'assignment:'+key+':'+record.revision,'approval',eventId,{sponsorId});
  return {id:key,...record};
 });
}
async function eventDetail(db,eventId,{finance=false,publicOnly=false}={}){
 const source=snapData(await db.doc('events/'+M.id(eventId)).get());
 const assignments=await db.collection('niazSponsorships').where('eventId','==',eventId).limit(501).get();
 if((publicOnly||assignments.empty)&&(!source||!M.eligible(source,eventId)))throw M.fault(404,'Programme unavailable.');
 const event=source||{id:eventId,title:'Programme no longer available',startAt:null,status:'deleted'};
 if(assignments.size>500)throw M.fault(413,'Too many assignments; request an administrative report.');
 const sponsors=new Map();
 for(const a of assignments.docs){const value=a.data();if(!sponsors.has(value.sponsorId))sponsors.set(value.sponsorId,snapData(await db.doc('niazSponsors/'+value.sponsorId).get()));}
 const coverage=snapData(await db.doc('niazEventCoverage/'+eventId).get())||{};
 if(coverage.eventReviewRequired||event.status!=='confirmed')coverage.arrangementConfirmed=false;
 const rows=assignments.docs.map(a=>({id:a.id,...a.data(),sponsor:sponsors.get(a.data().sponsorId)}));
 if(publicOnly)return {eventId,sponsors:rows.map(row=>M.publicSponsor(row.sponsor,row)).filter(Boolean)};
 const safeCoverage={...coverage};delete safeCoverage.targetCents;delete safeCoverage.confirmedCents;
 const pending=await db.collection('niazEOIs').where('eventIds','array-contains',eventId).where('status','==','pending').limit(501).get();
 if(pending.size>500)throw M.fault(413,'Pending EOI report exceeds safe bound; narrow the administrative scope.');
 const pendingEOIs=pending.docs.filter(doc=>doc.data().events.some(item=>item.eventId===eventId&&item.status==='pending')).length;
 const result={event:{id:eventId,title:event.title,startAt:event.startAt,status:event.status,venueName:event.venueName||'',seriesId:event.seriesId||''},assignments:rows,coverage:finance?coverage:safeCoverage,badges:M.badges(rows,{...(finance?coverage:safeCoverage),pendingEOIs,confirmedCents:finance?coverage.confirmedCents||0:0})};
 if(!M.eligible(source,eventId)||coverage.eventReviewRequired)result.badges.push('Event review required');
 if(finance){
  const ledger=await db.collection('_niazSandboxLedger').where('eventId','==',eventId).limit(501).get();
  if(ledger.size>500)throw M.fault(413,'TEST contribution preview exceeds 500 transactions. Request a scoped report.');
  result.sandboxContributions=ledger.docs.map(snapData);
  const sources=ledger.empty?[]:await db.getAll(...ledger.docs.map(doc=>db.doc('_stripeSandboxDonations/'+M.id(doc.data().entry.transactionId))));
  const grouped=new Map();let unavailable=0;
  for(let index=0;index<ledger.docs.length;index++){
   const row=ledger.docs[index].data(),record=sources[index].data();let entry;
   try{entry=record&&M.donationEntry(record,row.entry.transactionId);}catch{unavailable++;continue;}
   if(!entry||entry.eventId!==eventId||row.sponsorId!==M.sponsorKey({email:record.email?.toLowerCase(),phone:record.mobile})||Object.keys(entry).some(key=>entry[key]!==row.entry[key])){unavailable++;continue;}
   if(entry.netCents===0)continue;
   const current=grouped.get(row.sponsorId)||{id:row.sponsorId,name:typeof record.name==='string'?record.name.slice(0,120):'Name not recorded',netCents:0,references:[],role:'joint',status:'confirmed-test'};
   current.netCents+=entry.netCents;current.references.push(require('./donation-records').reference(entry.transactionId));grouped.set(row.sponsorId,current);
  }
  result.sandboxSponsorPreview={sandbox:true,items:[...grouped.values()],unavailable};
 }
 return result;
}
async function saveCoverage(db,eventId,input,actor,finance){
 if(input.confirmedCents!==undefined||input.donationRefs!==undefined)throw M.fault(400,'Confirmed funding is ledger-derived and cannot be entered manually.');
 return db.runTransaction(async tx=>{
  await currentEvent(tx,db,eventId);
  const ref=db.doc('niazEventCoverage/'+eventId),current=snapData(await tx.get(ref));
  revision(current,input);
  if(input.targetCents!==undefined&&!finance)throw M.fault(403,'Niaz finance access is required to set funding targets.');
  for(const flag of ['mwaArranged','arrangementConfirmed','acceptExtraEOIs'])if(typeof input[flag]!=='boolean')throw M.fault(400,'Choose arrangement and EOI settings.');
  const patch={mwaArranged:input.mwaArranged,arrangementConfirmed:input.arrangementConfirmed,acceptExtraEOIs:input.acceptExtraEOIs,eventReviewRequired:false,notes:M.text(input.notes||'','coverage notes',2000),revision:(current?.revision||0)+1,updatedAt:now(),confirmedBy:input.arrangementConfirmed?actor.uid:null,confirmedAt:input.arrangementConfirmed?now():null};
  if(input.targetCents!==undefined)patch.targetCents=M.amount(input.targetCents);
  tx.set(ref,patch,{merge:true});audit(db,tx,actor,'niaz.coverage_updated',eventId,{arrangementConfirmed:patch.arrangementConfirmed});
  return patch;
 });
}
async function identity(req,db,getAuth){
 const bearer=/^Bearer (.+)$/.exec(req.get('Authorization')||'');
 if(bearer){
  let token;try{token=await getAuth().verifyIdToken(bearer[1],true);}catch{throw M.fault(401,'Sign in again.');}
  if(token.email_verified===true||token.phone_number){
   const contact=token.email_verified===true?M.email(token.email):token.phone_number;
   return {uid:token.uid,email:token.email_verified===true?contact:'',phone:token.phone_number||'',ownerKey:'contact:'+M.hash((token.email_verified===true?'email':'mobile')+':'+contact),verified:true,token};
  }
 }
 let proof=req.body?.verification;
 if(!proof){
  try{proof=JSON.parse(req.get('X-Niaz-Verification')||'null');}
  catch{throw M.fault(400,'Invalid verification proof. Verify your contact again.');}
 }
 if(!proof||!/^[A-Za-z0-9_-]{40,50}$/.test(proof.challengeId||'')||!/^[A-Za-z0-9_-]{16,100}$/.test(proof.sessionId||''))throw M.fault(401,'Verify your email or mobile first.');
 const [challenge,session]=await Promise.all([db.doc('_bookingVerificationChallenges/'+proof.challengeId).get(),db.doc('_bookingVerificationSessions/'+M.hash(proof.sessionId)).get()]);
 const c=challenge.data();
 if(!c||c.purpose!=='public-booking'||c.scope!=='contact'||!['email','mobile'].includes(c.method)||!c.contact||c.status!=='verified'||!(c.expiresAt?.toMillis()>Date.now())||c.sessionIdHash!==M.hash(proof.sessionId)||session.data()?.challengeId!==proof.challengeId)throw M.fault(401,'Contact verification expired. Verify again.');
 return {uid:null,email:c.method==='email'?c.contact:'',phone:c.method==='mobile'?c.contact:'',ownerKey:'contact:'+M.hash(c.method+':'+c.contact),verified:true};
}
async function submitEOI(db,input,person){
 if(!Array.isArray(input.eventIds)||input.eventIds.length<1||input.eventIds.length>20)throw M.fault(400,'Select one to twenty actual events.');
 const eventIds=[...new Set(input.eventIds.map(M.id))],value=M.assignment(input),name=M.text(input.name,'name',160,true);
 if(typeof input.publicConsent!=='boolean')throw M.fault(400,'Choose public-name consent.');
 const {verification,...requestDetails}=input;
 const requestHash=M.hash(JSON.stringify(requestDetails));
 const requestId=M.id(input.requestId),key=M.hash(person.ownerKey+':'+requestId),ref=db.doc('niazEOIs/'+key);
 return db.runTransaction(async tx=>{
  const previous=snapData(await tx.get(ref));
  if(previous){if(previous.requestHash!==requestHash)throw M.fault(409,'Submission details changed. Use a new request reference.');return previous;}
  const contact=await tx.get(db.doc('_niazContacts/'+M.sponsorKey(person))),sponsorId=M.id(contact.data()?.sponsorId||M.sponsorKey(person));
  const sponsorRef=db.doc('niazSponsors/'+sponsorId),sponsor=snapData(await tx.get(sponsorRef)),events=[];
  if(contact.exists&&!sponsor)throw M.fault(409,'Contact is linked to a reviewed sponsor record that is unavailable. Contact the coordinator.');
  if(sponsor?.ownerKey&&sponsor.ownerKey!==person.ownerKey)throw M.fault(409,'Sponsor identity requires coordinator review.');
  if(sponsor&&sponsor.active!==true)throw M.fault(409,'Sponsor record is archived. Contact the coordinator before submitting.');
  const limitRef=db.doc('_niazLimits/'+M.hash(person.ownerKey+':'+Math.floor(Date.now()/3600000))),limit=snapData(await tx.get(limitRef));
  if((limit?.count||0)>=10)throw M.fault(429,'Too many requests; try again in an hour.');
  for(const eventId of eventIds){
   const event=await currentEvent(tx,db,eventId);
   if(Date.parse(event.startAt)<=Date.now())throw M.fault(400,'Choose an upcoming programme.');
   if(value.seriesId&&value.seriesId!==event.seriesId)throw M.fault(400,'Choose events in the selected permanent series.');
   const approved=await tx.get(db.collection('niazSponsorships').where('eventId','==',eventId).where('status','==','approved').limit(1));
   const coverage=snapData(await tx.get(db.doc('niazEventCoverage/'+eventId)));
   const intent=M.choice(input.intent||'new',['new','joint','consideration'],'an EOI intent');
   if(!approved.empty&&(intent==='new'||coverage?.acceptExtraEOIs!==true))throw M.fault(409,'Already sponsored. Choose another event; additional EOIs require coordinator-enabled intake and joint or consideration intent.');
   events.push({eventId,intent,status:'pending',year:Number(dateKey(event.startAt).slice(0,4))});
  }
  if(value.type==='annual'&&new Set(events.map(event=>event.year)).size>1)throw M.fault(400,'Annual sponsorship requests must stay within one calendar year; submit separate requests for different years.');
  const record={sponsorId,ownerKey:person.ownerKey,eventIds,events,...value,applicantName:name,status:'pending',revision:1,createdAt:now(),updatedAt:now(),requestHash};
  const sponsorPatch={publicConsent:input.publicConsent,consentVersion:'niaz-2026-11-v1',consentAt:now(),ownerKey:person.ownerKey,verification:'verified-contact',emailPreferences:{optionalReminders:input.optionalReminders===true,consentVersion:'niaz-reminders-v2'},updatedAt:now(),revision:(sponsor?.revision||0)+1};
  if(!sponsor)Object.assign(sponsorPatch,{name,email:person.email,phone:person.phone,active:true,notes:'',createdAt:now()});
  if(sponsor&&name!==sponsor.name)sponsorPatch.nameReviewRequired=true;
  tx.set(sponsorRef,sponsorPatch,{merge:true});
  tx.set(db.doc('_niazContacts/'+M.sponsorKey(person)),{sponsorId});
  tx.set(limitRef,{count:(limit?.count||0)+1,expiresAt:Date.now()+7200000});
  tx.create(ref,record);audit(db,tx,person,'niaz.eoi_submitted',key);
  queue(db,tx,'eoi:'+key,'eoi',eventIds[0],{eoiId:key});
  return {id:key,...record};
 });
}
async function decideEOI(db,eoiId,input,actor){
 return db.runTransaction(async tx=>{
  const ref=db.doc('niazEOIs/'+M.id(eoiId)),current=snapData(await tx.get(ref));
  if(!current)throw M.fault(404,'EOI not found.');revision(current,input);
  const eventId=M.id(input.eventId),target=current.events.find(v=>v.eventId===eventId);
  if(!target||target.status!=='pending')throw M.fault(409,'This event decision is no longer pending.');
  const decision=M.choice(input.decision,['approved','rejected'],'a decision'),reason=M.text(input.reason||'','decision reason',1000,true);
  const event=decision==='approved'?await currentEvent(tx,db,eventId):null;
  const sponsor=snapData(await tx.get(db.doc('niazSponsors/'+current.sponsorId)));
  if(!sponsor?.active)throw M.fault(409,'Sponsor is archived.');
  const approved=await tx.get(db.collection('niazSponsorships').where('eventId','==',eventId).where('status','==','approved').limit(501));
  const approvedType=current.type==='discretion'?M.choice(input.type||'one_time',['one_time','permanent'],'an approved sponsorship type'):current.type;
  if(decision==='approved'&&approvedType==='permanent'&&!event?.seriesId)throw M.fault(400,'Permanent sponsorship needs a calendar series.');
  const approvedSeries=approvedType==='permanent'&&event?event.seriesId:current.seriesId;
  const programmeRef=approvedType==='permanent'?db.doc('niazProgrammeSeries/'+M.hash(approvedSeries+':'+current.sponsorId)):null,programme=programmeRef?await tx.get(programmeRef):null;
  const assignmentRef=db.doc('niazSponsorships/'+M.assignmentKey(current.sponsorId,eventId,'eoi')),existing=await tx.get(assignmentRef);
  if(approved.size>500)throw M.fault(413,'Too many approved sponsors.');
  const replaces=input.reassignIds||[];
  if(!Array.isArray(replaces)||new Set(replaces).size!==replaces.length||replaces.some(id=>id===assignmentRef.id||!approved.docs.some(d=>d.id===id)))throw M.fault(400,'Choose distinct existing assignments to reassign, excluding the applicant assignment.');
  if(decision==='rejected'&&replaces.length)throw M.fault(400,'A declined EOI cannot reassign sponsors.');
  if(replaces.length&&input.confirmReassignment!==true)throw M.fault(400,'Explicitly confirm reassignment and record the reason.');
  if(decision==='approved'){
   if(approved.docs.some(doc=>doc.data().sponsorId===current.sponsorId&&!replaces.includes(doc.id)))throw M.fault(409,'This applicant already has an approved assignment for the event. Review it instead.');
   const role=approved.size>replaces.length?'joint':M.choice(input.role||'joint',['sole','joint'],'a sponsorship role');
   if(existing.exists)throw M.fault(409,'This applicant already has an EOI assignment for the event. Review the existing assignment instead of overwriting it.');
   tx.create(assignmentRef,{sponsorId:current.sponsorId,eventId,seriesId:approvedSeries,type:approvedType,origin:'eoi',role,status:'approved',arrangementConfirmed:false,notes:current.notes,inKind:current.inKind,revision:1,year:Number(dateKey(event.startAt).slice(0,4)),approvedBy:actor.uid,approvedAt:now(),createdAt:now(),updatedAt:now()});
   if(programmeRef&&!programme.exists)tx.create(programmeRef,{seriesId:approvedSeries,sponsorId:current.sponsorId,status:'active',reason:'Permanent EOI approved; annual occurrence review required.',revision:1,createdAt:now(),updatedAt:now()});
   for(const doc of approved.docs)if(!replaces.includes(doc.id)&&doc.data().role==='sole')tx.update(doc.ref,{role:'joint',revision:(doc.data().revision||0)+1,updatedAt:now()});
   for(const doc of approved.docs)if(replaces.includes(doc.id)){tx.update(doc.ref,{status:'reassigned',reason,updatedAt:now(),revision:(doc.data().revision||0)+1});queue(db,tx,'reassign:'+eoiId+':'+doc.id,'reassignment',eventId,{sponsorId:doc.data().sponsorId});}
  }
  const events=current.events.map(v=>v.eventId===eventId?{...v,status:decision,reason,decidedBy:actor.uid,decidedAt:now()}:v);
  tx.update(ref,{events,status:events.some(e=>e.status==='pending')?'pending':'reviewed',revision:current.revision+1,updatedAt:now()});
  audit(db,tx,actor,'niaz.eoi_'+decision,eoiId,{eventId,reassignIds:replaces,reason});
  queue(db,tx,'decision:'+eoiId+':'+eventId,'decision',eventId,{sponsorId:current.sponsorId,decision,eoiId,assignmentId:assignmentRef.id});
  return {events,revision:current.revision+1};
 });
}
async function proposeAlternative(db,input,actor){
 return db.runTransaction(async tx=>{
  const ref=db.doc('niazEOIs/'+M.id(input.id)),current=snapData(await tx.get(ref));if(!current)throw M.fault(404,'EOI unavailable.');
  revision(current,input);const event=await currentEvent(tx,db,M.id(input.eventId)),reason=M.text(input.reason||'','alternative reason',1000,true);
  if(Date.parse(event.startAt)<=Date.now())throw M.fault(400,'Choose an upcoming programme.');
  const alternatives=[...(current.alternatives||[]),{eventId:event.id,title:event.title,status:'proposed',reason,proposedBy:actor.uid,proposedAt:now()}];
  if(alternatives.length>20)throw M.fault(400,'Review existing alternatives before proposing more.');
  tx.update(ref,{alternatives,revision:current.revision+1,updatedAt:now()});audit(db,tx,actor,'niaz.alternative_proposed',current.id,{eventId:event.id,reason});
  queue(db,tx,'alternative:'+current.id+':'+current.revision,'alternative',event.id,{sponsorId:current.sponsorId});
  return {proposed:true,assignmentCreated:false};
 });
}
async function own(db,person,{assignmentAfter='',eoiAfter=''}={}){
 const sponsors=await db.collection('niazSponsors').where('ownerKey','==',person.ownerKey).limit(2).get();
 if(sponsors.size>1)throw M.fault(409,'Identity is linked to more than one sponsor. Request a coordinator review; no match is guessed.');
 const sponsor=sponsors.docs[0];if(!sponsor)return {sponsor:null,assignments:[],eois:[],membershipAvailable:false};
 const assignments=await list(db,'niazSponsorships',assignmentAfter,['sponsorId','==',sponsor.id]),eois=await list(db,'niazEOIs',eoiAfter,['ownerKey','==',person.ownerKey]);
 for(const row of assignments.items){
  const [event,coverage]=await Promise.all([db.doc('events/'+row.eventId).get(),db.doc('niazEventCoverage/'+row.eventId).get()]);
  row.eventTitle=event.exists?event.data().title:'Programme no longer available';row.eventStartAt=event.data()?.startAt||null;
  row.eventStatus=event.data()?.status||'deleted';row.arrangementConfirmed=event.data()?.status==='confirmed'&&!coverage.data()?.eventReviewRequired&&coverage.data()?.arrangementConfirmed===true;
 }
 const eventMetadata=new Map();
 for(const row of eois.items)for(const item of row.events||[])if(!eventMetadata.has(item.eventId))eventMetadata.set(item.eventId,null);
 const metadata=await readDocuments(db,db,[...eventMetadata.keys()].map(id=>'events/'+id));
 const ownSponsor=snapData(sponsor);
 const safeSponsor={id:ownSponsor.id,name:ownSponsor.name,email:ownSponsor.email,phone:ownSponsor.phone,publicConsent:ownSponsor.publicConsent,consentVersion:ownSponsor.consentVersion,consentAt:ownSponsor.consentAt,revision:ownSponsor.revision,emailPreferences:ownSponsor.emailPreferences||{optionalReminders:true}};
 const safeAssignments=assignments.items.map(row=>({id:row.id,eventId:row.eventId,eventTitle:row.eventTitle,eventStartAt:row.eventStartAt,eventStatus:row.eventStatus,type:row.type,role:row.role,origin:row.origin,status:row.status,fulfilmentStatus:row.fulfilmentStatus||'pending',arrangementConfirmed:row.arrangementConfirmed,eventReviewRequired:row.eventReviewRequired===true,createdAt:row.createdAt}));
 const safeEOIs=eois.items.map(row=>({id:row.id,revision:row.revision,status:row.status,type:row.type,notes:row.notes||'',inKind:row.inKind||'',createdAt:row.createdAt,events:row.events.map(event=>({eventId:event.eventId,eventTitle:metadata.get('events/'+event.eventId)?.title||'Programme no longer available',eventStartAt:metadata.get('events/'+event.eventId)?.startAt||null,status:event.status,reason:event.reason||''})),alternatives:(row.alternatives||[]).map(event=>({eventId:event.eventId,title:event.title,status:event.status,reason:event.reason}))}));
 return {sponsor:safeSponsor,assignments:safeAssignments,assignmentNext:assignments.next,eois:safeEOIs,eoiNext:eois.next,membershipAvailable:false};
}
async function editOwnEOI(db,input,person){
 return db.runTransaction(async tx=>{
  const ref=db.doc('niazEOIs/'+M.id(input.id)),current=snapData(await tx.get(ref));
  if(!current||current.ownerKey!==person.ownerKey)throw M.fault(404,'EOI unavailable.');
  revision(current,input);
  if(current.events.some(event=>event.status!=='pending'))throw M.fault(409,'Reviewed requests cannot be edited. Contact the coordinator.');
  const patch={notes:M.text(input.notes||'','offer details',2000),inKind:M.text(input.inKind||'','in-kind details',1000),updatedAt:now(),revision:current.revision+1};
  tx.update(ref,patch);audit(db,tx,person,'niaz.eoi_edited',current.id);return {ok:true};
 });
}
async function readDocuments(reader,db,paths){
 const refs=[...new Set(paths)].map(path=>db.doc(path)),result=new Map();
 if(!refs.length)return result;
 const snapshots=await reader.getAll(...refs);
 for(const snapshot of snapshots)result.set(snapshot.ref.path,snapData(snapshot));
 return result;
}
async function previewImport(db,rows,actor){
 if(!Array.isArray(rows)||rows.length<1||rows.length>500||Buffer.byteLength(JSON.stringify(rows))>800000)throw M.fault(400,'Import between 1 and 500 rows (under 800 KB).');
 const prepared=rows.map((input,index)=>{
  try{return {row:index+1,value:M.importRow(input)};}
  catch(error){if(!error.status)throw error;return {row:index+1,error:error.message};}
 });
 const days=new Map();
 const dates=[...new Set(prepared.filter(row=>!row.error).map(row=>row.value.eventDate))];
 // Bound concurrency across distinct dates; repeated dates share one authoritative query.
 for(let offset=0;offset<dates.length;offset+=10)await Promise.all(dates.slice(offset,offset+10).map(async date=>days.set(date,await require('./donation-records').eventList(db,date))));
 for(const row of prepared){
  if(row.error)continue;
  const candidates=days.get(row.value.eventDate).filter(event=>!row.value.eventId||event.id===row.value.eventId);
  if(candidates.length!==1)row.error='Resolve this date to exactly one event reference. Multiple matches are never guessed.';
  else row.eventId=candidates[0].id;
 }
 const valid=prepared.filter(row=>!row.error);
 const [events,contacts]=await Promise.all([
  readDocuments(db,db,valid.map(row=>'events/'+row.eventId)),
  readDocuments(db,db,valid.flatMap(row=>M.contactKeys(row.value).map(key=>'_niazContacts/'+key)))
 ]);
 for(const row of valid){
  try{
   const event=events.get('events/'+row.eventId);
   if(!M.eligible(event,row.eventId))throw M.fault(400,'Select a confirmed MWA programme.');
   if(dateKey(event.startAt)!==row.value.eventDate||row.value.seriesId&&row.value.seriesId!==event.seriesId)throw M.fault(400,'Series or date reference does not match occurrence.');
   const matches=new Set(M.contactKeys(row.value).map(key=>contacts.get('_niazContacts/'+key)?.sponsorId).filter(Boolean));
   if(matches.size>1)throw M.fault(409,'Email and mobile match different sponsors. Review the contacts before importing.');
   row.sponsorId=M.id([...matches][0]||M.sponsorKey(row.value));
   row.assignmentId=M.assignmentKey(row.sponsorId,row.eventId,'import');
  }catch(error){if(!error.status)throw error;row.error=error.message;}
 }
 const assignments=await readDocuments(db,db,prepared.filter(row=>!row.error).map(row=>'niazSponsorships/'+row.assignmentId));
 const seen=new Set(),seenContacts=new Map();
 const results=prepared.map(row=>{
  if(row.error)return {row:row.row,error:row.error};
  for(const key of M.contactKeys(row.value))if(seenContacts.has(key)&&seenContacts.get(key)!==row.sponsorId)return {row:row.row,error:'Contact overlaps another row with a different sponsor identity. Review rather than merging automatically.'};
  for(const key of M.contactKeys(row.value))seenContacts.set(key,row.sponsorId);
  const duplicate=seen.has(row.assignmentId)||!!assignments.get('niazSponsorships/'+row.assignmentId);seen.add(row.assignmentId);
  return {row:row.row,value:{...row.value,eventId:row.eventId},sponsorId:row.sponsorId,assignmentId:row.assignmentId,duplicate};
 });
 const jobId=randomUUID(),job={ownerUid:actor.uid,rows:results,offset:0,state:'preview',createdAt:now(),expiresAt:Date.now()+86400000};
 if(Buffer.byteLength(JSON.stringify(job))>900000)throw M.fault(413,'Import preview exceeds the safe document size; split the workbook into smaller batches.');
 await db.doc('_niazImports/'+jobId).create(job);
 return {jobId,rows:results};
}
async function importStep(db,jobId,offset,actor){
 return db.runTransaction(async tx=>{
  const ref=db.doc('_niazImports/'+M.id(jobId)),job=snapData(await tx.get(ref));
  if(!job||job.ownerUid!==actor.uid||job.expiresAt<Date.now())throw M.fault(404,'Import preview expired.');
  if(job.offset!==offset||!['preview','running'].includes(job.state))throw M.fault(409,'Import progress changed. Refresh.');
  const rows=job.rows.slice(offset,offset+40),read=[];
  const documents=await readDocuments(tx,db,rows.filter(row=>!row.error&&!row.duplicate).flatMap(row=>[
   'events/'+row.value.eventId,'niazSponsors/'+row.sponsorId,'niazSponsorships/'+row.assignmentId,...M.contactKeys(row.value).map(key=>'_niazContacts/'+key)
  ]));
  for(const row of rows){
   if(row.error||row.duplicate)continue;
   const event=documents.get('events/'+row.value.eventId);
   if(!M.eligible(event,row.value.eventId))throw M.fault(409,'Choose an existing confirmed public MWA programme.');
   if(dateKey(event.startAt)!==row.value.eventDate||row.value.seriesId&&event.seriesId!==row.value.seriesId)throw M.fault(409,'Programme changed after preview; start a new preview.');
   for(const key of M.contactKeys(row.value)){
    const contact=documents.get('_niazContacts/'+key);
    if(contact&&contact.sponsorId!==row.sponsorId)throw M.fault(409,'An import contact belongs to another sponsor reference. Resolve the match before importing.');
   }
   read.push({row,event,sponsor:documents.get('niazSponsors/'+row.sponsorId),assignment:documents.get('niazSponsorships/'+row.assignmentId)});
  }
  const eventGroups=new Map(),programmes=new Map();
  for(const {row,event,sponsor,assignment} of read){
   if(assignment)continue;
   if(sponsor&&sponsor.active!==true)throw M.fault(409,'An imported sponsor is inactive. Review the directory first.');
   if(!eventGroups.has(event.id)){
    const existing=await tx.get(db.collection('niazSponsorships').where('eventId','==',event.id).where('status','==','approved').limit(501));
    if(existing.size>500)throw M.fault(413,'Too many sponsors for this event.');
    eventGroups.set(event.id,{existing:existing.docs,added:[]});
   }
   const group=eventGroups.get(event.id),peers=[...group.existing.map(doc=>doc.data()),...group.added];
   if(peers.some(peer=>peer.sponsorId===row.sponsorId))throw M.fault(409,'An imported sponsor is already assigned to this event. Edit the existing assignment.');
   if(row.value.role==='sole'&&peers.length)throw M.fault(409,'A sole sponsorship conflicts with existing or imported sponsors. Choose joint sponsorship before importing.');
   if(group.added.some(peer=>peer.role==='sole'))throw M.fault(409,'Import contains incompatible sole and joint sponsors. Review it before importing.');
   group.added.push({sponsorId:row.sponsorId,role:row.value.role});
   if(row.value.type==='permanent'){
    const key=M.hash(row.value.seriesId+':'+row.sponsorId);
    if(!programmes.has(key)){const ref=db.doc('niazProgrammeSeries/'+key);programmes.set(key,{ref,snapshot:await tx.get(ref),row});}
   }
  }
  for(const {existing,added} of eventGroups.values())if(added.length)for(const doc of existing)if(doc.data().role==='sole')tx.update(doc.ref,{role:'joint',revision:doc.data().revision+1,updatedAt:now()});
  for(const {ref,snapshot,row} of programmes.values())if(!snapshot.exists)tx.create(ref,{seriesId:row.value.seriesId,sponsorId:row.sponsorId,status:'active',revision:1,createdAt:now(),updatedAt:now(),reason:'Coordinator imported assignment; future annual occurrences require review.'});
  for(const {row,event,sponsor,assignment} of read){
   if(assignment)continue;
   if(!sponsor)tx.set(db.doc('niazSponsors/'+row.sponsorId),{...M.sponsor(row.value),verification:'import-unverified',ownerKey:null,revision:1,consentAt:now(),createdAt:now(),updatedAt:now()});
   for(const key of M.contactKeys(row.value))tx.set(db.doc('_niazContacts/'+key),{sponsorId:row.sponsorId});
   tx.set(db.doc('niazSponsorships/'+row.assignmentId),{...M.assignment(row.value),sponsorId:row.sponsorId,eventId:event.id,origin:'import',status:'approved',approvedBy:actor.uid,approvedAt:now(),arrangementConfirmed:false,revision:1,year:Number(dateKey(event.startAt).slice(0,4)),createdAt:now(),updatedAt:now()});
  }
  const next=offset+rows.length,state=next>=job.rows.length?'complete':'running';
  tx.update(ref,{offset:next,state});audit(db,tx,actor,'niaz.import_batch',jobId,{offset,processed:rows.length});
  return {offset:next,state};
 });
}
async function legacyPreview(db,year){
 M.annualYear(year);
 const events=await db.collection('events').where('startAt','>=',new Date(midnight(year+'-01-01')).toISOString()).where('startAt','<',new Date(midnight((year+1)+'-01-01')).toISOString()).orderBy('startAt').limit(1001).get();
 if(events.size>1000)throw M.fault(413,'Legacy review exceeds 1,000 events. Use a narrower reviewed source export.');
 return {items:events.docs.filter(doc=>doc.data().niazSponsor).map(doc=>{
  const event=doc.data(),legacy=event.niazSponsor;
  return {name:legacy.name||'',phone:legacy.phone||'',email:'',eventId:doc.id,eventDate:dateKey(event.startAt),type:'one_time',seriesId:event.seriesId||'',role:'joint',publicConsent:false,notes:legacy.notes||'',memberId:''};
 })};
}
async function dashboard(db,month,finance){
 if(typeof month!=='string'||!validDate(month+'-01'))throw M.fault(400,'Choose a valid programme month.');
 const year=Number(month.slice(0,4)),number=Number(month.slice(5)),next=number===12?(year+1)+'-01-01':year+'-'+String(number+1).padStart(2,'0')+'-01';
 const events=await db.collection('events').where('startAt','>=',new Date(midnight(month+'-01')).toISOString()).where('startAt','<',new Date(midnight(next)).toISOString()).orderBy('startAt').limit(251).get();
 if(events.size>250)throw M.fault(413,'Programme month exceeds 250 events. Use a narrower event-date review.');
 const items=[];
 for(const doc of events.docs){
  if(!M.eligible(doc.data(),doc.id))continue;
  const detail=await eventDetail(db,doc.id,{finance});
  items.push({id:doc.id,eventId:doc.id,title:detail.event.title,startAt:detail.event.startAt,year,month,badges:detail.badges,coverage:detail.coverage,approvedSponsors:detail.assignments.filter(row=>row.status==='approved').length,needsArrangement:!detail.coverage.arrangementConfirmed});
 }
 return {items,next:null,liveFinanceAvailable:false};
}
async function handle(req,res,{db,getAuth,origins}){
 res.set('Cache-Control','no-store');
 try{
  const path=req.path.replace(/^\/api\/niaz/,'').replace(/\/$/,'')||'/',input=req.body||{};
  if(req.method!=='GET'){
   if(req.method!=='POST'||!origins.has(req.get('Origin'))||!req.is('application/json'))throw M.fault(403,'Use the MWA website and JSON requests.');
   if(Buffer.byteLength(JSON.stringify(input))>900000)throw M.fault(413,'Request too large.');
  }
  if(path==='/public'&&req.method==='GET')return res.json(await eventDetail(db,M.id(req.query.eventId),{publicOnly:true}));
  if(path==='/events'&&req.method==='GET'){
   if(!validDate(req.query.date))throw M.fault(400,'Choose a valid date.');
   const items=(await require('./donation-records').eventList(db,req.query.date)).filter(event=>event);
   const eligible=[];for(const event of items){const source=(await db.doc('events/'+event.id).get()).data();if(M.eligible(source,event.id))eligible.push({...event,seriesId:source.seriesId||'',...await eventDetail(db,event.id,{publicOnly:true}),alreadySponsored:!(await db.collection('niazSponsorships').where('eventId','==',event.id).where('status','==','approved').limit(1).get()).empty,acceptExtraEOIs:(await db.doc('niazEventCoverage/'+event.id).get()).data()?.acceptExtraEOIs===true});}
   return res.json({items:eligible});
  }
  const person=await identity(req,db,getAuth);
  if(path==='/mine'&&req.method==='GET')return res.json(await own(db,person,{assignmentAfter:req.query.assignmentAfter||'',eoiAfter:req.query.eoiAfter||''}));
  if(path==='/eoi'&&req.method==='POST')return res.json(await submitEOI(db,input,person));
  if(path==='/eoi-edit'&&req.method==='POST')return res.json(await editOwnEOI(db,input,person));
  if(path==='/consent'&&req.method==='POST'){
   if(typeof input.publicConsent!=='boolean')throw M.fault(400,'Choose consent.');
   const contact=(await db.doc('_niazContacts/'+M.sponsorKey(person)).get()).data(),sponsorId=M.id(contact?.sponsorId||M.sponsorKey(person));
   await db.runTransaction(async tx=>{const ref=db.doc('niazSponsors/'+sponsorId),s=snapData(await tx.get(ref));if(!s||s.ownerKey!==person.ownerKey)throw M.fault(404,'Sponsor record unavailable.');tx.update(ref,{publicConsent:input.publicConsent,consentAt:now(),updatedAt:now(),revision:s.revision+1});audit(db,tx,person,'niaz.consent_changed',sponsorId);});
   return res.json({ok:true});
  }
  if(path==='/preferences'&&req.method==='POST'){
   if(typeof input.optionalReminders!=='boolean')throw M.fault(400,'Choose optional reminder preferences.');
   const contact=(await db.doc('_niazContacts/'+M.sponsorKey(person)).get()).data(),sponsorId=M.id(contact?.sponsorId||M.sponsorKey(person));
   await db.runTransaction(async tx=>{const ref=db.doc('niazSponsors/'+sponsorId),s=snapData(await tx.get(ref));if(!s||s.ownerKey!==person.ownerKey)throw M.fault(404,'Sponsor record unavailable.');revision(s,input);tx.update(ref,{emailPreferences:{optionalReminders:input.optionalReminders,consentVersion:'niaz-reminders-v2'},updatedAt:now(),revision:s.revision+1});audit(db,tx,person,'niaz.preferences_changed',sponsorId);});
   return res.json({ok:true});
  }
  if(path==='/withdraw'&&req.method==='POST'){
   await db.runTransaction(async tx=>{const ref=db.doc('niazEOIs/'+M.id(input.id)),e=snapData(await tx.get(ref));if(!e||e.ownerKey!==person.ownerKey)throw M.fault(404,'EOI unavailable.');revision(e,input);const events=e.events.map(v=>v.status==='pending'?{...v,status:'withdrawn'}:v);tx.update(ref,{events,status:events.some(v=>v.status==='approved')?'reviewed':'withdrawn',revision:e.revision+1,updatedAt:now()});audit(db,tx,person,'niaz.eoi_withdrawn',e.id);});return res.json({ok:true});
  }
  if(!person.token)throw M.fault(403,'Niaz administration access required.');
  const manager=await resolveAdmin(db,person.uid,person.token,'niaz'),reader=manager||await resolveAdmin(db,person.uid,person.token,'niaz-read')||await resolveAdmin(db,person.uid,person.token,'niaz-finance');
  if(!reader)throw M.fault(403,'Niaz access is not assigned.');
  const finance=!!await resolveAdmin(db,person.uid,person.token,'niaz-finance');
  if(req.method==='GET'){
   if(path==='/session')return res.json({manage:!!manager,finance,membershipAvailable:false,liveFinanceAvailable:false});
   if(path==='/eois')return res.json(await eoiList(db,req.query.after||''));
   const collection={'/sponsors':'niazSponsors','/assignments':'niazSponsorships','/eois':'niazEOIs','/programmes':'niazProgrammeSeries'}[path];
   if(collection)return res.json(await (['niazSponsorships','niazProgrammeSeries'].includes(collection)?contextualList(db,collection,req.query.after||''):list(db,collection,req.query.after||'')));
   if(path==='/proposals')return res.json(await contextualList(db,'niazSponsorships',req.query.after||'',['status','==','proposed']));
   if(path==='/sandbox-ledger'){
    if(!finance)throw M.fault(403,'Niaz finance access is required for TEST contribution reports.');
    return res.json(await list(db,'_niazSandboxLedger',req.query.after||''));
   }
   if(path==='/event')return res.json(await eventDetail(db,req.query.eventId,{finance}));
   if(path==='/settings')return res.json((await db.doc('_niazPrivate/settings').get()).data()||{notificationEnabled:false,threeDayFollowup:false,revision:0});
   if(path==='/notifications')return res.json(await list(db,'_niazOutbox',req.query.after||''));
   if(path==='/legacy-preview')return res.json(await legacyPreview(db,Number(req.query.year)));
   if(path==='/dashboard')return res.json(await dashboard(db,req.query.month,finance));
  }
  if(path==='/export-audit'&&req.method==='POST'){
   if(!Array.isArray(input.reports)||input.reports.some(value=>typeof value!=='string'||value.length>80))throw M.fault(400,'Choose valid exports.');
   await db.runTransaction(async tx=>audit(db,tx,reader,'niaz.register_exported','register',{reports:input.reports}));return res.json({ok:true});
  }
  if(req.method!=='POST')throw M.fault(405,'Use POST for Niaz changes.');
  if(!manager)throw M.fault(403,'Niaz coordinator management access required.');
  if(path==='/attention-acknowledge')return res.json(await acknowledgeAttention(db,input,manager));
  if(path==='/sponsor')return res.json({sponsor:await saveSponsor(db,input,manager)});
  if(path==='/event-plan')return res.json(await require('./niaz-event-plan').saveEventPlan(db,input,manager));
  if(path==='/assign')return res.json({assignment:await assign(db,input,manager)});
  if(path==='/coverage')return res.json(await saveCoverage(db,M.id(input.eventId),input,manager,finance));
  if(path==='/decision')return res.json(await decideEOI(db,input.id,input,manager));
  if(path==='/eoi-alternative')return res.json(await proposeAlternative(db,input,manager));
  if(path==='/import-preview')return res.json(await previewImport(db,input.rows,manager));
  if(path==='/import-step')return res.json(await importStep(db,input.jobId,input.offset,manager));
  if(path==='/programme')return res.json(await require('./niaz-lifecycle').saveProgramme(db,input,manager));
  if(path==='/programme-transfer')return res.json(await require('./niaz-lifecycle').transferProgramme(db,input,manager));
  if(path==='/annual-propose')return res.json(await require('./niaz-lifecycle').proposeYear(db,input,manager));
  if(path==='/assignment-review')return res.json(await require('./niaz-lifecycle').reviewAssignment(db,input,manager));
  if(path==='/settings')return res.json(await require('./niaz-notifications').settings(db,input,manager));
  throw M.fault(404,'Niaz action not found.');
 }catch(error){console.error('Niaz request failed',{status:error.status||503,message:error.status?error.message:'Internal request failure'});return res.status(error.status||503).json({error:error.status?error.message:'Niaz is temporarily unavailable. No success is assumed; refresh before retrying.'});}
}
module.exports={handle,list,contextualList,saveSponsor,assign,eventDetail,saveCoverage,submitEOI,decideEOI,proposeAlternative,own,previewImport,importStep,identity,audit,queue,legacyPreview,editOwnEOI,dashboard,eoiList,acknowledgeAttention};
