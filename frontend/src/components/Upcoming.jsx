import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { eventWhen, until } from '../utils.js';

// Tests and interviews read from your emails, soonest first.
export default function Upcoming({ version, onOpen }) {
  const [rows, setRows] = useState(null);
  useEffect(() => { api.upcoming().then(setRows).catch(() => setRows([])); }, [version]);
  if (!rows || rows.length === 0) return null;
  return (
    <section className="upcoming" aria-labelledby="up-h">
      <h2 id="up-h">Coming up <span>{rows.length} test{rows.length > 1 ? 's' : ''} &amp; interview{rows.length > 1 ? 's' : ''}</span></h2>
      <div className="up-list">
        {rows.map(e => (
          <article key={e.event_id} className={`up up-${e.event_type.replace(/\s/g, '')}`}>
            <div className="up-when">
              <b>{eventWhen(e)}</b>
              <span>{until(e.scheduled_at || e.due_by)}</span>
            </div>
            <div className="up-what">
              <span className="up-type">{e.event_type}</span>
              <h3>{e.round_name}</h3>
              <p>{e.company} — {e.role}</p>
              <p className="muted">
                {[e.mode, e.location, e.hr_name && `HR: ${e.hr_name}${e.hr_phone ? ` (${e.hr_phone})` : ''}`].filter(Boolean).join(' · ')}
              </p>
            </div>
            <div className="up-acts">
              {e.meeting_link && <a className="btn sm primary" href={e.meeting_link} target="_blank" rel="noreferrer">{e.event_type === 'Test' || e.event_type === 'Assignment' ? 'Open test' : 'Join'}</a>}
              <button className="btn sm" onClick={() => onOpen(e.app_id)}>Open</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
