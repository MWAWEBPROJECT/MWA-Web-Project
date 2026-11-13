import React from 'react';
import {createRoot} from 'react-dom/client';
import {httpsCallable} from 'firebase/functions';
import {onAuthStateChanged} from 'firebase/auth';
import {auth,functions} from '@calendar/firebase/firebase.js';
import MwaAssistant from './MwaAssistant.jsx';
import {watchAssistantIdentity} from './mwa-assistant-session.mjs';
const call=httpsCallable(functions,'mwaAiChat',{timeout:35000});
const ask=async input=>{try{return (await call(input)).data;}catch(error){if(error.code==='functions/unauthenticated')throw Error('Browser verification was not accepted. Refresh the page and try again; check whether your browser is blocking Google verification.');throw error;}};
const subscribe=clear=>{
 const changed=watchAssistantIdentity(()=>({uid:auth.currentUser?.uid}),clear);
 return onAuthStateChanged(auth,changed);
};
if(import.meta.env.VITE_MWA_AI_ENABLED==='true'&&window.top===window.self){const root=document.createElement('div');root.id='mwa-ai-root';document.body.append(root);createRoot(root).render(<MwaAssistant ask={ask} subscribe={subscribe}/>);}
