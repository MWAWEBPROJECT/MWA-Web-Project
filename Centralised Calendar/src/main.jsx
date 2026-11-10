import React,{useEffect} from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { AuthProvider } from './contexts/AuthContext.jsx';
import './styles.css';
import './theme.css';
import './website-appearance.css';
import '../../Website/shared/admin-ui.css';
import {calendarWebsiteUrl} from '@mwa/calendar-entry';

function PageReady(){useEffect(()=>{const frame=requestAnimationFrame(()=>{if(window.parent!==window)window.parent.postMessage({type:'mwa-page-ready'},location.origin)});return()=>cancelAnimationFrame(frame)},[]);return null;}

const embedded=window.self!==window.top;
if(embedded){document.documentElement.dataset.mwaEmbedded='true';document.documentElement.dataset.mwaView=new URLSearchParams(window.location.search).get('view')||'calendar';}
if(!embedded && import.meta.env.PROD){
 // Direct visits to the frame return to its own website origin, preserving the session.
 window.location.replace(calendarWebsiteUrl(location.href,location.pathname.startsWith('/calendar-app/')?location.origin:undefined));
}else ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
      <PageReady/>
    </AuthProvider>
  </React.StrictMode>
);
