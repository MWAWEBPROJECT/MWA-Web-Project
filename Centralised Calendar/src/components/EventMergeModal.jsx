import { useMemo, useState } from 'react';
import { X, GitMerge, ArrowLeft } from 'lucide-react';
import { previewEventMerge, mergeEvents } from '../services/eventsService.js';
import { toOrgTimeParts, localToUtcIso, formatInOrgTz } from '../utils/dateUtils.js';
import './event-merge.css';

const ELIGIBLE = event => ['pending', 'confirmed'].includes(event.status) && String(event.departmentName || '').trim().toLowerCase() === 'mwa programs';
const dateTime = iso => { const value = toOrgTimeParts(iso); return `${value.dateStr}T${value.timeStr}`; };
const instant = local => local && local.includes('T') ? localToUtcIso(...local.split('T')) : null;
const caption = event => `${formatInOrgTz(event.startAt, { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })} · ${event.title}`;

function ChoiceList({ title, entries, selected, onToggle, label }) {
  return <fieldset className="merge-list"><legend>{title}</legend>
    {!entries.length ? <p className="muted">None linked.</p> : entries.map(entry => <label key={entry.key || entry.id} className="merge-choice">
      <input type="checkbox" checked={selected.includes(entry.key || entry.id)} onChange={event => onToggle(entry.key || entry.id, event.target.checked)} />
      <span><strong>{label(entry)}</strong><small>{entry.source === 'keep' ? 'Surviving event' : 'Other event'}</small></span>
    </label>)}
  </fieldset>;
}

export default function EventMergeModal({ events, onClose, onSaved }) {
  const candidates = useMemo(() => events.filter(ELIGIBLE).sort((a, b) => a.startAt.localeCompare(b.startAt)), [events]);
  const [firstId, setFirstId] = useState('');
  const [secondId, setSecondId] = useState('');
  const [firstSearch, setFirstSearch] = useState('');
  const [secondSearch, setSecondSearch] = useState('');
  const [keepChoice, setKeepChoice] = useState('first');
  const [review, setReview] = useState(null);
  const [title, setTitle] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [audience, setAudience] = useState('family');
  const [speakerName, setSpeakerName] = useState('');
  const [programDetails, setProgramDetails] = useState('');
  const [extras, setExtras] = useState({ volunteers: [], reciters: [], expenses: [] });
  const [sponsorIds, setSponsorIds] = useState([]);
  const [donationIds, setDonationIds] = useState([]);
  const [coverageSource, setCoverageSource] = useState('clear');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);
  const keepId = keepChoice === 'first' ? firstId : secondId;
  const removeId = keepChoice === 'first' ? secondId : firstId;
  const matching = (term, selectedId, excludedId = '') => candidates.filter(item => item.id !== excludedId && (item.id === selectedId || `${item.title} ${caption(item)}`.toLowerCase().includes(term.toLowerCase())));
  const clearReview = () => { setReview(null); setConfirmDelete(false); setError(''); };
  const choose = (set, value) => { set(value); clearReview(); };
  const toggle = (values, set, id, checked) => set(checked ? [...values, id] : values.filter(value => value !== id));

  async function loadReview() {
    setError(''); setBusy(true);
    try {
      const value = await previewEventMerge(keepId, removeId);
      setReview(value);
      setTitle(`${value.keep.title} & ${value.remove.title}`);
      setStart(dateTime(value.keep.startAt)); setEnd(dateTime(value.keep.endAt));
      setAudience(value.keep.audience || 'family');
      setSpeakerName(value.keep.speakerName || ''); setProgramDetails(value.keep.programDetails || '');
      setExtras(Object.fromEntries(['volunteers', 'reciters', 'expenses'].map(kind => [kind, (value.keep[kind] || []).map(item => `keep:${item.id}`)])));
      setSponsorIds(value.sponsorships.filter(item => item.source === 'keep').map(item => item.id));
      setDonationIds(value.donations.filter(item => item.source === 'keep').map(item => item.id));
      setCoverageSource(value.coverage.find(item => item.source === 'keep' && item.exists) ? 'keep' : value.coverage.find(item => item.source === 'remove' && item.exists) ? 'remove' : 'clear');
      setConfirmDelete(false);
    } catch (cause) { setError(cause?.message || 'Could not load the merge review.'); }
    finally { setBusy(false); }
  }

  async function submit(event) {
    event.preventDefault();
    if (!review || !confirmDelete || busy) return;
    setError(''); setBusy(true);
    try {
      const result = await mergeEvents({ keepId, removeId, version: review.version, title, extras, sponsorIds, donationIds, coverageSource,
        fields: { startAt: instant(start), endAt: instant(end), audience, speakerName, programDetails }, confirmDelete });
      setDone(result);
    } catch (cause) { setError(cause?.message || 'The merge could not be completed. No records should be changed; refresh the review before trying again.'); }
    finally { setBusy(false); }
  }

  return <div className="merge-overlay" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="merge-dialog" role="dialog" aria-modal="true" aria-labelledby="merge-title">
      <header className="merge-head"><div className="merge-heading">{review && !done && <button type="button" className="merge-back" aria-label="Back to event selection" onClick={clearReview} disabled={busy}><ArrowLeft size={18} /></button>}<div><p className="eyebrow">Events & Bookings</p><h2 id="merge-title"><GitMerge size={23} /> Merge two programmes</h2></div></div><button type="button" className="btn alt merge-close" aria-label="Close merge review" onClick={onClose} disabled={busy}><X size={18} /></button></header>
      {done ? <div className="merge-complete"><h3>Programmes merged</h3><p>One combined programme now uses the surviving booking record.</p>{done.conflictRefreshPending && <p className="err">The merge completed, but conflict badges need an administrator refresh.</p>}<button className="btn pri" type="button" onClick={onSaved}>Return to bookings</button></div> : <>
        <p className="muted">Choose two overlapping MWA programmes. The review shows linked records and lets you decide what moves to the event you keep.</p>
        <div className="merge-pair">
          <label>First programme<input type="search" placeholder="Search title or date" value={firstSearch} onChange={event => setFirstSearch(event.target.value)} /><select value={firstId} onChange={event => choose(setFirstId, event.target.value)}><option value="">Choose an event</option>{matching(firstSearch, firstId).map(item => <option key={item.id} value={item.id}>{caption(item)}</option>)}</select></label>
          <label>Second programme<input type="search" placeholder="Search title or date" value={secondSearch} onChange={event => setSecondSearch(event.target.value)} /><select value={secondId} onChange={event => choose(setSecondId, event.target.value)}><option value="">Choose an event</option>{matching(secondSearch, secondId, firstId).map(item => <option key={item.id} value={item.id}>{caption(item)}</option>)}</select></label>
        </div>
        <fieldset className="merge-keep"><legend>Which booking record should remain?</legend><label><input type="radio" name="keep-event" checked={keepChoice === 'first'} onChange={() => choose(setKeepChoice, 'first')} /> First</label><label><input type="radio" name="keep-event" checked={keepChoice === 'second'} onChange={() => choose(setKeepChoice, 'second')} /> Second</label></fieldset>
        {!review ? <div className="merge-actions"><button type="button" className="btn alt" onClick={onClose}>Cancel</button><button type="button" className="btn pri" disabled={!firstId || !secondId || firstId === secondId || busy} onClick={loadReview}>{busy ? 'Checking…' : 'Review linked records'}</button></div> : <form onSubmit={submit}>
          <div className="merge-review-title"><strong>Keeping {review.keep.title}</strong><span>Removing {review.remove.title}</span></div>
          <div className="merge-pair"><label>Combined public title<input required minLength={3} maxLength={160} value={title} onChange={event => setTitle(event.target.value)} /></label><label>Audience<select value={audience} onChange={event => setAudience(event.target.value)}>{[['family','Family'],['gents','Gents only'],['ladies','Ladies only'],['kids','Kids only']].map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label><label>Programme starts<input type="datetime-local" required value={start} onChange={event => setStart(event.target.value)} /></label><label>Programme ends<input type="datetime-local" required value={end} onChange={event => setEnd(event.target.value)} /></label><label>Speaker / reciter<input maxLength={160} value={speakerName} onChange={event => setSpeakerName(event.target.value)} /></label><label>Programme details<textarea maxLength={4000} value={programDetails} onChange={event => setProgramDetails(event.target.value)} /></label></div>
          {(['volunteers', 'reciters', 'expenses']).map(kind => {
            const entries = [...(review.keep[kind] || []).map(item => ({ ...item, source: 'keep', key: `keep:${item.id}` })), ...(review.remove[kind] || []).map(item => ({ ...item, source: 'remove', key: `remove:${item.id}` }))];
            return <ChoiceList key={kind} title={`Keep ${kind}`} entries={entries} selected={extras[kind]} onToggle={(key, checked) => setExtras(current => ({ ...current, [kind]: checked ? [...current[kind], key] : current[kind].filter(value => value !== key) }))} label={item => item.name || item.description || 'Untitled'} />;
          })}
          <ChoiceList title="Keep Niaz sponsor assignments" entries={review.sponsorships} selected={sponsorIds} onToggle={(id, checked) => toggle(sponsorIds, setSponsorIds, id, checked)} label={item => `${item.name || 'Sponsor'} · ${item.status || 'Unknown'}`} />
          <ChoiceList title="Transfer event Niaz donations" entries={review.donations} selected={donationIds} onToggle={(id, checked) => toggle(donationIds, setDonationIds, id, checked)} label={item => `${item.name || 'Donor'} · $${((item.amount || 0) / 100).toFixed(2)} · ${item.status || 'Unknown'}`} />
          {review.donations.length > 0 && <p className="muted">Unselected donations remain in finance history without an active event allocation. Payment and receipt records are never deleted.</p>}
          <fieldset className="merge-list"><legend>Niaz event coverage</legend>{[['keep', 'Keep surviving event coverage'], ['remove', 'Use other event coverage'], ['clear', 'Clear coverage for coordinator review']].map(([value, label]) => { const item = review.coverage.find(row => row.source === value); return <label key={value} className="merge-choice"><input type="radio" name="coverage" value={value} checked={coverageSource === value} onChange={() => setCoverageSource(value)} /><span><strong>{label}</strong>{value !== 'clear' && <small>{item?.exists ? `${item.mwaArranged ? 'MWA arranged' : 'Sponsor arranged'}${item.targetCents != null ? ` · Target $${(item.targetCents / 100).toFixed(2)}` : ''}${item.notes ? ` · ${item.notes}` : ''}` : 'No coverage record'}</small>}</span></label>; })}</fieldset>
          <div className="merge-summary"><h3>Final review</h3><p><strong>{sponsorIds.length}</strong> Niaz assignments retained · <strong>{review.sponsorships.length - sponsorIds.length}</strong> discarded</p><p><strong>{donationIds.length}</strong> donations allocated to the combined event · <strong>{review.donations.length - donationIds.length}</strong> retained in finance history without active event allocation</p><p>{['volunteers','reciters','expenses'].map(kind => `${extras[kind].length} ${kind} retained`).join(' · ')}</p><p>{review.counts.forms} forms · {review.counts.responses} submitted responses · {review.counts.eois} sponsorship requests · {review.counts.viewers} event viewer grants remain in history and move to the surviving event.</p><p>The server rechecks all linked records and third-party booking conflicts before saving.</p>{review.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div>
          <label className="merge-confirm"><input type="checkbox" checked={confirmDelete} onChange={event => setConfirmDelete(event.target.checked)} /> I confirm the other booking and unchecked operational entries will be permanently deleted after the transfer.</label>
          <div className="merge-actions"><button type="button" className="btn alt" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="btn alt" onClick={() => { setExtras({ volunteers: [], reciters: [], expenses: [] }); setSponsorIds([]); setDonationIds([]); setConfirmDelete(false); }} disabled={busy}>Clear selections</button><button className="btn pri" type="submit" disabled={busy || !confirmDelete}>{busy ? 'Merging…' : 'Confirm merge'}</button></div>
        </form>}
        {error && <p className="err" role="alert">{error}</p>}
      </>}
    </section>
  </div>;
}
