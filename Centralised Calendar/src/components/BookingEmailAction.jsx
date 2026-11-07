import {useEffect,useState} from 'react';
import {doc,onSnapshot} from 'firebase/firestore';
import {httpsCallable} from 'firebase/functions';
import {db,functions} from '../firebase/firebase';
import {useAuth} from '../contexts/AuthContext.jsx';
import {checkSlotConflicts} from '../services/eventsService.js';
export default function BookingEmailAction(){
 const query=new URLSearchParams(location.search),id=query.get('booking')||'',requested=query.get('decision');
 const valid=/^[a-zA-Z0-9_-]{1,128}$/.test(id)&&['approve','reject'].includes(requested);
 const session=useAuth(),allowed=session.canAccess('events-bookings');
 const [booking,setBooking]=useState(null),[loading,setLoading]=useState(true),[conflict,setConflict]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[done,setDone]=useState(''),[decision,setDecision]=useState(requested),[note,setNote]=useState('');
 useEffect(()=>{
  if(!valid||!allowed)return;setLoading(true);
  return onSnapshot(doc(db,'events',id),snap=>{setBooking(snap.exists()?{...snap.data(),id:snap.id}:null);setLoading(false)},()=>{setError('Could not load this booking. Access may have changed.');setBooking(null);setLoading(false)});
 },[id,valid,allowed]);
 useEffect(()=>{
  if(!booking||!allowed||booking.status!=='pending'){setConflict(null);return}
  let active=true;setConflict(null);
  checkSlotConflicts({venueId:booking.venueId,startAt:booking.startAt,endAt:booking.endAt,excludeId:id}).then(data=>{if(active)setConflict(data)}).catch(()=>{if(active)setError('Could not check current availability. Approval is unavailable until the check succeeds.')});
  return()=>{active=false};
 },[booking,allowed,id]);
 if(!valid)return null;
 const returnTo='/calendar/?booking='+encodeURIComponent(id)+'&decision='+requested;
 if(session.loading)return <section className="page-panel glass-panel email-decision"><p>Checking your admin session…</p></section>;
 if(!allowed)return <section className="page-panel glass-panel email-decision"><h2>Review booking request</h2><p>{session.isAdmin?'Events & Bookings access is not assigned or has expired. Contact the Super Admin.':'Sign in with your approved Events & Bookings admin account to review this request.'}</p><a className="lb lb-default" href={session.isAdmin?'/admin-login':'/admin-login?returnTo='+encodeURIComponent(returnTo)} target="_top">{session.isAdmin?'Admin Console':'Admin sign in'}</a></section>;
 if(loading)return <section className="page-panel glass-panel email-decision"><p>Loading booking request…</p></section>;
 if(!booking)return <section className="page-panel glass-panel email-decision"><h2>Booking unavailable</h2><p>{error||'This booking no longer exists.'}</p></section>;
 const fmt=value=>new Date(value).toLocaleString('en-AU',{timeZone:'Australia/Sydney',dateStyle:'medium',timeStyle:'short'});
 async function confirmDecision(){
  if(busy||booking.status!=='pending'||(decision==='approve'&&(!conflict||conflict.hasConflict)))return;
  setBusy(true);setError('');try{const updated=booking.updatedAt?.toDate?booking.updatedAt.toDate().toISOString():booking.updatedAt||'';const result=await httpsCallable(functions,'decideBookingFromEmail')({eventId:id,decision,expectedUpdatedAt:updated,note});setDone(result.data.status==='confirmed'?'Booking approved.':'Booking rejected.');}catch(e){setError(e.message||'Could not save this decision.')}finally{setBusy(false)}
 }
 return <section className="page-panel glass-panel email-decision" aria-labelledby="email-decision-title"><div className="section-eyebrow">BOOKING EMAIL · SECURE REVIEW</div><h2 id="email-decision-title">{booking.title}</h2><p>{booking.venueName} · {fmt(booking.startAt)} – {fmt(booking.endAt)} (Sydney)</p><p>Requested by {booking.contactName} · {booking.contactEmail}</p>
  {error&&<p className="err" role="alert">{error}</p>}{done&&<p className="ok" role="status">{done}</p>}
  {booking.status!=='pending'?<p>This booking is now <strong>{booking.status}</strong>. No further decision is required.</p>:<>
   {conflict?.hasConflict?<p className="conflict-warn">This booking conflicts with {conflict.count||conflict.overlaps?.length||'another'} existing booking(s). Approval is unavailable here. You can still reject the request.</p>:<p>{conflict?'No conflicts detected. Availability will be checked again when you approve.':'Checking current availability…'}</p>}
   <div className="email-decision-choices"><button type="button" className="lb lb-outline" aria-pressed={decision==='approve'} disabled={busy||!conflict||conflict.hasConflict} onClick={()=>setDecision('approve')}>Approve</button><button type="button" className="lb lb-outline" aria-pressed={decision==='reject'} disabled={busy} onClick={()=>setDecision('reject')}>Reject</button></div>
   <label className="email-decision-note">Note to the requester (optional)<textarea maxLength={2000} value={note} onChange={e=>setNote(e.target.value)} disabled={busy}/></label>
   <button type="button" className="lb lb-default" disabled={busy||(decision==='approve'&&(!conflict||conflict.hasConflict))} onClick={confirmDecision}>{busy?'Saving…':decision==='approve'?'Confirm approval':'Confirm rejection'}</button><p className="muted">The requester will receive the usual decision email. Opening this link alone does not change the booking.</p>
  </>}
 </section>;
}
