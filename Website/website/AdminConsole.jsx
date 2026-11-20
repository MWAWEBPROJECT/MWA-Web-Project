import {useAuth} from '@calendar/contexts/AuthContext.jsx';
import React from 'react';
import AdminBackButton from '@calendar/components/AdminBackButton.jsx';
import {CalendarDays,CalendarRange,UtensilsCrossed,HandHeart,Users,Workflow,Wrench,Receipt,HeartHandshake,Megaphone,MicVocal,PanelsTopLeft,ClipboardList,ArrowUpRight,Images} from 'lucide-react';

export const adminModules=[
 {id:'events-bookings',name:'Events & Bookings Hub',icon:CalendarDays,description:'Manage bookings, venues and event requests.',href:'/calendar/?view=admin'},
 {id:'enquiries',name:'Contact & Enquiries',icon:Megaphone,description:'Respond to community enquiries in a shared team inbox.',href:'/enquiries/'},
 {id:'calendar-management',name:'Calendar Management',icon:CalendarRange,description:'Manage shared dates and monthly Hijri settings.',href:'/calendar-management/'},
 {id:'niaz',name:'Niaz Administration',icon:UtensilsCrossed,description:'Coordinate Niaz arrangements and contributions.',href:'/admin-login?module=niaz'},
 {id:'volunteers',name:'Volunteer Administration',icon:HandHeart,description:'Organise volunteer teams and responsibilities.'},
 {id:'members',name:'Member Administration',icon:Users,description:'Manage membership and community records.'},
 {id:'tools-automation',name:'Tools & Automation',icon:Workflow,description:'Manage the admin team and review activity across modules.',href:'/tools-automation/'},
 {id:'maintenance',name:'Maintenance Administration',icon:Wrench,description:'Coordinate facility care and maintenance requests.'},
 {id:'treasurer',access:['expenses','donations'],name:"Treasurer's Dashboard",icon:Receipt,description:'Review donations and, when available, manage expenses.',href:'/admin-login?module=treasurer'},
 {id:'social-media',name:'Social Media Administration',icon:Megaphone,description:'Review channel status and connect MWA social accounts.',href:'/admin-login?module=social-media'},
 {id:'speakers-reciters',name:'Speakers & Reciters',icon:MicVocal,description:'Coordinate speakers, reciters and programme participation.'},
 {id:'website-cms',name:'Website CMS',icon:PanelsTopLeft,description:'Publish website content, branding and appearance.',href:'/cms'},
 {id:'gallery',name:'Media Hub',icon:Images,description:'Manage featured photos and community media.',href:'/admin-login?module=gallery'},
 {id:'form-builder',name:'Form Builder',icon:ClipboardList,description:'Build community forms, link calendar events and review responses.',href:'/admin-login?module=form-builder'},
 {id:'form-insights',name:'Form Insights',icon:ClipboardList,description:'Explore indexed registration counts and historical trends.',href:'/admin-login?module=form-insights'}
];

export default function AdminConsole({email}){
 const {canAccess,accessExpired,accessExpiryDate}=useAuth();
 return <section className="admin-console" aria-labelledby="admin-console-title">
  <AdminBackButton label="Back to Home"/>
  <div className="admin-console-intro"><div className="eyebrow">MWA · ADMINISTRATION</div><h1 id="admin-console-title">Welcome to Admin Console.</h1><p>Manage MWA’s services and website from one place.</p><span className="admin-console-account">Signed in as {email}</span></div>
  {accessExpired?<p role="status">Your admin module access has expired. Contact the Super Admin to renew it.</p>:accessExpiryDate&&<p>Access expires at the end of {accessExpiryDate} (Sydney time).</p>}
  <div className="admin-module-grid">{adminModules.map(({id,access,name,icon:Icon,description,href})=>{
   const allowed=(access||[id]).some(canAccess)||(id==='niaz'&&(canAccess('niaz-read')||canAccess('niaz-finance')));const live=!!href;
   if(!allowed)href=null;
   const Tag=href?'a':'article';
   return <Tag key={name} {...(href?{href}:{})} className={'admin-module'+(href?' is-live':' is-planned')}>
    <div className="admin-module-top"><span className="admin-module-icon"><Icon aria-hidden="true"/></span><span className="admin-module-status">{!allowed?'Access not assigned':live?'Live':'Coming soon'}</span></div>
    <h2>{name}{href&&<ArrowUpRight aria-hidden="true"/>}</h2><p>{description}</p>
   </Tag>;
   })}</div>{canAccess('form-insights-people')&&<p><a href="/admin-login?module=insights-people">Respondent review</a></p>}<p><a href="/admin-login?module=insights-detail">Scoped response-detail export</a> (requires a separate assignment)</p>
 </section>;
}
