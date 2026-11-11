import React from 'react';
import {createRoot} from 'react-dom/client';
import {httpsCallable} from 'firebase/functions';
import {onAuthStateChanged} from 'firebase/auth';
import {auth,functions} from '@calendar/firebase/firebase.js';
import MwaAssistant from './MwaAssistant.jsx';
const call=httpsCallable(functions,'mwaAiChat',{timeout:35000});
const ask=async input=>(await call(input)).data;
const subscribe=clear=>{const off=onAuthStateChanged(auth,clear);window.addEventListener('mwa-auth-changed',clear);return()=>{off();window.removeEventListener('mwa-auth-changed',clear);};};
if(import.meta.env.VITE_MWA_AI_ENABLED==='true'&&window.top===window.self){const root=document.createElement('div');root.id='mwa-ai-root';document.body.append(root);createRoot(root).render(<MwaAssistant ask={ask} subscribe={subscribe}/>);}
