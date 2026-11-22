import React,{useEffect,useRef,useState} from 'react';
import {auth} from '@calendar/firebase/firebase.js';
import {onAuthStateChanged} from 'firebase/auth';
import {watchVenues,watchDepartments} from '@calendar/services/directoryService.js';
import {availableBookingTypes} from '@calendar/utils/bookingTypes.js';
import {audienceError} from '@calendar/utils/venuePolicy.js';
import {AUDIENCES} from '@calendar/utils/audience.js';
import {localToUtcIso,dateKeyInOrgTz} from '@calendar/utils/dateUtils.js';
import {earliestAllowedPublicStart,MIN_PUBLIC_LEAD_HOURS} from '@calendar/utils/publicLeadTime.js';
import {startBookingVerification,verifyBookingEmailCode,verifyBookingMobile,submitBooking,checkSlotConflicts} from '@calendar/services/eventsService.js';
import {verificationPhone,contactError} from '@calendar/utils/contactVerification.mjs';
import {niazApi} from './niaz-client.js';
import {NIAZ_ARRANGEMENTS} from './niaz-offer.mjs';
import ContactVerification from '@calendar/components/ContactVerification.jsx';

const newSession=()=>crypto.randomUUID().replace(/-/g,'');
const newBooking=()=>({title:'',audience:'family',venueId:'',date:'',start:'',end:'',contactName:'',contactEmail:'',contactPhone:'',visibility:'public',notes:''});
const newOffer=()=>({date:'',eventIds:[],name:'',type:'one_time',intent:'new',arrangement:'',notes:'',inKind:'',publicConsent:false,optionalReminders:false});
const dateLabel=value=>new Date(value).toLocaleString('en-AU',{timeZone:'Australia/Sydney',dateStyle:'medium',timeStyle:'short'});
const nextDay=date=>new Date(Date.parse(date+'T12:00:00Z')+86400000).toISOString().slice(0,10);

export default function KhadimPublicWorkflow({kind,onClose}){
 const [user,setUser]=useState(auth.currentUser);
 const authenticated=!!user&&!user.isAnonymous&&(user.emailVerified||!!user.phoneNumber);
 const [stage,setStage]=useState('verify'),[method,setMethod]=useState('email'),[contact,setContact]=useState(''),[code,setCode]=useState(''),[challenge,setChallenge]=useState(null),[proof,setProof]=useState(null),[phoneConfirmation,setPhoneConfirmation]=useState(null),[resendAt,setResendAt]=useState(0);
 const [booking,setBooking]=useState(newBooking),[offer,setOffer]=useState(newOffer),[venues,setVenues]=useState([]),[departments,setDepartments]=useState([]),[events,setEvents]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[result,setResult]=useState(null),[conflict,setConflict]=useState(null);
 const sessionId=useRef(newSession()),requestId=useRef(crypto.randomUUID()),previousUser=useRef(auth.currentUser?.uid||null);
 const types=availableBookingTypes(departments,false);
 const selectedEvents=events.filter(event=>offer.eventIds.includes(event.id));
 const ready=authenticated||!!proof;
 const updateBooking=(key,value)=>{setBooking(current=>({...current,[key]:value}));setConflict(null);};
 const updateOffer=(key,value)=>{setOffer(current=>({...current,[key]:value}));requestId.current=crypto.randomUUID();};
 useEffect(()=>onAuthStateChanged(auth,value=>{
  if(previousUser.current!==(value?.uid||null)){setProof(null);setChallenge(null);setCode('');setStage('verify');setResult(null);previousUser.current=value?.uid||null;}
  setUser(value);
 }),[]);
 useEffect(()=>{
  if(kind!=='booking')return undefined;
  const offV=watchVenues(setVenues),offD=watchDepartments(setDepartments);
  return()=>{offV();offD();};
 },[kind]);
 useEffect(()=>()=>{import('@calendar/services/phoneBookingAuth.js').then(service=>service.clearBookingPhoneRecaptcha());},[]);
 useEffect(()=>{if(authenticated&&stage==='verify')setStage(kind==='booking'?'booking-details':'find-event');},[authenticated,stage,kind]);
 function resetContact(value){setContact(value);setProof(null);setChallenge(null);setCode('');setPhoneConfirmation(null);setError('');}
 async function run(action){if(busy)return;setBusy(true);setError('');try{await action();}catch(problem){setError(problem?.message||'Please try again.');}finally{setBusy(false);}}
 async function sendCode(){
  const issue=contactError(method,contact);if(issue)throw Error(issue);
  const number=method==='mobile'?verificationPhone(contact):'';
  const next=await startBookingVerification({method,sessionId:sessionId.current,contactEmail:method==='email'?contact.trim():'',contactPhone:number});
  setChallenge(next);setResendAt(Date.now()+next.resendAfterMs);
  if(method==='mobile'){const phone=await import('@calendar/services/phoneBookingAuth.js');setPhoneConfirmation(await phone.sendBookingPhoneCode(number));}
  setNotice('Code sent. Enter it here to continue.');
 }
 async function verifyCode(){
  if(!challenge)throw Error('Request a new verification code.');
  if(method==='email')await verifyBookingEmailCode({challengeId:challenge.challengeId,sessionId:sessionId.current,code});
  else{if(!phoneConfirmation)throw Error('Request a new mobile code.');const phone=await import('@calendar/services/phoneBookingAuth.js');const idToken=await phone.confirmBookingPhoneCode(phoneConfirmation,code);await verifyBookingMobile({challengeId:challenge.challengeId,sessionId:sessionId.current,idToken});}
  setProof({challengeId:challenge.challengeId,sessionId:sessionId.current});
  if(kind==='booking')setBooking(current=>({...current,[method==='email'?'contactEmail':'contactPhone']:contact.trim()}));
  setNotice('Contact verified. Your details will stay in this browser until you submit.');
  setStage(kind==='booking'?'booking-details':'find-event');
 }
 async function findEvents(){
  if(!offer.date)throw Error('Choose a programme date.');
  const data=await niazApi('/events?date='+encodeURIComponent(offer.date));
  setEvents(current=>[...current.filter(item=>!data.items.some(next=>next.id===item.id)),...data.items]);
  setNotice(data.items.length?'Choose the programme you want to sponsor.':'No eligible public MWA programmes were found on that date.');
 }
 function bookingRange(){
  if(!booking.date||!booking.start||!booking.end)throw Error('Choose a date, start time and end time.');
  const startAt=localToUtcIso(booking.date,booking.start);
  const endAt=localToUtcIso(booking.end<=booking.start?nextDay(booking.date):booking.date,booking.end);
  if(!startAt||!endAt||Date.parse(endAt)<=Date.parse(startAt))throw Error('Check the date and times.');
  if(Date.parse(startAt)<earliestAllowedPublicStart())throw Error('Public bookings must start at least '+MIN_PUBLIC_LEAD_HOURS+' hours from now.');
  return {startAt,endAt};
 }
 async function reviewBooking(){
  if(!booking.title.trim()||!booking.venueId||!types.length)throw Error('Enter a title and choose a venue.');
  if(audienceError(venues.find(v=>v.id===booking.venueId),booking.audience))throw Error('This venue is not available for that audience.');
  if(!booking.contactName.trim())throw Error('Enter your contact name.');
  if(method==='email'&&!authenticated&&booking.contactEmail.trim().toLowerCase()!==contact.trim().toLowerCase())throw Error('The booking email must match your verified email.');
  if(method==='mobile'&&!authenticated&&verificationPhone(booking.contactPhone)!==verificationPhone(contact))throw Error('The booking mobile must match your verified mobile.');
  const range=bookingRange();
  try{setConflict(await checkSlotConflicts({venueId:booking.venueId,audience:booking.audience,...range}));}
  catch{setConflict(null);setNotice('Availability could not be checked right now. The booking team will review the request.');}
  setStage('booking-review');
 }
 async function submitPublicBooking(){
  if(!ready)throw Error('Verify your contact first.');
  const range=bookingRange();
  const payload={...booking,...range,departmentId:types[0]?.id,dateBasis:'g',hijriDate:null,timeMode:'custom',speakerName:'',programDetails:'',startPrayer:null,endPrayer:null};
  delete payload.date;delete payload.start;delete payload.end;
  if(!authenticated)Object.assign(payload,{verificationChallengeId:proof.challengeId,verificationSessionId:sessionId.current});
  const saved=await submitBooking(payload);
  setResult({kind:'booking',id:saved?.id||saved?.eventId||'',status:saved?.status||'pending'});
  setStage('done');
 }
 async function reviewOffer(){
  if(!offer.eventIds.length)throw Error('Choose a programme.');
  if(!offer.name.trim())throw Error('Enter your name.');
  if(offer.eventIds.some(id=>!selectedEvents.some(item=>item.id===id)))throw Error('Search for the selected programmes again.');
  if(offer.type==='permanent'&&(!selectedEvents[0]?.seriesId||selectedEvents.some(item=>item.seriesId!==selectedEvents[0].seriesId)))throw Error('Permanent sponsorship requires one recurring programme series.');
  if(selectedEvents.some(item=>item.alreadySponsored)&&(offer.intent!=='joint'||selectedEvents.some(item=>!item.acceptExtraEOIs)))throw Error('This programme already has a sponsor and is not accepting this request. Choose another programme.');
  if(offer.intent==='joint'&&!offer.notes.trim())throw Error('Tell the coordinator how you would like to share sponsorship.');
  if(offer.intent==='new'&&!offer.arrangement)throw Error('Choose an arrangement.');
  setStage('offer-review');
 }
 async function submitOffer(){
  if(!ready)throw Error('Verify your contact first.');
  const body={name:offer.name.trim(),publicConsent:offer.publicConsent,eventIds:offer.eventIds,type:offer.type,seriesId:offer.type==='permanent'?selectedEvents[0]?.seriesId||'':'',intent:offer.intent,optionalReminders:offer.optionalReminders,notes:offer.intent==='joint'?offer.notes:offer.arrangement,inKind:offer.inKind,requestId:requestId.current};
  const saved=await niazApi('/eoi',body,proof);
  setResult({kind:'niaz',id:saved?.id||'',status:'pending'});
  setStage('done');
 }
 const action=(event,fn)=>{event.preventDefault();run(fn);};
 return <section className="mwa-ai-workflow" aria-label={kind==='booking'?'Public booking with Khadim':'Niaz offer with Khadim'}>
  <div className="mwa-ai-workflow-head"><strong>{kind==='booking'?'Book a public event':'Offer Niaz sponsorship'}</strong><button type="button" onClick={onClose}>Return to chat</button></div>
  {error&&<p className="mwa-ai-workflow-error" role="alert">{error}</p>}{notice&&<p className="mwa-ai-workflow-note" role="status">{notice}</p>}
  {stage==='verify'&&!authenticated&&<><p>First, please verify an email address or mobile number. This is required for public submissions.</p><ContactVerification idPrefix="khadim" method={method} onMethodChange={value=>{setMethod(value);resetContact('');}} contact={contact} onContactChange={resetContact} code={code} onCodeChange={setCode} challenge={challenge} verified={!!proof} busy={busy} resendAt={resendAt} onSend={()=>run(sendCode)} onVerify={()=>run(verifyCode)} help="Khadim uses the same verification as the public forms."/></>}
  {stage==='booking-details'&&<form onSubmit={event=>action(event,reviewBooking)}>
   <p>Tell me about the event you want to book. Only public Events Booking is available here; an admin will review the request.</p>
   <label>What is your event called?<input required maxLength={200} value={booking.title} onChange={e=>updateBooking('title',e.target.value)}/></label>
   <label>Who is it for?<select value={booking.audience} onChange={e=>updateBooking('audience',e.target.value)}>{Object.entries(AUDIENCES).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
   <label>Which venue?<select required value={booking.venueId} onChange={e=>updateBooking('venueId',e.target.value)}><option value="">Choose a venue</option>{venues.filter(v=>v.active!==false&&v.hireable!==false).map(v=><option key={v.id} value={v.id} disabled={!!audienceError(v,booking.audience)}>{v.name}</option>)}</select></label>
   <label>Which date?<input type="date" required value={booking.date} onChange={e=>updateBooking('date',e.target.value)}/></label>
   <div className="mwa-ai-workflow-pair"><label>Start time<input type="time" required value={booking.start} onChange={e=>updateBooking('start',e.target.value)}/></label><label>End time<input type="time" required value={booking.end} onChange={e=>updateBooking('end',e.target.value)}/></label></div>
   <p>If the end time is earlier than the start time, I’ll treat it as the following day.</p>
   <label>Your name<input required maxLength={200} autoComplete="name" value={booking.contactName} onChange={e=>updateBooking('contactName',e.target.value)}/></label>
   <label>Your email{method==='mobile'?' (optional)':''}<input type="email" required={method==='email'} readOnly={!authenticated&&method==='email'} value={booking.contactEmail} onChange={e=>updateBooking('contactEmail',e.target.value)}/></label>
   <label>Your mobile{method==='email'?' (optional)':''}<input type="tel" required={method==='mobile'} readOnly={!authenticated&&method==='mobile'} value={booking.contactPhone} onChange={e=>updateBooking('contactPhone',e.target.value)}/></label>
   <label>Anything else the booking team should know? (optional)<textarea maxLength={2000} value={booking.notes} onChange={e=>updateBooking('notes',e.target.value)}/></label>
   <label>Calendar visibility<select value={booking.visibility} onChange={e=>updateBooking('visibility',e.target.value)}><option value="public">Public title and details after approval</option><option value="private">Private title and details</option></select></label>
   <button type="submit" disabled={busy||!types.length}>{busy?'Checking…':'Review request'}</button>
  </form>}
  {stage==='booking-review'&&<div className="mwa-ai-workflow-review"><p>Please check your request before I submit it.</p><dl><dt>Event</dt><dd>{booking.title}</dd><dt>Audience</dt><dd>{AUDIENCES[booking.audience]}</dd><dt>Venue</dt><dd>{venues.find(v=>v.id===booking.venueId)?.name}</dd><dt>When</dt><dd>{dateLabel(bookingRange().startAt)} to {dateLabel(bookingRange().endAt)}</dd><dt>Contact</dt><dd>{booking.contactName}</dd><dt>Visibility</dt><dd>{booking.visibility}</dd></dl>{conflict?.hasConflict&&<p className="mwa-ai-workflow-note">This may conflict with another booking. You may submit for admin review; approval is not guaranteed.</p>}<div className="mwa-ai-workflow-actions"><button type="button" onClick={()=>setStage('booking-details')}>Edit</button><button type="button" disabled={busy} onClick={()=>run(submitPublicBooking)}>{busy?'Submitting…':'Submit booking request'}</button></div></div>}
  {stage==='find-event'&&<form onSubmit={event=>action(event,findEvents)}><p>Which public MWA programme would you like to sponsor? Search by its date, then choose it below.</p><label>Programme date<input type="date" required value={offer.date} onChange={e=>updateOffer('date',e.target.value)}/></label><button type="submit" disabled={busy}>Find programmes</button>{events.filter(item=>dateKeyInOrgTz(item.startAt)===offer.date).map(item=><label className="mwa-ai-workflow-choice" key={item.id}><input type="checkbox" checked={offer.eventIds.includes(item.id)} onChange={e=>updateOffer('eventIds',e.target.checked?[...offer.eventIds,item.id]:offer.eventIds.filter(id=>id!==item.id))}/><span>{item.title}<small>{dateLabel(item.startAt)} · {item.alreadySponsored?'Already sponsored':'No sponsor'}{item.alreadySponsored&&!item.acceptExtraEOIs?' · Additional offers closed':''}</small></span></label>)}{!!offer.eventIds.length&&<button type="button" onClick={()=>setStage('offer-details')}>Continue with {offer.eventIds.length} programme{offer.eventIds.length===1?'':'s'}</button>}</form>}
  {stage==='offer-details'&&<form onSubmit={event=>action(event,reviewOffer)}>
   <p>Tell me how you would like to support {selectedEvents.map(item=>item.title).join(', ')}. Your offer goes to the Niaz Coordinator for review.</p>
   <label>Your name<input required maxLength={160} autoComplete="name" value={offer.name} onChange={e=>updateOffer('name',e.target.value)}/></label>
   <label>Sponsorship type<select value={offer.type} onChange={e=>updateOffer('type',e.target.value)}><option value="one_time">One Time — selected event only</option><option value="permanent">Permanent Sponsorship — yearly selected event</option><option value="discretion">Niaz Coordinator discretion</option></select></label>
   <label>Your request<select value={offer.intent} onChange={e=>updateOffer('intent',e.target.value)}><option value="new">Sole Sponsor</option><option value="joint">Request Joint Sponsorship</option></select></label>
   {offer.intent==='joint'?<label>How would you like to share sponsorship?<textarea required maxLength={2000} value={offer.notes} onChange={e=>updateOffer('notes',e.target.value)}/></label>:<label>How will Niaz be arranged?<select required value={offer.arrangement} onChange={e=>updateOffer('arrangement',e.target.value)}><option value="">Choose an arrangement</option>{NIAZ_ARRANGEMENTS.map(value=><option key={value}>{value}</option>)}</select></label>}
   <label>Additional Offers / Requests (optional)<textarea maxLength={1000} value={offer.inKind} onChange={e=>updateOffer('inKind',e.target.value)}/></label>
   <label className="mwa-ai-workflow-choice"><input type="checkbox" checked={offer.publicConsent} onChange={e=>updateOffer('publicConsent',e.target.checked)}/><span>I consent to showing my name on public event cards after approval. I can revoke this later.</span></label>
   <label className="mwa-ai-workflow-choice"><input type="checkbox" checked={offer.optionalReminders} onChange={e=>updateOffer('optionalReminders',e.target.checked)}/><span>Email me a follow-up three days before the programme. An email address is needed for this reminder.</span></label>
   <div className="mwa-ai-workflow-actions"><button type="button" onClick={()=>setStage('find-event')}>Change programme</button><button type="submit" disabled={busy}>Review offer</button></div>
  </form>}
  {stage==='offer-review'&&<div className="mwa-ai-workflow-review"><p>Please check your offer. Submission is an expression of interest, not an approval.</p><dl><dt>Programme</dt><dd>{selectedEvents.map(item=>item.title+' · '+dateLabel(item.startAt)).join('; ')}</dd><dt>Name</dt><dd>{offer.name}</dd><dt>Type</dt><dd>{offer.type.replace('_',' ')}</dd><dt>Request</dt><dd>{offer.intent==='joint'?'Joint sponsorship':'Sole sponsorship'}</dd><dt>Public name</dt><dd>{offer.publicConsent?'Yes, after approval':'No'}</dd><dt>Three-day reminder</dt><dd>{offer.optionalReminders?'Yes':'No'}</dd></dl><div className="mwa-ai-workflow-actions"><button type="button" onClick={()=>setStage('offer-details')}>Edit</button><button type="button" disabled={busy} onClick={()=>run(submitOffer)}>{busy?'Submitting…':'Submit Niaz offer'}</button></div></div>}
  {stage==='done'&&<div role="status" className="mwa-ai-workflow-success"><strong>{result.kind==='booking'?'Booking request submitted':'Niaz offer submitted'}</strong><p>{result.kind==='booking'?'The booking team will review your request.':'The Niaz Coordinator will review your offer.'} This is not approval.</p>{result.id&&<p>Reference: {result.id}</p>}<button type="button" onClick={onClose}>Return to Khadim</button></div>}
 </section>;
}
