import {useEffect,useState} from 'react';
import {getHijriSettings,saveMonthOverride,removeMonthOverride} from '../services/calendarSettingsService.js';
import {HIJRI_MONTHS,getTodayHijriParts} from '../services/hijriService.js';
import HijriRecoveryStatus from './HijriRecoveryStatus.jsx';
export default function HijriTab({ adjustedBy, hijriOverrides, onReloadSettings }) {
  const blankForm = () => { const h = getTodayHijriParts(hijriOverrides); return { hYear: h.year ? String(h.year) : '', hMonth: h.month ? String(h.month) : '1', gDate: '' }; };
  const [settings, setSettings] = useState({ overrides: hijriOverrides });
  const [form, setForm] = useState(blankForm);
  const [err, setErr] = useState('');
  const [busy,setBusy]=useState(false);

  async function load() { setSettings(await getHijriSettings()); }
  useEffect(() => { setSettings({overrides:hijriOverrides}); }, [hijriOverrides]);

  async function add(e) {
    e.preventDefault();
    setErr('');
    if (!form.hYear || !form.gDate) { setErr('Enter a Hijri year and the Gregorian date day 1 fell/falls on.'); return; }
    setBusy(true);try { await saveMonthOverride(form.hYear, form.hMonth, form.gDate, adjustedBy);
    setForm(blankForm());
    await load();
    onReloadSettings && onReloadSettings();
    }catch(error){setErr(error.message||'Could not save Hijri settings.');}finally{setBusy(false);}
  }

  async function remove(o) {
    setBusy(true);setErr('');try { await removeMonthOverride(o.hYear, o.hMonth);
    await load();
    onReloadSettings && onReloadSettings();
    }catch(error){setErr(error.message||'Could not remove this override.');}finally{setBusy(false);}
  }

  return (
    <div>
      <p className="muted">
        Moon-sighting adjustment: anchor the first day of a Hijri month to the Gregorian date the
        community observed it on. This overrides the tabular calculation for that month onward
        (until a later override takes effect) and is used consistently across the public calendar,
        bookings list, website, all modules and iCal export. Changes can move Hijri-based bookings to their adjusted Gregorian date.
      </p>
      <HijriRecoveryStatus/>
      <form className="card" onSubmit={add} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div><label>Hijri year</label><input type="number" value={form.hYear} onChange={e => setForm(f => ({ ...f, hYear: e.target.value }))} /></div>
        <div>
          <label>Hijri month</label>
          <select value={form.hMonth} onChange={e => setForm(f => ({ ...f, hMonth: e.target.value }))}>
            {HIJRI_MONTHS.map(m => <option key={m.value} value={m.value}>{m.name}</option>)}
          </select>
        </div>
        <div><label>Day 1 fell on (Gregorian)</label><input type="date" value={form.gDate} onChange={e => setForm(f => ({ ...f, gDate: e.target.value }))} /></div>
        <button type="button" className="btn alt" disabled={busy} onClick={()=>{setForm({...form,hYear:'',gDate:''});setErr('');}}>Clear</button><button type="button" className="btn alt" disabled={busy} onClick={()=>{setForm(blankForm());setErr('');}}>Cancel</button><button className="btn pri" disabled={busy} type="submit">Save override</button>
      </form>
      {err && <div className="err">{err}</div>}
      <table>
        <thead><tr><th>Hijri month</th><th>Year</th><th>Day 1 (Gregorian)</th><th></th></tr></thead>
        <tbody>
          {(settings.overrides || []).map((o, i) => (
            <tr key={i}>
              <td>{HIJRI_MONTHS.find(m => m.value === Number(o.hMonth))?.name}</td>
              <td>{o.hYear}</td>
              <td>{o.gDate}</td>
              <td><button className="btn del" disabled={busy} onClick={() => remove(o)}>Remove</button></td>
            </tr>
          ))}
          {!settings.overrides?.length && <tr><td colSpan={4} className="muted">No overrides saved — using the tabular calculation.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
