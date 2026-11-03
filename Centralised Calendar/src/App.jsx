import BookingEmailAction from './components/BookingEmailAction.jsx';
import {CalendarManagement,ToolsAutomation} from './pages/ModulePages.jsx';
import {recordActivity} from './services/auditService.js';
import { useEffect, useState } from 'react';
import { useAuth } from './contexts/AuthContext.jsx';
import { firebaseConfigured } from './firebase/firebase.js';
import { watchVenues, watchDepartments } from './services/directoryService.js';
import { watchAllEvents, fetchPublicEvents } from './services/eventsService.js';
import { getHijriSettings,watchHijriSettings } from './services/calendarSettingsService.js';
import { dateKeyInOrgTz } from './utils/dateUtils.js';
import Header from './components/Header.jsx';
import CalendarPage from './pages/CalendarPage.jsx';
import BookingsPage from './pages/BookingsPage.jsx';
import AdminPage from './pages/AdminPage.jsx';
import BookingModal from './components/BookingModal.jsx';
import IslamicEventsPage from './pages/IslamicEventsPage.jsx';

export default function App() {
  const {canAccess}=useAuth();
  const isAdmin=canAccess('events-bookings');
  const entryView=new URLSearchParams(window.location.search).get('view');
  const moduleView=['calendar-management','tools'].includes(entryView);
  const [tab, setTab] = useState(()=>['calendar-management','tools','islamic-events'].includes(entryView)?entryView:'calendar');
  const [venues, setVenues] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [events, setEvents] = useState([]);
  const [hijriOverrides, setHijriOverrides] = useState([]);
  const [publicLoadTick, setPublicLoadTick] = useState(0);
  const [newBooking, setNewBooking] = useState(null); // { date } when the header's New booking dialog is open

  // Presentation entry point from the website. Guests still open the public calendar.
  useEffect(() => {
    const view=new URLSearchParams(window.location.search).get('view');
    if(view==='islamic-events')setTab('islamic-events');
    else if(isAdmin && view==='admin')setTab('admin');
    else if(!isAdmin)setTab(current=>current==='admin'?'calendar':current);
  }, [isAdmin]);

  useEffect(() => {
    if (!firebaseConfigured) return undefined;
    const unsubV = watchVenues(setVenues);
    const unsubD = watchDepartments(setDepartments);
    return () => { unsubV(); unsubD(); };
  }, []);

  useEffect(() => {
    if (!firebaseConfigured) return;
    return watchHijriSettings(s => setHijriOverrides(s.overrides || []),()=>{});
  }, []);

  // Admin: realtime full collection. Public: fetch sanitized events via a
  // Cloud Function (no direct Firestore access) and refetch on demand.
  useEffect(() => {
    if (!firebaseConfigured) return undefined;
    if (moduleView) return undefined;
    if (isAdmin) {
      return watchAllEvents(setEvents, () => setEvents([]));
    }
    let cancelled = false;
    fetchPublicEvents().then(list => { if (!cancelled) setEvents(list); }).catch(() => setEvents([]));
    return () => { cancelled = true; };
  }, [isAdmin, publicLoadTick,moduleView]);

  useEffect(()=>{if(isAdmin)recordActivity(tab==='tools'?'tools-automation':tab==='calendar-management'?'calendar-management':tab==='islamic-events'?'islamic-events':'events-bookings','module.opened',tab);},[tab,isAdmin]);

  useEffect(()=>{if(!isAdmin){setEvents([]);setNewBooking(null);setTab(current=>current==='admin'?'calendar':current)}},[isAdmin]);
  const reloadPublic = () => setPublicLoadTick(t => t + 1);

  if (!firebaseConfigured) {
    return (
      <div style={{ maxWidth: 640, margin: '60px auto', padding: 20 }}>
        <h1>MWA Central Calendar</h1>
        <p>
          Firebase is not configured yet. Copy <code>.env.example</code> to <code>.env</code>,
          fill in your Firebase project's web app credentials, and restart the dev server.
          See <code>docs/SETUP.md</code> for the full checklist.
        </p>
      </div>
    );
  }

  return (
    <div className="calendar-app">
      <div className="app-container">
        <Header tab={tab} setTab={setTab} onNewBooking={() => setNewBooking({ date: null })} />
        <main><BookingEmailAction/>
          {tab === 'calendar-management' && <CalendarManagement hijriOverrides={hijriOverrides} onReloadSettings={()=>getHijriSettings().then(s=>setHijriOverrides(s.overrides||[]))}/>}
          {tab === 'tools' && <ToolsAutomation/>}
          {tab === 'islamic-events' && <IslamicEventsPage hijriOverrides={hijriOverrides} departments={departments} venues={venues} />}
          {tab === 'calendar' && (
            <CalendarPage events={events} venues={venues} departments={departments}
              isAdmin={isAdmin} hijriOverrides={hijriOverrides} onSaved={reloadPublic} />
          )}
          {tab === 'bookings' && (
            <div className="page-panel glass-panel">
              <BookingsPage events={events} venues={venues} departments={departments}
                isAdmin={isAdmin} hijriOverrides={hijriOverrides} onSaved={reloadPublic} />
            </div>
          )}
          {tab === 'admin' && (
            <div className="page-panel glass-panel">
              <AdminPage events={events} venues={venues} departments={departments}
                hijriOverrides={hijriOverrides} onSaved={reloadPublic}
                onReloadSettings={() => getHijriSettings().then(s => setHijriOverrides(s.overrides || []))} />
            </div>
          )}
        </main>
        <footer className="app-footer">
          <span>MWA Central Calendar</span>
          <span>Australia/Sydney <span className="footer-dot">·</span> {isAdmin ? 'Admin view' : 'Public calendar'}</span>
        </footer>
      </div>
      {newBooking && (
        <BookingModal open={true} onClose={() => setNewBooking(null)} venues={venues} departments={departments}
          editing={null} initialDate={newBooking.date || dateKeyInOrgTz(new Date().toISOString())} isAdmin={isAdmin}
          hijriOverrides={hijriOverrides} onSaved={reloadPublic} />
      )}
    </div>
  );
}
