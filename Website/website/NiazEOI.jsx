import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {useAuth} from '@calendar/contexts/AuthContext.jsx';
import {startBookingVerification,verifyBookingEmailCode,verifyBookingMobile} from '@calendar/services/eventsService.js';
import {niazApi} from './niaz-client.js';
import './registrations.css';
import './niaz.css';
export default function NiazEOI(){
 const session=useAuth(),authenticated=!!session.user&&(session.user.emailVerified||session.user.phoneNumber);
 const [method,setMethod]=useState('email'),[contact,setContact]=useState(''),[name,setName]=useState(''),[code,setCode]=useState(''),[challenge,setChallenge]=useState(null),[proof,setProof]=useState(null),[phone,setPhone]=useState(null);
 const [date,setDate]=useState(''),[events,setEvents]=useState([]),[selected,setSelected]=useState([]),[type,setType]=useState('one_time'),[intent,setIntent]=useState('new'),[consent,setConsent]=useState(false),[notes,setNotes]=useState(''),[inKind,setInKind]=useState(''),[history,setHistory]=useState(null);
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[resendAt,setResendAt]=useState(0);
 const sessionId=useRef(null),requestId=useRef(null),generation=useRef(0);
 if(!sessionId.current&&typeof window!=='undefined'){sessionId.current=crypto.randomUUID().replace(/-/g,'');requestId.current=crypto.randomUUID();}
 const identityReady=authenticated||!!proof;
 async function run(action){
  const ticket=generation.current;setBusy(true);setError('');
  try{await action(ticket);}catch(problem){if(ticket===generation.current)setError(problem.message);}
  finally{if(ticket===generation.current)setBusy(false);}
 }
 useLayoutEffect(()=>{generation.current++;setProof(null);setChallenge(null);setHistory(null);setName(session.user?.displayName||'');setContact('');setCode('');setPhone(null);setNotes('');setInKind('');setSelected([]);setEvents([]);setConsent(false);setNotice('');setError('');setBusy(false);if(authenticated)run(async ticket=>{const data=await niazApi('/mine');if(ticket===generation.current)setHistory(data);});return()=>{generation.current++;};},[session.user?.uid,authenticated]);
 useEffect(()=>{window.mwaPageReady?.();},[]);
 function resetContact(value){
  generation.current++;setContact(value);setProof(null);setChallenge(null);setCode('');setPhone(null);setHistory(null);setBusy(false);
 }
 async function start(ticket){
  const data=await startBookingVerification({method,sessionId:sessionId.current,contactEmail:method==='email'?contact:'',contactPhone:method==='mobile'?contact:''});
  if(ticket!==generation.current)return;
  setChallenge(data);setResendAt(Date.now()+data.resendAfterMs);
  if(method==='mobile'){const service=await import('@calendar/services/phoneBookingAuth.js');setPhone(await service.sendBookingPhoneCode(contact));}
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
 return <section className="registrations-page niaz-admin">
  <a href="/calendar/">Events & Booking</a><h1>Niaz sponsorship EOI</h1>
  <p>Offer support for confirmed MWA programmes. Your EOI is not a booking, payment or approval. MWA will contact you about food, serving and logistics.</p>
  <p>Your contact is used privately for coordination and essential event notices. Public names require revocable consent. Membership linking is not configured; a verified contact is not proof of membership.</p>
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {!authenticated&&<fieldset disabled={busy}><legend>Verify your contact</legend><label>Verification method<select value={method} onChange={e=>{setMethod(e.target.value);resetContact('');}}><option value="email">Email OTP</option><option value="mobile">Mobile OTP</option></select></label><label>{method==='email'?'Email':'Mobile'}<input type={method==='email'?'email':'tel'} value={contact} onChange={e=>resetContact(e.target.value)}/></label>
   <button type="button" className="btn alt" disabled={!contact||busy} onClick={()=>{if(Date.now()<resendAt){setError('Wait one minute before requesting another code.');return;}run(start);}}>Send verification code</button>
   {challenge&&!proof&&<><label>Verification code<input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={e=>setCode(e.target.value)}/></label><button className="btn" type="button" onClick={()=>run(verify)}>Verify contact</button></>}
   {proof&&<p>Verified contact. Refreshing requires verification again.</p>}<div id="booking-phone-recaptcha"/>
  </fieldset>}
  <form className="registration-editor" onSubmit={e=>{e.preventDefault();run(async ticket=>{const value=await niazApi('/events?date='+date);if(ticket===generation.current)setEvents(value.items);});}}>
   <label>Programme date<input type="date" required value={date} onChange={e=>setDate(e.target.value)}/></label><button className="btn alt" disabled={busy}>Find programmes</button>
   <fieldset className="event-choice-list"><legend>Select actual events (up to 20, across dates)</legend>{events.map(event=><label className="event-choice" key={event.id}><input type="checkbox" checked={selected.some(value=>value.id===event.id)} onChange={e=>setSelected(current=>e.target.checked?[...current,event]:current.filter(value=>value.id!==event.id))}/><span>{event.title}<small>{event.alreadySponsored?'Already sponsored':'No sponsor'}{event.alreadySponsored&&!event.acceptExtraEOIs?' · Additional EOIs closed':''}</small>{event.sponsors?.map((s,index)=><small key={index}>{s.name} · {s.type}</small>)}</span></label>)}</fieldset>
   <p>Already sponsored? Choose another event, request joint sponsorship, or submit for coordinator consideration. Additional intake must be enabled by the coordinator; existing sponsors are never displaced automatically.</p>
  </form>
  <form className="registration-editor" onSubmit={e=>{e.preventDefault();run(async ticket=>{
   const seriesId=type==='permanent'?selected[0]?.seriesId||'':'';
   await niazApi('/eoi',{name,publicConsent:consent,eventIds:selected.map(event=>event.id),type,seriesId,intent,notes,inKind,requestId:requestId.current},proof);
   if(ticket!==generation.current)return;requestId.current=crypto.randomUUID();setSelected([]);setNotice('EOI submitted; not yet approved');
   const data=await niazApi('/mine',undefined,proof);if(ticket===generation.current)setHistory(data);
  });}}>
   <fieldset disabled={busy||!identityReady}><legend>Your offer</legend><label>Name<input required maxLength={160} value={name} onChange={e=>setName(e.target.value)}/></label><p>{selected.length} selected: {selected.map(event=>event.title).join(', ')}</p>
    <label>Sponsorship type<select value={type} onChange={e=>setType(e.target.value)}><option value="one_time">One-time occurrence(s)</option><option value="annual">Annual - selected occurrences</option><option value="permanent">Permanent series - annual review required</option></select></label>
    <label>Your request<select value={intent} onChange={e=>setIntent(e.target.value)}><option value="new">Choose another / unsponsored event</option><option value="joint">Request joint sponsorship</option><option value="consideration">Coordinator consideration / reassignment</option></select></label>
    <label>Offer / arrangement details<textarea maxLength={2000} value={notes} onChange={e=>setNotes(e.target.value)}/></label><label>In-kind provision<textarea maxLength={1000} value={inKind} onChange={e=>setInKind(e.target.value)}/></label><label className="registration-check"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>I explicitly consent to showing my name publicly for approved sponsorships. I can revoke this later.</label>
    <button className="btn" disabled={!selected.length}>Submit EOI</button>
   </fieldset>
  </form>
  {history&&<article className="registration-card"><h2>Your sponsorships and requests</h2><p>Private to your verified contact. Arrangement confirmation is made separately by the coordinator.</p>
   {history.sponsor&&<button className="btn alt" disabled={busy} onClick={()=>run(async ticket=>{await niazApi('/consent',{publicConsent:!history.sponsor.publicConsent},proof);const data=await niazApi('/mine',undefined,proof);if(ticket===generation.current)setHistory(data);})}>{history.sponsor.publicConsent?'Revoke public-name consent':'Allow public-name display'}</button>}
   {history.sponsor&&<><label className="registration-check"><input type="checkbox" disabled={busy} checked={history.sponsor.emailPreferences?.optionalReminders!==false} onChange={e=>changeReminderPreference(e.target.checked)}/>Receive optional three-day follow-up emails</label><p>Essential approval, cancellation, rescheduling and seven-day coordination notices are not marketing and remain enabled.</p></>}
   {!history.assignments.length&&!history.eois.length&&<p>No sponsorship records for this contact yet.</p>}{history.assignments.map(row=><p key={row.id}>{row.eventTitle||row.eventId}{row.eventStartAt?' · '+new Date(row.eventStartAt).toLocaleString('en-AU',{timeZone:'Australia/Sydney'}):''} · {row.type} · {row.status} · {row.eventStatus} · {row.arrangementConfirmed?'Arrangement confirmed':'Contact coordinator for arrangement status'}</p>)}
   {history.eois.map(row=><div key={row.id}><h3>Your Niaz request{row.createdAt?' - '+new Date(row.createdAt).toLocaleDateString('en-AU',{timeZone:'Australia/Sydney'}):''}</h3>{row.events.map(event=><p key={event.eventId}>{event.eventTitle||'Programme details unavailable'}{event.eventStartAt?' · '+new Date(event.eventStartAt).toLocaleString('en-AU',{timeZone:'Australia/Sydney'}):''} · {event.status}{event.reason?' · '+event.reason:''}</p>)}{row.events.every(event=>event.status==='pending')&&<button className="btn alt" disabled={busy} onClick={()=>{const value=prompt('Edit your offer details (event choices stay unchanged).',row.notes||'');if(value!==null)run(async ticket=>{await niazApi('/eoi-edit',{id:row.id,revision:row.revision,notes:value,inKind:row.inKind||''},proof);const data=await niazApi('/mine',undefined,proof);if(ticket===generation.current)setHistory(data);});}}>Edit pending offer details</button>}{row.events.some(event=>event.status==='pending')&&<button className="btn alt" disabled={busy} onClick={()=>run(async ticket=>{await niazApi('/withdraw',{id:row.id,revision:row.revision},proof);const data=await niazApi('/mine',undefined,proof);if(ticket===generation.current)setHistory(data);})}>Withdraw pending requests</button>}</div>)}
   {history.eois.flatMap(row=>(row.alternatives||[]).map((event,index)=><p key={row.id+':'+index}>Proposed alternative: {event.title||event.eventId} · {event.reason}. Use Find programmes for that date and submit a new EOI to accept; this proposal does not move your sponsorship.</p>))}
   {history.assignmentNext&&<button className="btn alt" disabled={busy} onClick={()=>run(async ticket=>{const data=await niazApi('/mine?assignmentAfter='+encodeURIComponent(history.assignmentNext),undefined,proof);if(ticket===generation.current)setHistory(current=>({...current,assignments:[...current.assignments,...data.assignments],assignmentNext:data.assignmentNext}));})}>Load more sponsorship history</button>}
   {history.eoiNext&&<button className="btn alt" disabled={busy} onClick={()=>run(async ticket=>{const data=await niazApi('/mine?eoiAfter='+encodeURIComponent(history.eoiNext),undefined,proof);if(ticket===generation.current)setHistory(current=>({...current,eois:[...current.eois,...data.eois],eoiNext:data.eoiNext}));})}>Load more request history</button>}
  </article>}
 </section>;
}
