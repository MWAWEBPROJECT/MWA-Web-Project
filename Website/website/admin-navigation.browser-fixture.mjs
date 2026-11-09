// Local synthetic fixture: no Firebase, provider or production requests.
import path from 'node:path';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export async function navigationFixture(authSource){
 const result=await build({stdin:{resolveDir:root,loader:'jsx',contents:`
 import React from 'react';import {createRoot} from 'react-dom/client';
 import {AuthProvider,useAuth} from '../Centralised Calendar/src/contexts/AuthContext.jsx';
 import App from '../Centralised Calendar/src/App.jsx';
 import FormBuilder from './website/FormBuilder.jsx';
 import AdminConsole from './website/AdminConsole.jsx';
 import AdminEntry from './website/AdminEntry.jsx';
 import EnquiriesPage from './website/EnquiriesPage.jsx';
 import './website/firebase-website.css';import './website/website-polish.css';
 import {mountCalendarShell} from './website/calendar-shell.js';window.mountCalendarShell=mountCalendarShell;
 function Workspace(){const auth=useAuth();window.fixtureSession=auth;
 if(new URLSearchParams(location.search).has('entry'))return <React.Suspense fallback={<p>Opening module</p>}><AdminEntry/></React.Suspense>;
 if(auth.loading)return <p>Checking session</p>;
 if(!auth.isAdmin)return <p>Signed out or denied</p>;
 return location.pathname.replace(/\\/$/,'')==='/enquiries'?<EnquiriesPage/>:location.search.includes('module=form-builder')?<FormBuilder/>:location.pathname==='/admin-login'?<AdminConsole email={auth.user.email}/>:<App/>;}
 createRoot(document.getElementById('root')).render(<AuthProvider><Workspace/></AuthProvider>);
 `},define:{__MWA_BUILD_ID__:'"synthetic"'},bundle:true,write:false,format:'iife',jsx:'automatic',plugins:[{name:'synthetic-navigation',setup(b){
  b.onResolve({filter:/^react(?:\/.*)?$/},args=>({path:path.resolve(root,'node_modules',args.path==='react'?'react/index.js':args.path+'.js')}));
  if(authSource)b.onLoad({filter:/contexts[\\/]AuthContext\.jsx$/},()=>({contents:authSource,loader:'jsx'}));
  b.onResolve({filter:/^@mwa\/access$/},()=>({path:path.resolve(root,'shared/module-access.js')}));
  b.onResolve({filter:/^@mwa\/appearance$/},()=>({path:path.resolve(root,'shared/appearance.js')}));
  b.onResolve({filter:/firebaseConfig(?:\.js)?$/},()=>({path:'config',namespace:'fixture'}));
  b.onResolve({filter:/firebase\/firebase(?:\.js)?$/},()=>({path:'firebase',namespace:'fixture'}));
  b.onResolve({filter:/^firebase\/auth$/},()=>({path:'auth-sdk',namespace:'fixture'}));
  b.onResolve({filter:/^firebase\/firestore$/},()=>({path:'store-sdk',namespace:'fixture'}));
  b.onResolve({filter:/\/services\/auditService(?:\.js)?$/},()=>({path:'audit',namespace:'fixture'}));
  b.onResolve({filter:/\/services\/adminTeamService(?:\.js)?$/},()=>({path:'team',namespace:'fixture'}));
  b.onResolve({filter:/\/services\/directoryService\.js$/},()=>({path:'directory',namespace:'fixture'}));
  b.onResolve({filter:/\/services\/eventsService\.js$/},()=>({path:'events',namespace:'fixture'}));
  b.onResolve({filter:/\/services\/calendarSettingsService\.js$/},()=>({path:'settings',namespace:'fixture'}));
  b.onResolve({filter:/\/pages\/(CalendarPage|BookingsPage|AdminPage|IslamicEventsPage)\.jsx$/},args=>({path:path.basename(args.path),namespace:'fixture'}));
  b.onResolve({filter:/\/components\/(HijriSettings|AuditLog|SharedDateCalendar)\.jsx$/},()=>({path:'empty-component',namespace:'fixture'}));
  b.onResolve({filter:/\/components\/(Header|BookingModal|BookingEmailAction)\.jsx$/},args=>({path:path.basename(args.path),namespace:'fixture'}));
  b.onResolve({filter:/\.png$/},()=>({path:'image',namespace:'fixture'}));
  b.onResolve({filter:/\/registration-client\.js$/},()=>({path:'registrations',namespace:'fixture'}));
  b.onResolve({filter:/^@calendar\/(.*)$/},args=>({path:path.resolve(root,'../Centralised Calendar/src',args.path.slice('@calendar/'.length))}));
  b.onLoad({filter:/\.css$/},args=>({contents:`const style=document.createElement('style');style.textContent=${JSON.stringify(readFileSync(args.path,'utf8'))};document.head.append(style);`,loader:'js'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},({path:p})=>{
   const fixtures={
    firebase:`export const auth=window.fixtureAuth={currentUser:null};export const db={};export const firebaseConfigured=true;`,
    'auth-sdk':`const callbacks=[];window.emitUser=u=>{if(u)u.getIdToken=async()=> 'synthetic-local-token';window.fixtureAuth.currentUser=u;callbacks.forEach(fn=>fn(u));};
 export const onAuthStateChanged=(_,fn)=>{callbacks.push(fn);queueMicrotask(()=>fn(window.fixtureAuth.currentUser));return()=>callbacks.splice(callbacks.indexOf(fn),1);};
 export const signOut=async()=>{window.signOutCalls++;window.reportSignOut?.();window.emitUser(null);};
 export class GoogleAuthProvider{};export const linkWithCredential=async()=>{};export const signInWithCredential=async()=>{};export const signInWithEmailAndPassword=async()=>{};export const signInWithPopup=async()=>{};export const signInWithRedirect=async()=>{};`,
    'store-sdk':`export const doc=(_,kind,id)=>kind+'/'+id;const watchers=new Map();
 window.emitDoc=(key,data)=>watchers.get(key)?.forEach(fn=>fn({exists:()=>!!data,data:()=>data}));
 export const onSnapshot=(key,fn)=>{if(!watchers.has(key))watchers.set(key,[]);watchers.get(key).push(fn);return()=>{const a=watchers.get(key);a.splice(a.indexOf(fn),1);};};`,
    audit:`export const recordActivity=async()=>{};`,
    team:`export const syncAdminAccess=()=>{window.syncCalls++;return new Promise(resolve=>window.syncReplies.push(resolve));};export const watchAdminTeam=fn=>{queueMicrotask(()=>fn([]));return()=>{};};export const addAdminEmail=async()=>{};export const removeAdminEmail=async()=>{};export const setAdminModules=async()=>{};`,
    directory:`export const watchVenues=()=>()=>{};export const watchDepartments=()=>()=>{};`,
    events:`export const fetchAdminEvents=async()=>{window.adminFetches++;return [];};export const fetchAllAdminBookings=async()=>[];export const fetchPublicEvents=async()=>{window.publicFetches++;return [];};`,
    settings:`export const watchHijriSettings=()=>()=>{};export const getHijriSettings=async()=>({overrides:[]});`,
    appearance:`export const defaults={};export const bookingToneIndex=()=>0;export const bookingTypeStyle=()=>({});`,
    image:`export default '';`,
    config:`export const ORG_TIMEZONE='Australia/Sydney';export const FUNCTIONS_REGION='australia-southeast1';export const firebaseConfig={};`,
    'CalendarPage.jsx':`import React,{useEffect}from'react';export default function Page({onPublicRangeChange}){useEffect(()=>onPublicRangeChange({from:'2026-01-01',to:'2027-01-01'}),[]);return <h2>Calendar screen</h2>;}`,
    'BookingsPage.jsx':`import React from'react';export default()=> <h2>Bookings screen</h2>;`,
    'AdminPage.jsx':`import React,{useState,useEffect}from'react';export default function Page({registerBack}){const[nested,setNested]=useState(false);useEffect(()=>{registerBack(nested?()=>setNested(false):null);return()=>registerBack(null);},[nested]);return <><h2>{nested?'Venue screen':'Approvals screen'}</h2><button onClick={()=>setNested(true)}>Venues</button></>;}`,
    'IslamicEventsPage.jsx':`export default()=>null;`,
    'ModulePages.jsx':`export const CalendarManagement=()=>null;export const ToolsAutomation=()=>null;`,
    'empty-component':`export default()=>null;`,
    'Header.jsx':`import React from'react';export default({setTab})=><nav>{['calendar','bookings','admin'].map(id=><button key={id} onClick={()=>setTab(id)}>{id}</button>)}</nav>;`,
    'BookingModal.jsx':`export default()=>null;`,
    'BookingEmailAction.jsx':`export default()=>null;`,
    registrations:`export const registrationApi=async()=>({items:[]});export const expiryLabel=()=>'';export const isFormOpen=()=>false;`
   };
   if(!(p in fixtures))throw Error('Unknown navigation fixture '+p);
   return {contents:fixtures[p],loader:'jsx',resolveDir:root};
  });
 }}]});
 return result.outputFiles.find(file=>file.path.endsWith('.js'))?.text||result.outputFiles[0].text;
}
