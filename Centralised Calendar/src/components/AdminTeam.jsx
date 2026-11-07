import {Fragment,useEffect,useState} from 'react';
import {Trash2,Pencil,Plus} from 'lucide-react';
import {OWNER_EMAIL,useAuth} from '../contexts/AuthContext.jsx';
import {ADMIN_MODULES,effectiveModules,accessActive} from '@mwa/access';
import {watchAdminTeam,addAdminEmail,removeAdminEmail,setAdminModules} from '../services/adminTeamService.js';
import AdminAccessEditor from './AdminAccessEditor.jsx';
export default function TeamTab({currentEmail,canManage}){
 const session=useAuth();
 const canEdit=canManage&&session.isOwner;
 const [team,setTeam]=useState(null),[editing,setEditing]=useState(null),[busy,setBusy]=useState(''),[msg,setMsg]=useState(null);
 useEffect(()=>watchAdminTeam(setTeam,()=>setMsg({err:true,text:'Could not load the admin list.'})),[]);
 useEffect(()=>{if(!canEdit)setEditing(null)},[canEdit]);
 const fmt=iso=>iso?new Date(iso).toLocaleString('en-AU',{timeZone:'Australia/Sydney',dateStyle:'medium',timeStyle:'short'}):'—';
 async function save({email,modules,expiryDate}){
  if(!canEdit)return;setBusy('save');setMsg(null);
  try{if(editing.isNew)await addAdminEmail(email,modules,expiryDate);else await setAdminModules(editing.id,modules,expiryDate,editing.permissionsRevision||0);setEditing(null);setMsg({text:'Access saved for '+email+'. Changes apply to existing sessions.'});}catch(e){setMsg({err:true,text:e.message||'Could not save access.'})}finally{setBusy('')}
 }
 async function remove(email){
  if(!canEdit||!window.confirm('Remove admin access for '+email+'?'))return;
  setBusy(email);setMsg(null);try{await removeAdminEmail(email);if(editing?.id===email)setEditing(null);setMsg({text:email+' no longer has admin access.'})}catch(e){setMsg({err:true,text:e.message||'Could not remove this member.'})}finally{setBusy('')}
 }
 return <div className="team-tab">
  <p className="muted">Listed members can sign in with their approved account and use only their assigned modules. Permission changes and expiry are enforced across the website.</p>
  <p className="team-owner-note">Only {OWNER_EMAIL} can add, edit, renew or remove team members. Super Admin always has full, indefinite access.</p>
  {canEdit&&!editing&&<button type="button" className="lb lb-default" onClick={()=>{setMsg(null);setEditing({isNew:true})}}><Plus size={16}/>Add team member</button>}
  {msg&&<div className={msg.err?'err':'ok'} role={msg.err?'alert':'status'}>{msg.text}</div>}
  {canEdit&&editing?.isNew&&<AdminAccessEditor key={editing.id||'new'} email={editing.email||editing.id||''} initialModules={editing.isNew?[]:effectiveModules(editing)} expiryDate={editing.accessExpiryDate||null} isNew={!!editing.isNew} busy={!!busy} onSave={save} onCancel={()=>setEditing(null)}/>}
  <div className="team-table-scroll"><table><thead><tr><th>Member</th><th>Module access</th><th>Access duration</th><th>Last sign-in</th>{canEdit&&<th>Actions</th>}</tr></thead><tbody>
   {team===null&&<tr><td colSpan={canEdit?5:4}>Loading team…</td></tr>}
   {team?.map(m=>{const owner=m.id===OWNER_EMAIL,ids=owner?ADMIN_MODULES.map(x=>x.id):effectiveModules(m),expired=!owner&&!accessActive(m);return <Fragment key={m.id}><tr>
    <td><strong>{m.displayName||m.email||m.id}</strong>{m.displayName&&<small className="team-email">{m.email||m.id}</small>}{owner&&<span className="team-you">Super Admin</span>}{m.id===currentEmail&&<span className="team-you">you</span>}</td>
    <td><details><summary>{owner?'Full access':ids.length+' of '+ADMIN_MODULES.length+' modules'}</summary><ul className="team-access-list">{ADMIN_MODULES.filter(x=>ids.includes(x.id)).map(x=><li key={x.id}>{x.name}{!x.live?' (coming soon)':''}</li>)}{!ids.length&&<li>No module access assigned</li>}</ul></details></td>
    <td>{owner||!m.accessExpiryDate?'Indefinite':<><span className={expired?'team-expired':''}>{expired?'Expired':'Through'} {m.accessExpiryDate}</span><small className="team-email">End of day · Sydney</small></>}</td><td>{m.lastSignInAt?fmt(m.lastSignInAt):'Never'}</td>
    {canEdit&&<td>{owner?<span className="muted">Protected Super Admin</span>:<div className="team-row-actions"><button type="button" className="lb lb-outline lb-sm" disabled={!!busy} onClick={()=>{setMsg(null);setEditing(m)}} aria-label={'Edit access for '+m.id}><Pencil size={15}/>Edit access</button><button type="button" className="lb lb-outline lb-sm" disabled={!!busy} onClick={()=>remove(m.id)} aria-label={'Remove '+m.id}><Trash2 size={15}/></button></div>}</td>}
   </tr>
   {canEdit&&editing?.id===m.id&&<tr className="team-inline-editor"><td colSpan={5}><AdminAccessEditor key={editing.id} email={editing.email||editing.id} initialModules={effectiveModules(editing)} expiryDate={editing.accessExpiryDate||null} busy={!!busy} onSave={save} onCancel={()=>setEditing(null)}/></td></tr>}
   </Fragment>})}
   {team?.length===0&&<tr><td colSpan={canEdit?5:4}>No team members listed.</td></tr>}
  </tbody></table></div>
 </div>;
}
