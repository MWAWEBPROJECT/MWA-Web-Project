import React,{useState} from 'react';

export default function InsightsProgrammes({api}){
 const [categories,setCategories]=useState([]),[name,setName]=useState(''),[eventId,setEventId]=useState(''),[inspection,setInspection]=useState(null),[selected,setSelected]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 async function perform(task){setBusy(true);setError('');setNotice('');try{await task();}catch(e){setInspection(null);setCategories([]);setSelected([]);setError(e.message);}finally{setBusy(false);}}
 async function load(){const result=await api('/programmes');setCategories(result.categories);}
 async function inspect(){const result=await api('/programmes?'+new URLSearchParams({eventId}));setInspection(result);setSelected(result.assignment.categoryIds);}
 async function create(){await api('/programmes',{method:'POST',body:JSON.stringify({action:'create',name})});setName('');await load();setNotice('Category created.');}
 async function review(){
  await api('/programmes',{method:'POST',body:JSON.stringify({action:'review',eventId:inspection.event.id,eventVersion:inspection.event.version,version:inspection.assignment.version,categoryIds:selected})});
  await inspect();setNotice('Category review saved.');
 }
 return <section><h3>Programme category review</h3><p>Only explicitly reviewed categories classify an event. Unassigned and stale reviews remain unknown. Booking type and recurring series are separate calendar attributes; titles do not classify events. Changes here do not modify calendar events or responses.</p>
 <p>Aggregate, mapped-answer, respondent and scoped response-detail filters use current reviewed categories. Scoped detail remains limited to its separate assignment.</p>
 <button type="button" className="btn alt" disabled={busy} onClick={()=>perform(load)}>Load category catalogue</button>
 <label>New category name<input maxLength="100" value={name} disabled={busy} onChange={event=>setName(event.target.value)}/></label>
 <button type="button" className="btn alt" disabled={busy||!name.trim()} onClick={()=>perform(create)}>Create category</button>
 <label>Calendar event reference<input value={eventId} maxLength="128" disabled={busy} onChange={event=>{setEventId(event.target.value);setInspection(null);setSelected([]);}}/></label>
 <button type="button" className="btn alt" disabled={busy||!eventId} onClick={()=>perform(async()=>{await load();await inspect();})}>Inspect event</button>
 {inspection&&<fieldset disabled={busy}><legend>Review {inspection.event.title}</legend><p>{inspection.event.startAt||'Event date unavailable'} · {inspection.assignment.stale?'Calendar event changed; review again.':inspection.assignment.version?'Previously reviewed':'Not yet reviewed'}</p>
 {categories.map(category=><label key={category.id}><input type="checkbox" checked={selected.includes(category.id)} onChange={event=>setSelected(current=>event.target.checked?[...current,category.id]:current.filter(id=>id!==category.id))}/>{category.name}</label>)}
 {!categories.length&&<p>No categories have been created.</p>}<p>No selected categories means Unknown.</p>
 <button type="button" className="btn alt" onClick={()=>perform(review)}>Save reviewed categories</button></fieldset>}
 {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 </section>;
}
