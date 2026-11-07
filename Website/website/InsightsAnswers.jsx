import React,{useEffect,useRef,useState} from 'react';
import {programmeFilterLabel} from './insights-provenance.mjs';
import {ChoiceChart} from './InsightsCharts.jsx';
import {prepareMultiSnapshot} from './insights-multi-client.mjs';

export default function InsightsAnswers({api,queryForReport,canExport=false}){
 const [concept,setConcept]=useState(''),[concept2,setConcept2]=useState(''),[data,setData]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[progress,setProgress]=useState(''),generation=useRef(0),jobRef=useRef('');
 async function cancelJob(){const jobId=jobRef.current;jobRef.current='';if(jobId)await api('/analysis',{method:'POST',body:JSON.stringify({action:'answers-cancel',jobId})});}
 useEffect(()=>()=>{generation.current++;cancelJob().catch(e=>console.error('Answer snapshot cancellation could not be confirmed:',e));},[]);
 useEffect(()=>{
  if(!data)return;
  const timer=setInterval(async()=>{
   const current=generation.current;
   try{const access=await api('/answers-access',{method:'POST',body:'{}'});if(access.calendarAllowed!==data.calendarAllowed||data.filters.searchUsed&&!access.peopleAllowed)throw Error('Insights access changed. Run analysis again.');}
   catch(e){if(current===generation.current){generation.current++;setData(null);setBusy(false);setError(e.message);}}
  },15000);
  return ()=>clearInterval(timer);
 },[api,data]);
 async function run(){
  const current=++generation.current,isCurrent=()=>current===generation.current;setBusy(true);setError('');setData(null);setProgress('');
  try{
   await cancelJob();if(!isCurrent())return;
   const query=queryForReport();query.set('concept',concept);if(concept2)query.set('concept2',concept2);
   const status=await api('/analysis',{method:'POST',body:JSON.stringify({action:'answers-status'})});if(!isCurrent())return;
   let result;
   if(status.enabled){
    const input=Object.fromEntries(query),jobId=await prepareMultiSnapshot({api,endpoint:'/analysis',prefix:'answers',input,stepInput:{search:input.search||''},isCurrent,onStart:id=>{jobRef.current=id;},onProgress:scanned=>setProgress(`${scanned} indexed submissions scanned.`)});
    if(!jobId||!isCurrent())return;
    result=await api('/analysis',{method:'POST',body:JSON.stringify({action:'answers-results',jobId})});
   }else result=await api('/answers?'+query);
   if(isCurrent())setData({...result,query:query.toString()});
  }
  catch(e){if(current===generation.current){setData(null);setError(e.message);}}
  finally{if(current===generation.current)setBusy(false);}
 }
 async function download(format){
  if(!data||!canExport)return;
  const current=++generation.current,snapshot=data;setBusy(true);setError('');
  const cancelled=()=>current!==generation.current;
  try{
   const exporter=await import('./registration-exports.mjs');
   const blob=format==='xlsx'?await exporter.mappedAnswersWorkbook(snapshot,{cancelled}):await exporter.mappedAnswersPdf(snapshot,{cancelled});
   if(cancelled())return;
   const query=new URLSearchParams(snapshot.query);query.set('export',format);
   const fresh=snapshot.snapshot?await api('/analysis',{method:'POST',body:JSON.stringify({action:'answers-results',jobId:jobRef.current,export:format})}):await api('/answers?'+query);
   if(cancelled())return;
   if(fresh.fingerprint!==snapshot.fingerprint)throw Error('The analysis changed while preparing the download. Run it again.');
   exporter.downloadResponses(blob,'Mapped-answers',snapshot.generatedAt,format);
  }catch(e){if(!cancelled()){setData(null);setError(e.message);}}
  finally{if(!cancelled())setBusy(false);}
 }
 return <section><h2>Reviewed mapped-answer analysis</h2><p>Uses the report filters above and a reviewed concept key. Choice options and numeric summaries are visible to aggregate Insights viewers. Text, contact and consent values are excluded. This screen does not download personal responses.</p>
 <label>Reviewed concept key<input value={concept} disabled={busy} maxLength="64" pattern="[a-z0-9][a-z0-9_-]*" onChange={event=>{generation.current++;setData(null);setError('');setConcept(event.target.value);}}/></label>
 <label>Second reviewed concept key (optional cross-tab)<input value={concept2} disabled={busy} maxLength="64" pattern="[a-z0-9][a-z0-9_-]*" onChange={event=>{generation.current++;setData(null);setError('');setConcept2(event.target.value);}}/></label><button type="button" className="btn alt" disabled={busy||!concept} onClick={run}>Analyse mapped answers</button>
 {busy&&<p role="status">Preparing mapped-answer analysis… {progress} <button type="button" className="btn alt small" onClick={async()=>{generation.current++;setBusy(false);setData(null);setProgress('');try{await cancelJob();setError('Analysis or download cancelled.');}catch(e){setError('Snapshot cancellation could not be confirmed: '+e.message);}}}>Cancel</button></p>}{error&&<p role="alert">{error}</p>}
 {data&&<section><p>{data.notice}</p><p>Selected {data.filters.from} to {data.filters.to} (Sydney), {data.filters.basis==='event'?'current calendar event date':'submission date'}; {data.filters.formId?'one selected form':'all forms'}; {data.filters.eventFiltered?'one selected event':'all accessible events'}; {programmeFilterLabel(data.filters)}{data.filters.searchUsed?'; candidate search filter applied':''}. Generated {new Date(data.generatedAt).toLocaleString('en-AU',{timeZone:'Australia/Sydney'})}.</p>
 {data.snapshot&&<p>Temporary analysis refuses more than 50,000 indexed records or 600 review entries; submission-date analysis also includes referenced calendar events in that ledger. Event-date analysis scans at most 5,000 calendar events, subject to a stored-scope size limit. Oversized definitions are refused rather than partially returned.</p>}
 <p>Indexed submissions: {data.coverage.indexed}. Unavailable/inaccessible events: {data.coverage.unavailableEvent}; stale sources: {data.coverage.staleSource}; missing, draft or mismatched mappings: {data.coverage.unreviewed}; concept not mapped: {data.coverage.unmapped}; conflicting definitions: {data.coverage.conflicting}; unsupported or personal fields: {data.coverage.unsupported}. Coverage does not include unindexed responses.</p>
 {!data.groups.length&&!data.crossTabs?.length&&<p>No supported reviewed definitions were found for the selected concepts in the selected data.</p>}
 {data.crossTabs?.map((group,index)=><section key={group.id}><h3>Definition pair {index+1}: {group.definitions[0].label} × {group.definitions[1].label}</h3><p>{group.eligible} eligible responses · {group.answered} answered both · {group.missing} missing · {group.invalid} invalid. Denominator: {group.answered} responses answering both questions.</p><div style={{overflowX:'auto'}}><table aria-label={`Definition pair ${index+1} cross-tab`}><thead><tr><th scope="col">{group.definitions[0].label} / {group.definitions[1].label}</th>{group.definitions[1].options.map(option=><th scope="col" key={option}>{option}</th>)}</tr></thead><tbody>{group.definitions[0].options.map((option,i)=><tr key={option}><th scope="row">{option}</th>{group.counts[i].map((count,j)=><td key={group.definitions[1].options[j]}>{count} ({group.answered?(count/group.answered*100).toFixed(1)+'%':'Unavailable'})</td>)}</tr>)}</tbody></table></div></section>)}
 {data.groups.map((group,index)=><section key={group.id}><h3>Definition {index+1}: {group.label} ({group.type})</h3><p>{group.eligible} eligible responses · {group.answered} answered · {group.missing} missing · {group.invalid} invalid. Denominator: {group.answered} answered responses.</p>
 {group.type==='number'?<p>Minimum: {group.min??'Unavailable'} · Maximum: {group.max??'Unavailable'} · Mean: {group.mean??'Unavailable'}. These are numeric answers, not people or attendance.</p>:<><ChoiceChart options={group.options} answered={group.answered}/><div style={{overflowX:'auto'}}><table aria-label={`Definition ${index+1} answer counts`}><thead><tr><th>Saved option</th><th>Responses selecting option</th><th>Percent of answered responses</th></tr></thead><tbody>{group.options.map(option=><tr key={option.label}><td>{option.label}</td><td>{option.count}</td><td>{group.answered?(option.count/group.answered*100).toFixed(1)+'%':'Unavailable'}</td></tr>)}</tbody></table></div></>}
 {group.type==='checkboxes'&&<p>Multiple options can be selected in one response; percentages can total more than 100%.</p>}</section>)}
 {canExport&&<div className="registration-actions"><button type="button" className="btn alt" disabled={busy} onClick={()=>download('xlsx')}>Download mapped answers Excel</button><button type="button" className="btn alt" disabled={busy} onClick={()=>download('pdf')}>Download mapped answers PDF</button></div>}<p>Downloads contain only these aggregate results; export permission is checked again before delivery.</p></section>}
 </section>;
}
