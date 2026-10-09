import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { ago, fmtDate, phaseCls } from '../utils.js';

export default function Lookup({ version, onOpen }) {
  const [text, setText] = useState('');
  const [hits, setHits] = useState(null);

  useEffect(() => {
    const q = text.trim();
    if (!q) { setHits(null); return; }
    const t = setTimeout(() => api.lookup(q).then(setHits).catch(() => setHits([])), 200);
    return () => clearTimeout(t);
  }, [text, version]);

  return (
    <section className="lookup" aria-labelledby="lk">
      <label id="lk" htmlFor="who">HR just called?</label>
      <p>Type the company, recruiter name, email or phone number. You'll see what you applied for, when, and where it stands.</p>
      <div className="field">
        <input id="who" type="search" autoComplete="off" value={text} onChange={e => setText(e.target.value)}
          placeholder="e.g. Kestrel, Priya, +91 98…, @northwind" />
        <span className="kbd">/ to focus</span>
      </div>
      {hits && hits.length === 0 && (
        <p className="nohit">No application matches “{text.trim()}”. If this is a new contact, log the application first, then add the recruiter.</p>
      )}
      {hits && hits.length > 0 && (
        <div className="hits">
          {hits.map(h => (
            <article className="hit" key={h.app_id}>
              <div>
                <h3>{h.company} — {h.title}</h3>
                <div className="facts">
                  Applied <b>{fmtDate(h.applied_on)}</b> ({ago(h.applied_on)}) via {h.platform}
                  {h.location ? ` · ${h.location}` : ''}{h.work_mode ? ` · ${h.work_mode}` : ''}
                </div>
                <div className="facts">
                  Stage <span className={`pill p-${phaseCls(h.current_stage, h.phase)}`}>{h.stage_label}</span>
                  {h.contacts.length > 0 && <> · Recruiter: <b>{h.contacts.map(c => c.full_name).join(', ')}</b></>}
                  {h.resume_version && <> · CV sent: <span className="mono">{h.resume_version}</span></>}
                </div>
                {h.last_contact && (
                  <div className="facts">
                    Last contact {fmtDate(h.last_contact.occurred_at)}: {h.last_contact.channel}
                    {h.last_contact.summary ? ` — ${h.last_contact.summary}` : ''}
                  </div>
                )}
              </div>
              <div className="acts">
                <button className="btn sm primary" onClick={() => onOpen(h.app_id, true)}>Log this call</button>
                <button className="btn sm" onClick={() => onOpen(h.app_id)}>Open</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
