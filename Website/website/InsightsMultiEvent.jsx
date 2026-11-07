import React,{useEffect,useRef,useState} from 'react';
import {prepareMultiSnapshot} from './insights-multi-client.mjs';

export default function InsightsMultiEvent({api,programmeFilters,responseScope,onChoosePerson}){
 const [references,setReferences]=useState(''),[group,setGroup]=useState('common'),[result,setResult]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[progress,setProgress]=useState(''),[snapshotEnabled,setSnapshotEnabled]=useState(null);
 const generation=useRef(0),activeJob=useRef('');
 useEffect(()=>{let mounted=true;api('/respondent',{method:'POST',body:JSON.stringify({action:'multi-status'})}).then(data=>{if(mounted)setSnapshotEnabled(data.enabled===true);}).catch(e=>{if(mounted)setError('Could not check comparison availability: '+e.message);});return()=>{mounted=false;};},[]);
 useEffect(()=>()=>{generation.current++;const jobId=activeJob.current;activeJob.current='';if(jobId)api('/respondent',{method:'POST',body:JSON.stringify({action:'multi-cancel',jobId})}).catch(e=>console.error('Comparison cancellation could not be confirmed:',e));},[]);
 useEffect(()=>{const jobId=activeJob.current;generation.current++;activeJob.current='';setResult(null);setBusy(false);setError('');if(jobId)api('/respondent',{method:'POST',body:JSON.stringify({action:'multi-cancel',jobId})}).catch(e=>setError('Cancellation could not be confirmed: '+e.message));},[programmeFilters,responseScope]);
 useEffect(()=>{
  if(!result)return;
  const timer=setInterval(async()=>{const current=generation.current;try{const access=await api('/respondent',{method:'POST',body:JSON.stringify({action:'access-check'})});if(access.calendarAllowed!==result.calendarAllowed)throw Error('Calendar access changed. Run comparison again.');}catch(e){if(current===generation.current){generation.current++;setResult(null);setBusy(false);setError(e.message);}}},15000);
  return ()=>clearInterval(timer);
 },[api,result]);
 async function run(nextGroup='common',cursor='',fresh=false){
  const current=++generation.current,eventIds=references.split(/[\s,]+/).filter(Boolean);let jobId=activeJob.current;
  setBusy(true);setError('');setProgress('');
  try{
   if(snapshotEnabled===false){
    const data=await api('/respondent',{method:'POST',body:JSON.stringify({action:'compare',eventIds,group:nextGroup,cursor,...programmeFilters,formId:responseScope?.formId||''})});
    if(current===generation.current){setGroup(nextGroup);setResult(data);}return;
   }
   if(fresh||!jobId){
    if(jobId){await api('/respondent',{method:'POST',body:JSON.stringify({action:'multi-cancel',jobId})});if(current!==generation.current)return;activeJob.current='';}
    jobId=await prepareMultiSnapshot({api,eventIds,programmeFilters,formId:responseScope?.formId||'',isCurrent:()=>current===generation.current,onStart:id=>{activeJob.current=id;},onProgress:scanned=>setProgress(`${scanned} indexed responses scanned.`)});
    if(!jobId)return;
   }
   if(current!==generation.current)return;
   const data=await api('/respondent',{method:'POST',body:JSON.stringify({action:'multi-results',jobId,group:nextGroup,cursor})});
   if(current===generation.current){setGroup(nextGroup);setResult(data);}
  }catch(e){if(current===generation.current){setResult(null);setError(e.message);}}
  finally{if(current===generation.current)setBusy(false);}
 }
 async function cancel(){
  const jobId=activeJob.current;generation.current++;activeJob.current='';setBusy(false);setResult(null);setProgress('');
  if(jobId)try{await api('/respondent',{method:'POST',body:JSON.stringify({action:'multi-cancel',jobId})});}catch(e){setError('Cancellation could not be confirmed: '+e.message);}
 }
 return <section><h3>Compare several events</h3><p>Enter 2 to 20 distinct accessible event references separated by commas or spaces. {snapshotEnabled===true?'Snapshots scan at most 50,000 indexed records; access expires after 24 hours and monitored cleanup is required to remove temporary data.':snapshotEnabled===false?'Temporary snapshots are disabled until cleanup is configured; the existing comparison refuses events above 250 indexed responses.':'Checking comparison availability.'} All selected events must match the programme filters. Form filter: {responseScope?.formId||'all'}; the single-event filter does not apply to a multi-event comparison. Counts use confirmed current respondents, not attendance.</p>
 <label>Event references<textarea value={references} disabled={busy} onChange={e=>{const jobId=activeJob.current;generation.current++;activeJob.current='';setResult(null);setError('');setReferences(e.target.value);if(jobId)api('/respondent',{method:'POST',body:JSON.stringify({action:'multi-cancel',jobId})}).catch(error=>setError('Cancellation could not be confirmed: '+error.message));}}/></label>
 <button type="button" className="btn alt" disabled={busy||!references.trim()||snapshotEnabled===null} onClick={()=>run('common','',true)}>Compare selected events</button>
 {busy&&<><p role="status">Preparing event comparison… {progress}</p><button type="button" className="btn alt" onClick={cancel}>Cancel comparison</button></>}{error&&<p role="alert">{error}</p>}
 {result&&<section><h4>Multi-event comparison</h4><p>{result.notice}</p><p>Common to every selected event: {result.counts.common}. Only means present in exactly one of the selected events; incomplete coverage means absence is not established.</p>
 {result.events.map((event,index)=><p key={index}>{index+1}. {event.title} · {result.coverage[index].submissions} indexed submissions · {result.coverage[index].identifiedRespondents} confirmed · {result.coverage[index].unresolved} unresolved · {result.coverage[index].staleIndex} stale · {result.counts.only[index]} only this event</p>)}
 <div style={{overflowX:'auto'}}><table aria-label="Pairwise confirmed respondent overlap"><caption>Pairwise overlap of confirmed respondents; diagonal is the confirmed count for that event. Select a count to view its authorized people list.</caption><thead><tr><th>Event</th>{result.events.map((event,i)=><th scope="col" key={i}>{i+1}. {event.title}</th>)}</tr></thead><tbody>{result.matrix.map((row,i)=><tr key={i}><th scope="row">{i+1}. {result.events[i].title}</th>{row.map((count,j)=><td key={j}><button type="button" className="btn alt" disabled={busy} aria-label={`View ${count} respondents in ${result.events[i].title} and ${result.events[j].title}`} onClick={()=>run(`pair:${i}:${j}`)}>{count}</button></td>)}</tr>)}</tbody></table></div>
 <label>Respondent list<select value={group} disabled={busy} onChange={e=>run(e.target.value)}><option value="common">Common to every event</option>{result.events.map((event,i)=><option value={'only:'+i} key={i}>Only {i+1}. {event.title}</option>)}{group.startsWith('pair:')&&<option value={group}>Selected pairwise overlap</option>}</select></label>
 {!result.items.length&&<p>No confirmed respondents in this group.</p>}{result.items.map(item=><p key={item.personId}>{item.names.join(' / ')||'Name unavailable'} · {item.personId} <button type="button" className="btn alt" onClick={()=>onChoosePerson(item.personId)}>Choose for timeline</button></p>)}
 {result.next&&<button type="button" className="btn alt" disabled={busy} onClick={()=>run(group,result.next)}>Next respondent page</button>}<button type="button" className="btn alt" disabled={busy} onClick={()=>run(group)}>First respondent page</button>
 </section>}</section>;
}
