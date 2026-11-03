import React,{useEffect,useRef,useState} from 'react';
import {ArrowUp,ArrowDown,Trash2} from 'lucide-react';
import {useAuth} from '@calendar/contexts/AuthContext.jsx';
import {auth} from '@calendar/firebase/firebase.js';
import {FIELD_TYPES,FORM_TEMPLATES,templateFields,makeField,consentLast,moveField,cleanFields} from '../functions/registration-model.mjs';
import RegistrationFields from './RegistrationFields.jsx';
import {registrationApi,expiryLabel,isFormOpen} from './registration-client.js';
import './registrations.css';
const newDraft=()=>({revision:0,title:'',description:'',purpose:'Your answers will be used by MWA to organise this activity.',expiryDate:'',eventId:'',published:false,fields:templateFields(FORM_TEMPLATES[0])});
export default function FormBuilder(){
 const session=useAuth(),allowed=session.isAdmin&&session.canAccess('form-builder');
 const [items,setItems]=useState([]),[next,setNext]=useState(null),[draft,setDraft]=useState(null),[preview,setPreview]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const [eventDate,setEventDate]=useState(''),[events,setEvents]=useState([]),[eventBusy,setEventBusy]=useState(false),[eventSearched,setEventSearched]=useState(false);
 const [responseForm,setResponseForm]=useState(null),[responses,setResponses]=useState([]),[responseNext,setResponseNext]=useState(null);
 const request=useRef(0),eventRequest=useRef(0),responsesRequest=useRef(0),active=useRef(false);
 active.current=allowed;
 const api=(path,options)=>registrationApi('/admin'+path,options,true);
 async function load(after=''){
  const ticket=++request.current,userId=auth.currentUser?.uid;setBusy(true);setError('');
  try{const data=await api(after?'?after='+encodeURIComponent(after):'');if(ticket!==request.current||!active.current||auth.currentUser?.uid!==userId)return;setItems(current=>after?[...current,...data.items]:data.items);setNext(data.next);}
  catch(problem){if(ticket===request.current)setError(problem.message);}
  finally{if(ticket===request.current)setBusy(false);}
 }
 useEffect(()=>{
  if(allowed)load();else{setItems([]);setDraft(null);setResponses([]);setResponseForm(null);setEvents([]);}
  return()=>{request.current++;eventRequest.current++;responsesRequest.current++;};
 },[allowed,session.user?.uid]);
 useEffect(()=>{window.mwaPageReady?.();},[]);
 async function findEvents(){
  const ticket=++eventRequest.current;setEventBusy(true);setError('');setEvents([]);setEventSearched(false);
  try{const data=await api('/events?date='+encodeURIComponent(eventDate));if(ticket===eventRequest.current&&active.current){setEvents(data.items);setEventSearched(true);}}
  catch(problem){if(ticket===eventRequest.current)setError(problem.message);}
  finally{if(ticket===eventRequest.current)setEventBusy(false);}
 }
 async function save(event){
  event.preventDefault();setError('');setNotice('');
  try{
   const fields=cleanFields(draft.fields);setBusy(true);
   const userId=auth.currentUser?.uid,ticket=request.current;
   const data=await api(draft.id?'/'+draft.id:'',{method:draft.id?'PUT':'POST',body:JSON.stringify({...draft,fields})});
   if(!active.current||auth.currentUser?.uid!==userId||request.current!==ticket)return;
   setDraft(data.form);setNotice(data.form.published?'Form published in Registrations until its expiry date.':'Draft saved. It is not listed publicly.');await load();
  }catch(problem){if(active.current)setError(problem.message);}
  finally{if(active.current)setBusy(false);}
 }
 async function showResponses(form,after=''){
  const ticket=++responsesRequest.current,userId=auth.currentUser?.uid;setBusy(true);setError('');setResponseForm(form);setDraft(null);if(!after)setResponses([]);
  try{const data=await api('/'+form.id+'/responses'+(after?'?after='+encodeURIComponent(after):''));if(ticket!==responsesRequest.current||!active.current||auth.currentUser?.uid!==userId)return;setResponses(current=>after?[...current,...data.items]:data.items);setResponseNext(data.next);}
  catch(problem){if(ticket===responsesRequest.current)setError(problem.message);}
  finally{if(ticket===responsesRequest.current)setBusy(false);}
 }
 function edit(form){eventRequest.current++;responsesRequest.current++;setDraft(structuredClone(form));setPreview(false);setResponseForm(null);setResponses([]);setEvents([]);setEventDate('');setEventSearched(false);setEventBusy(false);setError('');setNotice('');}
 const update=(key,value)=>setDraft(current=>({...current,[key]:value}));
 const change=(id,patch)=>setDraft(current=>({...current,fields:current.fields.map(field=>field.id===id?{...field,...patch}:field)}));
 if(session.loading)return <p>Checking Form Builder access...</p>;
 if(!allowed)return <section className="admin-console"><h1>Form Builder</h1><p>Your account does not have access to this module.</p><a className="text-link" href="/admin-login">Back to Admin Console</a></section>;
 return <section className="admin-console form-builder"><div className="eyebrow">MWA ADMINISTRATION</div><h1>Form Builder</h1><p>Create event-linked or standalone forms. Published forms appear in the Registrations panel until the end of their expiry date in Sydney.</p><p><a className="text-link" href="/admin-login">Admin Console</a> &middot; <a className="text-link" href="/registrations/">Public registrations</a></p>
 <div className="registration-actions"><button type="button" className="btn" disabled={busy} onClick={()=>edit(newDraft())}>Create form</button><button type="button" className="btn alt" disabled={busy} onClick={()=>load()}>Refresh list</button></div>
 {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 {!draft&&!responseForm&&<><div className="registration-admin-list">{items.map(form=><article className="registration-card" key={form.id}><h2>{form.title}</h2><p>{!form.published?'Draft':isFormOpen(form)?'Published':'Expired'} &middot; Closes {expiryLabel(form.expiryDate)}</p><div className="registration-actions"><button className="btn alt small" disabled={busy} onClick={()=>edit(form)}>Edit form</button><button className="btn alt small" disabled={busy} onClick={()=>showResponses(form)}>Responses</button>{isFormOpen(form)&&<a className="text-link" href={'/registrations/?form='+form.id}>Open public form</a>}</div></article>)}</div>{!busy&&!items.length&&<p>No forms have been created.</p>}{next&&<button type="button" className="btn alt" disabled={busy} onClick={()=>load(next)}>Load more forms</button>}</>}
 {draft&&<form onSubmit={save} className="registration-editor"><fieldset disabled={busy}><legend>{draft.id?'Edit form':'New form'}</legend>
 <label>Form title<input required maxLength={160} value={draft.title} onChange={event=>update('title',event.target.value)}/></label>
 <label>Introduction<textarea maxLength={2000} value={draft.description} onChange={event=>update('description',event.target.value)}/></label>
 <label>Why are you collecting these answers?<textarea required maxLength={1000} value={draft.purpose} onChange={event=>update('purpose',event.target.value)}/></label>
 <label>Expiry date (Sydney)<input type="date" required value={draft.expiryDate} onChange={event=>update('expiryDate',event.target.value)}/></label><p>Required for every form. Responses close at midnight after this date, including daylight-saving changes.</p>
 <section className="registration-card"><h2>Link a calendar event (optional)</h2><p>Choose a date to find confirmed public calendar events. Linking does not create, change or reserve a booking.</p>
 <label>Event date<input type="date" value={eventDate} onChange={event=>{eventRequest.current++;setEventBusy(false);setEventDate(event.target.value);setEvents([]);setEventSearched(false);}}/></label><button type="button" className="btn alt small" disabled={!eventDate||eventBusy} onClick={findEvents}>{eventBusy?'Finding events...':'Find events'}</button>
 {eventSearched&&!events.length&&<p role="status">No confirmed public events were found on this date.</p>}
 {events.length>0&&<label>Existing event<select value={draft.eventId} onChange={event=>update('eventId',event.target.value)}><option value="">Standalone form</option>{draft.eventId&&!events.some(item=>item.id===draft.eventId)&&<option value={draft.eventId}>Current linked event</option>}{events.map(item=><option key={item.id} value={item.id}>{item.title} &middot; {new Date(item.startAt).toLocaleTimeString('en-AU',{timeZone:'Australia/Sydney',hour:'2-digit',minute:'2-digit'})}</option>)}</select></label>}
 {draft.eventId?<p>Linked event reference: {draft.eventId} <button type="button" className="btn alt small" onClick={()=>update('eventId','')}>Remove link</button></p>:<p>Standalone form: no calendar event linked.</p>}</section>
 <section className="registration-card"><h2>Start with a template</h2><p>Choosing a template replaces the questions in this draft.</p><div className="registration-actions">{FORM_TEMPLATES.map(template=><button type="button" className="btn alt small" key={template.name} onClick={()=>{if(window.confirm('Replace the current questions with this template?'))update('fields',templateFields(template));}}>{template.name}</button>)}</div></section>
 {draft.fields.map((field,index)=><section className="registration-card" key={field.id}><h2>Question {index+1} &middot; {FIELD_TYPES.find(([type])=>type===field.type)?.[1]}</h2>
 <label>Question<input required maxLength={200} value={field.label} onChange={event=>change(field.id,{label:event.target.value})}/></label>
 <label>Help text<input maxLength={500} value={field.description} onChange={event=>change(field.id,{description:event.target.value})}/></label>
 {['select','radio','checkboxes'].includes(field.type)&&<label>Options (one per line)<textarea value={field.options.join('\n')} onChange={event=>change(field.id,{options:event.target.value.split('\n')})}/></label>}
 {field.type==='consent'&&<label>Terms and conditions<textarea required maxLength={1000} value={field.terms} onChange={event=>change(field.id,{terms:event.target.value})}/></label>}
 <label className="registration-check"><input type="checkbox" checked={field.required} disabled={field.type==='consent'} onChange={event=>change(field.id,{required:event.target.checked})}/>Required</label>
 <div className="registration-actions"><button type="button" className="btn alt small" aria-label={'Move question '+(index+1)+' up'} disabled={index===0||field.type==='consent'||draft.fields[index-1]?.type==='consent'} onClick={()=>update('fields',moveField(draft.fields,index,-1))}><ArrowUp size={18}/></button><button type="button" className="btn alt small" aria-label={'Move question '+(index+1)+' down'} disabled={index===draft.fields.length-1||field.type==='consent'||draft.fields[index+1]?.type==='consent'} onClick={()=>update('fields',moveField(draft.fields,index,1))}><ArrowDown size={18}/></button><button type="button" className="btn alt small" aria-label={'Remove question '+(index+1)} onClick={()=>update('fields',draft.fields.filter(item=>item.id!==field.id))}><Trash2 size={18}/></button></div></section>)}
 <section className="registration-card"><h2>Add a question</h2><div className="registration-actions">{FIELD_TYPES.map(([type,label])=><button type="button" className="btn alt small" disabled={draft.fields.length>=30} key={type} onClick={()=>update('fields',consentLast([...draft.fields,makeField(type,'q-'+crypto.randomUUID())]))}>{label}</button>)}</div></section>
 <label className="registration-check"><input type="checkbox" checked={draft.published} onChange={event=>update('published',event.target.checked)}/>Publish in Registrations until expiry</label><p>Uncheck and save to close and hide a form. Existing responses are retained. Editing a published form requires visitors to reload before submitting.</p>
 <div className="registration-actions"><button type="submit" className="btn">{busy?'Saving...':'Save form'}</button><button type="button" className="btn alt" onClick={()=>setPreview(value=>!value)}>{preview?'Hide preview':'Preview form'}</button><button type="button" className="btn alt" onClick={()=>setDraft(null)}>Close editor</button></div>
 {preview&&<section className="registration-card"><h2>Public form preview</h2><p>{draft.title}</p><p>{draft.description}</p><p>{draft.purpose}</p><fieldset disabled><RegistrationFields fields={draft.fields} answers={{}} onChange={()=>{}}/></fieldset></section>}
 </fieldset></form>}
 {responseForm&&<section className="registration-responses"><h2>Responses: {responseForm.title}</h2><button className="btn alt" disabled={busy} onClick={()=>{responsesRequest.current++;setResponseForm(null);setResponses([]);}}>Back to forms</button><p>Responses retain the questions and terms shown at submission. Contact details are visitor-provided, not verified identities.</p>
 {responses.map(response=><article className="registration-card" key={response.id}><h3>{response.reference}</h3><p>{new Date(response.createdAt).toLocaleString('en-AU',{timeZone:'Australia/Sydney'})} (Sydney) &middot; Form revision {response.revision}</p><p>{response.formTitle}</p><dl>{response.fields.map(field=><React.Fragment key={field.id}><dt>{field.label}</dt><dd>{field.type==='consent'?response.answers[field.id]===true?'Agreed':'Not agreed':Array.isArray(response.answers[field.id])?response.answers[field.id].join(', '):response.answers[field.id]||'No answer'}{field.type==='consent'&&<p className="registration-terms">{field.terms}</p>}</dd></React.Fragment>)}</dl></article>)}
 {!busy&&!responses.length&&<p>No responses yet.</p>}{responseNext&&<button type="button" className="btn alt" disabled={busy} onClick={()=>showResponses(responseForm,responseNext)}>Load more responses</button>}</section>}
 {busy&&<p role="status">Loading...</p>}
 </section>;
}
