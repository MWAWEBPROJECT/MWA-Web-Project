import React,{lazy,useEffect} from 'react';
import {useAuth} from '@calendar/contexts/AuthContext.jsx';
import AdminLoginCard from './AdminLoginCard.jsx';
import AdminBackButton from '@calendar/components/AdminBackButton.jsx';
import {adminReturnTarget} from './admin-entry-route.mjs';
const modules={
 donations:lazy(()=>import('./DonationsAdmin.jsx')),
 'form-builder':lazy(()=>import('./FormBuilder.jsx')),
 'form-insights':lazy(()=>import('./FormInsights.jsx')),
 'insights-detail':lazy(()=>import('./InsightsDetail.jsx')),
 'insights-people':lazy(()=>import('./InsightsPeople.jsx'))
};
const AdminConsole=lazy(()=>import('./AdminConsole.jsx'));
export default function AdminEntry(){
 const session=useAuth(),query=new URLSearchParams(location.search);
 const returnTo=adminReturnTarget(query.get('returnTo'));
 useEffect(()=>{window.mwaPageReady?.();},[]);
 useEffect(()=>{if(!session.loading&&session.isAdmin&&returnTo)location.replace(returnTo);},[session.loading,session.isAdmin,returnTo]);
 if(session.loading)return <div className="admin-welcome"><AdminBackButton/><p>Checking your admin session…</p></div>;
 if(session.isAdmin&&returnTo)return <div className="admin-welcome"><p>Opening your workspace…</p></div>;
 const Module=session.isResponseViewer?modules['form-builder']:modules[query.get('module')];
 if(session.isResponseViewer||session.isAdmin&&Module)return <Module/>;
 if(session.isAdmin)return <AdminConsole email={session.user?.email}/>;
 return <div className="mwa-admin-auth"><AdminBackButton/><div className="admin-auth-intro"><div className="eyebrow">ONE MWA · ONE ADMIN ACCOUNT</div><h1>Admin login.</h1><p>Use your existing MWA calendar admin account. After signing in, open the calendar workspace or manage website content.</p></div><AdminLoginCard {...session}/></div>;
}
