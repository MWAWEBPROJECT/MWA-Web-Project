import React,{useEffect,useMemo,useRef,useState} from 'react';
import {useAuth} from '@calendar/contexts/AuthContext.jsx';
import {auth} from '@calendar/firebase/firebase.js';
import InsightsMapping from './InsightsMapping.jsx';
import InsightsProgrammes from './InsightsProgrammes.jsx';
import InsightsProgrammeFilters,{emptyProgrammeFilters} from './InsightsProgrammeFilters.jsx';
import {MonthlyChart,YearlyChart,YearOverYearChart} from './InsightsCharts.jsx';
import InsightsRespondents from './InsightsRespondents.jsx';
import InsightsAnswers from './InsightsAnswers.jsx';
import {INSIGHTS_PROVENANCE,insightsExportFilter,insightsPdfMetricRows,programmeFilterLabel} from './insights-provenance.mjs';
import {prepareMultiSnapshot} from './insights-multi-client.mjs';
import './registrations.css';
import AdminBackButton from '@calendar/components/AdminBackButton.jsx';

export function EventCoverageTable({events,coverage,analysisLimits,showIds=false,onSelectEvent}){
 return <section><h3>Calendar event inventory and indexed coverage</h3><p>{coverage.label}: {coverage.reason} Inventory is selected by current event start date in Australia/Sydney; indexed response counts include all indexed records for each event ID across forms.</p>{analysisLimits&&<p>Temporary inventory scans at most {analysisLimits.indexed.toLocaleString()} matching indexed responses and {analysisLimits.calendar.toLocaleString()} calendar events including inaccessible events. Category filtering uses at most {analysisLimits.programme} programme review entries. A separate stored-scope size limit can apply. Larger scopes are rejected without partial results.</p>}{coverage.indexScanTruncated&&<p>Only the first 5,000 indexed records were scanned. Counts are observed lower bounds and must not be interpreted as totals.</p>}{coverage.sourceReconciliationTruncated&&<p>Source counts were checked for only the first 100 events in this inventory.</p>}<div style={{overflowX:'auto'}}><table aria-label="Calendar event inventory and indexed response coverage"><thead><tr><th>Event</th><th>Event date (Sydney)</th><th>Status</th><th>Forms with indexed responses</th><th>Source responses with event ID</th><th>Indexed responses</th><th>Index comparison</th><th>Coverage</th></tr></thead><tbody>{events.map(event=><tr key={event.id}><td>{onSelectEvent?<button type="button" className="btn alt" onClick={()=>onSelectEvent(event.id)}>{event.title}</button>:event.title}{showIds&&<> <small>{event.id}</small></>}</td><td>{event.startAt?new Date(event.startAt).toLocaleString('en-AU',{timeZone:'Australia/Sydney'}):'Date unavailable'}</td><td>{event.status}</td><td>{event.indexedForms}</td><td>{event.sourceResponses===null?'Not checked':event.sourceResponses}</td><td>{coverage.indexScanTruncated?`${event.indexedResponses} observed`:`${event.indexedResponses} indexed responses`}</td><td>{event.reconciliationStatus}</td><td>{event.coverageStatus==='complete'?'Reconciled':'Coverage incomplete'}</td></tr>)}</tbody></table></div>{!events.length&&<p role="status">No accessible calendar events were found for this Sydney event-date range and programme filters.</p>}</section>;
}

export function InsightsDrilldown({report,pageIndex,onPage,canPage}){
 if(!report?.drilldownAvailable)return <p>Response-level drilldown requires the separately assigned Form Insights person-search permission. Aggregate results remain available.</p>;
 return <section><h3>Matching response references</h3><p>References are not verified identities. Personal answers and contact details are not included in this table.</p><div style={{overflowX:'auto'}}><table aria-label="Paginated registration response references"><thead><tr><th>Reference</th><th>Form</th><th>Event</th><th>Submitted (Sydney)</th></tr></thead><tbody>{report.items.map((row,index)=><tr key={row.reference+'-'+index}><td>{row.reference}</td><td>{row.formTitle}</td><td>{row.eventTitle||'No accessible event detail'}</td><td>{new Date(row.submittedAt).toLocaleString('en-AU',{timeZone:'Australia/Sydney'})}</td></tr>)}</tbody></table></div><p role="status">Showing page {pageIndex+1} of matching indexed response references ({report.totalMatching} total for the selected filters).</p><div className="registration-actions"><button type="button" className="btn alt" disabled={!canPage||pageIndex===0} onClick={()=>onPage('previous')}>Previous page</button><button type="button" className="btn alt" disabled={!report.nextCursor} onClick={()=>onPage('next')}>Next page</button></div></section>;
}

function sydneyToday(){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Sydney',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()),value=Object.fromEntries(parts.map(part=>[part.type,part.value]));
 return {date:`${value.year}-${value.month}-${value.day}`,month:`${value.year}-${value.month}`,year:value.year};
}

export default function FormInsights(){
 const session=useAuth();
 if(session.loading)return <p>Checking Insights access…</p>;
 if(!session.isAdmin||!session.canAccess('form-insights'))return <section><AdminBackButton/><p>Form Insights access is not assigned.</p></section>;
 const scope=JSON.stringify([session.user?.uid,session.user?.email,session.isOwner,...['events-bookings','form-insights-people','form-insights-export'].map(module=>session.canAccess(module))]);
 return <FormInsightsWorkspace key={scope} session={session}/>;
}

function FormInsightsWorkspace({session}){
 const today=sydneyToday(),[dateMode,setDateMode]=useState('custom'),[from,setFrom]=useState(today.year+'-01-01'),[to,setTo]=useState(today.date),[month,setMonth]=useState(today.month),[year,setYear]=useState(today.year),[basis,setBasis]=useState('submission'),[search,setSearch]=useState(''),[formId,setFormId]=useState(''),[eventId,setEventId]=useState(''),[report,setReport]=useState(null),[eventCoverage,setEventCoverage]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[rebuild,setRebuild]=useState(''),[cursor,setCursor]=useState(''),[progress,setProgress]=useState(''),[activeQuery,setActiveQuery]=useState(''),[pageStarts,setPageStarts]=useState(['']),[pageIndex,setPageIndex]=useState(0),[reconciliation,setReconciliation]=useState(null),[reconciliationBusy,setReconciliationBusy]=useState(false);
 const [programmeFilters,setProgrammeFilters]=useState(emptyProgrammeFilters);
 const inventoryJob=useRef(''),aggregateJob=useRef(''),requestGeneration=useRef(0),[inventoryProgress,setInventoryProgress]=useState('');
 const responseScope=useMemo(()=>({formId,eventId}),[formId,eventId]);
 async function api(path,options){const user=auth.currentUser;if(!user)throw Error('Sign in again.');const response=await fetch('/api/form-insights'+path,{...options,headers:{'Content-Type':'application/json',Authorization:'Bearer '+await user.getIdToken()},cache:'no-store'});const data=await response.json();if(auth.currentUser!==user)throw Error('Session changed.');if(!response.ok)throw Error(data.error||'Insights request failed.');return data;}
 async function cancelInventory(jobId){if(jobId)await api('/events',{method:'POST',body:JSON.stringify({action:'inventory-cancel',jobId})});}
 async function cancelAggregate(jobId){if(jobId)await api('/analysis',{method:'POST',body:JSON.stringify({action:'aggregate-cancel',jobId})});}
 function takeJobs(){const jobs=[inventoryJob.current,aggregateJob.current];inventoryJob.current='';aggregateJob.current='';return jobs;}
 async function cancelJobs([inventory,aggregate]){await Promise.all([cancelInventory(inventory),cancelAggregate(aggregate)]);}
 useEffect(()=>()=>{requestGeneration.current++;cancelJobs(takeJobs()).catch(e=>console.error('Snapshot cancellation could not be confirmed:',e));},[]);
 async function cancelReport(){requestGeneration.current++;const jobs=takeJobs();setBusy(false);setInventoryProgress('');setReport(null);setEventCoverage(null);try{await cancelJobs(jobs);}catch(e){setError('Snapshot cancellation could not be confirmed: '+e.message);}}
 function queryForReport(){const values={dateMode,basis,search,eventId,formId,...programmeFilters,categories:programmeFilters.categories.join(',')};if(dateMode==='custom'){values.from=from;values.to=to;}else if(dateMode==='month')values.month=month;else values.year=year;return new URLSearchParams(values);}
 async function run(format,overrides={},sourceQuery=''){
  const userId=auth.currentUser?.uid,currentRequest=++requestGeneration.current,current=()=>requestGeneration.current===currentRequest,previousJobs=takeJobs();setBusy(true);setInventoryProgress('');setError('');setReport(null);setEventCoverage(null);
  try{
   await cancelJobs(previousJobs);if(!current())return;
   const query=sourceQuery?new URLSearchParams(sourceQuery):queryForReport();for(const [key,value] of Object.entries(overrides))query.set(key,value);setActiveQuery(query.toString());setPageStarts(['']);setPageIndex(0);
   const reportQuery=new URLSearchParams(query);reportQuery.set('pageSize','50');if(format)reportQuery.set('export',format);
   const aggregateStatus=await api('/analysis',{method:'POST',body:JSON.stringify({action:'aggregate-status'})});if(!current())return;
   let data;
   if(aggregateStatus.enabled){
    const input=Object.fromEntries(query),jobId=await prepareMultiSnapshot({api,endpoint:'/analysis',prefix:'aggregate',input,stepInput:{search:input.search||''},isCurrent:current,onStart:id=>{aggregateJob.current=id;},onProgress:scanned=>setInventoryProgress(`${scanned} indexed submissions scanned.`)});
    if(!jobId||!current())return;
    data=await api('/analysis',{method:'POST',body:JSON.stringify({action:'aggregate-results',jobId,pageSize:50,...(format?{export:format}:{})})});
   }else data=await api('/?'+reportQuery);
   if(!current())return;
   const status=await api('/events',{method:'POST',body:JSON.stringify({action:'inventory-status'})});if(!current())return;
   let coverage;
   if(status.enabled){
    const jobId=await prepareMultiSnapshot({api,endpoint:'/events',prefix:'inventory',input:{from:data.filters.from,to:data.filters.to,categories:data.filters.categories,bookingType:data.filters.bookingType,series:data.filters.series},isCurrent:current,onStart:id=>{inventoryJob.current=id;},onProgress:scanned=>setInventoryProgress(`${scanned} indexed event responses scanned.`)});
    if(!jobId||!current())return;
    coverage=await api('/events',{method:'POST',body:JSON.stringify({action:'inventory-results',jobId})});
   }else coverage=await api('/events?'+new URLSearchParams({from:data.filters.from,to:data.filters.to,categories:data.filters.categories.join(','),bookingType:data.filters.bookingType,series:data.filters.series}));
   if(!current())return;
   if(data.filters.basis==='event'&&data.calendarVersion!==coverage.calendarVersion)throw Error('Calendar events changed while preparing the report and inventory. Run it again.');
   const refresh=()=>data.snapshot?api('/analysis',{method:'POST',body:JSON.stringify({action:'aggregate-results',jobId:aggregateJob.current,pageSize:50,...(format?{export:format}:{})})}):api('/?'+reportQuery);
   const fresh=await refresh();if(!current())return;
   if(fresh.coverageVersion!==data.coverageVersion||fresh.totalMatching!==data.totalMatching)throw Error('Report data changed while preparing the inventory. Run it again.');
   if(status.enabled){coverage=await api('/events',{method:'POST',body:JSON.stringify({action:'inventory-results',jobId:inventoryJob.current})});if(!current())return;}
   setReport(data);setEventCoverage(coverage);
   if(format){
    const exporter=await import('./registration-exports.mjs'),filter=insightsExportFilter(data);
    let blob;
    if(format==='pdf'){
     const fields=[{id:'kind',type:'text',label:'Metric'},{id:'period',type:'text',label:'Period or event'},{id:'count',type:'number',label:'Submissions'}];
     const rows=insightsPdfMetricRows(data).map((answers,index)=>({id:String(index),reference:'INSIGHT-'+(index+1),createdAt:data.generatedAt,revision:1,formTitle:'Form Insights',fields,answers}));
     const form={id:'Insights',title:'Form Insights — '+data.filters.from+' to '+data.filters.to,fields,revision:1};
     blob=await exporter.responsePdf(form,rows,data.generatedAt,{filter,insights:{submissions:data.submissions}});
    }else blob=await exporter.insightsWorkbook(data,data.generatedAt,{filter});
    if(!current())return;const checked=await refresh();if(!current())return;
    if(checked.coverageVersion!==data.coverageVersion||checked.totalMatching!==data.totalMatching)throw Error('Report data changed while preparing export. Run it again.');
    if(auth.currentUser?.uid!==userId)throw Error('Session changed.');
    exporter.downloadResponses(blob,'Insights',data.generatedAt,format);
   }
  }catch(e){if(current())setError(e.message);}finally{if(current()){setBusy(false);setInventoryProgress('');}}
 }
 async function changePage(direction){if(!report||busy)return;const nextIndex=direction==='next'?pageIndex+1:pageIndex-1;if(nextIndex<0)return;const nextCursor=direction==='next'?report.nextCursor:pageStarts[nextIndex];if(direction==='next'&&!nextCursor)return;const currentRequest=++requestGeneration.current,current=()=>requestGeneration.current===currentRequest;setBusy(true);setError('');try{const query=new URLSearchParams(activeQuery);query.set('pageSize','50');if(nextCursor)query.set('cursor',nextCursor);const data=report.snapshot?await api('/analysis',{method:'POST',body:JSON.stringify({action:'aggregate-results',jobId:aggregateJob.current,pageSize:50,cursor:nextCursor})}):await api('/?'+query);if(!current())return;setReport(data);if(direction==='next')setPageStarts(previous=>[...previous.slice(0,pageIndex+1),nextCursor]);setPageIndex(nextIndex);}catch(e){if(current()){setReport(null);setError(e.message);}}finally{if(current())setBusy(false);}}
 function selectChartPeriod(start,end){
  const narrowedFrom=start>report.filters.from?start:report.filters.from,narrowedTo=end<report.filters.to?end:report.filters.to;
  setDateMode('custom');setFrom(narrowedFrom);setTo(narrowedTo);
  run(null,{dateMode:'custom',from:narrowedFrom,to:narrowedTo},activeQuery);
 }
 async function backfill(dryRun){setBusy(true);setError('');try{const data=await api('/backfill',{method:'POST',body:JSON.stringify({formId:rebuild,after:cursor,dryRun})});setProgress((dryRun?'Preview: ':'Indexed: ')+data.count+' records in this batch. '+(data.next?'More batches remain.':'End of form reached. This does not certify all history is indexed.'));if(!dryRun)setCursor(data.next||'');}catch(e){setError(e.message);}finally{setBusy(false);}}
 async function reconcile(action){setReconciliationBusy(true);setError('');try{const data=action==='status'?await api('/reconcile'+(reconciliation?.jobId?'?jobId='+encodeURIComponent(reconciliation.jobId):'')):await api('/reconcile',{method:'POST',body:JSON.stringify({action,jobId:reconciliation?.jobId})});setReconciliation(data);}catch(e){setError(e.message);}finally{setReconciliationBusy(false);}}
 return <section className="admin-console form-builder"><AdminBackButton/><div className="eyebrow">MWA · FORM INSIGHTS</div><h1>Registration history</h1><p><a href="/admin-login?module=form-builder">Form Builder</a></p><p>Reports measure registrations, not attendance. Historical coverage remains incomplete.</p><p>{INSIGHTS_PROVENANCE}</p>
 <form onSubmit={event=>{event.preventDefault();run();}}><fieldset disabled={busy}><legend>Report filters</legend><label>Reporting period<select value={dateMode} onChange={event=>setDateMode(event.target.value)}><option value="custom">Custom date range</option><option value="month">Sydney calendar month</option><option value="year">Sydney calendar year</option></select></label>{dateMode==='custom'?<><label>From (Sydney)<input required type="date" value={from} onChange={event=>setFrom(event.target.value)}/></label><label>To (Sydney)<input required type="date" min={from} value={to} onChange={event=>setTo(event.target.value)}/></label></>:dateMode==='month'?<label>Month (Sydney)<input required type="month" value={month} onChange={event=>setMonth(event.target.value)}/></label>:<label>Year (Sydney)<input required type="number" min="1000" max="9999" step="1" value={year} onChange={event=>setYear(event.target.value)}/></label>}<label>Date basis<select value={basis} onChange={event=>setBasis(event.target.value)}><option value="submission">Submission date</option><option value="event">Current calendar event date</option></select></label><label>Form reference (optional)<input maxLength="128" value={formId} onChange={event=>setFormId(event.target.value)}/></label><label>Event (optional)<select value={eventId} onChange={event=>setEventId(event.target.value)}><option value="">All accessible events</option>{eventCoverage?.events.map(event=><option key={event.id} value={event.id}>{event.title} — {event.startAt?new Date(event.startAt).toLocaleDateString('en-AU',{timeZone:'Australia/Sydney'}):'date unavailable'}</option>)}</select></label>{session.canAccess('form-insights-people')&&<label>Candidate answer search<input type="search" maxLength="200" placeholder="Name, email or mobile as entered" value={search} onChange={event=>setSearch(event.target.value)}/></label>}<div className="registration-actions mwa-module-menu"><button className="btn">Run report</button>{session.canAccess('form-insights-export')&&<><button type="button" className="btn alt" onClick={()=>run('xlsx')}>Export Excel</button><button type="button" className="btn alt" onClick={()=>run('pdf')}>Export PDF</button></>}</div></fieldset><div className="registration-actions"><button type="button" className="btn alt" disabled={busy} onClick={()=>{setFrom('');setTo('');setSearch('');setFormId('');setEventId('');setProgrammeFilters(emptyProgrammeFilters());}}>Clear</button><button type="button" className="btn alt" disabled={busy} onClick={()=>{cancelReport();location.assign('/admin-login?module=form-builder');}}>Cancel</button></div></form>
 <InsightsProgrammeFilters api={api} value={programmeFilters} onChange={setProgrammeFilters} disabled={busy}/>
 {error&&<p role="alert">{error}</p>}
 {busy&&<><p role="status">Preparing… {inventoryProgress}</p><button type="button" className="btn alt" onClick={cancelReport}>Cancel report preparation</button></>}
 <InsightsAnswers key={session.user?.uid} api={api} queryForReport={queryForReport} canExport={session.canAccess('form-insights-export')}/>
 {report&&<section>
  <h2>{report.submissions} submissions · {report.events} events receiving entries · {report.forms} forms{Number.isSafeInteger(report.identified)&&<> · {report.identified} identified people</>}</h2>
  <p>{report.definitions}</p>
  <p>Applied: {programmeFilterLabel(report.filters)}. The calendar inventory uses these programme filters and current event dates; its response counts span all forms and submission dates and do not apply the report's form, event or candidate-search filters.</p>
  <p>Generated {new Date(report.generatedAt).toLocaleString('en-AU',{timeZone:'Australia/Sydney'})} Sydney. These results retain the filters used when Run report was clicked.</p>
  <p>Source/index reconciliation: {report.reconciliation?`${report.reconciliation.status}; ${report.reconciliation.freshness}; last scanned ${report.reconciliation.completedAt||'not completed'}. Coverage remains incomplete.`:'No reconciliation scan has completed. Coverage remains incomplete.'} Reconciliation does not check event dates or other calendar changes.</p>
  <p>Exports include the complete filtered aggregate report, not only the current response-reference page. {report.snapshot?'Temporary reports refuse more than 50,000 indexed records or 600 review entries; submission-date reports also include referenced calendar events in that ledger. Event-date reports scan at most 5,000 calendar events, subject to a stored-scope size limit.':'More than 5,000 matching indexed responses are refused rather than partially exported.'}</p>
  <YearlyChart items={report.years} disabled={busy} onSelect={value=>selectChartPeriod(value+'-01-01',value+'-12-31')}/>
  <YearOverYearChart items={report.days} filters={report.filters} disabled={busy} onSelect={(value,first,last)=>selectChartPeriod(value+'-'+first,value+'-'+last)}/>
  <MonthlyChart items={report.months} disabled={busy} onSelect={value=>selectChartPeriod(value+'-01',new Date(Date.UTC(Number(value.slice(0,4)),Number(value.slice(5,7)),0)).toISOString().slice(0,10))}/>
  <h3>Yearly registrations</h3>
  <div style={{overflowX:'auto'}}><table aria-label="Yearly registrations chart and data"><thead><tr><th>Year</th><th>Relative volume</th><th>Submissions</th><th>Filter</th></tr></thead><tbody>{report.years.map(item=><tr key={item.year}><th scope="row">{item.year}</th><td><span aria-label={`${item.count} submissions`} style={{display:'block',background:'var(--accent,#176446)',height:18,borderRadius:4,width:Math.max(1,item.count/Math.max(...report.years.map(value=>value.count))*100)+'%'}}/></td><td>{item.count}</td><td><button type="button" className="btn alt" onClick={()=>{setDateMode('year');setYear(item.year);setEventId('');}}>Filter to {item.year}</button></td></tr>)}</tbody></table></div>
  <h3>Monthly registrations</h3>
  <div style={{overflowX:'auto'}}><table aria-label="Monthly registrations chart and data"><thead><tr><th>Month</th><th>Relative volume</th><th>Submissions</th><th>Filter</th></tr></thead><tbody>{report.months.map(item=><tr key={item.month}><th scope="row">{item.month}</th><td><span aria-label={`${item.count} submissions`} style={{display:'block',background:'var(--accent,#176446)',height:18,borderRadius:4,width:Math.max(1,item.count/Math.max(...report.months.map(value=>value.count))*100)+'%'}}/></td><td>{item.count}</td><td><button type="button" className="btn alt" onClick={()=>{setDateMode('month');setMonth(item.month);setEventId('');}}>Filter to {item.month}</button></td></tr>)}</tbody></table></div>
  {eventCoverage&&<EventCoverageTable events={eventCoverage.events} coverage={eventCoverage.coverage} analysisLimits={eventCoverage.analysisLimits} showIds={session.canAccess('events-bookings')} onSelectEvent={id=>setEventId(id)}/>}
  <div style={{overflowX:'auto'}}><table aria-label="Events receiving indexed entries"><thead><tr><th>Event receiving indexed entries</th><th>Entries</th><th>Filter</th></tr></thead><tbody>{report.eventRows.map(event=><tr key={event.id}><td>{event.title}</td><td>{event.count}</td><td><button type="button" className="btn alt" onClick={()=>setEventId(event.id)}>Filter to event</button></td></tr>)}</tbody></table></div>
  <InsightsDrilldown report={report} pageIndex={pageIndex} onPage={changePage} canPage={!busy}/>
  {report.candidates.length>0&&<><h3>Search candidate response references</h3><p>Matches are candidates, not a merged person record. Open the permitted form’s Responses view and search the reference/answers to investigate.</p>{report.candidates.map(candidate=><p key={candidate.responseId}>{candidate.reference} · {candidate.formTitle} · {candidate.eventTitle} · {new Date(candidate.submittedAt).toLocaleDateString('en-AU',{timeZone:'Australia/Sydney'})}</p>)}{report.candidateLimit&&<p>First 100 references shown; narrow the search. Aggregate totals include all matches.</p>}</>}
 </section>}
 {session.isOwner&&<details><summary>Historical index preparation — Super Admin</summary><p>Preview first. Each indexing action processes up to 50 source responses and leaves original answers unchanged. Do not start production backfill until retention and historical use are agreed. No automatic deletion is configured.</p><label>Form reference<input value={rebuild} onChange={event=>{setRebuild(event.target.value);setCursor('');setProgress('');}}/></label><div className="registration-actions"><button className="btn alt" disabled={busy||!rebuild} onClick={()=>backfill(true)}>Preview next batch</button><button className="btn alt" disabled={busy||!rebuild} onClick={()=>backfill(false)}>Index next batch</button></div><p role="status">{progress}</p><h3>Source/index reconciliation scan</h3><p>This bounded scan reads source response and private index data but changes neither. It stores resumable scan and issue metadata. It never repairs, indexes, deletes or changes source responses. A clean scan does not prove that legacy records without reliable links or identity mappings are complete. Do not run against production until separately authorized.</p><div className="registration-actions"><button type="button" className="btn alt" disabled={reconciliationBusy} onClick={()=>reconcile('start')}>Start a new reconciliation scan</button><button type="button" className="btn alt" disabled={reconciliationBusy||!reconciliation?.jobId||reconciliation.status!=='running'} onClick={()=>reconcile('step')}>Run next reconciliation batch</button><button type="button" className="btn alt" disabled={reconciliationBusy} onClick={()=>reconcile('status')}>Refresh reconciliation status</button></div>{reconciliation&&<div role="status"><p>Scan {reconciliation.status} · phase {reconciliation.phase||'finished'} · {reconciliation.formCount} forms · scope cutoff {reconciliation.scopeCutoff}</p><p>Sources scanned {reconciliation.counts?.sourcesScanned||0}; index rows scanned {reconciliation.counts?.indexedScanned||0}; missing indexes {reconciliation.counts?.missingIndex||0}; stale indexes {reconciliation.counts?.staleIndex||0}; orphan indexes {reconciliation.counts?.orphanIndex||0}; unindexable sources {reconciliation.counts?.unindexableSource||0}; invalid index rows {reconciliation.counts?.invalidIndex||0}.</p><p>Freshness: {reconciliation.freshness||'not complete'}. Historical coverage remains incomplete.</p></div>}<InsightsMapping api={api}/></details>}
 {session.isOwner&&<details><summary>Programme category review — Super Admin</summary><InsightsProgrammes key={session.user?.uid} api={api}/></details>}
 {session.canAccess('form-insights-people')&&<details><summary>Respondent link review</summary><InsightsRespondents key={session.user?.uid} api={api} programmeFilters={programmeFilters} responseScope={responseScope} canExport={session.canAccess('form-insights-export')}/></details>}
 </section>;
}
