import './YouTubePanel.jsx';
import {normaliseTextSize,applyTextSize} from '../shared/text-size.js';
import {recordActivity} from '@calendar/services/auditService.js';
import React,{lazy,Suspense,useState,useEffect} from 'react';
import {createPortal} from 'react-dom';
import {createRoot} from 'react-dom/client';
import {onAuthStateChanged} from 'firebase/auth';
import {doc,onSnapshot} from 'firebase/firestore';
import {auth,db} from '@calendar/firebase/firebase.js';
import {AuthProvider,useAuth} from '@calendar/contexts/AuthContext.jsx';
import AdminLogin from './AdminEntry.jsx';
const EnquiriesPage=lazy(()=>import('./EnquiriesPage.jsx'));
const Registrations=lazy(()=>import('./Registrations.jsx'));
const NiazEOI=lazy(()=>import('./NiazEOI.jsx'));
const RegistrationList=lazy(()=>import('./Registrations.jsx').then(module=>({default:module.RegistrationList})));
import './contact-form.js';
import {schemes,defaults,applyAppearance,normaliseSettings} from '../shared/appearance.js';
import './firebase-website.css';
import './website-polish.css';
import './website-polish.js';
import './solar-panel.js';
import {mountCalendarShell} from './calendar-shell.js';
import AdminBackButton from '@calendar/components/AdminBackButton.jsx';
import {goAdminBack,recordAdminPage} from '@calendar/utils/adminNavigation.mjs';
import WorkspaceBoundary from '@calendar/components/WorkspaceBoundary.jsx';

recordAdminPage();
const cmsHeading=document.querySelector('#cms-dialog .cms-heading');
const cmsBackRoot=document.createElement('div');
if(cmsHeading){cmsHeading.prepend(cmsBackRoot);document.querySelector('#cms-close').hidden=true;}
const cmsGateRoot=document.createElement('div');
if(location.pathname.replace(/\/$/,'')==='/cms'){
 document.querySelector('#modal')?.prepend(cmsGateRoot);
 const close=document.querySelector('#close-modal');if(close)close.hidden=true;
 const body=document.querySelector('#modal-body');
 if(body)new MutationObserver(()=>{for(const link of body.querySelectorAll('a[href="/admin-login"]'))if(link.textContent.trim()==='Admin Console')link.remove();}).observe(body,{childList:true,subtree:true});
}
function cmsBack(){
 const publish=document.querySelector('#cms-publish');
 if(publish&&!publish.disabled&&!confirm('Leave the editor? Unpublished changes will be lost.'))return;
 document.querySelector('#cms-close')?.click();
 if(location.pathname.replace(/\/$/,'')==='/cms')goAdminBack();
}

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

if(location.pathname.replace(/\/$/,'')==='/admin-login'){
 document.querySelector('#main').hidden=true;document.querySelector('.skip')?.setAttribute('href','#admin-main');document.querySelector('#admin-main').hidden=false;

}
if(location.pathname.replace(/\/$/,'')==='/enquiries'){document.querySelector('#main').hidden=true;document.querySelector('#enquiries-main').hidden=false;document.querySelector('.skip')?.setAttribute('href','#enquiries-main');}
const niazRoute=location.pathname.replace(/\/$/,'')==='/niaz';
const registrationsRoute=location.pathname.replace(/\/$/,'')==='/registrations';
if(registrationsRoute){
 document.querySelector('#main').hidden=true;
 const main=document.createElement('main');main.id='registrations-main';document.querySelector('#main').after(main);
 document.querySelector('.skip')?.setAttribute('href','#registrations-main');
}
if(niazRoute){
 document.querySelector('#main').hidden=true;
 const main=document.createElement('main');main.id='niaz-main';document.querySelector('#main').after(main);
 document.querySelector('.skip')?.setAttribute('href','#niaz-main');
}
if(location.pathname.replace(/\/$/,'')==='/member-login')window.MWA_BRIDGE_READY.then(()=>{document.querySelector('[data-action="login"]').click()});

function WebsiteSession(){
 const session=useAuth();
 useEffect(()=>{if(session.isAdmin && !['/calendar/','/calendar-management/','/tools-automation/','/islamic-events/'].includes(location.pathname))recordActivity(['donations','form-builder'].includes(new URLSearchParams(location.search).get('module'))?new URLSearchParams(location.search).get('module'):location.pathname==='/cms'?'website-cms':'website','module.opened',location.pathname);},[session.isAdmin]);
 const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 useEffect(()=>{window.mwaAdminSession={loading:session.loading,isAdmin:session.isAdmin,signedIn:!!session.user,modules:session.modules};if(session.loading)return;resolveAdminReady();window.MWA_BRIDGE_RESOLVE();window.dispatchEvent(new Event('mwa-auth-changed'))},[session.loading,session.isAdmin,session.user?.uid,session.modules.join(',')]);
 async function signOut(){setBusy(true);setError('');const frame=document.querySelector('#mwa-calendar-frame');if(frame)frame.remove();window.mwaAdminSession={loading:false,isAdmin:false,signedIn:false,modules:[]};window.dispatchEvent(new Event('mwa-auth-changed'));try{await session.logout()}catch{setError('Could not sign out. Please try again.')}finally{setBusy(false)}}
 return <>{session.isAdmin?<button className="btn alt small admin-header" type="button" disabled={busy} aria-busy={busy} onClick={signOut}>Admin Sign out</button>:<a className="btn alt small admin-header" href="/admin-login">Admin Login</a>}{session.isAdmin&&createPortal(<><a className="nav-admin-console" href="/admin-login" aria-current={location.pathname==='/admin-login'?'page':undefined}>Admin Console</a></>,document.querySelector('#nav'))}{cmsHeading&&createPortal(<AdminBackButton onBack={cmsBack}/>,cmsBackRoot)}{cmsGateRoot.isConnected&&createPortal(<AdminBackButton onBack={()=>{document.querySelector('#close-modal')?.click();goAdminBack();}}/>,cmsGateRoot)}{error&&<span role="alert" className="admin-header-error">{error}</span>}{location.pathname.replace(/\/$/,'')==='/admin-login'&&createPortal(<AdminLogin/>,document.querySelector('#admin-root'))}{location.pathname.replace(/\/$/,'')==='/enquiries'&&createPortal(<EnquiriesPage/>,document.querySelector('#enquiries-root'))}{registrationsRoute&&createPortal(<Registrations/>,document.querySelector('#registrations-main'))}{location.pathname==='/'&&createPortal(<RegistrationList panel/>,document.querySelector('#registrations-panel-root'))}</>;
}
const adminHeader=document.querySelector('.admin-header');
const sessionRoot=document.createElement('span');sessionRoot.className='admin-header-slot';
adminHeader.replaceWith(sessionRoot);
createRoot(sessionRoot).render(<AuthProvider><WorkspaceBoundary><Suspense fallback={<p role="status">Opening your workspace…</p>}><WebsiteSession/>{niazRoute&&createPortal(<NiazEOI/>,document.querySelector('#niaz-main'))}</Suspense></WorkspaceBoundary></AuthProvider>);
mountCalendarShell();

if(location.pathname==='/')import('./community-calendar.jsx').then(module=>module.mountCommunityCalendar()).catch(error=>console.error('Community calendar could not open.',error));

window.addEventListener('mwa-appearance-preferences',()=>{if(window.mwaAdminSession?.isAdmin)recordActivity('website','appearance.changed',document.documentElement.dataset.palette+' / '+document.documentElement.dataset.mode);});

// One server-managed visibility list applies to all visitors and survives refreshes.
