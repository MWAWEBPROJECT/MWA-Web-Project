import {useEffect,useState} from 'react';
import {httpsCallable} from 'firebase/functions';
import {functions} from '../firebase/firebase.js';

export default function HijriRecoveryStatus(){
 const [status,setStatus]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function load(){
  setBusy(true);setError('');
  try{const response=await httpsCallable(functions,'getHijriRecoveryStatus')();setStatus(response.data);}
  catch(problem){setError(problem.message||'Could not load Hijri recovery status.');}
  finally{setBusy(false);}
 }
 useEffect(()=>{load();},[]);
 async function markReviewed(item){
  const timing=item.sendingAt&&item.notAfter?` Check the Sent folder from ${item.sendingAt} onwards. The configured send deadline was ${new Date(item.notAfter).toISOString()}, but a request could be processed late or not yet appear in Sent. Absence from Sent does not prove it is safe to resend.`:'';
  if(!window.confirm('Only mark this reviewed after checking the mailbox and booking details.'+timing+' This action does not send an email. Continue?'))return;
  setBusy(true);setError('');
  try{await httpsCallable(functions,'resolveHijriNotificationReview')({id:item.id});await load();}
  catch(problem){setError(problem.message||'Could not mark the notification reviewed.');}
  finally{setBusy(false);}
 }
 return <section className="card" aria-label="Hijri update recovery">
  <h3>Hijri update recovery</h3>
  <p>Interrupted updates retry automatically. Emails with an uncertain delivery outcome are held and never automatically resent; check the mailbox before taking action.</p>
  <button type="button" className="btn alt" onClick={load} disabled={busy}>Refresh recovery status</button>
  {error&&<p role="alert">{error}</p>}
  {status&&<>
   {status.pending.length?<p role="status">{status.pending.length}{status.morePending?'+':''} update(s) awaiting recovery. {status.pending.some(item=>item.lastError)?'Some are paused; contact the administrator to inspect function logs.':''}</p>:<p>No updates awaiting recovery.</p>}
   {status.held.length?<><p role="alert">{status.held.length}{status.moreHeld?'+':''} notification(s) require review.</p>{status.held.map(item=><article key={item.id}>
    <p><strong>{item.kind==='digest'?'Admin digest':item.title||'Booking notification'}</strong>{item.recipient?' — '+item.recipient:''}</p>
    <p>{item.reason}</p>
    {item.sendingAt&&item.notAfter&&<p>Check the Sent folder from {item.sendingAt} onwards. The configured send deadline was {new Date(item.notAfter).toISOString()}, but a request could be processed late or not yet appear in Sent. Absence from Sent does not prove it is safe to resend.</p>}
    {item.eventId&&<p>Booking reference: {item.eventId}. Previous start: {item.fromStartAt}; updated start: {item.toStartAt}.</p>}
    {item.kind==='digest'&&<p>Digest covers {item.moved.length} booking(s): {item.moved.map(change=>change.title||'Untitled').join(', ')}.</p>}
    <button type="button" className="btn alt" disabled={busy} onClick={()=>markReviewed(item)}>Mark reviewed</button>
   </article>)}</>:<p>No notification deliveries require review.</p>}
  </>}
 </section>;
}
