import {useEffect,useState} from 'react';
export default function NiazPublicSponsors({eventId}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{
  let controller=null,disposed=false;setData(null);setError('');
  let request=0;
  function refresh(){
   controller?.abort();controller=new AbortController();
   const current=controller;
   const ticket=++request;
   const timeout=setTimeout(()=>current.abort(),15000);
   fetch('/api/niaz/public?eventId='+encodeURIComponent(eventId),{cache:'no-store',signal:current.signal}).then(async response=>{
   const value=await response.json();if(!response.ok)throw Error('Sponsorship details are unavailable.');return value;
   }).then(value=>{if(!disposed&&ticket===request){setData(value);setError('');}}).catch(problem=>{if(!disposed&&ticket===request){setData(null);setError(current.signal.aborted?'Sponsorship details timed out. Retry or contact the coordinator.':problem.message);}}).finally(()=>clearTimeout(timeout));
  }
  refresh();const interval=setInterval(()=>{if(document.visibilityState==='visible')refresh();},30000);
  window.addEventListener('focus',refresh);
  return()=>{disposed=true;controller?.abort();clearInterval(interval);window.removeEventListener('focus',refresh);};
 },[eventId,retry]);
 return <section className="card" aria-label="Niaz Sponsor(s)">
  <h3>Niaz Sponsor(s)</h3>{error?<p role="status">{error}</p>:!data?<p role="status">Loading sponsorships...</p>:data.sponsors.length?<ul>{data.sponsors.map((sponsor,index)=><li key={index}>{sponsor.name} · {sponsor.type==='one_time'?'One-time':sponsor.type==='annual'?'Annual':'Permanent'} · {sponsor.role}</li>)}</ul>:<p>No approved sponsorships listed.</p>}
  {error&&<button type="button" className="btn alt" onClick={()=>setRetry(value=>value+1)}>Retry sponsorship details</button>}
  <a href="/niaz/" target="_top">Offer Niaz sponsorship</a>
 </section>;
}
