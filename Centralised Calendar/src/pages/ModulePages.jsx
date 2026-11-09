import {useCallback,useState} from 'react';
import {Users,Eye,ScrollText,CalendarRange,MoonStar} from 'lucide-react';
import AdminBackButton from '../components/AdminBackButton.jsx';
import {useAuth} from '../contexts/AuthContext.jsx';
import TeamTab from '../components/AdminTeam.jsx';
import HijriTab from '../components/HijriSettings.jsx';
import AuditLog from '../components/AuditLog.jsx';
import SharedDateCalendar from '../components/SharedDateCalendar.jsx';

export function ModuleGate({name,moduleId,children}) {
  const {isAdmin,loading,syncing,canAccess}=useAuth();
  if(loading||syncing)return <section className="module-intro"><p>Checking your admin session…</p></section>;
  if(!isAdmin)return <section className="module-intro"><AdminBackButton/><h1>{name}</h1><p>Sign in with your MWA admin account to open this module.</p><a className="lb lb-default" href={'/admin-login?returnTo='+encodeURIComponent(location.pathname.includes('calendar-app')?(name==='Calendar Management'?'/calendar-management/':'/tools-automation/'):location.pathname)} target="_top">Admin Login</a></section>;
  if(!canAccess(moduleId))return <section className="module-intro"><AdminBackButton/><h1>{name}</h1><p>Access to this module is not assigned or has expired. Contact the MWA Super Admin.</p></section>;
  return children;
}
function Intro({Icon,name,children}) {return <div className="module-intro"><div className="section-eyebrow"><Icon size={18}/> MWA Administration</div><div className="module-title-line"><h1>{name}</h1></div><p>{children}</p></div>;}
export function CalendarManagement({hijriOverrides,onReloadSettings}) {
  const {user}=useAuth();
  return <ModuleGate name="Calendar Management" moduleId="calendar-management"><AdminBackButton/><Intro Icon={CalendarRange} name="Calendar Management">One shared calendar and one source for Hijri dates across MWA.</Intro><SharedDateCalendar reference overrides={hijriOverrides}/><section className="page-panel glass-panel hijri-settings-section"><h2><MoonStar size={22}/> Monthly Hijri settings</h2><HijriTab adjustedBy={user?.email} hijriOverrides={hijriOverrides} onReloadSettings={onReloadSettings}/></section></ModuleGate>;
}
export function ToolsAutomation() {
  const {user,profile,isOwner}=useAuth();const [tab,setTab]=useState('audit'),[teamNavigation,setTeamNavigation]=useState(null);
  const registerBack=useCallback(value=>setTeamNavigation(value),[]);
  return <ModuleGate name="Tools & Automation" moduleId="tools-automation"><AdminBackButton disabled={tab==='team'&&teamNavigation?.busy} onBack={tab==='team'?()=>{if(teamNavigation)teamNavigation.back();else setTab('audit');}:undefined}/><Intro Icon={ScrollText} name="Tools & Automation">Manage the admin team and review activity across MWA’s live modules.</Intro><section className="page-panel glass-panel"><div className="bar admin-menu" role="group" aria-label="Tools sections">{[['audit','Audit log',ScrollText],['team','Admin team',Users]].map(([id,label,Icon])=><button key={id} className={'tab '+(tab===id?'on':'')} aria-pressed={tab===id} onClick={()=>setTab(id)}><Icon size={16}/>{label}</button>)}</div>{tab==='team'?<TeamTab registerBack={registerBack} currentEmail={(user?.email||profile?.email||'').toLowerCase()} canManage={isOwner}/>:<AuditLog/>}</section></ModuleGate>;
}
