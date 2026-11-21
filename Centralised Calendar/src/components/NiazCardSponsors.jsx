import {useEffect,useMemo,useState} from 'react';
import {niazCardApi} from '../services/niazCardService.js';

export function NiazCardSponsors({eventId,canManage,onManage,refreshKey=0}){
 const [names,setNames]=useState([]),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 useEffect(()=>{let live=true;setLoading(true);setError('');
  niazCardApi((canManage?'/event':'/public')+'?eventId='+encodeURIComponent(eventId)).then(data=>{
   if(live)setNames(canManage?data.assignments.filter(row=>row.status==='approved').map(row=>row.sponsor?.name||'Sponsor unavailable'):data.sponsors.map(row=>row.name));
  }).catch(problem=>{if(live)setError(problem.message)}).finally(()=>{if(live)setLoading(false)});
  return()=>{live=false};
 },[eventId,canManage,refreshKey]);
 return <div className="extras-section niaz-card-section"><div className="extras-head"><b>Niaz sponsor{names.length>1?'s':''}</b>{canManage&&onManage&&<button type="button" className="btn sm" onClick={onManage}>Manage</button>}</div>
  {loading?<div className="muted" role="status">Loading sponsors…</div>:error?<div className="err" role="alert">{error}</div>:names.length?<div>{names.join(', ')}</div>:<div className="muted">None assigned.</div>}
 </div>;
}

export function NiazCardSponsorEditor({eventId,onClose,onSaved}){
 const [detail,setDetail]=useState(null),[directory,setDirectory]=useState([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[search,setSearch]=useState(''),[selected,setSelected]=useState(null),[removed,setRemoved]=useState([]);
 useEffect(()=>{let live=true;(async()=>{try{
  const event=await niazCardApi('/event?eventId='+encodeURIComponent(eventId));
  let after='',all=[];do{const page=await niazCardApi('/sponsors'+(after?'?after='+encodeURIComponent(after):''));all.push(...page.items);after=page.next;if(all.length>=10000&&after)throw Error('Sponsor directory is too large for this picker. Open Niaz Administration.');}while(after);
  if(live){setDetail(event);setDirectory(all)}
 }catch(problem){if(live)setError(problem.message)}finally{if(live)setLoading(false)}})();return()=>{live=false};},[eventId]);
 const approved=detail?.assignments.filter(row=>row.status==='approved')||[];
 const kept=approved.filter(row=>!removed.includes(row.id));
 const matches=useMemo(()=>search.trim().length>=2?directory.filter(row=>row.active&&!approved.some(item=>item.sponsorId===row.id)&&row.id!==selected?.id&&[row.name,row.email,row.phone].join(' ').toLowerCase().includes(search.trim().toLowerCase())).slice(0,10):[],[directory,approved,selected,search]);
 async function save(){if(!detail||(!selected&&!removed.length))return;
  if(removed.length&&!window.confirm('Remove the selected sponsor assignment(s) from this event? Sponsor Directory contacts and history will remain.'))return;
  if(selected&&kept.some(row=>row.role==='sole')&&!window.confirm('Adding a sponsor will make the existing sole sponsorship joint for this event. Continue?'))return;
  setBusy(true);setError('');try{
   const assignments=kept.map(row=>({id:row.id,revision:row.revision,sponsorId:row.sponsorId,type:row.type,role:row.role,seriesId:row.seriesId||'',inKind:row.inKind||'',notes:row.notes||''}));
   if(selected)assignments.push({sponsorId:selected.id,type:'one_time',role:assignments.length?'joint':'sole',seriesId:'',inKind:'',notes:'',revision:0});
   const coverage=detail.coverage;
   await niazCardApi('/event-plan',{eventId,revision:coverage.revision||0,baseline:approved.map(row=>({id:row.id,revision:row.revision})),assignments,mwaArranged:coverage.mwaArranged===true,arrangementConfirmed:coverage.arrangementConfirmed===true,acceptExtraEOIs:coverage.acceptExtraEOIs===true,notes:coverage.notes||'',fundsRequiredCents:coverage.fundsRequiredCents??null});
   onSaved();onClose();
  }catch(problem){setError(problem.message)}finally{setBusy(false)}
 }
 return <div className="overlay show extras-overlay" onClick={onClose}><div className="dlg niaz-card-editor" role="dialog" aria-modal="true" aria-label="Assign Niaz sponsor" onClick={event=>event.stopPropagation()}>
  <button type="button" className="dlg-close" onClick={onClose} aria-label="Close dialog">✕</button><h3>Assign Niaz sponsor</h3>
  {loading?<p role="status">Loading event and Sponsor Directory…</p>:detail&&<><p className="muted">{detail.event.title}</p>
   <div className="niaz-card-existing"><b>Assigned sponsors</b>{kept.length?kept.map(row=><div key={row.id}><span>{row.sponsor?.name||'Sponsor unavailable'}</span><button type="button" className="btn sm" disabled={busy} onClick={()=>setRemoved(current=>[...current,row.id])}>Remove</button></div>):<p>None assigned.</p>}{removed.length>0&&<button type="button" className="btn sm" onClick={()=>setRemoved([])}>Restore removed</button>}</div>
   <label htmlFor="niaz-card-search">Search Sponsor Directory</label><input id="niaz-card-search" type="search" autoComplete="off" placeholder="Type at least two letters of a name, email or mobile" value={search} onChange={event=>setSearch(event.target.value)} disabled={busy}/>
   {matches.length>0&&<ul className="niaz-card-matches" aria-label="Matching sponsors">{matches.map(row=><li key={row.id}><button type="button" onClick={()=>{setSelected(row);setSearch('')}}><b>{row.name}</b><small>{[row.email,row.phone].filter(Boolean).join(' · ')||'No contact recorded'}</small></button></li>)}</ul>}
   {search.trim().length>=2&&!matches.length&&<p className="muted">No matching active sponsors.</p>}
   {selected&&<div className="card niaz-card-selected"><b>Selected sponsor</b><div>{selected.name}</div><div>{selected.email||'No email recorded'}</div><div>{selected.phone||'No mobile recorded'}</div><p>This assignment applies to this event only.</p><button type="button" className="btn sm" onClick={()=>setSelected(null)}>Clear selection</button></div>}
   <p className="muted">Approved assignments are saved immediately. Existing permanent commitments require separate review in Niaz Administration.</p>
  </>}
  {error&&<div className="err" role="alert">{error}</div>}
  <div className="niaz-card-actions"><button type="button" className="btn" onClick={()=>{setSelected(null);setSearch('');setRemoved([])}} disabled={busy}>Clear</button><button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="btn pri" onClick={save} disabled={busy||loading||!detail||(!selected&&!removed.length)}>Save assignment</button></div>
 </div></div>;
}
