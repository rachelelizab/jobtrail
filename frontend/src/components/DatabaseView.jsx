import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';

// "My data": your own applications as plain tables. Pick a view, search it, download it as CSV.
// No SQL is typed here — each view is a fixed query on the server, filtered to the signed-in user.
// (The schema, ER diagram and every query are documented in docs/DATABASE.md and database/queries.sql.)
export default function DatabaseView({ version }) {
  const [list, setList] = useState([]);
  const [key, setKey] = useState('all');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');

  useEffect(() => { api.reports().then(setList).catch(e => setError(e.message)); }, []);
  useEffect(() => {
    setError('');
    api.report(key).then(setData).catch(e => { setData(null); setError(e.message); });
  }, [key, version]);

  const rows = useMemo(() => {
    if (!data) return [];
    const f = filter.trim().toLowerCase();
    return f ? data.rows.filter(r => r.some(v => v != null && String(v).toLowerCase().includes(f))) : data.rows;
  }, [data, filter]);

  const current = list.find(r => r.key === key);

  return (
    <div className="mydata">
      <div className="views" role="tablist" aria-label="Choose what to see">
        {list.map(r => (
          <button key={r.key} className="chip" aria-pressed={r.key === key} onClick={() => { setKey(r.key); setFilter(''); }}>
            {r.title}
          </button>
        ))}
      </div>

      <div className="card">
        <div className="mdhead">
          <div>
            <h2>{current?.title || 'All applications'}</h2>
            <p className="sub">{current?.about}</p>
          </div>
          <div className="row">
            <input className="mdfilter" type="search" placeholder="Search this table" value={filter}
                   onChange={e => setFilter(e.target.value)} aria-label="Search this table" />
            <a className="btn primary" href={`/api/reports/${key}.csv`}>Download as CSV</a>
          </div>
        </div>

        {error && <p className="msg err">{error}</p>}
        {!data && !error && <p className="loading">Loading…</p>}
        {data && (
          rows.length === 0
            ? <div className="empty"><h3>Nothing here yet</h3><p className="muted">{filter ? 'No rows match your search.' : 'This view fills up as you apply and as emails arrive.'}</p></div>
            : <>
                <div className="resbox">
                  <table className="res">
                    <thead><tr>{data.columns.map(c => <th key={c}>{c}</th>)}</tr></thead>
                    <tbody>
                      {rows.map((row, i) => (
                        <tr key={i}>{row.map((v, j) => {
                          const s = v == null ? '' : String(v);
                          const link = /^https?:\/\//.test(s);
                          return <td key={j} title={s}>{v == null || s === '' ? <span className="muted">—</span>
                            : link ? <a href={s} target="_blank" rel="noreferrer">Open</a> : s}</td>;
                        })}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="msg muted">{rows.length} {rows.length === 1 ? 'row' : 'rows'}{filter ? ` of ${data.rows.length}` : ''}</p>
              </>
        )}
      </div>
    </div>
  );
}
