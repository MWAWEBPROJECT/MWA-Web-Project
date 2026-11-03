import {normaliseTextSize,applyTextSize} from '../shared/text-size.js';
import {mountCommunityCalendar} from './community-calendar.jsx';
import {recordActivity} from '@calendar/services/auditService.js';
import React,{useState,useEffect} from 'react';
import {createPortal} from 'react-dom';
import {createRoot} from 'react-dom/client';
import {onAuthStateChanged} from 'firebase/auth';
import {doc,onSnapshot} from 'firebase/firestore';
import {auth,db} from '@calendar/firebase/firebase.js';
import {AuthProvider,useAuth} from '@calendar/contexts/AuthContext.jsx';
import AdminLoginCard from './AdminLoginCard.jsx';
import AdminConsole from './AdminConsole.jsx';
import DonationsAdmin from './DonationsAdmin.jsx';
import EnquiriesPage from './EnquiriesPage.jsx';
import FormBuilder from './FormBuilder.jsx';
import Registrations,{RegistrationList} from './Registrations.jsx';
import './contact-form.js';
import {schemes,defaults,applyAppearance,normaliseSettings} from '../shared/appearance.js';
import './firebase-website.css';
import './website-polish.css';
import './website-polish.js';
import './solar-panel.js';
import {mountCalendarShell} from './calendar-shell.js';

window.MWA_SCHEMES=schemes;window.MWA_TEXT_SIZE={normalise:normaliseTextSize,apply:applyTextSize};
let siteSettings=defaults;applyAppearance(siteSettings);
let resolveAuth;const authReady=new Promise(resolve=>{resolveAuth=resolve});let initial=true;
let resolveAdminReady;const adminReady=new Promise(resolve=>{resolveAdminReady=resolve});
window.mwaAdminSession={loading:true,isAdmin:false,signedIn:false};
onAuthStateChanged(auth,()=>{if(initial){initial=false;resolveAuth()}});
window.mwaContentFetch=async(input,options={})=>{await authReady;await adminReady;const headers=new Headers(options.headers||{});if(auth.currentUser)headers.set('Authorization','Bearer '+await auth.currentUser.getIdToken());return fetch(input,{...options,headers})};
onSnapshot(doc(db,'calendarSettings','websiteAppearance'),snapshot=>{if(snapshot.exists()){siteSettings=normaliseSettings(snapshot.data());applyAppearance(siteSettings);window.dispatchEvent(new Event('mwa-site-settings-updated'))}},()=>{});
const refreshAppearance=()=>applyAppearance(siteSettings);
window.addEventListener('storage',refreshAppearance);window.addEventListener('mwa-appearance-preferences',refreshAppearance);matchMedia('(prefers-color-scheme: dark)').addEventListener('change',refreshAppearance);

function AdminLogin(){const session=useAuth();useEffect(()=>{window.mwaPageReady?.()},[]);const requestedReturn=new URLSearchParams(location.search).get('returnTo');const bookingReturn=/^\/calendar\/\?booking=[a-zA-Z0-9_-]{1,128}&decision=(approve|reject)$/.test(requestedReturn||'');const returnTo=bookingReturn||['/cms','/calendar-management/','/tools-automation/'].includes(requestedReturn)||/^\/enquiries\/(?:\?(?:thread=[a-f0-9]{32}|mailbox=setup))?$/.test(requestedReturn||'')?requestedReturn:null;const returnToCms=!!returnTo;useEffect(()=>{if(!session.loading&&session.isAdmin&&returnToCms)location.replace(returnTo)},[session.loading,session.isAdmin,returnTo]);if(!session.loading&&session.isAdmin&&returnToCms)return <div className="admin-welcome"><p>Opening your workspace…</p></div>;if(session.loading)return <div className="admin-welcome"><p>Checking your admin session…</p></div>;if(session.isAdmin&&new URLSearchParams(location.search).get('module')==='donations')return <DonationsAdmin/>;if(session.isAdmin&&new URLSearchParams(location.search).get('module')==='form-builder')return <FormBuilder/>;if(session.isAdmin)return <AdminConsole email={session.user?.email}/>;return <div className="mwa-admin-auth"><div className="admin-auth-intro"><div className="eyebrow">ONE MWA · ONE ADMIN ACCOUNT</div><h1>Admin login.</h1><p>Use your existing MWA calendar admin account. After signing in, open the calendar workspace or manage website content.</p></div><AdminLoginCard {...session}/></div>}
if(location.pathname.replace(/\/$/,'')==='/admin-login'){
 document.querySelector('#main').hidden=true;document.querySelector('.skip')?.setAttribute('href','#admin-main');document.querySelector('#admin-main').hidden=false;

}
if(location.pathname.replace(/\/$/,'')==='/enquiries'){document.querySelector('#main').hidden=true;document.querySelector('#enquiries-main').hidden=false;document.querySelector('.skip')?.setAttribute('href','#enquiries-main');}
const registrationsRoute=location.pathname.replace(/\/$/,'')==='/registrations';
if(registrationsRoute){
 document.querySelector('#main').hidden=true;
 const main=document.createElement('main');main.id='registrations-main';document.querySelector('#main').after(main);
 document.querySelector('.skip')?.setAttribute('href','#registrations-main');
}
if(location.pathname.replace(/\/$/,'')==='/member-login')window.MWA_BRIDGE_READY.then(()=>{document.querySelector('[data-action="login"]').click()});

function WebsiteSession(){
 const session=useAuth();
 useEffect(()=>{if(session.isAdmin && !['/calendar/','/calendar-management/','/tools-automation/','/islamic-events/'].includes(location.pathname))recordActivity(['donations','form-builder'].includes(new URLSearchParams(location.search).get('module'))?new URLSearchParams(location.search).get('module'):location.pathname==='/cms'?'website-cms':'website','module.opened',location.pathname);},[session.isAdmin]);
 const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 useEffect(()=>{window.mwaAdminSession={loading:session.loading,isAdmin:session.isAdmin,signedIn:!!session.user,modules:session.modules};if(session.loading)return;resolveAdminReady();window.MWA_BRIDGE_RESOLVE();window.dispatchEvent(new Event('mwa-auth-changed'))},[session.loading,session.isAdmin,session.user?.uid,session.modules.join(',')]);
 async function signOut(){setBusy(true);setError('');const frame=document.querySelector('#mwa-calendar-frame');if(frame)frame.remove();window.mwaAdminSession={loading:false,isAdmin:false,signedIn:false,modules:[]};window.dispatchEvent(new Event('mwa-auth-changed'));try{await session.logout()}catch{setError('Could not sign out. Please try again.')}finally{setBusy(false)}}
 return <>{session.isAdmin?<button className="btn alt small admin-header" type="button" disabled={busy} aria-busy={busy} onClick={signOut}>Admin Sign out</button>:<a className="btn alt small admin-header" href="/admin-login">Admin Login</a>}{session.isAdmin&&createPortal(<><a className="nav-admin-console" href="/admin-login" aria-current={location.pathname==='/admin-login'?'page':undefined}>Admin Console</a></>,document.querySelector('#nav'))}{error&&<span role="alert" className="admin-header-error">{error}</span>}{location.pathname.replace(/\/$/,'')==='/admin-login'&&createPortal(<AdminLogin/>,document.querySelector('#admin-root'))}{location.pathname.replace(/\/$/,'')==='/enquiries'&&createPortal(<EnquiriesPage/>,document.querySelector('#enquiries-root'))}{registrationsRoute&&createPortal(<Registrations/>,document.querySelector('#registrations-main'))}{location.pathname==='/'&&createPortal(<RegistrationList panel/>,document.querySelector('#registrations-panel-root'))}</>;
}
const adminHeader=document.querySelector('.admin-header');
const sessionRoot=document.createElement('span');sessionRoot.className='admin-header-slot';
adminHeader.replaceWith(sessionRoot);
createRoot(sessionRoot).render(<AuthProvider><WebsiteSession/></AuthProvider>);
mountCalendarShell();

mountCommunityCalendar();

window.addEventListener('mwa-appearance-preferences',()=>{if(window.mwaAdminSession?.isAdmin)recordActivity('website','appearance.changed',document.documentElement.dataset.palette+' / '+document.documentElement.dataset.mode);});

// One server-managed visibility list applies to all visitors and survives refreshes.
let hiddenSocialIds=new Set();
async function applySocialVisibility(){for(const link of document.querySelectorAll('.social-update[data-cms-link]')){try{const url=new URL(link.href);for(const key of [...url.searchParams.keys()])if(/^utm_/i.test(key)||['fbclid','igsh','igshid','si','_r','_t'].includes(key))url.searchParams.delete(key);url.searchParams.sort();url.hash='';url.pathname=url.pathname.replace(/\/$/,'');const bytes=new TextEncoder().encode(url.href.replace(/\/$/,''));const key=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');link.hidden=hiddenSocialIds.has(key);}catch{link.hidden=false;}}}
onSnapshot(doc(db,'calendarSettings','socialModeration'),snapshot=>{hiddenSocialIds=new Set(snapshot.exists()?snapshot.data().hiddenPostIds||[]:[]);applySocialVisibility()},()=>{});
window.addEventListener('mwa-content-rendered',applySocialVisibility);
