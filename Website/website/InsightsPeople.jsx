import React,{useMemo,useState} from 'react';
import {useAuth} from '@calendar/contexts/AuthContext.jsx';
import {auth} from '@calendar/firebase/firebase.js';
import InsightsRespondents from './InsightsRespondents.jsx';
import InsightsProgrammeFilters,{emptyProgrammeFilters} from './InsightsProgrammeFilters.jsx';
import AdminBackButton from '@calendar/components/AdminBackButton.jsx';

export default function InsightsPeople(){
 const session=useAuth();
 const [programmeFilters,setProgrammeFilters]=useState(emptyProgrammeFilters);
 const [formId,setFormId]=useState(''),[eventId,setEventId]=useState(''),responseScope=useMemo(()=>({formId,eventId}),[formId,eventId]);
 async function api(path,options){
  const user=auth.currentUser;if(!user)throw Error('Sign in again.');
  const response=await fetch('/api/form-insights'+path,{...options,headers:{'Content-Type':'application/json',Authorization:'Bearer '+await user.getIdToken()},cache:'no-store'});
  const data=await response.json();if(auth.currentUser!==user)throw Error('Session changed.');
  if(!response.ok)throw Error(data.error||'Respondent review failed.');return data;
 }
 if(session.loading)return <p>Checking respondent review access…</p>;
 if(!session.isAdmin||!session.canAccess('form-insights-people'))return <section><AdminBackButton/><p>Form Insights people access is not assigned.</p></section>;
 return <section className="admin-console form-builder"><AdminBackButton/><h1>Respondent review</h1><InsightsProgrammeFilters api={api} value={programmeFilters} onChange={setProgrammeFilters}/><p>Form and saved-event references narrow lookup, cohorts and timeline. Comparisons use the form reference and their own event selections; event inventory is not filtered by form.</p><label>Respondent form reference (optional)<input value={formId} maxLength="128" onChange={event=>setFormId(event.target.value)}/></label><label>Respondent saved-event reference (optional)<input value={eventId} maxLength="128" onChange={event=>setEventId(event.target.value)}/></label><InsightsRespondents key={session.user?.uid} api={api} programmeFilters={programmeFilters} responseScope={responseScope} canExport={session.canAccess('form-insights-export')}/></section>;
}
