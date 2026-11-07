import React,{useEffect,useRef,useState} from 'react';
import {prepareMultiSnapshot} from './insights-multi-client.mjs';

const date=value=>value?new Date(value).toLocaleString('en-AU',{timeZone:'Australia/Sydney'}):'Date unavailable';

export default function InsightsRespondentReports({api,selectedPerson,programmeFilters,responseScope}){
 const [person,setPerson]=useState(''),[eventA,setEventA]=useState(''),[eventB,setEventB]=useState(''),[group,setGroup]=useState('common');
 const [timeline,setTimeline]=useState(null),[comparison,setComparison]=useState(null),[choices,setChoices]=useState(null),[from,setFrom]=useState(''),[to,setTo]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const generation=useRef(0),activeJob=useRef(''),activeKind=useRef('multi');
 const [snapshotEnabled,setSnapshotEnabled]=useState(null),[progress,setProgress]=useState(''),[comparisonRunning,setComparisonRunning]=useState('');
 useEffect(()=>{let mounted=true;api('/respondent',{method:'POST',body:JSON.stringify({action:'multi-status'})}).then(data=>{if(mounted)setSnapshotEnabled(data.enabled===true);}).catch(e=>{if(mounted)setError('Could not check comparison availability: '+e.message);});return()=>{mounted=false;};},[]);
 useEffect(()=>()=>{generation.current++;const jobId=activeJob.current,kind=activeKind.current;activeJob.current='';if(jobId)api('/respondent',{method:'POST',body:JSON.stringify({action:kind+'-cancel',jobId})}).catch(e=>console.error('Analysis cancellation could not be confirmed:',e));},[]);
 useEffect(()=>{const jobId=activeJob.current,kind=activeKind.current;generation.current++;activeJob.current='';setTimeline(null);setComparison(null);setChoices(null);setBusy(false);setComparisonRunning(false);setError('');if(jobId)api('/respondent',{method:'POST',body:JSON.stringify({action:kind+'-cancel',jobId})}).catch(e=>setError('Cancellation could not be confirmed: '+e.message));},[programmeFilters,responseScope]);
 useEffect(()=>{if(selectedPerson?.id){clear();setPerson(selectedPerson.id);setChoices(null);setBusy(false);}},[selectedPerson]);
 useEffect(()=>{
  if(!timeline&&!comparison&&!choices)return;
  const timer=setInterval(async()=>{
   const current=generation.current;
   try{const access=await api('/respondent',{method:'POST',body:JSON.stringify({action:'access-check'})});if([timeline,comparison,choices].some(value=>value&&access.calendarAllowed!==value.calendarAllowed))throw Error('Calendar access changed. Run the report again.');}
   catch(e){if(current===generation.current){generation.current++;setTimeline(null);setComparison(null);setChoices(null);setBusy(false);setError(e.message);}}
  },15000);
  return ()=>clearInterval(timer);
 },[api,timeline,comparison,choices]);
 function clear(){const jobId=activeJob.current,kind=activeKind.current;generation.current++;activeJob.current='';setTimeline(null);setComparison(null);setError('');if(jobId)api('/respondent',{method:'POST',body:JSON.stringify({action:kind+'-cancel',jobId})}).catch(e=>setError('Cancellation could not be confirmed: '+e.message));}
 async function cancel(){const jobId=activeJob.current,kind=activeKind.current;generation.current++;activeJob.current='';setBusy(false);setComparisonRunning(false);setTimeline(null);setComparison(null);setProgress('');if(jobId)try{await api('/respondent',{method:'POST',body:JSON.stringify({action:kind+'-cancel',jobId})});}catch(e){setError('Cancellation could not be confirmed: '+e.message);}}
 async function run(action,cursor='',nextGroup=group,fresh=false){
  const current=++generation.current;setBusy(true);setComparisonRunning(['compare','timeline'].includes(action)&&snapshotEnabled===true?action:'');setError('');
  try{
   let data;
   if(['timeline','compare'].includes(action)&&snapshotEnabled===true&&activeJob.current&&activeKind.current!==(action==='timeline'?'timeline':'multi')){const jobId=activeJob.current;await api('/respondent',{method:'POST',body:JSON.stringify({action:activeKind.current+'-cancel',jobId})});if(current!==generation.current)return;activeJob.current='';}
   if(action==='timeline'&&snapshotEnabled===true){
    let jobId=activeJob.current;
    if(fresh||!jobId){
     if(jobId){await api('/respondent',{method:'POST',body:JSON.stringify({action:'timeline-cancel',jobId})});if(current!==generation.current)return;activeJob.current='';}
     setProgress('');jobId=await prepareMultiSnapshot({api,prefix:'timeline',input:{personId:person,...programmeFilters,...responseScope},isCurrent:()=>current===generation.current,onStart:id=>{activeKind.current='timeline';activeJob.current=id;},onProgress:scanned=>setProgress(`${scanned} linked records scanned.`)});
     if(!jobId)return;
    }
    data=await api('/respondent',{method:'POST',body:JSON.stringify({action:'timeline-results',jobId,cursor})});
   }else
   if(action==='compare'&&snapshotEnabled===true){
    let jobId=activeJob.current;
    if(fresh||!jobId){
     if(jobId){await api('/respondent',{method:'POST',body:JSON.stringify({action:'multi-cancel',jobId})});if(current!==generation.current)return;activeJob.current='';}
     setProgress('');
     jobId=await prepareMultiSnapshot({api,eventIds:[eventA,eventB],programmeFilters,formId:responseScope?.formId||'',isCurrent:()=>current===generation.current,onStart:id=>{activeKind.current='multi';activeJob.current=id;},onProgress:scanned=>setProgress(`${scanned} indexed responses scanned.`)});
     if(!jobId)return;
    }
    const snapshotGroup=nextGroup==='a-only'?'only:0':nextGroup==='b-only'?'only:1':nextGroup;
    data=await api('/respondent',{method:'POST',body:JSON.stringify({action:'multi-results',jobId,group:snapshotGroup,cursor})});
    data={...data,counts:{common:data.counts.common,aOnly:data.counts.only[0],bOnly:data.counts.only[1]}};
   }else{
    const body=action==='timeline'?{action,personId:person,cursor,...programmeFilters,...responseScope}:action==='event-choices'?{action,from,to,...programmeFilters}:{action,eventA,eventB,group:nextGroup,cursor,...programmeFilters,formId:responseScope?.formId||''};
    data=await api('/respondent',{method:'POST',body:JSON.stringify(body)});
   }
   if(current!==generation.current)return;
   if(action==='timeline'){setTimeline(data);setComparison(null);}else if(action==='event-choices')setChoices(data);else{setComparison(data);setTimeline(null);setGroup(nextGroup);}
  }catch(e){if(current===generation.current){setTimeline(null);setComparison(null);setChoices(null);setError(e.message);}}
  finally{if(current===generation.current){setBusy(false);setComparisonRunning(false);}}
 }
 return <section><h3>Explore confirmed respondent history</h3>
 <p>These are registrations, not attendance or inferred participants. Results cover available records only; first known does not mean first ever. Event dates use the current calendar in Sydney, not historical dates at submission. Timeline uses the selected form and saved-event references; comparisons use the selected form but their own event selection. Event inventory is not filtered by form.</p>
 <label>Respondent reference<input value={person} onChange={e=>{clear();setPerson(e.target.value);}} disabled={busy}/></label>
 <button type="button" className="btn alt" disabled={busy||!person||snapshotEnabled===null} onClick={()=>run('timeline','','',true)}>Show respondent timeline</button>
 {timeline&&<section><h4>Respondent timeline</h4><p>{timeline.notice}</p><p>{timeline.confirmed} confirmed links; {timeline.reviewRequired} require review; {timeline.inactive} inactive link records. {snapshotEnabled?'Snapshots scan at most 50,000 links and 600 calendar/review entries.':'The timeline is bounded to 250 link records.'} This is not a complete history of unlinked submissions.</p>
 {timeline.items.length===0&&<p>No linked responses in this history.</p>}
 <div style={{overflowX:'auto'}}><table aria-label="Respondent timeline"><thead><tr><th>Source</th><th>Status</th><th>Submitted (Sydney)</th><th>Current calendar event</th><th>Current event date (Sydney)</th></tr></thead><tbody>{timeline.items.map(item=><tr key={item.formId+'/'+item.responseId}><td>{item.formTitle||'Form unavailable'} · {item.reference||item.responseId} · {item.formId} / {item.responseId} · revision {item.revision}</td><td>{item.status}</td><td>{date(item.submittedAt)}</td><td>{item.event.title}</td><td>{date(item.event.date)}</td></tr>)}</tbody></table></div>
 {timeline.next&&<button type="button" className="btn alt" disabled={busy} onClick={()=>run('timeline',timeline.next)}>Next timeline page</button>}<button type="button" className="btn alt" disabled={busy} onClick={()=>run('timeline')}>First timeline page</button></section>}
 <h3>Compare two events</h3><p>Enter two accessible event references. People access does not reveal private calendar events; Events &amp; Bookings access is required for those. Counts deduplicate confirmed respondents across forms. {snapshotEnabled===true?'Snapshots scan at most 50,000 indexed records and expire after 24 hours.':snapshotEnabled===false?'Temporary snapshots are disabled; an event is limited to 250 indexed responses.':'Checking comparison availability.'}</p>
 <label>Event dates from (Sydney)<input type="date" value={from} onChange={e=>{clear();setChoices(null);setFrom(e.target.value);}} disabled={busy}/></label><label>Event dates to (Sydney)<input type="date" value={to} onChange={e=>{clear();setChoices(null);setTo(e.target.value);}} disabled={busy}/></label>
 <button type="button" className="btn alt" disabled={busy||!from||!to} onClick={()=>run('event-choices')}>Find accessible events</button>
 {choices&&<><p>{choices.notice}</p>{!choices.events.length&&<p>No accessible dated events in this range.</p>}<label>Select event A<select value={eventA} disabled={busy} onChange={e=>{clear();setEventA(e.target.value);}}><option value="">Select an event</option>{choices.events.map(event=><option key={event.id} value={event.id}>{event.title} · {date(event.date)}</option>)}</select></label><label>Select event B<select value={eventB} disabled={busy} onChange={e=>{clear();setEventB(e.target.value);}}><option value="">Select an event</option>{choices.events.map(event=><option key={event.id} value={event.id}>{event.title} · {date(event.date)}</option>)}</select></label></>}
 <label>Event A reference<input value={eventA} onChange={e=>{clear();setEventA(e.target.value);}} disabled={busy}/></label><label>Event B reference<input value={eventB} onChange={e=>{clear();setEventB(e.target.value);}} disabled={busy}/></label>
 <button type="button" className="btn alt" disabled={busy||!eventA||!eventB||snapshotEnabled===null} onClick={()=>run('compare','',group,true)}>Compare events</button>
 {comparison&&<section><h4>Event comparison</h4><p>{comparison.notice}</p>{comparison.events.map((event,index)=><p key={index}>Event {index?'B':'A'}: {event.title} · current date {date(event.date)} · {comparison.coverage[index].submissions} indexed submissions; {comparison.coverage[index].identifiedRespondents} confirmed respondents; {comparison.coverage[index].unresolved} unresolved; {comparison.coverage[index].staleIndex} stale or unavailable indexed sources.</p>)}
 <p>Both: {comparison.counts.common} · A only: {comparison.counts.aOnly} · B only: {comparison.counts.bOnly}. These differences are not proof that someone did not register.</p>
 <label>Respondent list<select value={group} disabled={busy} onChange={e=>run('compare','',e.target.value)}><option value="common">Both events</option><option value="a-only">A only</option><option value="b-only">B only</option></select></label>
 {comparison.items.length===0&&<p>No confirmed respondents in this group.</p>}{comparison.items.map(item=><p key={item.personId}>{item.names.join(' / ')||'Name unavailable'} · {item.personId} <button type="button" className="btn alt" disabled={busy} onClick={()=>{clear();setPerson(item.personId);}}>Choose for timeline</button></p>)}
 {comparison.next&&<button type="button" className="btn alt" disabled={busy} onClick={()=>run('compare',comparison.next)}>Next respondent page</button>}<button type="button" className="btn alt" disabled={busy} onClick={()=>run('compare','',group)}>First respondent page</button></section>}
 {busy&&<><p role="status">Preparing respondent results… {progress}</p>{comparisonRunning&&<button type="button" className="btn alt" onClick={cancel}>{comparisonRunning==='timeline'?'Cancel timeline':'Cancel comparison'}</button>}</>}{error&&<p role="alert">{error}</p>}
 </section>;
}
