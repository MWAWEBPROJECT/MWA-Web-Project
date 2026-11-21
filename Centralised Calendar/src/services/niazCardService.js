import {auth} from '../firebase/firebase.js';

export async function niazCardApi(path,body){
 const user=auth.currentUser;
 const headers={'Content-Type':'application/json'};
 if(user)headers.Authorization='Bearer '+await user.getIdToken();
 const response=await fetch('/api/niaz'+path,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined,cache:'no-store',signal:AbortSignal.timeout(30000)});
 if(auth.currentUser?.uid!==user?.uid)throw Error('Your session changed. Reopen the event.');
 const data=await response.json();
 if(!response.ok)throw Error(data.error||'Could not load Niaz sponsorships.');
 return data;
}
