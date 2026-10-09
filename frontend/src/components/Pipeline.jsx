import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { MON, phaseCls } from '../utils.js';

function MonthlyChart({ rows }) {
  if (!rows.length) return <p className="muted">No applications yet.</p>;
  const W = Math.max(320, rows.length * 70 + 50), H = 200, top = 14, bot = 26, left = 30;
  const ymax = Math.max(1, ...rows.map(m => m.applied));
  const step = Math.max(1, Math.ceil(ymax / 4)), ytop = step * 4;
  const y = v => top + (H - top - bot) * (1 - v / ytop);
  const bw = Math.min(22, ((W - left) / rows.length - 16) / 2);
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, minWidth: 300 }} role="img" aria-label="Applications per month">
        {[0, 1, 2, 3, 4].map(i => (
          <g key={i}>
            <line x1={left} x2={W - 6} y1={y(step * i)} y2={y(step * i)} stroke="var(--line)" />
            <text x={left - 6} y={y(step * i) + 4} textAnchor="end">{step * i}</text>
          </g>
        ))}
        {rows.map((m, i) => {
          const cx = left + ((W - left) / rows.length) * (i + 0.5);
          return (
            <g key={m.month}>
              <rect x={cx - bw - 1} y={y(m.applied)} width={bw} height={y(0) - y(m.applied)} rx="2" fill="var(--accent)"><title>{m.applied} applied</title></rect>
              <rect x={cx + 1} y={y(Number(m.got_response))} width={bw} height={y(0) - y(Number(m.got_response))} rx="2" fill="var(--active)"><title>{m.got_response} responded</title></rect>
              <text x={cx} y={H - 8} textAnchor="middle">{MON[+m.month.slice(5) - 1]} {m.month.slice(2, 4)}</text>
            </g>
          );
        })}
      </svg>
      <div className="row" style={{ fontSize: 12, gap: 14 }}>
        <span><i style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--accent)', borderRadius: 2 }} /> Applied</span>
        <span><i style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--active)', borderRadius: 2 }} /> Got a response</span>
      </div>
    </>
  );
}

export default function Pipeline({ version, onOpen }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api.dashboard().then(setD).catch(e => setError(e.message)); }, [version]);
  if (error) return <div className="err-banner">{error}</div>;
  if (!d) return <div className="loading">Loading dashboard…</div>;

  const k = d.kpi;
  const pct = x => (k.applied ? Math.round((100 * x) / k.applied) + '%' : '—');
  const kpis = [
    ['Applied', k.applied, 'all time'], ['Heard back', pct(k.heard_back), `${k.heard_back} of ${k.applied}`],
    ['HR calls', k.hr_calls, 'applications with a call'], ['Interviews', k.interviews, 'reached interview or later'],
    ['Offers', k.offers, ''], ['Rejected', k.rejected, ''],
  ];
  const mx = Math.max(1, ...d.pipeline.map(p => p.applications));

  return (
    <>
      <div className="kpis">
        {kpis.map(([label, val, sub]) => <div className="kpi" key={label}><span>{label}</span><b>{val}</b><small>{sub}</small></div>)}
      </div>
      <div className="grid2">
        <div className="card">
          <h2>Where applications stand</h2>
          <p className="sub">Current stage of every application (view <span className="mono">v_pipeline</span>).</p>
          <div className="funnel">
            {d.pipeline.map(p => (
              <div className="frow" key={p.stage_code}>
                <span>{p.label}</span>
                <span className="ftrack"><i className={`f-${phaseCls(p.stage_code, p.phase)}`}
                  style={{ width: `${p.applications ? Math.max(3, (100 * p.applications) / mx) : 0}%` }} /></span>
                <span className="mono num" style={{ textAlign: 'right' }}>{p.applications}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <h2>Applications per month</h2>
          <p className="sub">Applied vs. got any response (view <span className="mono">v_monthly_activity</span>).</p>
          <div className="scroll"><MonthlyChart rows={d.monthly.map(m => ({ ...m, applied: Number(m.applied) }))} /></div>
        </div>
        <div className="card">
          <h2>Follow up these</h2>
          <p className="sub">Open, 7+ days since applying, no contact in the last 7 days (view <span className="mono">v_followups_due</span>).</p>
          <div className="list">
            {d.followups.length === 0 && <p className="muted">Nothing overdue. Every open application has had contact in the last week.</p>}
            {d.followups.map(f => (
              <div className="li" key={f.app_id}>
                <span><b>{f.company}</b> · {f.role}<br /><span className="muted" style={{ fontSize: 13 }}>Applied {f.days_since_applied} days ago · {f.stage}</span></span>
                <button className="btn sm" onClick={() => onOpen(f.app_id)}>Open</button>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <h2>By company</h2>
          <p className="sub">Every role you applied for at each company (view <span className="mono">v_company_summary</span>).</p>
          <div className="list">
            {d.companies.length === 0 && <p className="muted">No companies yet.</p>}
            {d.companies.map(c => (
              <div className="li" key={c.company_id}>
                <span><b>{c.company}</b><br /><span className="muted" style={{ fontSize: 13 }}>{c.roles}</span></span>
                <span className="mono num">{c.applications}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
