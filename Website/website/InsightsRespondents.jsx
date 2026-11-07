import React,{useState} from 'react';
import InsightsRespondentReports from './InsightsRespondentReports.jsx';
import InsightsRespondentLookup from './InsightsRespondentLookup.jsx';
import InsightsMultiEvent from './InsightsMultiEvent.jsx';

export default function InsightsRespondents({api,programmeFilters,responseScope,canExport=false}){
 const [formId,setFormId]=useState(''),[responseId,setResponseId]=useState(''),[scanId,setScanId]=useState(''),[revision,setRevision]=useState(''),[scan,setScan]=useState(null),[result,setResult]=useState(null),[history,setHistory]=useState(null),[preview,setPreview]=useState(null),[operationId,setOperationId]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[selectedPerson,setSelectedPerson]=useState(''),[reportsRevision,setReportsRevision]=useState(0);
 async function scanRevision(action){
  setBusy(true);setError('');setResult(null);setHistory(null);setPreview(null);
  try{
   const data=await api('/respondent-scan',{method:'POST',body:JSON.stringify({action,...(action==='start'?{formId,revision:Number(revision)}:{jobId:scan.jobId})})});
   setScan(data);setScanId(data.status==='complete'?data.jobId:'');
  }catch(e){setScan(null);setScanId('');setError(e.message);}finally{setBusy(false);}
 }
 async function request(action,personId){
  setBusy(true);setError('');setResult(null);setHistory(null);
  try{
   const data=await api('/respondent',{method:'POST',body:JSON.stringify({action,formId,responseId,scanId,...(personId?{personId}:{}),...(result?.reviewToken?{reviewToken:result.reviewToken}:{})})});
   if(action==='inspect')setResult(data);else{setReportsRevision(value=>value+1);setResult({message:action==='unlink'?'Link removed. Inspect again to review this response.':'Link recorded. Inspect again to check current status.'});}
  }catch(e){setError(e.message);}finally{setBusy(false);}
 }
 async function openHistory(personId,after=''){
  setBusy(true);setError('');
  try{const data=await api('/respondent',{method:'POST',body:JSON.stringify({action:'history',personId,after,...(after?{personVersion:history.personVersion}:{})})});setHistory(previous=>after?{...data,items:[...previous.items,...data.items]}:data);setSelectedPerson({id:personId});}
  catch(e){setHistory(null);setError(e.message);}finally{setBusy(false);}
 }
 async function merge(action,candidateId){
  setBusy(true);setError('');setMessage('');
  try{
   const body=action==='merge-preview'?{sourceId:result.personId,targetId:candidateId}:action==='merge-confirm'?{sourceId:preview.sourceId,targetId:preview.targetId,reviewToken:preview.reviewToken}:{operationId:operationId.trim()};
   const data=await api('/respondent',{method:'POST',body:JSON.stringify({action,...body})});
   if(action==='merge-preview')setPreview(data);
   else{setReportsRevision(value=>value+1);setPreview(null);setResult(null);setHistory(null);if(data.operationId)setOperationId(data.operationId);setMessage(action==='merge-confirm'?'Merge completed. Keep the operation reference to undo if no later changes conflict.':'Merge undone. Inspect responses again.');}
  }catch(e){setPreview(null);setResult(null);setHistory(null);setError(e.message);}finally{setBusy(false);}
 }
 return <section><h3>Respondent identity review</h3>
 <p>Track the person who submitted the response, not inferred participants, households or attendance. Exact contact matches are candidates only; an authorised reviewer must review every link and merge. Shared contacts can belong to different people. No automatic linking or merges occur.</p>
 <p>First complete a fresh inspection of the response’s revision above and review its mapping. Enter that inspection’s job ID. Missing, draft, conflicting or stale mappings remain unresolved.</p>
 <label>Form reference<input value={formId} onChange={e=>{setFormId(e.target.value);setResult(null);setHistory(null);setPreview(null);setScan(null);setScanId('');}} disabled={busy}/></label>
 <label>Response reference ID<input value={responseId} onChange={e=>{setResponseId(e.target.value);setResult(null);setHistory(null);setPreview(null);}} disabled={busy}/></label>
 <label>Response revision<input type="number" min="1" value={revision} onChange={e=>{setRevision(e.target.value);setScan(null);setScanId('');setResult(null);setHistory(null);setPreview(null);}} disabled={busy}/></label>
 <button type="button" className="btn alt" disabled={busy||!formId||!revision} onClick={()=>scanRevision('start')}>Start revision inspection</button>
 {scan&&<p role="status">Revision inspection {scan.status}; {scan.scanned} snapshots scanned. {scan.status==='running'?'Inspection is incomplete.':''}{scan.status==='complete'&&scan.result?.status!=='available'?'Revision definition is unavailable or conflicting.':''}</p>}
 {scan?.status==='running'&&<><button type="button" className="btn alt" disabled={busy} onClick={()=>scanRevision('step')}>Continue inspection</button><button type="button" className="btn alt" disabled={busy} onClick={()=>scanRevision('cancel')}>Cancel inspection</button></>}
 <label>Completed revision inspection job ID<input value={scanId} onChange={e=>{setScanId(e.target.value);setResult(null);setHistory(null);setPreview(null);}} disabled={busy}/></label>
 <div className="registration-actions"><button type="button" className="btn alt" disabled={busy||!formId||!responseId||!scanId} onClick={()=>request('inspect')}>Inspect respondent candidates</button><button type="button" className="btn alt" disabled={busy||!formId||!responseId} onClick={()=>request('unlink')}>Remove this response link</button></div>
 {error&&<p role="alert">{error}</p>}{result?.message&&<p role="status">{result.message}</p>}
 {result?.source&&<><p>Source {result.source.formId} / {result.source.responseId} · revision {result.source.revision} · {result.source.reference} · respondent name: {result.source.names.join(' / ')||'unavailable'}. Status: {result.status}. Unresolved in this inspected response: {result.unresolvedCount}. {result.notice}</p>
 <p>{result.candidateCount} current contact candidates; {result.staleCandidateCount} stale candidate references excluded. Inspect and review source records before choosing.</p>
 {result.status==='unresolved'&&<button type="button" className="btn alt" disabled={busy} onClick={()=>request('create')}>Create a distinct respondent and link</button>}
 {result.status==='review-required'&&<><p>Review the existing respondent history and the current source before reconfirming this stale link.</p><button type="button" className="btn alt" disabled={busy} onClick={()=>request('reconfirm')}>Reconfirm existing response link</button></>}
 {result.personId&&<button type="button" className="btn alt" disabled={busy} onClick={()=>openHistory(result.personId)}>View linked respondent history</button>}
 {result.candidates.map(candidate=><p key={candidate.id}>Candidate {candidate.id} · {candidate.match} · respondent name: {candidate.names.join(' / ')||'unavailable'} · source {candidate.source.formId} / {candidate.source.responseId} <button type="button" className="btn alt" disabled={busy} onClick={()=>openHistory(candidate.id)}>View candidate history</button> {result.status==='unresolved'&&<button type="button" className="btn alt" disabled={busy} onClick={()=>request('link',candidate.id)}>Confirm this response link</button>}{result.status==='linked'&&result.personId!==candidate.id&&<button type="button" className="btn alt" disabled={busy} onClick={()=>merge('merge-preview',candidate.id)}>Review whole-record merge</button>}</p>)}</>}
 {preview&&<section><h4>Review merge before confirming</h4><p>Move {preview.sourceCount} linked responses from {preview.sourceId} to {preview.targetId}, which has {preview.targetCount} linked responses. {preview.inspectedLinks} total link records inspected; maximum {preview.limit}. Matching contact types: {preview.sharedTypes.join(', ')}. {preview.notice}</p>{preview.sources.map(item=><p key={item.formId+'/'+item.responseId}>{item.personId} · {item.formId} / {item.responseId} · revision {item.revision} · {item.names.join(' / ')||'name unavailable'}</p>)}<button type="button" className="btn alt" disabled={busy} onClick={()=>merge('merge-confirm')}>Confirm reviewed merge</button><button type="button" className="btn alt" disabled={busy} onClick={()=>setPreview(null)}>Cancel merge preview</button></section>}
 {message&&<p role="status">{message}</p>}<label>Merge operation reference for undo<input value={operationId} onChange={e=>setOperationId(e.target.value)} disabled={busy}/></label><p>Undo refuses if either respondent, their links, sources or mappings changed since the merge. It never rewrites response answers or consent.</p><button type="button" className="btn alt" disabled={busy||!operationId} onClick={()=>merge('merge-undo')}>Undo reviewed merge</button>
 {history&&<section><h4>Respondent history</h4><p>{history.notice}</p>{history.lastMergeOperation&&<p>Latest merge reference: {history.lastMergeOperation} <button type="button" className="btn alt" disabled={busy} onClick={()=>setOperationId(history.lastMergeOperation)}>Use for undo</button></p>}{history.items.map(item=><p key={item.formId+'/'+item.responseId}>{item.formId} / {item.responseId} · revision {item.revision} · {item.status}</p>)}{history.next&&<button type="button" className="btn alt" disabled={busy} onClick={()=>openHistory(history.personId,history.next)}>Load more linked responses</button>}</section>}
 <InsightsRespondentLookup key={'lookup-'+reportsRevision} api={api} programmeFilters={programmeFilters} responseScope={responseScope} canExport={canExport} onChoosePerson={id=>setSelectedPerson({id})}/>
 <InsightsMultiEvent key={'multi-'+reportsRevision} api={api} programmeFilters={programmeFilters} responseScope={responseScope} onChoosePerson={id=>setSelectedPerson({id})}/>
 <InsightsRespondentReports key={'reports-'+reportsRevision} api={api} programmeFilters={programmeFilters} responseScope={responseScope} selectedPerson={selectedPerson}/>
 </section>;
}
