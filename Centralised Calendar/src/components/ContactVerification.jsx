import React,{useEffect,useState} from 'react';
import {ShieldCheck} from 'lucide-react';
import {contactInput,contactError} from '../utils/contactVerification.mjs';
import './contact-verification.css';

export default function ContactVerification({idPrefix,method,onMethodChange,contact,onContactChange,code,onCodeChange,challenge,verified=false,busy=false,resendAt=0,onSend,onVerify,help,verifiedMessage}){
 const [touched,setTouched]=useState(false),[clock,setClock]=useState(Date.now());
 useEffect(()=>{setTouched(false);},[method]);
 useEffect(()=>{if(!resendAt)return;setClock(Date.now());const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer);},[resendAt]);
 const error=contactError(method,contact),waiting=clock<resendAt;
 return <fieldset className="contact-verification" disabled={busy}>
  <legend><ShieldCheck size={21} aria-hidden="true"/>Verify your contact</legend>
  <p className="contact-hint">{help} Only the selected contact is verified. Codes expire after 10 minutes.</p>
  <div className="contact-fields"><label htmlFor={idPrefix+'-method'}>Verification method<select id={idPrefix+'-method'} value={method} onChange={event=>onMethodChange(event.target.value)}><option value="email">Email OTP</option><option value="mobile">Mobile OTP</option></select></label>
   <label htmlFor={idPrefix+'-contact'}>{method==='email'?'Email address':'Mobile number'}<input id={idPrefix+'-contact'} type={method==='email'?'email':'tel'} inputMode={method==='mobile'?'numeric':'email'} autoComplete={method==='email'?'email':'tel'} placeholder={method==='email'?'you@example.com':'0412345678 or 61412345678'} value={contact} onChange={event=>onContactChange(contactInput(method,event.target.value))} onBlur={()=>setTouched(true)} aria-invalid={touched&&!!error} aria-describedby={idPrefix+'-contact-help'+(touched&&error?' '+idPrefix+'-error':'')}/></label></div>
  <p className="contact-hint" id={idPrefix+'-contact-help'}>{method==='mobile'?'Numbers only. Use an Australian 04 number, or include the country code for an international number (for example 61412345678).':'Use an email address you can access.'}</p>
  {touched&&error&&<p id={idPrefix+'-error'} className="contact-error" role="alert">{error}</p>}
  {!verified&&<button className="btn alt" type="button" disabled={busy||!!error||waiting} onClick={onSend}>{waiting?'Send a new code in '+Math.ceil((resendAt-clock)/1000)+' seconds':challenge?'Send a new code':'Send verification code'}</button>}
  {challenge&&!verified&&<><p className="contact-hint" role="status">Code sent{challenge.maskedContact?' to '+challenge.maskedContact:''}. Enter it below.</p><label htmlFor={idPrefix+'-code'}>Verification code<input id={idPrefix+'-code'} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={event=>onCodeChange(event.target.value.replace(/\D/g,'').slice(0,6))}/></label><button className="btn" type="button" disabled={busy||code.length!==6} onClick={onVerify}>Verify contact</button></>}
  {verified&&<p className="contact-hint" role="status">{verifiedMessage||'Contact verified. Refreshing requires verification again.'}</p>}
  <div id="booking-phone-recaptcha"/>
 </fieldset>;
}
