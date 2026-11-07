import React,{useEffect,useState} from 'react';
import {auth} from '@calendar/firebase/firebase.js';

export default function RegistrationPoster({form,upload,removed=false,admin=false}){
 const [privateUrl,setPrivateUrl]=useState(''),[error,setError]=useState('');
 const size=['small','medium','large'].includes(form.posterSize)?form.posterSize:form.poster?.size||'medium';
 useEffect(()=>{
  if(!admin||!form.id||!form.poster||upload||removed)return;
  let active=true,url='';
  (async()=>{try{
   const user=auth.currentUser;if(!user)throw Error('Sign in again to preview this poster.');
   const response=await fetch('/api/registrations/admin/'+form.id+'/poster',{headers:{Authorization:'Bearer '+await user.getIdToken()},cache:'no-store'});
   if(!response.ok){const result=await response.json();throw Error(result.error||'Poster preview is unavailable.');}
   const blob=await response.blob();if(!active||auth.currentUser?.uid!==user.uid)return;
   url=URL.createObjectURL(blob);setPrivateUrl(url);setError('');
  }catch(problem){if(active)setError(problem.message);}})();
  return()=>{active=false;if(url)URL.revokeObjectURL(url);setPrivateUrl('');};
 },[admin,form.id,form.poster?.key,upload,removed]);
 if(removed||!upload&&!form.poster)return null;
 const src=upload?'data:'+upload.type+';base64,'+upload.data:admin?privateUrl:'/api/registrations/'+form.id+'/poster';
 return <div className={'registration-poster registration-poster--'+size}>
 {src&&<img src={src} alt={form.posterAlt||form.poster?.alt||'Event poster for '+(form.title||'this form')} onError={()=>setError('The event poster could not be displayed.')}/>}
 {error&&<p role="alert">{error}</p>}
 </div>;
}
