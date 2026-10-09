import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { ago, fmtDate, phaseCls, trk } from '../utils.js';

const PHASES = [['All', 'All'], ['Waiting', 'Waiting to hear'], ['Active', 'In process'], ['Won', 'Offers'], ['Closed', 'Closed']];

export default function Tracker({ version, onOpen, onAdd }) {
  const [phase, setPhase] = useState('All');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('recent');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const t = setTimeout(() => {
      api.list({ phase, q: search, sort })
        .then(d => { setData(d); setError(''); })
        .catch(e => setError(e.message));
    }, search ? 200 : 0);
    return () => clearTimeout(t);
  }, [phase, search, sort, version]);

  if (error) return <div className="err-banner">{error}</div>;
  if (!data) return <div className="loading">Loading applications…</div>;

  const total = Object.values(data.counts).reduce((a, b) => a + b, 0);
  const count = p => (p === 'All' ? total : data.counts[p] || 0);

  return (
    <>
      <div className="filters">
        {PHASES.map(([p, label]) => (
          <button key={p} className="chip" aria-pressed={phase === p} onClick={() => setPhase(p)}>
            {label} <b>{count(p)}</b>
          </button>
        ))}
        <input className="grow" type="search" placeholder="Filter by company, role, city…" value={search}
          onChange={e => setSearch(e.target.value)} aria-label="Filter applications" />
        <select value={sort} onChange={e => setSort(e.target.value)} aria-label="Sort">
          <option value="recent">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="company">Company A–Z</option>
          <option value="priority">Priority</option>
        </select>
      </div>

      <div className="ledger">
        {total === 0 ? (
          <div className="empty">
            <h3>Nothing logged yet</h3>
            <p className="muted">Log each job right after you hit “Apply” on LinkedIn.</p>
            <button className="btn primary" onClick={onAdd}>+ Log your first application</button>
          </div>
        ) : (
          <>
            <div className="lrow lhead">
              <span>Tracking</span><span>Company · role</span><span>HR contact</span><span>Applied</span>
              <span>Stage</span><span>Viewed</span><span>HR call</span>
            </div>
            {data.rows.length === 0 && <div className="empty"><p className="muted">No applications match this filter.</p></div>}
            {data.rows.map(r => (
              <div key={r.app_id} className="lrow item" tabIndex={0} role="button" aria-label={`${r.company}, ${r.role}`}
                onClick={() => onOpen(r.app_id)} onKeyDown={e => e.key === 'Enter' && onOpen(r.app_id)}>
                <span className="trk">{trk(r.app_id)}</span>
                <span className="co"><span className="name">{r.company}</span>
                  <span className="role">{r.role}{r.location ? ` · ${r.location}` : ''}{r.work_mode && r.work_mode !== r.location ? ` · ${r.work_mode}` : ''}</span></span>
                <span className="loc hr">{r.hr_name ? <><b>{r.hr_name}</b>{r.hr_phone && <small className="mono">{r.hr_phone}</small>}</> : <small className="muted">—</small>}</span>
                <span className="date num">{fmtDate(r.applied_on)}<small>{ago(r.applied_on)}{r.site ? ` · ${r.site}` : ''}</small></span>
                <span className="st"><span className={`pill p-${phaseCls(r.stage_code, r.phase)}`}>{r.stage}</span></span>
                <span className="flags">
                  <span className={`flag ${r.viewed ? 'yes' : ''}`}>{r.viewed ? 'Viewed' : 'Not yet'}</span>
                  <span className={`flag ${r.hr_called ? 'yes' : ''}`}>{r.hr_called ? 'Called' : 'No call'}</span>
                </span>
              </div>
            ))}
          </>
        )}
      </div>
    </>
  );
}
