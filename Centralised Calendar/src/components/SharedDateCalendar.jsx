import NiazPublicSponsors from './NiazPublicSponsors.jsx';
import './shared-calendar.css';
import {useEffect,useMemo,useState} from 'react';
import {ChevronLeft,ChevronRight,CalendarDays} from 'lucide-react';
import {buildGregorianMonthGrid,buildHijriMonthGrid,gregorianCursorToHijri,hijriCursorToGregorian,shiftGregorianCursor,shiftHijriCursor,DOW} from '../utils/hijriCalendarGrid.js';
import {getHijriParts,HIJRI_MONTHS} from '../services/hijriService.js';
import {dateKeyInOrgTz,timeKeyInOrgTz} from '../utils/dateUtils.js';
import {publicProgrammes} from '../utils/communityCalendar.js';

export default function SharedDateCalendar({overrides=[],events=[],reference=false,loading=false,error='',onRangeChange}) {
  const today=dateKeyInOrgTz(new Date().toISOString());
  const current=()=>{const [year,month]=dateKeyInOrgTz(new Date().toISOString()).split('-').map(Number);return {year,month:month-1};};
  const [basis,setBasis]=useState('gregorian');
  const [g,setG]=useState(current);
  const [h,setH]=useState(()=>gregorianCursorToHijri(g.year,g.month,overrides));
  const [selected,setSelected]=useState(null);
  const grid=useMemo(()=>basis==='gregorian'?buildGregorianMonthGrid(g.year,g.month,overrides):buildHijriMonthGrid(h.hYear,h.hMonth,overrides),[basis,g,h,overrides]);
  const firstKey=grid.cells[0]?.key,lastKey=grid.cells.at(-1)?.key;
  useEffect(()=>{if(onRangeChange&&firstKey&&lastKey)onRangeChange({from:firstKey+'T00:00:00+11:00',to:lastKey+'T23:59:59+10:00'});},[firstKey,lastKey,onRangeChange]);
  const programmes=useMemo(()=>reference?[]:publicProgrammes(events),[reference,events]);
  const inMonth=new Set(grid.cells.filter(c=>c.inMonth).map(c=>c.key));
  const shown=programmes.filter(e=>selected?dateKeyInOrgTz(e.startAt)===selected:inMonth.has(dateKeyInOrgTz(e.startAt)));
  function goToday(){const cursor=current();const currentHijri=getHijriParts(dateKeyInOrgTz(new Date().toISOString()),overrides);setG(cursor);setH({hYear:currentHijri.year,hMonth:currentHijri.month});setSelected(null);}
  useEffect(()=>{window.addEventListener('mwa-calendar-today',goToday);return()=>window.removeEventListener('mwa-calendar-today',goToday);},[overrides]);
  function toggle(next){if(next===basis)return;if(next==='hijri'){const anchor=selected||(Number(today.slice(0,4))===g.year&&Number(today.slice(5,7))===g.month+1?today:`${g.year}-${String(g.month+1).padStart(2,'0')}-01`);const date=getHijriParts(anchor,overrides);setH({hYear:date.year,hMonth:date.month});}else if(selected){const [year,month]=selected.split('-').map(Number);setG({year,month:month-1});}else setG(hijriCursorToGregorian(h.hYear,h.hMonth,overrides));setBasis(next);setSelected(null);}
  function shift(n){basis==='gregorian'?setG(c=>shiftGregorianCursor(c,n)):setH(c=>shiftHijriCursor(c,n));setSelected(null);}
  const hText=key=>{const p=getHijriParts(key,overrides);return p.year?`${p.day} ${HIJRI_MONTHS.find(m=>m.value===p.month)?.name || ''} ${p.year} AH`:'';};
  const dateLabel=key=>new Intl.DateTimeFormat('en-AU',{dateStyle:'medium',timeZone:'Australia/Sydney'}).format(new Date(key+'T12:00:00+11:00'));
  return <div className={'shared-calendar-layout'+(reference?' is-reference':'')}>
    <section className="calendar-main shared-date-calendar" aria-label={reference?'Reference calendar':'MWA Programs calendar'}>
      <div className="calendar-toolbar"><div className="month-controls"><button className="lb lb-outline lb-icon" aria-label="Previous month" onClick={()=>shift(-1)}><ChevronLeft/></button><h2 className="month-title">{grid.label}</h2><button className="lb lb-outline lb-icon" aria-label="Next month" onClick={()=>shift(1)}><ChevronRight/></button><button className="lb lb-ghost lb-sm" onClick={goToday}>Today</button></div>
      <div className="segmented" role="group" aria-label="Calendar system">{['gregorian','hijri'].map(value=><button key={value} type="button" aria-pressed={basis===value} onClick={()=>toggle(value)}>{value==='hijri'?'Hijri':'Gregorian'}</button>)}</div></div>
      <p className="muted shared-calendar-note">{reference?'Shared dates for every MWA module. Select a day to see both dates.':'Confirmed MWA Programs · Select a day to view its programmes.'}</p>
      <div className="calendar-weekdays">{DOW.map(day=><span key={day}>{day}</span>)}</div>
      <div className="calendar-grid">{grid.cells.map(cell=>{const dayEvents=programmes.filter(e=>dateKeyInOrgTz(e.startAt)===cell.key);return <button key={cell.key} type="button" className={'calendar-date'+(!cell.inMonth?' outside':'')+(cell.key===today?' today':'')+(selected===cell.key?' selected':'')} aria-pressed={selected===cell.key} aria-label={`${dateLabel(cell.key)} · ${hText(cell.key)}${dayEvents.length?' · '+dayEvents.length+' programmes':''}`} onClick={()=>setSelected(key=>key===cell.key?null:cell.key)}>
        <span className="date-number">{basis==='hijri'?cell.hijri.day:cell.date.getDate()}</span><span className="hijri-date">{basis==='hijri'?cell.date.toLocaleDateString('en-AU',{day:'numeric',month:'short'}):`${cell.hijri.day} ${({1:'Muh',2:'Saf',3:'Rab I',4:'Rab II',5:'Jum I',6:'Jum II',7:'Raj',8:'Sha',9:'Ram',10:'Shaw',11:'DhQ',12:'DhH'})[cell.hijri.month]||''}`}</span>
        {cell.key===today&&<span className="today-label">Today</span>}{dayEvents.length>0&&<span className="programme-dot" aria-hidden="true"/>}
      </button>;})}</div>
      <p className="shared-date-selection">{selected?`${dateLabel(selected)} · ${hText(selected)}`:`Dates follow MWA’s monthly moon-sighting settings.`}</p>
      {selected&&<button className="lb lb-outline lb-sm" onClick={()=>setSelected(null)}>Clear date selection</button>}
    </section>
    {!reference&&<aside className="shared-programmes" aria-label="Confirmed MWA programmes"><div className="section-eyebrow"><CalendarDays size={16}/> MWA Programs</div><h3>{selected?dateLabel(selected):'This month’s gatherings'}</h3><p className="muted">{loading?'Loading the shared calendar…':error||`${shown.length} confirmed programme${shown.length===1?'':'s'}`}</p><div className="shared-programme-list">{shown.map(event=><article className="shared-programme" key={event.id}><small>{dateLabel(dateKeyInOrgTz(event.startAt))} · {timeKeyInOrgTz(event.startAt)}</small><h4>{event.title}</h4><p>{hText(dateKeyInOrgTz(event.startAt))}</p><p>{event.venueName || 'MWA Centre'}</p>{event.programDetails&&<p>{event.programDetails}</p>}<NiazPublicSponsors compact eventId={event.id} startAt={event.startAt}/></article>)}{!loading&&!error&&!shown.length&&<p className="muted">No confirmed MWA programmes for this selection.</p>}</div><a href="/calendar/" className="text-link">Open Events & Bookings ↗</a></aside>}
  </div>;
}
