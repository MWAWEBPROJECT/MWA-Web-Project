import {useState} from 'react';
import {ADMIN_MODULES} from '@mwa/access';
export default function AdminAccessEditor({email='',initialModules=[],expiryDate=null,isNew=false,busy=false,onSave,onCancel}){
 const [address,setAddress]=useState(email),[selected,setSelected]=useState(initialModules),[expiryMode,setExpiryMode]=useState(expiryDate?'date':'indefinite'),[date,setDate]=useState(expiryDate||'');
 const toggle=id=>setSelected(values=>values.includes(id)?values.filter(v=>v!==id):[...values,id]);
 return <form className="team-access-editor" onSubmit={e=>{e.preventDefault();onSave({email:address.trim().toLowerCase(),modules:selected,expiryDate:expiryMode==='date'?date:null})}}>
  <div className="team-editor-heading"><div><h3>{isNew?'Add admin team member':'Edit access'}</h3><p>{isNew?'Select the modules this person may use.':email}</p></div></div>
  {isNew&&<div className="field"><label htmlFor="team-email">Admin email</label><input id="team-email" type="email" required value={address} onChange={e=>setAddress(e.target.value)} disabled={busy} placeholder="name@example.com"/></div>}
  <fieldset disabled={busy}><legend>Module access</legend><p className="team-access-help">Checked modules allow administration. Unchecked modules are blocked. Coming-soon modules remain unavailable until launched.</p>
   <div className="team-selection-actions"><button type="button" className="lb lb-outline lb-sm" onClick={()=>setSelected(ADMIN_MODULES.map(m=>m.id))}>Select all</button><button type="button" className="lb lb-outline lb-sm" onClick={()=>setSelected([])}>Clear all</button><span>{selected.length} of {ADMIN_MODULES.length} selected</span></div>
   <div className="team-module-options">{ADMIN_MODULES.map(m=><label key={m.id} className={'team-module-option'+(selected.includes(m.id)?' selected':'')}><input type="checkbox" checked={selected.includes(m.id)} onChange={()=>toggle(m.id)}/><span>{m.name}{!m.live&&<small>Coming soon</small>}</span></label>)}</div>
  </fieldset>
  <fieldset disabled={busy}><legend>Access duration</legend><div className="team-expiry-options"><label><input type="radio" name="team-expiry" value="indefinite" checked={expiryMode==='indefinite'} onChange={()=>setExpiryMode('indefinite')}/>Indefinite</label><label><input type="radio" name="team-expiry" value="date" checked={expiryMode==='date'} onChange={()=>setExpiryMode('date')}/>Expires on a date</label></div>
   {expiryMode==='date'&&<div className="field"><label htmlFor="team-expiry-date">Last day of access</label><input id="team-expiry-date" type="date" required value={date} onChange={e=>setDate(e.target.value)}/><p className="team-access-help">Access ends at midnight after this date, in Sydney time. The member stays on the list and can be renewed here.</p></div>}
  </fieldset>
  {!selected.length&&<p className="team-owner-note">No modules selected. This person can sign in but cannot administer any module.</p>}
  <div className="team-editor-actions"><button type="button" className="btn alt" disabled={busy} onClick={()=>{if(isNew)setAddress('');setSelected([]);setExpiryMode('indefinite');setDate('');}}>Clear</button><button className="lb lb-default" disabled={busy} type="submit">{busy?'Saving…':isNew?'Add member':'Save access'}</button><button className="lb lb-outline" type="button" disabled={busy} onClick={onCancel}>Cancel</button></div>
 </form>;
}
