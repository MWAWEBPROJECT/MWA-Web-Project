import React,{useState} from 'react';
import {isFormOpen} from './registration-client.js';
import {formShareLinks} from './registration-share.mjs';
export default function RegistrationShare({form}){
 const [notice,setNotice]=useState(''),[error,setError]=useState('');
 if(!form.id)return null;
 if(!form.published)return <p>Publish and save this form to enable sharing.</p>;
 if(!isFormOpen(form))return <p>This form has expired. Update its expiry date and save before sharing.</p>;
 const ios=typeof navigator!=='undefined'&&(/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1));
 const links=formShareLinks(location.origin,form,ios);
 function checkOpen(event){
  if(isFormOpen(form))return true;
  event.preventDefault();setError('This form has closed. Update its expiry date and save before sharing.');return false;
 }
 async function copy(event){
  setNotice('');setError('');if(!checkOpen(event))return;
  if(!navigator.clipboard?.writeText){setError('Automatic copying is unavailable. Select and copy the link below.');return;}
  try{await navigator.clipboard.writeText(links.url);setNotice('Form link copied.');}
  catch{setError('Could not copy the link. Select and copy the link below.');}
 }
 return <section className="registration-share" aria-label={'Share '+form.title}><h3>Share form</h3><div className="registration-actions"><button type="button" className="btn alt small" onClick={copy}>Copy link</button><a className="btn alt small" href={links.whatsapp} target="_blank" rel="noopener noreferrer" onClick={checkOpen}>WhatsApp</a><a className="btn alt small" href={links.sms} onClick={checkOpen}>Text message</a></div><label>Direct form link<input aria-label={'Share link for '+form.title} readOnly value={links.url} onFocus={event=>event.target.select()}/></label><p>Opens only this form, with no sign-in required. Messaging opens your app; choose the recipient and send.</p>{notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}</section>;
}
