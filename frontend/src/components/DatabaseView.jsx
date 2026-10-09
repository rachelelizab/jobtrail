import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

const ER = `erDiagram
  COMPANY ||--o{ CONTACT : employs
  COMPANY ||--o{ JOB_POSTING : advertises
  JOB_POSTING ||--o| APPLICATION : "applied via"
  STAGE ||--o{ APPLICATION : "current stage"
  APPLICATION ||--|{ STATUS_HISTORY : logs
  STAGE ||--o{ STATUS_HISTORY : "to stage"
  APPLICATION ||--o{ INTERACTION : has
  CONTACT |o--o{ INTERACTION : "made by"
  COMPANY {
    int company_id PK
    text name UK
    text website
    text industry
    text address
    text city
    text country
  }
  CONTACT {
    int contact_id PK
    int company_id FK
    text full_name
    text role_title
    text email
    text phone
  }
  JOB_POSTING {
    int job_id PK
    int company_id FK
    text title
    text location
    text work_mode
    text employment_type
    text job_url
    text external_job_id
    text description
  }
  APPLICATION {
    int app_id PK
    int job_id FK,UK
    date applied_on
    text platform
    text resume_version
    text current_stage FK
    int viewed_by_employer
    int priority
    text review
  }
  STAGE {
    text stage_code PK
    text label UK
    text phase
    int sort_order
    int is_terminal
  }
  STATUS_HISTORY {
    int history_id PK
    int app_id FK
    text from_stage FK
    text to_stage FK
    datetime changed_at
  }
  INTERACTION {
    int interaction_id PK
    int app_id FK
    int contact_id FK
    text channel
    text direction
    datetime occurred_at
    text summary
  }`;

const PRESETS = [
  ['Overview', `SELECT company, role, applied_on, days_since_applied, stage, viewed, hr_called
FROM v_application_overview
ORDER BY applied_on DESC`],
  ['Who called me?', `SELECT c.name AS company, k.full_name, k.phone, i.occurred_at, i.summary
FROM interaction i
JOIN application a  ON a.app_id = i.app_id
JOIN job_posting j  ON j.job_id = a.job_id
JOIN company c      ON c.company_id = j.company_id
LEFT JOIN contact k ON k.contact_id = i.contact_id
WHERE i.direction = 'Inbound' AND i.channel = 'Phone call'
ORDER BY i.occurred_at DESC`],
  ['Response rate by platform', `SELECT platform,
       COUNT(*) AS applied,
       SUM(current_stage NOT IN ('APPLIED','GHOSTED')) AS responded,
       ROUND(100.0 * SUM(current_stage NOT IN ('APPLIED','GHOSTED')) / COUNT(*), 1) AS response_pct
FROM application
GROUP BY platform
ORDER BY response_pct DESC`],
  ['Avg days to first call', `SELECT ROUND(AVG(julianday(f.first_call) - julianday(a.applied_on)), 1) AS avg_days_to_first_call
FROM application a
JOIN (SELECT app_id, MIN(occurred_at) AS first_call
      FROM interaction WHERE direction = 'Inbound'
      GROUP BY app_id) f ON f.app_id = a.app_id`],
  ['Same company, many roles', `SELECT company, applications, roles
FROM v_company_summary
WHERE applications > 1`],
  ['Stage history', `SELECT h.changed_at, c.name AS company, h.from_stage, h.to_stage
FROM status_history h
JOIN application a ON a.app_id = h.app_id
JOIN job_posting j ON j.job_id = a.job_id
JOIN company c     ON c.company_id = j.company_id
ORDER BY h.changed_at DESC
LIMIT 25`],
  ['Triggers & views', `SELECT type, name, tbl_name AS on_table
FROM sqlite_master
WHERE type IN ('trigger', 'view', 'index') AND name NOT LIKE 'sqlite_%'
ORDER BY type, name`],
  ['Table structure', 'PRAGMA table_info(application)'],
  ['Foreign keys', 'PRAGMA foreign_key_list(interaction)'],
];

export default function DatabaseView({ version }) {
  const [schema, setSchema] = useState('');
  const [sql, setSql] = useState(PRESETS[0][1]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const erRef = useRef(null);

  useEffect(() => { api.schema().then(setSchema).catch(e => setSchema('-- ' + e.message)); }, []);

  useEffect(() => {
    let cancelled = false;
    import('mermaid').then(async ({ default: mermaid }) => {
      const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'neutral' });
      const { svg } = await mermaid.render('er-' + Date.now(), ER);
      if (!cancelled && erRef.current) erRef.current.innerHTML = svg;
    }).catch(e => { if (erRef.current) erRef.current.textContent = 'ER diagram failed to render: ' + e.message; });
    return () => { cancelled = true; };
  }, []);

  async function run(text = sql) {
    setError('');
    try { setResult(await api.sql(text)); } catch (e) { setResult(null); setError(e.message); }
  }
  useEffect(() => { run(); }, [version]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="grid2">
      <div className="card" style={{ gridColumn: '1/-1' }}>
        <h2>Entity–relationship diagram</h2>
        <p className="sub">Seven relations. Company → postings → one application each; the application carries its stage, an append-only status history and every call or email.</p>
        <div className="mermaid-box" ref={erRef}><p className="muted">Drawing the diagram…</p></div>
      </div>

      <div className="card">
        <h2>Design notes</h2>
        <div className="notes">
          <p><b>3NF / BCNF.</b> Company facts live once in <code>company</code>, so an address change updates one row. Recruiters are a separate relation because one company has many. Stage labels sit in the <code>stage</code> lookup table; <code>application</code> stores only the code.</p>
          <p><b>Integrity.</b> Foreign keys with <code>ON DELETE CASCADE</code> and <code>SET NULL</code>; <code>CHECK</code> constraints on work mode, platform, channel, direction, priority 1–5 and e-mail shape; <code>UNIQUE(job_id)</code> makes posting ↔ application 1:1.</p>
          <p><b>Triggers.</b> New application → first history row. Stage change → history row + timestamp. Moving past “Applied” → marks it viewed. Inbound call while waiting → moves to “HR screen”. History is append-only (<code>RAISE(ABORT)</code>). Deleting a company's last posting removes the company.</p>
          <p><b>Transactions.</b> “Log an application” finds or creates the company, then the posting, then the application inside one <code>BEGIN … COMMIT</code>; any failure rolls all three back.</p>
          <p><b>Engine.</b> SQLite, built into Node.js — the whole database is the file <code>database/jobtrail.db</code>. A MySQL 8 version with stored procedures is in <code>database/mysql-reference/</code>.</p>
          <p><b>Views.</b> <code>v_application_overview</code>, <code>v_pipeline</code>, <code>v_followups_due</code>, <code>v_monthly_activity</code>, <code>v_company_summary</code> — the Tracker and Pipeline tabs read from these.</p>
        </div>
      </div>

      <div className="card">
        <h2>Schema (DDL)</h2>
        <p className="sub">database/schema.sql — runs automatically the first time the backend starts.</p>
        <pre className="code">{schema || 'Loading…'}</pre>
      </div>

      <div className="card" style={{ gridColumn: '1/-1' }}>
        <h2>SQL console</h2>
        <p className="sub">Read-only: runs one SELECT / WITH / PRAGMA / EXPLAIN on a read-only connection to the live database.</p>
        <div className="presets">
          {PRESETS.map(([label, text]) => (
            <button key={label} className="chip" onClick={() => { setSql(text); run(text); }}>{label}</button>
          ))}
        </div>
        <textarea id="sql" spellCheck="false" aria-label="SQL query" value={sql} onChange={e => setSql(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) run(); }} />
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn primary" onClick={() => run()}>Run query</button>
          <span className="muted" style={{ fontSize: 13 }}>Ctrl + Enter</span>
        </div>
        {error && <p className="msg err">{error}</p>}
        {result && (
          <>
            <div className="resbox">
              <table className="res">
                <thead><tr>{result.columns.map(c => <th key={c}>{c}</th>)}</tr></thead>
                <tbody>
                  {result.rows.map((row, i) => (
                    <tr key={i}>{row.map((v, j) => <td key={j} title={v == null ? '' : String(v)}>{v === null ? <span className="muted">NULL</span> : String(v)}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="msg">{result.total} row(s){result.truncated ? ' (first 500 shown)' : ''} · {result.ms} ms</p>
          </>
        )}
      </div>

      <div className="card" style={{ gridColumn: '1/-1' }}>
        <h2>Export</h2>
        <p className="sub">All applications from <span className="mono">v_application_overview</span> as a CSV that opens in Excel. For a full backup, copy the file <span className="mono">database/jobtrail.db</span>.</p>
        <a className="btn" href="/api/export/applications.csv">Download applications (.csv)</a>
      </div>
    </div>
  );
}
