import React,{useEffect,useRef,useState} from 'react';
import AdminBackButton from '@calendar/components/AdminBackButton.jsx';
import {auth} from '@calendar/firebase/firebase.js';
import {useAuth} from '@calendar/contexts/AuthContext.jsx';
import InsightsProgrammeFilters,{emptyProgrammeFilters} from './InsightsProgrammeFilters.jsx';
import {programmeFilterLabel} from './insights-provenance.mjs';

const identifiers=value=>value.split(/[\s,]+/).map(item=>item.trim()).filter(Boolean);

export default function InsightsDetail(){
 const session=useAuth(),[access,setAccess]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[progress,setProgress]=useState(''),[grants,setGrants]=useState([]),[next,setNext]=useState(''),[email,setEmail]=useState(''),[forms,setForms]=useState(''),[events,setEvents]=useState(''),[expiry,setExpiry]=useState(''),[permission,setPermission]=useState('export');
 const [filterForm,setFilterForm]=useState(''),[filterEvent,setFilterEvent]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState(''),[basis,setBasis]=useState('submission'),[programmeFilters,setProgrammeFilters]=useState(emptyProgrammeFilters),[search,setSearch]=useState(''),[browse,setBrowse]=useState(null),[items,setItems]=useState([]),[selected,setSelected]=useState(null);
 const cancelled=useRef(false),mounted=useRef(true),operation=useRef(''),epoch=useRef(0);
 async function api(path,options={}){
  const user=auth.currentUser;if(!user)throw Error('Sign in again.');
  const response=await fetch('/api/insights-detail'+path,{...options,headers:{'Content-Type':'application/json',Authorization:'Bearer '+await user.getIdToken()},cache:'no-store'});
  const data=await response.json();if(auth.currentUser?.uid!==user.uid)throw Error('Your session changed.');
  if(!response.ok){if(response.status===401||response.status===403||response.status===409){setBrowse(null);setItems([]);setSelected(null);if(response.status!==409)setAccess(null);}throw Object.assign(Error(data.error||'Detail request failed.'),{status:response.status});}return data;
 }
 useEffect(()=>{
  mounted.current=true;const generation=++epoch.current;setAccess(null);setBrowse(null);setItems([]);setSelected(null);setGrants([]);setBusy(false);setProgress('');cancelled.current=false;
  let fingerprint='';
  async function checkAccess(){
   try{
    const data=await api('/session');if(epoch.current!==generation)return;
    const current=JSON.stringify(data);
    if(fingerprint&&current!==fingerprint)throw Error('Your response-detail assignment changed. Reload to continue.');
    fingerprint=current;setAccess(data);
   }catch(e){if(epoch.current===generation){epoch.current++;cancelled.current=true;setAccess(null);setBrowse(null);setItems([]);setSelected(null);setBusy(false);setError(e.message);}}
  }
  if(session.isAdmin)checkAccess();
  const timer=session.isAdmin?setInterval(checkAccess,15000):null;
  return ()=>{if(timer)clearInterval(timer);mounted.current=false;epoch.current++;cancelled.current=true;};
 },[session.isAdmin,session.user?.uid]);
 async function loadGrants(after=''){
  try{const data=await api('/grants'+(after?'?after='+encodeURIComponent(after):''));setGrants(old=>after?[...old,...data.items]:data.items);setNext(data.next||'');}
  catch(e){setError(e.message);}
 }
 async function saveGrant(event,revoke=false,grant=null){
  event.preventDefault();setBusy(true);setError('');
  try{
   const target=grant?.email||email.trim().toLowerCase(),existing=grants.find(item=>item.email===target);
   await api('/grants',{method:'POST',body:JSON.stringify({email:target,revision:grant?.revision??existing?.revision??0,revoke,formIds:identifiers(forms),eventIds:identifiers(events),expiryDate:expiry,permission})});
   setProgress(revoke?'Assignment revoked.':'Assignment saved.');await loadGrants();
  }catch(e){setError(e.message);}finally{setBusy(false);}
 }
 async function browseResponses(nextPage=false){
  const generation=epoch.current;let active=null;operation.current='view';cancelled.current=false;setBusy(true);setError('');setItems([]);setSelected(null);
  try{
   active=nextPage?browse:await api('/start',{method:'POST',body:JSON.stringify({mode:'view',...(access.owner?{formIds:identifiers(forms),eventIds:identifiers(events)}:{}),formId:filterForm.trim(),eventId:filterEvent.trim(),from,to,basis,...programmeFilters,search})});
   if(cancelled.current||epoch.current!==generation)throw Error('Browsing cancelled or session changed.');
   const page=await api('/step',{method:'POST',body:JSON.stringify({jobId:active.jobId,step:active.step,search})});
   active={jobId:active.jobId,...page};
   if(cancelled.current||epoch.current!==generation)throw Error('Browsing cancelled or session changed.');
   setBrowse(active);setItems(page.items);
  }catch(e){
   if(active?.jobId&&epoch.current===generation)try{await api('/cancel',{method:'POST',body:JSON.stringify({jobId:active.jobId,step:active.step})});}catch(cancelError){if(![401,403,404,409].includes(cancelError.status)&&epoch.current===generation)setProgress('Cancellation could not be confirmed; the preparation expires after 24 hours.');}
   if(epoch.current===generation){setBrowse(null);setItems([]);setSelected(null);setError(e.message);}
  }finally{if(epoch.current===generation){operation.current='';setBusy(false);}}
 }
 async function exportDetails(){
  const originalUid=auth.currentUser?.uid,generation=epoch.current;let jobId='',step=0,rows=[],blob=null;
  const stopped=()=>cancelled.current||epoch.current!==generation||auth.currentUser?.uid!==originalUid;
  operation.current='export';cancelled.current=false;setBusy(true);setError('');setProgress('Preparing the complete assigned scope…');
  try{
   const scope=access.owner?{formIds:identifiers(forms),eventIds:identifiers(events)}:{};
   const start=await api('/start',{method:'POST',body:JSON.stringify({...scope,formId:filterForm.trim(),eventId:filterEvent.trim(),from,to,basis,...programmeFilters,search})});jobId=start.jobId;step=start.step;
   let page;
   do{
    if(stopped())throw Error('Export cancelled or session changed.');
    page=await api('/step',{method:'POST',body:JSON.stringify({jobId,step,search})});step=page.step;rows.push(...page.items);
    if(epoch.current===generation)setProgress(`Scanned ${page.scanned} source responses; collected ${page.count}.`);
   }while(page.status==='running');
   if(page.status!=='complete'||rows.length!==page.count)throw Error('Export preparation was incomplete. No file was downloaded.');
   const exporter=await import('./registration-exports.mjs'),asOf=new Date().toISOString();
   const filter={label:'Selected scope and filters',query:`Form ${filterForm.trim()||'assigned scope'}; saved event ${filterEvent.trim()||'assigned scope'}; ${basis==='event'?'current event':'submission'} dates ${from&&to?from+' to '+to+' (Sydney)':'all dates'}; ${programmeFilterLabel(programmeFilters)}; answer search ${search?'applied (text omitted)':'none'}.`};
   blob=await exporter.responseWorkbook({id:'Scoped-Insights',title:'Scoped Insights response details',fields:[],revision:1},rows,asOf,{detailScope:true,filter,cancelled:stopped});
   if(stopped())throw Error('Export cancelled or session changed.');
   await api('/authorize',{method:'POST',body:JSON.stringify({jobId,step})});
   if(stopped())throw Error('Export cancelled or session changed.');
   exporter.downloadResponses(blob,'Scoped-Insights',asOf);setProgress('Complete scoped export downloaded.');
  }catch(e){
   let cleanupError='';
   if(jobId&&epoch.current===generation)try{await api('/cancel',{method:'POST',body:JSON.stringify({jobId,step})});}catch(cancelError){if(![403,404,409].includes(cancelError.status))cleanupError=' Cancellation could not be confirmed; the preparation expires after 24 hours.';}
   if(epoch.current===generation){setError(e.message+cleanupError);setProgress('No file was downloaded.');if(e.status===401||e.status===403||/session changed/i.test(e.message))setAccess(null);}
  }finally{rows.length=0;blob=null;if(epoch.current===generation){operation.current='';setBusy(false);}}
 }
 if(session.loading)return <p>Checking admin access…</p>;
 if(!session.isAdmin)return <section><AdminBackButton/><p>An active admin account is required.</p></section>;
 return <section className="admin-console form-builder"><AdminBackButton onBack={selected?()=>setSelected(null):undefined}/><h1>Scoped response details</h1>
 <p>All answers and contact fields in the assigned scope are included. Consent snapshots remain read-only. This is separate from aggregate Insights, person search, and volunteer access.</p>
 <p>When both forms and events are selected, each response must match a selected form <strong>and</strong> its saved event ID. Event-only scope includes matching responses across forms. No current form-event link is substituted.</p>
 {error&&<p role="alert">{error}</p>}
 {access?.grant&&<p>Your assignment: {access.grant.permission==='view'?'view only':'view and export'}; forms {access.grant.formIds.join(', ')||'all forms for selected events'}; events {access.grant.eventIds.join(', ')||'all saved events for selected forms'}. Expires {new Date(access.grant.expiresAt).toLocaleString('en-AU',{timeZone:'Australia/Sydney'})} Sydney.</p>}
 {access?.owner&&<><h2>Super Admin scope</h2><p>Enter up to 30 form references and/or 30 event references, separated by commas or spaces. A scope is required even for Super Admin.</p>
 <label>Form references<input value={forms} onChange={event=>{setForms(event.target.value);setBrowse(null);setItems([]);setSelected(null);}} disabled={busy}/></label>
 <label>Saved event references<input value={events} onChange={event=>{setEvents(event.target.value);setBrowse(null);setItems([]);setSelected(null);}} disabled={busy}/></label>
 <details onToggle={event=>{if(event.currentTarget.open)loadGrants();}}><summary>Manage explicit admin assignments</summary>
 <form onSubmit={saveGrant}><fieldset disabled={busy}><label>Existing admin email<input type="email" required value={email} onChange={event=>setEmail(event.target.value)}/></label><label>Access<select value={permission} onChange={event=>setPermission(event.target.value)}><option value="export">View and export</option><option value="view">View only</option></select></label><label>Expiry date (end of day Sydney)<input type="date" required value={expiry} onChange={event=>setExpiry(event.target.value)}/></label><p>The form and event references above define this assignment. Reload the assignment list before updating an existing admin.</p><button className="btn">Save assignment</button></fieldset></form>
 {grants.map(grant=><p key={grant.email}>{grant.email} · {grant.revoked?'Revoked':`until ${grant.expiryDate} Sydney`} · {grant.permission==='view'?'View only':'View and export'} · Forms: {grant.formIds.join(', ')||'all'} · Events: {grant.eventIds.join(', ')||'all'} <button type="button" className="btn alt" disabled={busy||grant.revoked} onClick={event=>saveGrant(event,true,grant)}>Revoke</button></p>)}
 {next&&<button type="button" className="btn alt" onClick={()=>loadGrants(next)}>Load more assignments</button>}</details></>}
 {access&&<section><h2>Explore assigned responses</h2><p>Filters narrow the assigned scope for both browsing and export. Search checks saved answer values on the server. Provide both dates or neither; current event-date filtering requires both dates and excludes events without an accessible current date. Programme filters exclude inaccessible events; Unknown includes unclassified, stale reviews and eventless responses. Counts remain partial until the last batch is reached.</p><fieldset disabled={busy}><label>Form reference filter (optional)<input value={filterForm} onChange={e=>{setFilterForm(e.target.value);setBrowse(null);setItems([]);setSelected(null);}}/></label><label>Saved event reference filter (optional)<input value={filterEvent} onChange={e=>{setFilterEvent(e.target.value);setBrowse(null);setItems([]);setSelected(null);}}/></label><label>Date basis<select value={basis} onChange={e=>{setBasis(e.target.value);setBrowse(null);setItems([]);setSelected(null);}}><option value="submission">Submission date</option><option value="event">Current calendar event date</option></select></label><label>From (Sydney, optional)<input type="date" value={from} onChange={e=>{setFrom(e.target.value);setBrowse(null);setItems([]);setSelected(null);}}/></label><label>To (Sydney, optional)<input type="date" value={to} onChange={e=>{setTo(e.target.value);setBrowse(null);setItems([]);setSelected(null);}}/></label><label>Search answers (optional)<input value={search} maxLength="200" onChange={e=>{setSearch(e.target.value);setBrowse(null);setItems([]);setSelected(null);}}/></label><button type="button" className="btn" onClick={()=>browseResponses()}>Browse responses</button></fieldset>
 <InsightsProgrammeFilters api={api} value={programmeFilters} disabled={busy} onChange={value=>{setProgrammeFilters(value);setBrowse(null);setItems([]);setSelected(null);}}/>
 {browse&&<><p role="status">{browse.scanned} scanned · {browse.count} matching so far · {browse.status==='complete'?'scope fully scanned':'more batches remain; count incomplete'}</p>{!items.length&&<p>No matching responses in this batch.</p>}{items.map(row=><p key={row.formId+'/'+row.id}>{row.reference} · {row.formTitle} · revision {row.revision} <button type="button" className="btn alt" disabled={busy} onClick={()=>setSelected(row)}>View answers</button></p>)}{browse.status==='running'&&<button type="button" className="btn alt" disabled={busy} onClick={()=>browseResponses(true)}>Next batch</button>}</>}
 {selected&&<section><h3>Saved response: {selected.reference}</h3><p>{selected.formTitle} · revision {selected.revision} · purpose: {selected.purpose||'Unavailable'} · submitted {selected.createdAt}{selected.editedAt?` · corrected ${selected.editedAt} (revision ${selected.editRevision})`:''}. Consent is read-only.</p>{selected.fields.map(field=><div key={field.id}><strong>{field.label}</strong>{field.description&&<p>{field.description}</p>}{field.type==='consent'&&field.terms&&<p>{field.terms}</p>}<p>{Array.isArray(selected.answers[field.id])?selected.answers[field.id].join(', '):String(selected.answers[field.id]??'Not answered')}</p></div>)}<button type="button" className="btn alt" onClick={()=>setSelected(null)}>Close response</button></section>}</section>}
 {access&&<div className="registration-actions">{(access.owner||access.grant?.permission!=='view')&&<button type="button" className="btn" disabled={busy} onClick={exportDetails}>Export complete filtered scope to Excel</button>}{busy&&operation.current&&<button type="button" className="btn alt" onClick={()=>{cancelled.current=true;setBrowse(null);setItems([]);setSelected(null);}}>Cancel {operation.current==='view'?'browsing':'export'}</button>}</div>}
 <p role="status">{progress}</p><p>Exports over 20,000 scanned source responses or the calendar review ledger capacity are refused, not truncated. Detected source, calendar or programme-review changes during preparation require a restart. Out-of-band source writes may precede their change markers, so this is not an atomic historical snapshot. No index backfill is required.</p>
 </section>;
}
