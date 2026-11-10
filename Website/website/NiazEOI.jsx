import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {ArrowLeft,ShieldCheck,CalendarDays,HandHeart,Info,CheckCircle2} from 'lucide-react';
import {useAuth} from '@calendar/contexts/AuthContext.jsx';
import {startBookingVerification,verifyBookingEmailCode,verifyBookingMobile} from '@calendar/services/eventsService.js';
import {niazProgrammeDate,parseNiazProgrammeLink} from '@calendar/utils/niazProgramme.mjs';
import {niazApi} from './niaz-client.js';
import ContactVerification from '@calendar/components/ContactVerification.jsx';
import {contactError,verificationPhone} from '@calendar/utils/contactVerification.mjs';
import {NIAZ_ARRANGEMENTS} from './niaz-offer.mjs';
import './registrations.css';
import './niaz.css';
export default function NiazEOI(){
 const session=useAuth(),authenticated=!!session.user&&(session.user.emailVerified||session.user.phoneNumber);
 const [method,setMethod]=useState('email'),[contact,setContact]=useState(''),[name,setName]=useState(''),[code,setCode]=useState(''),[challenge,setChallenge]=useState(null),[proof,setProof]=useState(null),[phone,setPhone]=useState(null);
 const [date,setDate]=useState(''),[events,setEvents]=useState([]),[selected,setSelected]=useState([]),[type,setType]=useState('one_time'),[intent,setIntent]=useState('new'),[consent,setConsent]=useState(false),[notes,setNotes]=useState(''),[inKind,setInKind]=useState(''),[history,setHistory]=useState(null);
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[resendAt,setResendAt]=useState(0),[eventsSearched,setEventsSearched]=useState(false);
 const [programmeLink]=useState(()=>parseNiazProgrammeLink(typeof location==='undefined'?'':location.search));
 const [showProgrammeSearch,setShowProgrammeSearch]=useState(!programmeLink.valid),[linkLoading,setLinkLoading]=useState(programmeLink.valid),[linkError,setLinkError]=useState('');
 const linkHandled=useRef(false);
 const sessionId=useRef(null),requestId=useRef(null),generation=useRef(0);
 if(!sessionId.current&&typeof window!=='undefined'){sessionId.current=crypto.randomUUID().replace(/-/g,'');requestId.current=crypto.randomUUID();}
 const [arrangement,setArrangement]=useState('');
 const identityReady=authenticated||!!proof,hasSponsored=selected.some(event=>event.alreadySponsored);
 async function run(action){
  const ticket=generation.current;setBusy(true);setError('');
  try{await action(ticket);}catch(problem){if(ticket===generation.current)setError(problem.message);}
  finally{if(ticket===generation.current)setBusy(false);}
 }
 useLayoutEffect(()=>{generation.current++;setProof(null);setChallenge(null);setHistory(null);setName(session.user?.displayName||'');setContact('');setCode('');setPhone(null);setNotes('');setArrangement('');setInKind('');setConsent(false);setNotice('');setError('');setBusy(false);if(authenticated)run(async ticket=>{const data=await niazApi('/mine');if(ticket===generation.current)setHistory(data);});return()=>{generation.current++;};},[session.user?.uid,authenticated]);
 useEffect(()=>{
  if(linkHandled.current||!programmeLink.requested)return;
  if(!programmeLink.valid){linkHandled.current=true;setLinkError('The programme link is incomplete or invalid. Please find a programme by date.');return;}
  let active=true;setLinkLoading(true);
  niazApi('/events?date='+programmeLink.date).then(value=>{
   if(!active)return;
   const event=value.items.find(item=>item.id===programmeLink.eventId&&niazProgrammeDate(item.startAt)===programmeLink.date);
   if(!event){setShowProgrammeSearch(true);setLinkError('This programme is no longer available for selection from this link. Please find a programme by date.');}
   else{setDate(programmeLink.date);setEvents(value.items);setEventsSearched(true);setSelected(current=>current.some(item=>item.id===event.id)?current:[...current,event]);}
   linkHandled.current=true;
  }).catch(problem=>{
   if(!active)return;
   setShowProgrammeSearch(true);setLinkError('The linked programme could not be loaded: '+problem.message+' Please find a programme by date.');linkHandled.current=true;
  }).finally(()=>{if(active)setLinkLoading(false);});
  return()=>{active=false;};
 },[programmeLink,session.user?.uid]);
 useEffect(()=>{window.mwaPageReady?.();},[]);
 function resetContact(value){
  generation.current++;setContact(value);setProof(null);setChallenge(null);setCode('');setPhone(null);setHistory(null);setBusy(false);
 }
 async function start(ticket){
  const validation=contactError(method,contact);if(validation)throw Error(validation);
  const contactPhone=method==='mobile'?verificationPhone(contact):'';
  const data=await startBookingVerification({method,sessionId:sessionId.current,contactEmail:method==='email'?contact.trim():'',contactPhone});
  if(ticket!==generation.current)return;
  setChallenge(data);setResendAt(Date.now()+data.resendAfterMs);
  if(method==='mobile'){const service=await import('@calendar/services/phoneBookingAuth.js');setPhone(await service.sendBookingPhoneCode(contactPhone));}
  setNotice('Verification code sent. Enter it below.');
 }
 async function verify(ticket){
  if(!challenge)throw Error('Request a new verification code.');
  if(method==='email')await verifyBookingEmailCode({challengeId:challenge.challengeId,sessionId:sessionId.current,code});
  else{if(!phone)throw Error('Request a new mobile code.');const service=await import('@calendar/services/phoneBookingAuth.js');const idToken=await service.confirmBookingPhoneCode(phone,code);await verifyBookingMobile({challengeId:challenge.challengeId,sessionId:sessionId.current,idToken});}
  if(ticket!==generation.current)return;
  const value={challengeId:challenge.challengeId,sessionId:sessionId.current};setProof(value);
  const data=await niazApi('/mine',undefined,value);if(ticket===generation.current){setHistory(data);setNotice('Contact verified. You may submit an EOI; it is not approval.');}
 }
 function changeReminderPreference(optionalReminders){
  const previous=history.sponsor.emailPreferences;
  setHistory(current=>({...current,sponsor:{...current.sponsor,emailPreferences:{optionalReminders}}}));
  run(async ticket=>{
   try{
    await niazApi('/preferences',{optionalReminders,revision:history.sponsor.revision},proof);
    const data=await niazApi('/mine',undefined,proof);if(ticket===generation.current)setHistory(data);
   }catch(problem){
    if(ticket===generation.current)setHistory(current=>({...current,sponsor:{...current.sponsor,emailPreferences:previous}}));
    throw problem;
   }
  });
 }
 return <section className="registrations-page wrap niaz-page niaz-public" aria-labelledby="niaz-eoi-title">
  <a className="text-link niaz-back-link" href="/calendar/"><ArrowLeft size={17} aria-hidden="true"/>Events & Booking</a>
  <header className="niaz-heading"><div><div className="eyebrow">MWA COMMUNITY PROGRAMMES</div><h1 id="niaz-eoi-title">Niaz sponsorship EOI</h1>
   <p>Offer support for confirmed MWA programmes. Your EOI is not a booking, payment or approval. MWA will contact you about food, serving and logistics.</p></div></header>
  <div className="niaz-message niaz-context"><Info size={19} aria-hidden="true"/><p>Your contact is used privately for coordination and essential event notices. Public names require revocable consent. Membership linking is not configured; a verified contact is not proof of membership.</p></div>
  <ol className="niaz-steps" aria-label="How to offer sponsorship"><li><ShieldCheck size={20} aria-hidden="true"/><span><strong>1. Verify contact</strong><small>{identityReady?'Verified contact ready':'Email or mobile verification'}</small></span></li><li><CalendarDays size={20} aria-hidden="true"/><span><strong>2. {selected.length?'Review programme':'Find programmes'}</strong><small>{selected.length?selected.length+' programme(s) selected':'Select one or more dates'}</small></span></li><li><HandHeart size={20} aria-hidden="true"/><span><strong>3. Send your offer</strong><small>Coordinator review follows</small></span></li></ol>
  {error&&<p className="niaz-message niaz-error" role="alert">{error}</p>}{notice&&<p className="niaz-message" role="status">{notice}</p>}
  {authenticated&&<p className="niaz-message niaz-verified"><CheckCircle2 size={19} aria-hidden="true"/>Your signed-in contact is verified. You can submit an offer and view your private history.</p>}
  {!authenticated&&<ContactVerification idPrefix="niaz" method={method} onMethodChange={value=>{setMethod(value);resetContact('');}} contact={contact} onContactChange={resetContact} code={code} onCodeChange={setCode} challenge={challenge} verified={!!proof} busy={busy} resendAt={resendAt} onSend={()=>run(start)} onVerify={()=>run(verify)} help="Use a contact you can access. Verification lets you manage your own offers privately."/>}
  {linkLoading&&<p className="niaz-message" role="status">Loading the selected programme...</p>}
  {linkError&&<p className="niaz-message" role="alert">{linkError}</p>}
  {selected.length>0&&<section className="niaz-panel" aria-labelledby="niaz-selected-title"><h2 id="niaz-selected-title"><CalendarDays size={22} aria-hidden="true"/>Selected programme{selected.length===1?'':'s'}</h2><p className="niaz-hint">Programme details are checked against the current calendar. Approval and arrangements still require coordinator review.</p>
   <ul className="niaz-selected-programmes">{selected.map(event=><li key={event.id}><div><strong>{event.title}</strong><p>{event.startAt?new Date(event.startAt).toLocaleString('en-AU',{timeZone:'Australia/Sydney',dateStyle:'full',timeStyle:'short'}):'Programme date unavailable'}</p><span className="niaz-badge">{event.alreadySponsored?'Already sponsored':'No sponsor'}{event.alreadySponsored&&!event.acceptExtraEOIs?' · Additional EOIs closed':''}</span></div><button className="btn alt" type="button" onClick={()=>{setSelected(current=>current.filter(item=>item.id!==event.id));setShowProgrammeSearch(true);}} aria-label={'Remove '+event.title}>Remove</button></li>)}</ul>
   <button className="btn alt" type="button" aria-expanded={showProgrammeSearch} aria-controls="niaz-programme-search" onClick={()=>setShowProgrammeSearch(true)}>Choose different or additional programmes</button>
  </section>}
  <form id="niaz-programme-search" hidden={!showProgrammeSearch} className="registration-editor niaz-panel" aria-labelledby="niaz-programmes-title" onSubmit={e=>{e.preventDefault();run(async ticket=>{const value=await niazApi('/events?date='+date);if(ticket===generation.current){setEvents(value.items);setEventsSearched(true);}});}}>
   <h2 id="niaz-programmes-title"><CalendarDays size={22} aria-hidden="true"/>Find programmes</h2><p className="niaz-hint">Find confirmed occurrences by date. Your selection is kept when you search another date.</p>
   <label>Programme date<input type="date" required value={date} onChange={e=>setDate(e.target.value)}/></label><button className="btn alt" disabled={busy}>Find programmes</button>
   <fieldset className="event-choice-list"><legend>Select actual events (up to 20, across dates)</legend>{events.map(event=><label className="event-choice" key={event.id}><input type="checkbox" checked={selected.some(value=>value.id===event.id)} onChange={e=>setSelected(current=>e.target.checked?[...current,event]:current.filter(value=>value.id!==event.id))}/><span>{event.title}<small>{event.alreadySponsored?'Already sponsored':'No sponsor'}{event.alreadySponsored&&!event.acceptExtraEOIs?' · Additional EOIs closed':''}</small>{event.sponsors?.map((s,index)=><small key={index}>{s.name} · {s.type}</small>)}</span></label>)}</fieldset>
   {!events.length&&<p className="niaz-empty" role="status">{eventsSearched?'No programmes found for the searched date. Try another date.':'Choose a date and find available programmes to begin.'}</p>}
   <p className="niaz-hint">Already sponsored? Choose another event, request joint sponsorship, or submit for coordinator consideration. Additional intake must be enabled by the coordinator; existing sponsors are never displaced automatically.</p>
  </form>
  <form className="registration-editor niaz-panel" onSubmit={e=>{e.preventDefault();run(async ticket=>{
   const seriesId=type==='permanent'?selected[0]?.seriesId||'':'';
   await niazApi('/eoi',{name,publicConsent:consent,eventIds:selected.map(event=>event.id),type,seriesId,intent,notes:intent==='joint'?notes:arrangement,inKind,requestId:requestId.current},proof);
   if(ticket!==generation.current)return;requestId.current=crypto.randomUUID();setSelected([]);setShowProgrammeSearch(true);setNotice('EOI submitted; not yet approved');
   const data=await niazApi('/mine',undefined,proof);if(ticket===generation.current)setHistory(data);
  });}}>
   {!identityReady&&<p className="niaz-message">Verify your contact above to unlock your offer.</p>}
   <fieldset disabled={busy||!identityReady}><legend><HandHeart size={22} aria-hidden="true"/>Your offer</legend><label>Name<input autoComplete="name" required maxLength={160} value={name} onChange={e=>setName(e.target.value)}/></label><p className="niaz-selection" aria-live="polite">{selected.length} selected: {selected.map(event=>event.title).join(', ')}</p>
    <label>Sponsorship type<select value={type} onChange={e=>setType(e.target.value)}><option value="one_time">One-time occurrence(s)</option><option value="annual">Annual - selected occurrences</option><option value="permanent">Permanent series - annual review required</option></select></label>
    <label>Your request<select required value={intent==='new'&&hasSponsored?'':intent} onChange={e=>{if(e.target.value==='new'&&hasSponsored){setSelected([]);setShowProgrammeSearch(true);}setIntent(e.target.value);}}>{hasSponsored&&<option value="" disabled>Select a request for the sponsored programme(s)</option>}<option value="new">{hasSponsored?'Choose another event':'Sponsor selected event'}</option><option value="joint">Request joint sponsorship</option><option value="consideration">Coordinator consideration / reassignment</option></select></label>
    {hasSponsored&&<p className="niaz-hint">A selected programme already has a sponsor. Choose joint sponsorship or coordinator consideration; additional intake must be enabled. Choose another event to start a new sponsorship.</p>}
    <label>Offer / arrangement details{intent==='joint'?<textarea maxLength={2000} value={notes} onChange={e=>setNotes(e.target.value)}/>:<select required value={arrangement} onChange={e=>setArrangement(e.target.value)}><option value="">Choose an arrangement</option>{NIAZ_ARRANGEMENTS.map(value=><option key={value}>{value}</option>)}</select>}</label><label>In-kind provision<textarea maxLength={1000} value={inKind} onChange={e=>setInKind(e.target.value)}/></label><p className="niaz-hint">Optional non-cash items or services you can provide, such as ingredients, packaging or transport. Describe your offer; MWA confirms arrangements separately.</p><label className="registration-check"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>I explicitly consent to showing my name publicly for approved sponsorships. I can revoke this later.</label>
    <button className="btn" disabled={!selected.length}>Submit EOI</button>
   </fieldset>
  </form>
  {busy&&<p className="niaz-message" role="status">Processing your request...</p>}
  {history&&<article className="registration-card niaz-history"><h2>Your sponsorships and requests</h2><p>Private to your verified contact. Arrangement confirmation is made separately by the coordinator.</p>
   {history.sponsor&&<button className="btn alt" disabled={busy} onClick={()=>run(async ticket=>{await niazApi('/consent',{publicConsent:!history.sponsor.publicConsent},proof);const data=await niazApi('/mine',undefined,proof);if(ticket===generation.current)setHistory(data);})}>{history.sponsor.publicConsent?'Revoke public-name consent':'Allow public-name display'}</button>}
   {history.sponsor&&<><label className="registration-check"><input type="checkbox" disabled={busy} checked={history.sponsor.emailPreferences?.optionalReminders!==false} onChange={e=>changeReminderPreference(e.target.checked)}/>Receive optional three-day follow-up emails</label><p>Essential approval, cancellation, rescheduling and seven-day coordination notices are not marketing and remain enabled.</p></>}
   {!history.assignments.length&&!history.eois.length&&<p>No sponsorship records for this contact yet.</p>}{history.assignments.map(row=><p key={row.id}>{row.eventTitle||'Programme details unavailable'}{row.eventStartAt?' · '+new Date(row.eventStartAt).toLocaleString('en-AU',{timeZone:'Australia/Sydney'}):''} · {row.type} · {row.status} · {row.eventStatus} · {row.arrangementConfirmed?'Arrangement confirmed':'Contact coordinator for arrangement status'}</p>)}
   {history.eois.map(row=><div key={row.id}><h3>Your Niaz request{row.createdAt?' - '+new Date(row.createdAt).toLocaleDateString('en-AU',{timeZone:'Australia/Sydney'}):''}</h3>{row.events.map(event=><p key={event.eventId}>{event.eventTitle||'Programme details unavailable'}{event.eventStartAt?' · '+new Date(event.eventStartAt).toLocaleString('en-AU',{timeZone:'Australia/Sydney'}):''} · {event.status}{event.reason?' · '+event.reason:''}</p>)}{row.events.every(event=>event.status==='pending')&&<button className="btn alt" disabled={busy} onClick={()=>{const value=prompt('Edit your offer details (event choices stay unchanged).',row.notes||'');if(value!==null)run(async ticket=>{await niazApi('/eoi-edit',{id:row.id,revision:row.revision,notes:value,inKind:row.inKind||''},proof);const data=await niazApi('/mine',undefined,proof);if(ticket===generation.current)setHistory(data);});}}>Edit pending offer details</button>}{row.events.some(event=>event.status==='pending')&&<button className="btn alt" disabled={busy} onClick={()=>run(async ticket=>{await niazApi('/withdraw',{id:row.id,revision:row.revision},proof);const data=await niazApi('/mine',undefined,proof);if(ticket===generation.current)setHistory(data);})}>Withdraw pending requests</button>}</div>)}
   {history.eois.flatMap(row=>(row.alternatives||[]).map((event,index)=><p key={row.id+':'+index}>Proposed alternative: {event.title||'Programme details unavailable'} · {event.reason}. Use Find programmes for that date and submit a new EOI to accept; this proposal does not move your sponsorship.</p>))}
   {history.assignmentNext&&<button className="btn alt" disabled={busy} onClick={()=>run(async ticket=>{const data=await niazApi('/mine?assignmentAfter='+encodeURIComponent(history.assignmentNext),undefined,proof);if(ticket===generation.current)setHistory(current=>({...current,assignments:[...current.assignments,...data.assignments],assignmentNext:data.assignmentNext}));})}>Load more sponsorship history</button>}
   {history.eoiNext&&<button className="btn alt" disabled={busy} onClick={()=>run(async ticket=>{const data=await niazApi('/mine?eoiAfter='+encodeURIComponent(history.eoiNext),undefined,proof);if(ticket===generation.current)setHistory(current=>({...current,eois:[...current.eois,...data.eois],eoiNext:data.eoiNext}));})}>Load more request history</button>}
  </article>}
 </section>;
}
