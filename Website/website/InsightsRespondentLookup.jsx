import React,{useEffect,useRef,useState} from 'react';
import {FirstKnownChart} from './InsightsCharts.jsx';
import {prepareMultiSnapshot} from './insights-multi-client.mjs';

const displayDate=value=>value?new Date(value).toLocaleString('en-AU',{timeZone:'Australia/Sydney'}):'Unavailable';

export default function InsightsRespondentLookup({api,onChoosePerson,programmeFilters,responseScope,canExport=false}){
 const [from,setFrom]=useState(''),[to,setTo]=useState(''),[historyFrom,setHistoryFrom]=useState(''),[kind,setKind]=useState('name'),[term,setTerm]=useState(''),[group,setGroup]=useState('first-known');
 const [lookup,setLookup]=useState(null),[cohorts,setCohorts]=useState(null),[matrix,setMatrix]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),generation=useRef(0),cohortJob=useRef(''),lookupJob=useRef('');
 const [snapshotEnabled,setSnapshotEnabled]=useState(null),[progress,setProgress]=useState(''),[runningSnapshot,setRunningSnapshot]=useState('');
 useEffect(()=>{let mounted=true;api('/respondent',{method:'POST',body:JSON.stringify({action:'multi-status'})}).then(data=>{if(mounted)setSnapshotEnabled(data.enabled===true);}).catch(e=>{if(mounted)setError('Could not check cohort availability: '+e.message);});return()=>{mounted=false;};},[]);
 function takeJobs(){const jobs=[['cohort',cohortJob.current],['lookup',lookupJob.current]];cohortJob.current='';lookupJob.current='';return jobs.filter(([,id])=>id);}
 function cancelJobs(jobs,onError){for(const [prefix,jobId] of jobs)api('/respondent',{method:'POST',body:JSON.stringify({action:prefix+'-cancel',jobId})}).catch(e=>onError(prefix,e));}
 useEffect(()=>()=>{generation.current++;cancelJobs(takeJobs(),(prefix,e)=>console.error(`${prefix} cancellation could not be confirmed:`,e));},[]);
 useEffect(()=>{generation.current++;const jobs=takeJobs();setLookup(null);setCohorts(null);setMatrix(null);setBusy(false);setRunningSnapshot('');setError('');cancelJobs(jobs,(prefix,e)=>setError(`${prefix} cancellation could not be confirmed: ${e.message}`));},[programmeFilters,responseScope]);
 useEffect(()=>{
  if(!lookup&&!cohorts&&!matrix)return;
  const timer=setInterval(async()=>{
   const current=generation.current;
   try{const access=await api('/respondent',{method:'POST',body:JSON.stringify({action:'access-check'})});if([lookup,cohorts,matrix].some(value=>value&&value.calendarAllowed!==access.calendarAllowed))throw Error('Calendar access changed. Run the report again.');}
   catch(e){if(current===generation.current){generation.current++;const jobs=takeJobs();setLookup(null);setCohorts(null);setMatrix(null);setBusy(false);setError(e.message);cancelJobs(jobs,(prefix,error)=>console.error(`${prefix} cancellation could not be confirmed:`,error));}}
  },15000);
  return ()=>clearInterval(timer);
 },[api,lookup,cohorts,matrix]);
 function clear(){generation.current++;const jobs=takeJobs();setLookup(null);setCohorts(null);setMatrix(null);setError('');cancelJobs(jobs,(prefix,e)=>setError(`${prefix} cancellation could not be confirmed: ${e.message}`));}
 async function cancel(){const prefix=runningSnapshot,jobRef=prefix==='lookup'?lookupJob:cohortJob,jobId=jobRef.current;generation.current++;jobRef.current='';setBusy(false);setRunningSnapshot('');setLookup(null);setCohorts(null);setMatrix(null);setProgress('');if(jobId)try{await api('/respondent',{method:'POST',body:JSON.stringify({action:prefix+'-cancel',jobId})});}catch(e){setError(`${prefix} cancellation could not be confirmed: ${e.message}`);}}
 async function snapshotResults(current,selection){
  let jobId=cohortJob.current;
  if(!jobId){
   jobId=await prepareMultiSnapshot({api,prefix:'cohort',input:{historyFrom,from,to,...programmeFilters,...responseScope},isCurrent:()=>current===generation.current,onStart:id=>{cohortJob.current=id;},onProgress:scanned=>setProgress(`${scanned} indexed submissions scanned.`)});
   if(!jobId)return null;
  }
  return api('/respondent',{method:'POST',body:JSON.stringify({action:'cohort-results',jobId,...selection})});
 }
 async function lookupResults(current,cursor){
  let jobId=lookupJob.current;
  if(!jobId){
   jobId=await prepareMultiSnapshot({api,prefix:'lookup',input:{from,to,kind,term,...programmeFilters,...responseScope},stepInput:{term},isCurrent:()=>current===generation.current,onStart:id=>{lookupJob.current=id;},onProgress:scanned=>setProgress(`${scanned} indexed submissions scanned.`)});
   if(!jobId)return null;
  }
  return api('/respondent',{method:'POST',body:JSON.stringify({action:'lookup-results',jobId,cursor})});
 }
 async function run(action,cursor='',nextGroup=group){
  const current=++generation.current;setBusy(true);setRunningSnapshot(snapshotEnabled===true?(action==='lookup'?'lookup':'cohort'):'');setProgress('');setError('');
  try{
   const body=action==='lookup'?{action,from,to,kind,term,cursor,...programmeFilters,...responseScope}:{action,historyFrom,from,to,group:nextGroup,cursor,...programmeFilters,...responseScope};
   const data=snapshotEnabled===true?(action==='lookup'?await lookupResults(current,cursor):await snapshotResults(current,{group:nextGroup,cursor})):await api('/respondent',{method:'POST',body:JSON.stringify(body)});
   if(current!==generation.current)return;
   if(action==='lookup'){setLookup(data);setCohorts(null);}else{setCohorts(data);setLookup(null);setGroup(nextGroup);}setMatrix(null);
  }catch(e){if(current===generation.current){if(action==='lookup'&&lookupJob.current){const jobId=lookupJob.current;lookupJob.current='';cancelJobs([['lookup',jobId]],(prefix,error)=>console.error(`${prefix} cancellation could not be confirmed:`,error));}setLookup(null);setCohorts(null);setMatrix(null);setError(e.message);}}
  finally{if(current===generation.current){setBusy(false);setRunningSnapshot('');}}
 }
 async function runMatrix(cohortYear='',returnYear='',cursor=''){
  const current=++generation.current;setBusy(true);setRunningSnapshot(snapshotEnabled===true?'cohort':'');setProgress('');setError('');
  try{
   const data=snapshotEnabled===true?await snapshotResults(current,{cohortYear,returnYear,cursor}):await api('/respondent',{method:'POST',body:JSON.stringify({action:'cohortMatrix',historyFrom,from,to,cohortYear,returnYear,cursor,...programmeFilters,...responseScope})});
   if(current===generation.current){setMatrix(data);setLookup(null);setCohorts(null);}
  }catch(e){if(current===generation.current){setMatrix(null);setError(e.message);}}
  finally{if(current===generation.current){setBusy(false);setRunningSnapshot('');}}
 }
 async function downloadMatrix(format){
  if(!matrix||!canExport)return;
  const current=++generation.current,snapshot=matrix,cancelled=()=>current!==generation.current;setBusy(true);setError('');
  try{
   const exporter=await import('./registration-exports.mjs'),blob=format==='xlsx'?await exporter.cohortHeatmapWorkbook(snapshot,{cancelled}):await exporter.cohortHeatmapPdf(snapshot,{cancelled});
   if(cancelled())return;
   const fresh=await api('/respondent',{method:'POST',body:JSON.stringify(snapshotEnabled===true?{action:'cohort-results',jobId:cohortJob.current,export:format}:{action:'cohortMatrix',historyFrom:snapshot.historyFrom,from:snapshot.from,to:snapshot.to,...snapshot.filters,export:format})});
   if(cancelled())return;
   if(fresh.fingerprint!==snapshot.fingerprint)throw Error('The cohort report changed while preparing the download. Run it again.');
   exporter.downloadResponses(blob,'Cohort-aggregate',snapshot.generatedAt,format);
  }catch(e){if(!cancelled()){setMatrix(null);setError(e.message);}}
  finally{if(!cancelled())setBusy(false);}
 }
 const coverage=data=><p>{data.coverage.indexed} indexed submissions in the history window; {data.coverage.unresolved} unresolved, {data.coverage.unmapped} missing or conflicting mappings, {data.coverage.staleIndex} stale index rows and {data.coverage.unavailable} unavailable or inaccessible event rows. Unindexed history is not counted.</p>;
 return <section><h3>Find a respondent</h3><p>Search reviewed mapped respondent fields within a Sydney submission-date window. Names use partial matching; email and mobile require a complete exact match. Shared contacts can match different people. No match automatically links or merges anyone. Form filter: {responseScope?.formId||'all'}; saved-event filter: {responseScope?.eventId||'all'}. {snapshotEnabled===true?'Temporary searches scan at most 50,000 indexed records and 600 distinct calendar/review ledger entries; larger scopes are rejected without partial results.':snapshotEnabled===false?'Temporary snapshots are disabled; windows exceeding 5,000 indexed responses are rejected.':'Checking search availability.'}</p>
 <label>Submission dates from (Sydney)<input type="date" disabled={busy} value={from} onChange={e=>{clear();setFrom(e.target.value);}}/></label><label>Submission dates to (Sydney)<input type="date" disabled={busy} value={to} onChange={e=>{clear();setTo(e.target.value);}}/></label>
 <label>Search field<select disabled={busy} value={kind} onChange={e=>{clear();setKind(e.target.value);setTerm('');}}><option value="name">Name</option><option value="email">Email</option><option value="mobile">Mobile</option></select></label>
 <label>Respondent search<input type="search" maxLength="254" disabled={busy} value={term} onChange={e=>{clear();setTerm(e.target.value);}}/></label><button type="button" className="btn alt" disabled={busy||snapshotEnabled===null||!from||!to||!term} onClick={()=>run('lookup')}>Search respondent records</button>
 {lookup&&<section><h4>Respondent search results</h4><p>{lookup.notice}</p>{coverage(lookup)}<p>{lookup.confirmedMatches} confirmed respondents; {lookup.unresolvedMatches} unresolved matching responses. Contacts are masked.</p>
 {!lookup.items.length&&<p>No mapped matches in this window.</p>}{lookup.items.map(item=><p key={item.kind==='confirmed'?item.personId:item.formId+'/'+item.responseId}>{item.kind==='confirmed'?'Confirmed respondent':'Unresolved response candidate'} · {item.names.join(' / ')||'Name unavailable'} · {item.contactHints.join(', ')||'Contact unavailable'} · {item.kind==='confirmed'?item.personId:`${item.formId} / ${item.responseId} · ${item.reference}`} {item.kind==='confirmed'&&<button type="button" className="btn alt" disabled={busy} onClick={()=>onChoosePerson(item.personId)}>Choose for timeline</button>}</p>)}
 {lookup.next&&<button type="button" className="btn alt" disabled={busy} onClick={()=>run('lookup',lookup.next)}>Next search page</button>}<button type="button" className="btn alt" disabled={busy} onClick={()=>run('lookup')}>First search page</button></section>}
 <h3>First-known and returning respondents</h3><p>The period above uses submission dates and the selected programme filters; earlier history includes all accessible forms and events from the history start. Returning means any earlier confirmed submission in that window, not necessarily the same event or programme. Results are not attendance. {snapshotEnabled===true?'Temporary snapshots scan at most 50,000 indexed records and 600 distinct calendar/review ledger entries; larger scopes are rejected without partial reports.':snapshotEnabled===false?'Temporary snapshots are disabled; windows exceeding 5,000 indexed responses are rejected.':'Checking cohort availability.'}</p>
 <label>History starts (Sydney)<input type="date" disabled={busy} value={historyFrom} onChange={e=>{clear();setHistoryFrom(e.target.value);}}/></label><button type="button" className="btn alt" disabled={busy||snapshotEnabled===null||!historyFrom||!from||!to} onClick={()=>run('cohorts')}>Run first-known report</button>
 {cohorts&&<section><h4>First-known report</h4><p>{cohorts.notice}</p>{coverage(cohorts)}<p>{cohorts.counts.identified} identified respondents in the period: {cohorts.counts.firstKnown} first-known in this history window; {cohorts.counts.returning} returning.</p>
 <FirstKnownChart counts={cohorts.counts} disabled={busy} onSelect={value=>run('cohorts','',value)}/>
 <label>Classification<select disabled={busy} value={group} onChange={e=>run('cohorts','',e.target.value)}><option value="first-known">First-known</option><option value="returning">Returning</option></select></label>
 {!cohorts.items.length&&<p>No identified respondents in this group.</p>}{cohorts.items.map(item=><p key={item.personId}>{item.names.join(' / ')||'Name unavailable'} · {item.personId} · first known {displayDate(item.firstKnownAt)} <button type="button" className="btn alt" disabled={busy} onClick={()=>onChoosePerson(item.personId)}>Choose for timeline</button></p>)}
 {cohorts.next&&<button type="button" className="btn alt" disabled={busy} onClick={()=>run('cohorts',cohorts.next)}>Next classification page</button>}<button type="button" className="btn alt" disabled={busy} onClick={()=>run('cohorts','',group)}>First classification page</button></section>}
 <h3>First-known-year cohort heatmap</h3><p>Uses the same history start and submission-date period. Each cell represents distinct confirmed people with a matching submission in that Sydney year, not attendance; partial years and incomplete history affect comparisons.</p><button type="button" className="btn alt" disabled={busy||snapshotEnabled===null||!historyFrom||!from||!to} onClick={()=>runMatrix()}>Run cohort heatmap</button>
 {matrix&&<section><p>{matrix.notice}</p>{coverage(matrix)}{!matrix.rows.length?<p>No confirmed respondents with matching submissions in this period.</p>:<div style={{overflowX:'auto'}}><table aria-label="First-known-year cohort heatmap"><thead><tr><th scope="col">First-known year</th>{matrix.years.map(y=><th key={y} scope="col">{y}{(matrix.from>y+'-01-01'||matrix.to<y+'-12-31')?' (partial)':''}</th>)}</tr></thead><tbody>{matrix.rows.map(row=><tr key={row.cohortYear}><th scope="row">{row.cohortYear}</th>{row.counts.map((count,i)=><td key={matrix.years[i]}><button type="button" className="btn alt" disabled={busy} onClick={()=>runMatrix(row.cohortYear,matrix.years[i])} aria-label={`First-known ${row.cohortYear}, ${matrix.years[i]}: ${count} respondents; show list`} style={{background:count?`rgba(23,100,70,${0.1+0.35*count/Math.max(1,...matrix.rows.flatMap(item=>item.counts))})`:'#f1f3f5',color:'#163a2b'}}>{count}</button></td>)}</tr>)}</tbody></table></div>}
 {matrix.cohortYear&&<section><h4>First-known {matrix.cohortYear}, matching in {matrix.returnYear}</h4>{!matrix.items.length&&<p>No confirmed respondents in this cell.</p>}{matrix.items.map(item=><p key={item.personId}>{item.names.join(' / ')||'Name unavailable'} · {item.personId} · first known {displayDate(item.firstKnownAt)} <button type="button" className="btn alt" disabled={busy} onClick={()=>onChoosePerson(item.personId)}>Choose for timeline</button></p>)}{matrix.next&&<button type="button" className="btn alt" disabled={busy} onClick={()=>runMatrix(matrix.cohortYear,matrix.returnYear,matrix.next)}>Next cohort page</button>}<button type="button" className="btn alt" disabled={busy} onClick={()=>runMatrix(matrix.cohortYear,matrix.returnYear)}>First cohort page</button></section>}
 {canExport&&<div className="registration-actions"><button type="button" className="btn alt" disabled={busy} onClick={()=>downloadMatrix('xlsx')}>Download aggregate cohorts Excel</button><button type="button" className="btn alt" disabled={busy} onClick={()=>downloadMatrix('pdf')}>Download aggregate cohorts PDF</button></div>}<p>Cohort downloads contain counts only, never person lists; people and export permissions are checked again before delivery.</p></section>}
 {busy&&<><p role="status">Preparing respondent results… {progress}</p>{runningSnapshot&&<button type="button" className="btn alt" onClick={cancel}>Cancel {runningSnapshot==='lookup'?'respondent search':'cohort analysis'}</button>}</>}{error&&<p role="alert">{error}</p>}</section>;
}
