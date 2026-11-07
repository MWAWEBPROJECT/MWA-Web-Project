import React,{useEffect,useState} from 'react';

const roles=[
 ['','Unmapped'],
 ['respondent-name','Respondent name'],
 ['respondent-email','Respondent email'],
 ['respondent-mobile','Respondent mobile'],
 ['participant-name','Participant name'],
 ['household-size','Household size']
];
const allowed={
 'respondent-name':['text','textarea'],
 'respondent-email':['email','text'],
 'respondent-mobile':['phone','text'],
 'participant-name':['text','textarea'],
 'household-size':['number']
};
const storageKey='mwa-insights-mapping-scans';
function restored(){
 try{return JSON.parse(sessionStorage.getItem(storageKey)||'{}');}catch{return {};}
}
export function MappingScanControls({job,label,busy,dirty,onRefresh,onStep,onCancel}){
 if(!job)return null;
 return <div><p role="status">{label}: {job.status}; job ID {job.jobId}; {job.scanned} response snapshots scanned.{job.status==='running'?' Discovery or inspection is incomplete.':''}{job.status==='invalidated'?' Source or form changed; start a new scan.':''}</p>
  <button type="button" className="btn alt" disabled={busy||dirty} onClick={onRefresh}>Refresh {label.toLowerCase()} status</button>
  {job.status==='running'&&<><button type="button" className="btn alt" disabled={busy||dirty} onClick={onStep}>Continue {label.toLowerCase()} (next 100)</button><button type="button" className="btn alt" disabled={busy||dirty} onClick={onCancel}>Cancel {label.toLowerCase()}</button></>}
 </div>;
}
export default function InsightsMapping({api}){
 const [initial]=useState(restored);
 const [formId,setFormId]=useState(initial.formId||''),[revision,setRevision]=useState(initial.revision||''),[copyFrom,setCopyFrom]=useState(initial.copyFrom||'');
 const [jobs,setJobs]=useState(()=>Object.fromEntries(Object.entries(initial.jobs||{}).filter(([,job])=>job?.jobId).map(([key,job])=>[key,{jobId:job.jobId,status:'restoring',scanned:job.scanned}])));
 const [entries,setEntries]=useState([]),[dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const target=jobs.target?.status==='complete'?jobs.target.result:null;
 useEffect(()=>{try{sessionStorage.setItem(storageKey,JSON.stringify({formId,revision,copyFrom,jobs}));}catch{/* Recovery storage is optional. */}},[formId,revision,copyFrom,jobs]);
 useEffect(()=>{
  const saved=Object.entries(initial.jobs||{}).filter(([,job])=>job?.jobId);
  if(!saved.length)return;
  setBusy(true);
  Promise.all(saved.map(async([key,job])=>{try{updateJob(key,await api('/mapping?'+new URLSearchParams({jobId:job.jobId})));}catch(e){setJobs(current=>({...current,[key]:{jobId:job.jobId,status:'error',scanned:job.scanned}}));setError(e.message);}})).finally(()=>setBusy(false));
 },[]);
 function updateJob(key,result){
  setJobs(current=>({...current,[key]:result}));
  if(key==='target'){
   const data=result.status==='complete'?result.result:null;
   setEntries(data?.status==='available'?(data.mapping?.stale||!data.mapping?data.fields.map(field=>({fieldId:field.id,role:'',concept:''})):data.mapping.entries):[]);
   setDirty(false);
  }
 }
 async function perform(task){
  setBusy(true);setError('');
  try{await task();}catch(e){setError(e.message);}finally{setBusy(false);}
 }
 async function start(key,mode,rev){
  const result=await api('/mapping',{method:'POST',body:JSON.stringify({action:'scan-start',formId,mode,...(rev?{revision:Number(rev)}:{})})});
  updateJob(key,result);
 }
 async function step(key,action){
  const result=await api('/mapping',{method:'POST',body:JSON.stringify({action,jobId:jobs[key].jobId})});
  updateJob(key,result);
 }
 async function refresh(key,after=''){
  const result=await api('/mapping?'+new URLSearchParams({jobId:jobs[key].jobId,...(after?{after}:{})}));
  updateJob(key,result);
 }
 async function write(action){
  await api('/mapping',{method:'POST',body:JSON.stringify({formId,revision:Number(revision),version:target.mapping?.version||0,action,scanId:jobs.target.jobId,...(action==='save'?{entries}:{}),...(action==='copy'?{copyFromRevision:Number(copyFrom),copyScanId:jobs.copy.jobId}:{})})});
  await refresh('target');
 }
 function change(index,key,value){setEntries(current=>current.map((entry,i)=>i===index?{...entry,[key]:value}:entry));setDirty(true);}
 function controls(key,label){
  const job=jobs[key];
  if(!job)return null;
  return <MappingScanControls job={job} label={label} busy={busy} dirty={dirty} onRefresh={()=>perform(()=>refresh(key))} onStep={()=>perform(()=>step(key,'scan-step'))} onCancel={()=>perform(()=>step(key,'scan-cancel'))}/>;
 }
 return <section><h3>Historical question mapping review</h3><p>Mappings belong to one form revision. They are review records only: they do not alter responses, consent, indexes or identity links. Revisions without a consistent field snapshot cannot be reviewed.</p>
 <label>Form reference<input disabled={busy} value={formId} onChange={event=>{setFormId(event.target.value);setJobs({});setEntries([]);setDirty(false);}}/></label><button type="button" className="btn alt" disabled={busy||!formId||dirty} onClick={()=>perform(()=>start('discovery','discover'))}>Find available revisions</button>
 {controls('discovery','Revision discovery')}
 {jobs.discovery?.status==='complete'&&<div><p>{jobs.discovery.notice} Responses without a valid revision: {jobs.discovery.unknownRevisionResponses}.</p>{jobs.discovery.revisions.map(item=><p key={item.revision}>Revision {item.revision}{item.current?' (current form)':''}: {item.responseSnapshots} response snapshots <button type="button" className="btn alt" disabled={busy||dirty} onClick={()=>{setRevision(String(item.revision));setJobs(current=>({...current,target:null}));}}>Choose revision {item.revision}</button></p>)}{jobs.discovery.next&&<button type="button" className="btn alt" disabled={busy||dirty} onClick={()=>perform(()=>refresh('discovery',jobs.discovery.next))}>Next revisions</button>}</div>}
 <label>Form revision<input disabled={busy||dirty} type="number" min="1" step="1" value={revision} onChange={event=>{setRevision(event.target.value);setJobs(current=>({...current,target:null}));}}/></label><button type="button" className="btn alt" disabled={busy||!formId||!revision||dirty} onClick={()=>perform(()=>start('target','inspect',revision))}>Inspect revision</button>
 {controls('target','Revision inspection')}
 {error&&<p role="alert">{error}</p>}
 {target&&target.status!=='available'&&<p role="status">Revision {target.revision}: {target.status}. {target.reason} Coverage remains incomplete.</p>}
 {target?.status==='available'&&<><p>Revision {target.revision}; source: {target.source}; response snapshots checked: {target.snapshotCount}. Mapping: {target.mapping?.stale?'stale - review required':target.mapping?.status||'not mapped'}. Unmapped questions remain unmapped.</p>
 {target.mapping?.copiedFromRevision&&<p>Draft copied from revision {target.mapping.copiedFromRevision}; every revision requires its own review.</p>}
 {target.fields.map((field,index)=><fieldset key={field.id}><legend>{field.label}</legend><p>Question ID: {field.id} · type: {field.type} · {field.required?'required':'optional'}</p>{field.description&&<p>{field.description}</p>}{field.options.length>0&&<p>Options: {field.options.join(' · ')}</p>}{field.terms&&<p>Original consent terms: {field.terms}</p>}
 <label>Semantic role<select value={entries[index]?.role||''} disabled={busy||field.type==='consent'} onChange={event=>change(index,'role',event.target.value)}>{roles.filter(([id])=>!id||allowed[id].includes(field.type)).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
 <label>Comparable question concept key <input value={entries[index]?.concept||''} disabled={busy||field.type==='consent'} maxLength="64" pattern="[a-z0-9][a-z0-9_-]*" onChange={event=>change(index,'concept',event.target.value)} placeholder="Optional, e.g. meal_choice"/></label></fieldset>)}
 <p>Reviewing a concept authorizes aggregate Insights viewers to see its supported choice option labels and numeric summaries, which may contain sensitive information. Text, contact and consent values are excluded. Review each concept and its labels carefully.</p>
 <div className="registration-actions"><button type="button" className="btn alt" disabled={busy} onClick={()=>perform(()=>write('save'))}>Save mapping draft</button><button type="button" className="btn alt" disabled={busy||!dirty} onClick={()=>updateJob('target',jobs.target)}>Discard unsaved changes</button><button type="button" className="btn alt" disabled={busy||dirty||target.mapping?.status!=='draft'||target.mapping?.stale} onClick={()=>perform(()=>write('review'))}>Mark this revision reviewed</button></div><p>Review confirms this revision only; it does not activate analysis or matching.</p>
 <label>Copy from earlier revision<input disabled={busy||dirty} type="number" min="1" step="1" value={copyFrom} onChange={event=>{setCopyFrom(event.target.value);setJobs(current=>({...current,copy:null}));}}/></label><button type="button" className="btn alt" disabled={busy||!copyFrom||dirty} onClick={()=>perform(()=>start('copy','inspect',copyFrom))}>Inspect earlier revision</button>
 {controls('copy','Earlier revision inspection')}
 {jobs.copy?.status==='complete'&&jobs.copy.result?.status!=='available'&&<p role="status">Earlier revision: {jobs.copy.result.status}. {jobs.copy.result.reason}</p>}
 <button type="button" className="btn alt" disabled={busy||dirty||jobs.copy?.status!=='complete'||jobs.copy?.result?.status!=='available'||!jobs.copy?.result?.mapping||jobs.copy.result.mapping.stale} onClick={()=>perform(()=>write('copy'))}>Copy earlier mapping as draft</button><p>Copy replaces this revision's mapping with a draft. Only questions with identical IDs and definitions are copied; all others stay unmapped. Save unsaved changes before copying.</p></>}
 </section>;
}
