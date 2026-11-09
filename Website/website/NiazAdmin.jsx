import React,{useEffect,useRef,useState} from 'react';
import {useAuth} from '@calendar/contexts/AuthContext.jsx';
import AdminBackButton from '@calendar/components/AdminBackButton.jsx';
import {goAdminBack} from '@calendar/utils/adminNavigation.mjs';
import {niazApi,importColumns,importMapping,mapImportRows,importTemplate,readImport,workbook,download} from './niaz-client.js';
import './registrations.css';
import './niaz.css';
const empty=()=>({name:'',email:'',phone:'',publicConsent:false,active:true,notes:'',revision:0});
const description={sponsors:'Sponsor directory',dashboard:'Monthly programme dashboard',assignments:'Event coverage & history',eois:'EOI review queue',programmes:'Permanent annual review',notifications:'Notification delivery status'};
export default function NiazAdmin(){
 const session=useAuth(),allowed=session.isAdmin&&['niaz','niaz-read','niaz-finance'].some(id=>session.canAccess(id));
 const [permissions,setPermissions]=useState(null),[tab,setTab]=useState('sponsors'),[rows,setRows]=useState([]),[next,setNext]=useState(null),[draft,setDraft]=useState(null),[pageDirty,setDirty]=useState(false),[editorDirty,setEditorDirty]=useState({}),[query,setQuery]=useState(''),[status,setStatus]=useState(''),[year,setYear]=useState('');
 const dirty=pageDirty||Object.values(editorDirty).some(Boolean);
 function markEditor(key,value){setEditorDirty(current=>({...current,[key]:value}));}
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[date,setDate]=useState(''),[events,setEvents]=useState([]),[detail,setDetail]=useState(null),[assignDraft,setAssignDraft]=useState({sponsorId:'',type:'one_time',role:'joint',seriesId:'',inKind:'',notes:'',revision:0});
 const [importData,setImportData]=useState(null),[mapping,setMapping]=useState({}),[preview,setPreview]=useState(null),[offset,setOffset]=useState(0);
 const [settings,setSettings]=useState({notificationEnabled:false,threeDayFollowup:false,coordinatorEmails:[]});
 const [month,setMonth]=useState(()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Sydney',year:'numeric',month:'2-digit'}).format(new Date()).slice(0,7));
 const generation=useRef(0),active=useRef(false),dataUid=useRef(null);active.current=allowed;
 async function run(action){
  const ticket=generation.current,uid=session.user?.uid;setBusy(true);setError('');
  try{const result=await action();if(ticket!==generation.current||!active.current||session.user?.uid!==uid)return;return result;}
  catch(problem){if(ticket===generation.current&&active.current)setError(problem.message);}
  finally{if(ticket===generation.current&&active.current)setBusy(false);}
 }
 async function load(which=tab,after=''){
  const ticket=generation.current,result=await niazApi('/'+which+(which==='dashboard'?'?month='+month:after?'?after='+encodeURIComponent(after):''));if(!active.current||ticket!==generation.current)return;
  setRows(current=>after?[...current,...result.items]:result.items);setNext(result.next);
 }
 useEffect(()=>{
  setEditorDirty({});
  generation.current++;dataUid.current=session.user?.uid;setRows([]);setPermissions(null);setDraft(null);setDetail(null);setPreview(null);setImportData(null);setError('');setNotice('');setBusy(false);setDirty(false);setTab('sponsors');setQuery('');setYear('');setStatus('');setEvents([]);setDate('');setSettings({notificationEnabled:false,threeDayFollowup:false,coordinatorEmails:[]});setAssignDraft({sponsorId:'',type:'one_time',role:'joint',seriesId:'',inKind:'',notes:'',revision:0});
  if(allowed)run(async()=>{const p=await niazApi('/session');if(!active.current)return;setPermissions(p);await load('sponsors');});
  return()=>{generation.current++;};
 },[allowed,session.user?.uid]);
 useEffect(()=>{window.mwaPageReady?.();},[]);
 useEffect(()=>{const warn=event=>{if(dirty){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
 function leave(){if(dirty&&!confirm('Leave this editor? Unsaved changes will be lost.'))return false;setDirty(false);setEditorDirty({});setDraft(null);setDetail(null);setImportData(null);setPreview(null);return true;}
 function changeTab(value){if(!leave())return;generation.current++;setTab(value);setRows([]);setNext(null);setNotice('');run(()=>load(value));}
 async function openEvent(eventId){const value=await niazApi('/event?eventId='+encodeURIComponent(eventId));if(active.current)setDetail(value);}
 async function exportRows(){
  const sheets={};for(const key of Object.keys(description)){
   const all=[];let after='';for(let page=0;page<100;page++){const value=await niazApi('/'+key+(key==='dashboard'?'?month='+month:after?'?after='+encodeURIComponent(after):''));all.push(...value.items);after=value.next;if(!after)break;if(page===99)throw Error('Export exceeds 10,000 records. Narrow the report.');}
   sheets[description[key]]=all;
  }
  if(permissions?.finance){
   const all=[];let after='';
   for(let page=0;page<100;page++){const value=await niazApi('/sandbox-ledger'+(after?'?after='+encodeURIComponent(after):''));all.push(...value.items);after=value.next;if(!after)break;if(page===99)throw Error('TEST finance export exceeds 10,000 records. Request a scoped report.');}
   sheets['TEST contributions - NOT live']=all;
  }
  await niazApi('/export-audit',{reports:Object.keys(sheets)});
  if(active.current)download(await workbook(sheets),'MWA Niaz Register.xlsx');
 }
 if(session.loading||(allowed&&dataUid.current!==session.user?.uid))return <section className="registrations-page"><AdminBackButton/><p>Checking Niaz access...</p></section>;
 if(!allowed)return <section className="registrations-page"><AdminBackButton/><h1>Niaz Administration</h1><p role="alert">Niaz access is not assigned. Sign in with an authorised account.</p></section>;
 const filtered=rows.filter(row=>(!query||JSON.stringify(row).toLowerCase().includes(query.toLowerCase()))&&(!year||String(row.year)===year)&&(!status||row.status===status||row.eventLifecycle===status||row.events?.some(e=>e.status===status)));
 return <section className="registrations-page niaz-admin">
  <AdminBackButton disabled={busy} onBack={draft||detail||importData?leave:dirty?()=>{if(leave())goAdminBack();}:undefined}/>
  <h1>Niaz Administration</h1>
  <p>EOI approval, financial support and final food/serving arrangements are separate decisions.</p>
  <p role="status">Member linking and live donation finance are not configured. Sandbox donations never represent money received. Notification delivery is off by default; check settings for activation status.</p>
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  <nav className="registration-actions" aria-label="Niaz sections">{Object.entries(description).map(([key,label])=><button key={key} className="btn alt" disabled={busy} aria-pressed={tab===key} onClick={()=>changeTab(key)}>{label}</button>)}
   <button className="btn alt" disabled={busy} onClick={()=>run(exportRows)}>Export register</button><button className="btn alt" disabled={busy} onClick={()=>{if(!leave())return;setTab('settings');setRows([]);run(async()=>setSettings(await niazApi('/settings')));}}>Notification settings</button><a href="/niaz/">Sponsor EOI / own history</a></nav>
  {tab==='settings'&&<form className="registration-editor" onSubmit={e=>{e.preventDefault();run(async()=>{setSettings(await niazApi('/settings',settings));setDirty(false);setNotice('Notification settings saved. Activation does not prove email delivery.');});}}>
   <fieldset disabled={!session.isOwner||busy}><legend>Owner-controlled notifications</legend><label>Coordinator emails (one per line; active Niaz permission required)<textarea value={settings.coordinatorEmails?.join('\n')||''} onChange={e=>{setSettings({...settings,coordinatorEmails:e.target.value.split('\n').map(value=>value.trim()).filter(Boolean)});setDirty(true);}}/></label>
    {[['notificationEnabled','Enable configured Niaz notification delivery'],['threeDayFollowup','Three-day follow-up for unconfirmed arrangements']].map(([key,label])=><label className="registration-check" key={key}><input type="checkbox" checked={settings[key]===true} onChange={e=>{setSettings({...settings,[key]:e.target.checked});setDirty(true);}}/>{label}</label>)}<button className="btn">Save notification settings</button>
   </fieldset><p>Delivery uses the existing connected Gmail mailbox. No SMS sender or additional payment processor is introduced.</p>
  </form>}
  {tab!=='settings'&&!draft&&!detail&&!importData&&<>
   {tab==='dashboard'&&<form className="registration-editor" onSubmit={e=>{e.preventDefault();run(()=>load('dashboard'));}}><label>Programme month (Sydney)<input type="month" required value={month} onChange={e=>setMonth(e.target.value)}/></label><button className="btn alt" disabled={busy}>Refresh monthly dashboard</button><p>Use search for compatible badges such as No sponsor, EOI pending, MWA arranged or Arrangement confirmed.</p></form>}
   <div className="niaz-filters"><label>Search loaded records<input value={query} onChange={e=>setQuery(e.target.value)} type="search"/></label><label>Year<input inputMode="numeric" value={year} onChange={e=>setYear(e.target.value)}/></label><label>Status<select value={status} onChange={e=>setStatus(e.target.value)}><option value="">All statuses</option>{['pending','approved','rejected','withdrawn','proposed','paused','cancelled','fulfilled'].map(value=><option key={value}>{value}</option>)}</select></label></div>
   {tab==='sponsors'&&permissions?.manage&&<div className="registration-actions"><button className="btn" onClick={()=>setDraft(empty())}>Create sponsor</button><button className="btn alt" onClick={()=>run(async()=>download(await importTemplate(),'mwa-niaz-import-template.xlsx'))}>Download import template</button><label>Import sponsor/event rows<input type="file" accept=".xlsx,.csv" onChange={e=>{const file=e.target.files[0];if(file)run(async()=>{const value=await readImport(file);setImportData(value);setMapping(importMapping(value.headers));});}}/></label></div>}
   {tab==='sponsors'&&permissions?.manage&&<button className="btn alt" disabled={busy} onClick={()=>{const value=prompt('Calendar year for non-destructive legacy sponsor review:');if(value)run(async()=>{const result=await niazApi('/legacy-preview?year='+encodeURIComponent(value));download(await workbook({'Legacy source review':result.items}),'MWA Niaz Legacy Review.xlsx');setNotice('Legacy source exported for review. Import after correcting missing contacts and reviewing matches. No legacy event data was changed.');});}}>Export legacy Calendar sponsors for review</button>}
   {!rows.length&&!busy&&<p>No records yet.</p>}{filtered.map(row=><article className="registration-card" key={row.id}>
    <h2>{row.name||row.applicantName||row.title||row.eventId||row.seriesId||row.id}</h2>
    <small>Reference: {row.id}</small>
    {row.eventReviewRequired&&<p role="status">Event {row.eventLifecycle||'changed'} - coordinator review required.</p>}
    {row.nameReviewRequired&&<p role="status">An applicant supplied a different name. Review the EOI; the directory name and contacts were preserved.</p>}
    {tab==='notifications'?<><p>{row.kind} · {row.state} · Attempts: {row.attempts||0}</p>{row.lastError&&<p role="status">{row.lastError}</p>}<p>{row.completedAt?'Completed: '+row.completedAt:'Next attempt: '+(row.nextAttempt?new Date(row.nextAttempt).toLocaleString('en-AU',{timeZone:'Australia/Sydney'}):'Scheduled')}. Delivery status is not proof of mailbox receipt.</p>{row.state==='attention'&&<><p>Acknowledgment only records that this was reviewed. It does not resolve the conflict, resend a notice or retry delivery.</p>{row.acknowledgment?<p>Review acknowledged: {new Date(row.acknowledgment.at).toLocaleString('en-AU',{timeZone:'Australia/Sydney'})}. Attention remains outstanding.</p>:permissions?.manage&&<button className="btn alt" disabled={busy} onClick={()=>run(async()=>{await niazApi('/attention-acknowledge',{id:row.id});await load();setNotice('Review acknowledged only. Attention remains outstanding; no delivery or retry was triggered.');})}>Acknowledge review only</button>}</>}</>:tab==='sponsors'?<><p>{row.email} {row.phone}</p><p>{row.active?'Active':'Archived'} · {row.publicConsent?'Public name consented':'Private sponsor'} · {row.verification}</p>{permissions?.manage&&<button className="btn alt" onClick={()=>{setDraft(row);setDirty(false);}}>Edit sponsor</button>}</>:<><p>{tab==='dashboard'?row.badges?.join(' · '):'Type: '+(row.type||'permanent')+' · Status: '+row.status+' · Year: '+(row.year||'series commitment')}</p>{row.eventId&&<button className="btn alt" onClick={()=>run(()=>openEvent(row.eventId))}>Event sponsorship detail</button>}
     {tab==='eois'&&row.events?.map(event=><div key={event.eventId}><p>{event.eventTitle||'Programme details unavailable'} · {event.eventStartAt?new Date(event.eventStartAt).toLocaleString('en-AU',{timeZone:'Australia/Sydney'}):'Date unavailable'}: {event.status}</p>{event.status==='pending'&&permissions?.manage&&<NiazDecision row={row} event={event} busy={busy} onDirty={value=>markEditor('decision:'+row.id+':'+event.eventId,value)} onSave={body=>run(async()=>{await niazApi('/decision',body);markEditor('decision:'+row.id+':'+event.eventId,false);await load();})}/>}</div>)}
     {tab==='eois'&&<><p>Applicant sponsor reference: {row.sponsorId||'Unavailable'}. Contact verified for EOI submission; this is not membership verification.</p><p>Offer details: {row.notes||'Not provided'}</p><p>In-kind provision: {row.inKind||'Not provided'}</p>{row.alternatives?.map((event,index)=><p key={index}>Alternative proposal: {event.title||event.eventId} · {event.status} · {event.reason}</p>)}</>}
     {['eois','assignments','programmes'].includes(tab)&&permissions?.manage&&<NiazActions row={row} section={tab} busy={busy} onDirty={value=>markEditor('action:'+row.id,value)} onSave={(path,body)=>run(async()=>{
      const result=await niazApi(path,body);
      if(path==='/annual-propose')setNotice(result.proposed+' proposals created. Nothing has been approved or published.');
      if(path==='/eoi-alternative')setNotice('Alternative proposed only. Applicant must accept through a new EOI; no assignment has been moved.');
      markEditor('action:'+row.id,false);await load();return true;
     })}/>}
    </>}
   </article>)}{next&&<button className="btn alt" disabled={busy} onClick={()=>run(()=>load(tab,next))}>Load more</button>}
  </>}
  {draft&&<form className="registration-editor" onSubmit={e=>{e.preventDefault();run(async()=>{const data=await niazApi('/sponsor',draft);setDraft(data.sponsor);setDirty(false);setNotice('Sponsor saved.');await load('sponsors');});}}>
   <fieldset disabled={busy}><legend>Sponsor details</legend>{[['name','Name'],['email','Email'],['phone','Mobile']].map(([key,label])=><label key={key}>{label}<input type={key==='email'?'email':'text'} required={key==='name'} value={draft[key]} onChange={e=>{setDraft({...draft,[key]:e.target.value});setDirty(true);}}/></label>)}
    <label>Internal notes<textarea value={draft.notes} onChange={e=>{setDraft({...draft,notes:e.target.value});setDirty(true);}}/></label>
    {['publicConsent','active'].map(key=><label className="registration-check" key={key}><input type="checkbox" disabled={key==='publicConsent'&&!!draft.ownerKey} checked={draft[key]} onChange={e=>{setDraft({...draft,[key]:e.target.checked});setDirty(true);}}/>{key==='publicConsent'?'Explicit consent to show name publicly':'Active sponsor (uncheck to archive)'}</label>)}{draft.ownerKey&&<p>Verified sponsors manage their own public-name consent. Saving does not clear a pending name-review flag.</p>}<button className="btn">Save sponsor</button>
   </fieldset>
  </form>}
  {tab!=='settings'&&!draft&&!importData&&<form className="registration-editor" onSubmit={e=>{e.preventDefault();run(async()=>{const result=await niazApi('/events?date='+date);setEvents(result.items);});}}>
   <label>Programme date<input type="date" required value={date} onChange={e=>setDate(e.target.value)}/></label><button className="btn alt" disabled={busy}>Find programmes</button>
   {events.map(event=><button key={event.id} type="button" className="registration-list-item" onClick={()=>run(()=>openEvent(event.id))}>{event.title} · {event.alreadySponsored?'Already sponsored':'No sponsor'}</button>)}
  </form>}
  {detail&&<article className="registration-card"><h2>{detail.event.title}</h2><p>{detail.event.startAt?new Date(detail.event.startAt).toLocaleString('en-AU',{timeZone:'Australia/Sydney'}):'Programme date unavailable'} · {detail.event.venueName}</p><p>{detail.badges.join(' · ')}</p>
   <h3>Niaz Sponsor(s)</h3>{detail.assignments.map(row=><p key={row.id}>{row.sponsor?.name||'Archived / unavailable'} · {row.type} · {row.origin} · {row.status} · {row.sponsor?.publicConsent?'Name public':'Name private'}</p>)}
   {detail.assignments.map(row=><details key={row.id}><summary>Private assignment detail / timeline: {row.sponsor?.name||row.sponsorId}</summary><p>Reference: {row.id}</p><p>Contact: {row.sponsor?.email||'Email unavailable'} · {row.sponsor?.phone||'Mobile unavailable'}. Verification: {row.sponsor?.verification||'Not recorded'} (not membership).</p><p>In-kind provision: {row.inKind||'Not provided'}</p><p>Internal assignment notes: {row.notes||'Not provided'}</p><p>Created: {row.createdAt||'Not recorded'} · Approved: {row.approvedAt||'Not recorded'} · Last review: {row.reviewedAt||'Not recorded'}</p><p>Last review reason: {row.reason||'Not recorded'} · Fulfilment: {row.fulfilmentStatus||'Pending'}</p>{row.eventReviewRequired&&<p>Current event changed; coordinator review required. Historical approval is not current arrangement confirmation.</p>}</details>)}
   {permissions?.finance&&<><p>Target (AUD): {detail.coverage.targetCents===undefined?'Not set':(detail.coverage.targetCents/100).toFixed(2)}. Real funding: unavailable (no live ledger).</p><h3>Sandbox transactions (TEST only)</h3>{detail.sandboxContributions?.map(row=><p key={row.id}>{row.entry.transactionId}: TEST AUD {(row.entry.netCents/100).toFixed(2)}</p>)}</>}
   {permissions?.manage&&<><form key={detail.coverage.revision||0} className="registration-editor" onSubmit={e=>{e.preventDefault();const form=new FormData(e.currentTarget);run(async()=>{await niazApi('/coverage',{eventId:detail.event.id,revision:detail.coverage.revision||0,mwaArranged:form.has('mwaArranged'),arrangementConfirmed:form.has('arrangementConfirmed'),acceptExtraEOIs:form.has('acceptExtraEOIs'),notes:form.get('notes'),...(permissions.finance&&form.get('targetCents')!==''?{targetCents:Math.round(Number(form.get('targetCents'))*100)}:{})});await openEvent(detail.event.id);setDirty(false);});}}>
    <fieldset disabled={busy} onChange={()=>setDirty(true)}>{[['mwaArranged','MWA arranged'],['arrangementConfirmed','Arrangement confirmed after contacting sponsor'],['acceptExtraEOIs','Accept additional joint / consideration EOIs']].map(([key,label])=><label className="registration-check" key={key}><input type="checkbox" name={key} defaultChecked={detail.coverage[key]}/>{label}</label>)}
     {permissions.finance&&<label>Funding target (AUD)<input name="targetCents" type="number" min="0" step="0.01" defaultValue={detail.coverage.targetCents===undefined?'':detail.coverage.targetCents/100}/></label>}<label>Internal arrangement notes<textarea name="notes" defaultValue={detail.coverage.notes||''}/></label><button className="btn">Save arrangement</button></fieldset>
   </form><form className="registration-editor" onChange={()=>setDirty(true)} onSubmit={e=>{e.preventDefault();run(async()=>{await niazApi('/assign',{...assignDraft,eventId:detail.event.id});await openEvent(detail.event.id);setDirty(false);setNotice('Sponsorship approved; final arrangement confirmation remains separate.');});}}>
    <h3>Assign sponsor</h3><label>Sponsor reference<input required value={assignDraft.sponsorId} onChange={e=>setAssignDraft({...assignDraft,sponsorId:e.target.value})}/></label><label>Type<select value={assignDraft.type} onChange={e=>setAssignDraft({...assignDraft,type:e.target.value,seriesId:e.target.value==='permanent'?detail.event.seriesId:''})}>{['one_time','annual','permanent'].map(value=><option key={value}>{value}</option>)}</select></label><label>In-kind provision<textarea value={assignDraft.inKind} onChange={e=>setAssignDraft({...assignDraft,inKind:e.target.value})}/></label><button className="btn" disabled={busy}>Approve joint assignment</button>
   </form></>}
  </article>}
  {importData&&<article className="registration-card"><h2>Map and preview import</h2><p>Imports create proposed assignments, never automatic approval. Explicit event IDs resolve ambiguous dates. Membership IDs cannot be linked until the membership adapter exists.</p>
   {!preview&&<>{importColumns.map(key=><label key={key}>{key}<select value={mapping[key]} onChange={e=>setMapping({...mapping,[key]:Number(e.target.value)})}><option value="-1">Not provided</option>{importData.headers.map((header,index)=><option key={index} value={index}>{header}</option>)}</select></label>)}<button className="btn" disabled={busy} onClick={()=>run(async()=>{setPreview(await niazApi('/import-preview',{rows:mapImportRows(importData,mapping)}));setOffset(0);})}>Dry-run preview</button></>}
   {preview&&<><p>{preview.rows.length} rows · {preview.rows.filter(row=>row.error).length} errors · {preview.rows.filter(row=>row.duplicate).length} duplicates (skipped)</p><button className="btn alt" onClick={()=>run(async()=>download(await workbook({'Import review':preview.rows.map(row=>({row:row.row,error:row.error||'',duplicate:row.duplicate||false,...row.value}))}),'MWA Niaz Import Review.xlsx'))}>Export review/errors</button>
    <div className="niaz-table"><table><thead><tr><th>Row</th><th>Sponsor</th><th>Event</th><th>Outcome</th></tr></thead><tbody>{preview.rows.map(row=><tr key={row.row}><td>{row.row}</td><td>{row.value?.name}</td><td>{row.value?.eventId}</td><td>{row.error|| (row.duplicate?'Duplicate - skipped':'Valid - proposed')}</td></tr>)}</tbody></table></div>
    <p>Progress: {offset}/{preview.rows.length}</p><button className="btn" disabled={busy||offset>=preview.rows.length} onClick={()=>{if(offset===0&&!confirm('Import valid rows as proposed assignments? Errors and duplicates will be skipped.'))return;run(async()=>{const result=await niazApi('/import-step',{jobId:preview.jobId,offset});setOffset(result.offset);setNotice(result.state==='complete'?'Import complete. Review proposed assignments.':'Batch saved. Continue the next batch.');});}}>Import next batch (up to 40 rows)</button>
   </>}
  </article>}
  {busy&&<p role="status">Working...</p>}
 </section>;
}
function NiazActions({row,section,busy,onDirty,onSave}){
 const [edited,setEdited]=useState(false);
 const [action,setAction]=useState(''),[reason,setReason]=useState(''),[date,setDate]=useState(''),[year,setYear]=useState(new Date().getFullYear()+1),[events,setEvents]=useState([]),[eventId,setEventId]=useState(''),[sponsors,setSponsors]=useState([]),[sponsorId,setSponsorId]=useState(''),[search,setSearch]=useState(''),[next,setNext]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 const live=useRef(true);useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 const actions=section==='eois'?['Propose alternative programme']:section==='assignments'?['approved','declined','paused','cancelled','fulfilled']:['Propose annual review','active','paused','cancelled','Transfer future commitment'];
 async function loadSponsors(after=''){
  setLoading(true);setError('');
  try{const data=await niazApi('/sponsors'+(after?'?after='+encodeURIComponent(after):''));if(live.current){setSponsors(current=>after?[...current,...data.items]:data.items);setNext(data.next||'');}}
  catch(problem){if(live.current)setError(problem.message);}finally{if(live.current)setLoading(false);}
 }
 function close(){if(edited&&!confirm('Discard this unsaved Niaz action?'))return;setAction('');setReason('');setEventId('');setSponsorId('');setDate('');setSearch('');setYear(String(new Date().getFullYear()+1));setEdited(false);onDirty(false);}
 const transfer=action==='Transfer future commitment',alternative=action==='Propose alternative programme',annual=action==='Propose annual review';
 return <div className="registration-actions">
  {!action?actions.map(value=><button key={value} type="button" className="btn alt" disabled={busy} onClick={()=>{setAction(value);setError('');if(value==='Transfer future commitment')loadSponsors();}}>{value}</button>):<form className="registration-editor" onChange={()=>{setEdited(true);onDirty(true);}} onSubmit={async e=>{
   e.preventDefault();
   if(transfer&&!confirm('Transfer the future permanent commitment? Existing occurrence assignments remain unchanged for separate review.'))return;
   const path=alternative?'/eoi-alternative':transfer?'/programme-transfer':annual?'/annual-propose':section==='assignments'?'/assignment-review':'/programme';
   const body={id:row.id,revision:row.revision,...(alternative?{eventId,reason}:transfer?{newSponsorId:sponsorId,reason,confirm:true}:annual?{year:Number(year)}:section==='assignments'?{status:action,reason}:{seriesId:row.seriesId,sponsorId:row.sponsorId,status:action,reason})};
   if(await onSave(path,body)){setAction('');setReason('');setEventId('');setSponsorId('');setEdited(false);}
  }}><fieldset disabled={busy||loading}><legend>{action}</legend>
   {annual&&<label>Annual review year<input required type="number" min="2020" max="2100" value={year} onChange={e=>setYear(e.target.value)}/></label>}
   {alternative&&<><label>Alternative programme date<input type="date" required value={date} onChange={e=>{setDate(e.target.value);setEvents([]);setEventId('');}}/></label><button type="button" className="btn alt" onClick={async()=>{
    setLoading(true);setError('');try{const data=await niazApi('/events?date='+date);if(live.current)setEvents(data.items);}catch(problem){if(live.current)setError(problem.message);}finally{if(live.current)setLoading(false);}
   }}>Find alternative programmes</button><label>Alternative programme<select required value={eventId} onChange={e=>setEventId(e.target.value)}><option value="">Choose a programme</option>{events.map(event=><option key={event.id} value={event.id}>{event.title}</option>)}</select></label></>}
   {transfer&&<><label>Search destination sponsors<input type="search" value={search} onChange={e=>setSearch(e.target.value)}/></label><label>Destination sponsor<select required value={sponsorId} onChange={e=>setSponsorId(e.target.value)}><option value="">Choose an active sponsor</option>{sponsors.filter(sponsor=>sponsor.active&&sponsor.id!==row.sponsorId&&(!search||(sponsor.name+' '+sponsor.email+' '+sponsor.phone).toLowerCase().includes(search.toLowerCase())||sponsor.id===sponsorId)).map(sponsor=><option key={sponsor.id} value={sponsor.id}>{sponsor.name} - {sponsor.email||sponsor.phone}</option>)}</select></label>{next&&<button type="button" className="btn alt" onClick={()=>loadSponsors(next)}>Load more destination sponsors</button>}</>}
   {!annual&&<label>Action reason<textarea required maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label>}
   {error&&<p role="alert">{error}</p>}<button className="btn" disabled={alternative&&!eventId||transfer&&!sponsorId}>Save Niaz action</button><button type="button" className="btn alt" onClick={close}>Cancel Niaz action</button>
  </fieldset></form>}
 </div>;
}
function NiazDecision({row,event,busy,onSave,onDirty}){
 const [open,setOpen]=useState(false),[existing,setExisting]=useState([]),[error,setError]=useState(''),[decision,setDecision]=useState('approved'),[role,setRole]=useState('joint'),[reason,setReason]=useState(''),[reassignIds,setReassignIds]=useState([]),[edited,setEdited]=useState(false);
 async function expand(){try{const value=await niazApi('/event?eventId='+encodeURIComponent(event.eventId));setExisting(value.assignments.filter(item=>item.status==='approved'));setOpen(true);}catch(problem){setError(problem.message);}}
 if(!open)return <><button className="btn alt" disabled={busy} onClick={expand}>Review event decision</button>{error&&<p role="alert">{error}</p>}</>;
 return <form className="registration-editor" onChange={()=>{setEdited(true);onDirty(true);}} onSubmit={e=>{
  e.preventDefault();if(reassignIds.length&&!confirm('Reassign these existing sponsorships? The reason will be audited and affected sponsors notified when delivery is configured.'))return;
  onSave({id:row.id,revision:row.revision,eventId:event.eventId,decision,role,reason,reassignIds,confirmReassignment:reassignIds.length>0});
 }}><fieldset disabled={busy}><legend>Independent event decision</legend><p>Existing sponsors: {existing.map(item=>item.sponsor?.name||item.sponsorId).join(', ')||'None'}. Joint approval never removes them.</p>
  <label>Decision<select value={decision} onChange={e=>{setDecision(e.target.value);setReassignIds([]);}}><option value="approved">Approve</option><option value="rejected">Decline</option></select></label><label>Role<select value={role} onChange={e=>setRole(e.target.value)}><option value="joint">Joint</option><option value="sole">Sole (only if no other approved sponsor remains)</option></select></label>
  <label>Required decision / reassignment reason<textarea required maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
  {decision==='approved'&&existing.length>0&&<fieldset><legend>Optional explicit reassignment (not automatic)</legend>{existing.map(item=><label className="registration-check" key={item.id}><input type="checkbox" checked={reassignIds.includes(item.id)} onChange={e=>setReassignIds(current=>e.target.checked?[...current,item.id]:current.filter(id=>id!==item.id))}/>{item.sponsor?.name||item.sponsorId}</label>)}</fieldset>}
  <button className="btn">Record event decision</button><button className="btn alt" type="button" onClick={()=>{if(edited&&!confirm('Discard this unsaved event decision?'))return;setOpen(false);setReason('');setReassignIds([]);setDecision('approved');setRole('joint');setEdited(false);onDirty(false);}}>Close decision editor</button>
 </fieldset></form>;
}
