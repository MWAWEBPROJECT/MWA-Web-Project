import React,{useEffect,useRef,useState} from 'react';
import {registrationApi,expiryLabel,isFormOpen} from './registration-client.js';
import {validateAnswers} from '../functions/registration-model.mjs';
import RegistrationFields from './RegistrationFields.jsx';
import {RegistrationIntroduction} from './RegistrationIntroduction.jsx';
import RegistrationPoster from './RegistrationPoster.jsx';
import './registrations.css';

export function RegistrationList({panel=false}){
 const [items,setItems]=useState([]),[next,setNext]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[time,setTime]=useState(Date.now());
 const request=useRef(0);
 async function load(after=''){
  const ticket=++request.current;setBusy(true);setError('');
  try{
   const data=await registrationApi(after?'?after='+encodeURIComponent(after):'');
   if(ticket!==request.current)return;
   setItems(current=>after?[...current,...data.items.filter(item=>!current.some(old=>old.id===item.id))]:data.items);setNext(data.next);
  }catch(problem){if(ticket===request.current)setError(problem.message);}
  finally{if(ticket===request.current)setBusy(false);}
 }
 useEffect(()=>{
  load();
  const timer=setInterval(()=>setTime(Date.now()),1000);
  const refresh=()=>{if(!document.hidden){setTime(Date.now());load();}};
  document.addEventListener('visibilitychange',refresh);
  return()=>{request.current++;clearInterval(timer);document.removeEventListener('visibilitychange',refresh);};
 },[]);
 const visible=items.filter(form=>isFormOpen(form,time));
 return <div className={'registration-list'+(panel?' is-panel':'')}>
 {error&&<p role="alert">{error} <button type="button" className="btn alt small" disabled={busy} onClick={()=>load()}>Retry</button></p>}
 {!busy&&!error&&!visible.length&&<p>No registrations are open at the moment.</p>}
 {visible.map(form=><a key={form.id} className="registration-list-item" href={'/registrations/?form='+form.id}><strong>{form.title}</strong><RegistrationIntroduction description={form.description} descriptionRuns={form.descriptionRuns} className="registration-introduction-content" as="span"/><small>Closes {expiryLabel(form.expiryDate)} (Sydney)</small><b>Open form &rarr;</b></a>)}
 {busy&&<p role="status">Loading registrations...</p>}
 {next&&<button type="button" className="btn alt small" disabled={busy} onClick={()=>load(next)}>Load more forms</button>}
 </div>;
}
export default function Registrations(){
 const params=new URLSearchParams(location.search),id=params.get('form'),shared=!!id&&params.get('shared')==='1';
 const [form,setForm]=useState(null),[answers,setAnswers]=useState({}),[errors,setErrors]=useState({}),[error,setError]=useState(''),[loading,setLoading]=useState(!!id),[busy,setBusy]=useState(false),[reference,setReference]=useState(''),[time,setTime]=useState(Date.now());
 const requestId=useRef(crypto.randomUUID()),honeypot=useRef(null);
 useEffect(()=>{
  window.mwaPageReady?.();
  if(!id)return;
  let active=true;
  if(!/^[a-f0-9-]{36}$/.test(id)){setError('This form link is invalid.');setLoading(false);return;}
  registrationApi('/'+id).then(data=>{if(active)setForm(data.form);}).catch(problem=>{if(active)setError(problem.message);}).finally(()=>{if(active)setLoading(false);});
  const timer=setInterval(()=>setTime(Date.now()),1000);
  return()=>{active=false;clearInterval(timer);};
 },[id]);
 async function submit(event){
  event.preventDefault();
  if(busy||reference)return;
  const problems=validateAnswers(form.fields,answers);setErrors(problems);setError('');
  if(Object.keys(problems).length){setError('Check the highlighted answers before submitting.');return;}
  setBusy(true);
  try{const data=await registrationApi('/'+id+'/submit',{method:'POST',body:JSON.stringify({revision:form.revision,requestId:requestId.current,answers,website:honeypot.current.value})});setReference(data.reference);setAnswers({});}
  catch(problem){setError(problem.message);}
  finally{setBusy(false);}
 }
 const ConfirmationHeading=shared?'h1':'h2';
 const logo=typeof document!=='undefined'?document.querySelector('img.official-logo')?.getAttribute('src'):'';
 return <section className="registrations-page wrap">{(!shared||!reference)&&<><div className="registration-brand">{logo&&<img className="registration-logo" data-cms-image="logo" src={logo} alt="Muhammadi Welfare Association logo"/>}<div className="eyebrow">{shared?'MUHAMMADI WELFARE ASSOCIATION':'MWA COMMUNITY'}</div></div><h1>{form?.title||'Registrations'}</h1></>}
 {!shared&&<p><a className="text-link" href={id?'/registrations/':'/#today-panels'}>{id?'All registrations':'Back to Home'}</a></p>}
 {!id?<RegistrationList/>:<>
 {loading&&<p role="status">Loading form...</p>}{error&&<p role="alert">{error}</p>}
 {reference?<div role="status" className="registration-card"><ConfirmationHeading>Thank you.</ConfirmationHeading><p>We have received your response. Your reference number is <strong>{reference}</strong>.</p></div>
 :form&&<><RegistrationPoster form={form}/><RegistrationIntroduction description={form.description} descriptionRuns={form.descriptionRuns} className="registration-introduction" as="p"/><p>Closes at the end of {expiryLabel(form.expiryDate)} (Sydney time).</p>
 {form.event&&<p>Linked event: {shared?form.event.title:<a className="text-link" href={'/calendar/?date='+new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Sydney',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(form.event.startAt))}>{form.event.title}</a>}</p>}
 <p className="registration-purpose">{form.purpose}</p><p>Responses are private to authorised MWA Form Builder administrators. No sign-in is required.</p>
 {!isFormOpen(form,time)?<p role="status">This form has expired and no longer accepts responses.</p>
 :<form onSubmit={submit} noValidate><fieldset disabled={busy}><legend className="registration-sr-only">Your answers</legend><p>Fields marked * are required.</p><RegistrationFields fields={form.fields} answers={answers} errors={errors} onChange={(key,value)=>setAnswers(current=>({...current,[key]:value}))}/>
 <label className="registration-honeypot" aria-hidden="true">Leave this blank<input ref={honeypot} tabIndex={-1} autoComplete="off" name="website"/></label>
 <button className="btn" type="submit">{busy?'Submitting...':'Submit response'}</button></fieldset></form>}</>}
 </>}
 </section>;
}
