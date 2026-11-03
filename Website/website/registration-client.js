import {auth} from '@calendar/firebase/firebase.js';
export async function registrationApi(path='',options={},admin=false){
 const headers={'Content-Type':'application/json'};
 if(admin){
  if(!auth.currentUser)throw Error('Sign in again to open Form Builder.');
  headers.Authorization='Bearer '+await auth.currentUser.getIdToken();
 }
 const response=await fetch('/api/registrations'+path,{...options,headers,cache:'no-store'});
 const data=await response.json();
 if(!response.ok)throw Error(data.error||'The registrations service is unavailable.');
 return data;
}
export const expiryLabel=date=>new Date(date+'T12:00:00Z').toLocaleDateString('en-AU',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
export const isFormOpen=(form,time=Date.now())=>form.published!==false&&Date.parse(form.expiresAt)>time;
