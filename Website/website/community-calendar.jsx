import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import SharedDateCalendar from '@calendar/components/SharedDateCalendar.jsx';
import {watchHijriSettings} from '@calendar/services/calendarSettingsService.js';
import {getTodayHijriParts,HIJRI_MONTHS} from '@calendar/services/hijriService.js';
import {fetchPublicEvents} from '@calendar/services/eventsService.js';
import {dateKeyInOrgTz,timeKeyInOrgTz} from '@calendar/utils/dateUtils.js';
import {publicProgrammes} from '@calendar/utils/communityCalendar.js';

function CommunityCalendar(){
 const [range,setRange]=useState(null),[todayEvents,setTodayEvents]=useState([]),[todayError,setTodayError]=useState(''),[todayLoading,setTodayLoading]=useState(true);
 useEffect(()=>{let active=true;async function load(){try{const today=dateKeyInOrgTz(new Date().toISOString());const list=await fetchPublicEvents({from:today+'T00:00:00+11:00',to:today+'T23:59:59+10:00'});if(active){setTodayEvents(publicProgrammes(list));setTodayError('');}}catch{if(active)setTodayError('Today’s programmes could not be refreshed.');}finally{if(active)setTodayLoading(false);}}load();const timer=setInterval(load,60000);return()=>{active=false;clearInterval(timer);};},[]);
 const [overrides,setOverrides]=useState([]),[events,setEvents]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
 useEffect(()=>watchHijriSettings(settings=>{setOverrides(settings.overrides);},()=>setError('Shared date settings could not be refreshed.')),[]);
 useEffect(()=>{let active=true;let pending=false;async function load(){if(pending)return;pending=true;try{const list=await fetchPublicEvents(range||{});if(active){setEvents(publicProgrammes(list));setLoading(false);setError('');}}catch{if(active){setError('Programmes could not be loaded. Open the live calendar or try again shortly.');setLoading(false);}}finally{pending=false;}}load();const timer=setInterval(load,60000);window.addEventListener('focus',load);return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',load);};},[range]);
 useEffect(()=>{
  function update(){const h=getTodayHijriParts(overrides);const label=document.querySelector('#hijri-today');if(label)label.textContent=h.year?`${h.day} ${HIJRI_MONTHS.find(m=>m.value===h.month)?.name} ${h.year} AH · MWA calendar`:'Shared Hijri calendar unavailable';
   const list=document.querySelector('#programme-today-list');if(list){list.replaceChildren();const today=dateKeyInOrgTz(new Date().toISOString());const matches=todayEvents.filter(e=>dateKeyInOrgTz(e.startAt)===today);for(const event of matches){const block=document.createElement('div'),heading=document.createElement('strong'),caption=document.createElement('small');heading.textContent=event.title;caption.textContent=timeKeyInOrgTz(event.startAt)+' · '+(event.venueName||'MWA Centre');block.append(heading,caption);list.append(block);}if(!matches.length){const message=document.createElement('p');message.textContent=todayLoading?'Loading today’s programmes…':todayError||'No confirmed MWA programmes listed for today.';list.append(message);}}
   const intro=document.querySelector('#events [data-cms="copy_8"]');if(intro&&/illustrative|sample/i.test(intro.textContent))intro.textContent='Find a gathering and make time for community. Confirmed MWA programmes from our shared calendar.';
  }
  window.mwaRefreshSharedDates=update;update();window.addEventListener('mwa-content-rendered',update);const timer=setInterval(update,60000);return()=>{clearInterval(timer);window.removeEventListener('mwa-content-rendered',update);delete window.mwaRefreshSharedDates;};
 },[overrides,todayEvents,todayLoading,todayError]);
 return <SharedDateCalendar onRangeChange={setRange} overrides={overrides} events={events} loading={loading} error={error}/>;
}
export function mountCommunityCalendar(){if(location.pathname!=='/')return;const root=document.querySelector('#community-calendar-root');if(root)createRoot(root).render(<CommunityCalendar/>);}
