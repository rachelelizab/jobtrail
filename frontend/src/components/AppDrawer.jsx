import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { ago, eventWhen, fmtDate, nowLocalInput, trk } from '../utils.js';
import { CHANNELS, DetailFields, Field, formData } from './Fields.jsx';

export default function AppDrawer({ id, focusCall, version, onClose, onChanged, onDeleted }) {
  const [a, setA] = useState(null);
  const [stages, setStages] = useState([]);
  const [error, setError] = useState('');
  const [editErr, setEditErr] = useState('');
  const [newContact, setNewContact] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  useEffect(() => { api.stages().then(setStages).catch(() => {}); }, []);
  useEffect(() => {
    api.get(id).then(d => { setA(d); setError(''); }).catch(e => setError(e.message));
  }, [id, version]);
  useEffect(() => {
    if (focusCall && a) setTimeout(() => { const s = document.getElementById('f-summary'); s?.scrollIntoView({ block: 'center' }); s?.focus(); }, 50);
  }, [focusCall, a?.app_id]);

  const act = async (fn, msg) => {
    try { await fn(); onChanged(msg); } catch (e) { setError(e.message); }
  };

  if (!a) {
    return (
      <>
        <div className="scrim" onClick={onClose} />
        <aside className="drawer" role="dialog" aria-modal="true">
          <div className="dhead"><h2>{error ? 'Could not load' : 'Loading…'}</h2><button className="btn ghost" onClick={onClose}>Close</button></div>
          {error && <div className="dbody"><p className="msg err">{error}</p></div>}
        </aside>
      </>
    );
  }

  const cur = stages.find(s => s.stage_code === a.current_stage);
  const events = [
    ...a.history.map(h => ({ t: h.changed_at, kind: 'stage', h })),
    ...a.interactions.map(i => ({ t: i.occurred_at, kind: 'call', i })),
    ...(a.events || []).filter(ev => ev.scheduled_at || ev.due_by).map(ev => ({ t: ev.scheduled_at || ev.due_by, kind: 'round', ev })),
  ].sort((x, y) => String(y.t).localeCompare(String(x.t)));

  async function addCall(e) {
    e.preventDefault();
    const f = formData(e.target);
    const body = { channel: f.channel, direction: f.direction, occurred_at: f.occurred_at, summary: f.summary };
    if (f.contact === '__new') body.new_contact = { full_name: f.nk_name, phone: f.nk_phone, email: f.nk_email, role_title: f.nk_role };
    else if (f.contact) body.contact_id = f.contact;
    const form = e.target;
    await act(async () => { await api.addInteraction(a.app_id, body); form.reset(); setNewContact(false); }, 'Added to the log');
  }

  async function saveDetails(e) {
    e.preventDefault();
    const f = formData(e.target);
    if (!f.company || !f.title || !f.applied_on) return setEditErr('Company, role and applied date are required.');
    try { await api.update(a.app_id, f); setEditErr(''); onChanged('Details saved'); }
    catch (err) { setEditErr(err.message); }
  }

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="dT">
        <div className="dhead">
          <div>
            <span className="trk">{trk(a.app_id)}{a.external_job_id ? ` · LinkedIn job ${a.external_job_id}` : ''}</span>
            <h2 id="dT">{a.company}</h2>
            <div className="r">{a.title}</div>
          </div>
          <button className="btn ghost" onClick={onClose}>Close</button>
        </div>

        <div className="dbody">
          {error && <p className="msg err">{error}</p>}

          <div className="sec">
            <h3>Stage · applied {fmtDate(a.applied_on)} ({ago(a.applied_on)})</h3>
            <div className="stepper">
              {stages.map(s => {
                const on = s.stage_code === a.current_stage;
                const past = !on && cur && !s.is_terminal && !cur.is_terminal && s.sort_order < cur.sort_order;
                return (
                  <button key={s.stage_code} className={`step ${on ? 'on' : past ? 'past' : ''}`}
                    onClick={() => !on && act(() => api.setStage(a.app_id, s.stage_code), `Moved to ${s.label}`)}>
                    {s.label}
                  </button>
                );
              })}
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <label className="row" style={{ gap: 6, fontSize: 14 }}>
                <input type="checkbox" checked={!!a.viewed_by_employer}
                  onChange={e => act(() => api.setViewed(a.app_id, e.target.checked))} />
                Employer viewed my application
              </label>
              {a.job_url && <a href={a.job_url} target="_blank" rel="noreferrer" style={{ fontSize: 14 }}>Open job post ↗</a>}
            </div>
          </div>

          <div className="sec">
            <h3>Tests &amp; interviews{a.events?.length ? ` · ${a.events.length}` : ''}</h3>
            {!a.events?.length && <p className="muted" style={{ margin: 0 }}>None yet. Test and interview invites in your Gmail appear here on their own.</p>}
            <div className="rounds">
              {(a.events || []).map(ev => (
                <div className="round" key={ev.event_id}>
                  <div>
                    <b>{ev.round_name}</b> <span className="muted">· {ev.event_type}{ev.source === 'Gmail' ? ' · from email' : ''}</span><br />
                    {eventWhen(ev)}{ev.mode ? ` · ${ev.mode}` : ''}{ev.location ? ` · ${ev.location}` : ''}
                    {ev.hr_name && <><br /><span className="muted">HR: {ev.hr_name}{ev.hr_phone ? ` · ${ev.hr_phone}` : ''}</span></>}
                    {ev.meeting_link && <><br /><a href={ev.meeting_link} target="_blank" rel="noreferrer">{ev.meeting_link.replace(/^https?:\/\//, '').slice(0, 48)}</a></>}
                  </div>
                  <select aria-label="Outcome" value={ev.outcome} onChange={e => act(() => api.setEventOutcome(ev.event_id, e.target.value), `Marked ${e.target.value}`)}>
                    {['Scheduled', 'Done', 'Passed', 'Not selected', 'Cancelled'].map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div className="sec">
            <h3>Log a call, email or message</h3>
            <form className="form" onSubmit={addCall}>
              <Field name="channel" label="Type" value="Phone call" options={CHANNELS} />
              <Field name="direction" label="Who reached out" value="Inbound" options={['Inbound', 'Outbound']} />
              <Field name="occurred_at" label="When" type="datetime-local" value={nowLocalInput()} />
              <label className="fld" htmlFor="f-contact"><span>With</span>
                <select id="f-contact" name="contact" defaultValue="" onChange={e => setNewContact(e.target.value === '__new')}>
                  <option value="">— not recorded —</option>
                  {a.contacts.map(k => <option key={k.contact_id} value={k.contact_id}>{k.full_name}</option>)}
                  <option value="__new">+ New contact…</option>
                </select>
              </label>
              {newContact && (
                <div className="full form">
                  <Field name="nk_name" label="Contact name" />
                  <Field name="nk_phone" label="Phone" type="tel" />
                  <Field name="nk_email" label="Email" type="email" />
                  <Field name="nk_role" label="Their title" />
                </div>
              )}
              <Field name="summary" label="What was said" full area rows={2} />
              <div className="full row">
                <button className="btn primary" type="submit">Add to log</button>
                <span className="muted" style={{ fontSize: 12.5 }}>An inbound call while you're waiting moves this to “HR / recruiter screen” (trigger).</span>
              </div>
            </form>
          </div>

          <div className="sec">
            <h3>Timeline</h3>
            <div className="timeline">
              {events.map((e, n) => e.kind === 'round' ? (
                <div className="tl round-ev" key={'r' + e.ev.event_id}>
                  <div className="when">{eventWhen(e.ev)}</div>
                  <b>{e.ev.round_name}</b> · {e.ev.event_type}{e.ev.mode ? ` · ${e.ev.mode}` : ''}
                </div>
              ) : e.kind === 'stage' ? (
                <div className="tl" key={'h' + e.h.history_id}>
                  <div className="when">{String(e.t).slice(0, 16)}</div>
                  {e.h.from_stage ? <>{e.h.from_label} → <b>{e.h.to_label}</b></> : <b>Applied</b>}
                </div>
              ) : (
                <div className="tl call" key={'i' + e.i.interaction_id}>
                  <div className="when">{String(e.t).slice(0, 16)}</div>
                  <b>{e.i.channel}</b> · {e.i.direction === 'Inbound' ? 'from' : 'to'} {e.i.full_name || 'company'}
                  {e.i.summary && <><br />{e.i.summary}</>}{' '}
                  <button className="btn sm ghost" onClick={() => act(() => api.removeInteraction(e.i.interaction_id), 'Entry removed')}>Remove</button>
                </div>
              ))}
            </div>
          </div>

          <div className="sec">
            <h3>Recruiters at {a.company}</h3>
            {a.contacts.length === 0 && <p className="muted" style={{ margin: 0 }}>None saved. Add one when you log a call.</p>}
            {a.contacts.map(k => (
              <div className="li" key={k.contact_id}>
                <span><b>{k.full_name}</b>{k.role_title ? ` · ${k.role_title}` : ''}<br />
                  <span className="mono" style={{ fontSize: 12.5 }}>{[k.email, k.phone].filter(Boolean).join('  ·  ') || 'no contact details'}</span>
                </span>
                <button className="btn sm ghost" onClick={() => act(() => api.removeContact(k.contact_id), 'Contact removed')}>Remove</button>
              </div>
            ))}
          </div>

          <form className="sec" onSubmit={saveDetails} key={a.last_updated + a.company}>
            <h3>Details</h3>
            <DetailFields d={a} />
            {editErr && <p className="msg err">{editErr}</p>}
            <div className="row" style={{ marginTop: 10 }}><button className="btn primary" type="submit">Save details</button></div>
          </form>

          <div className="sec">
            <h3>Remove</h3>
            {confirmDel ? (
              <div className="row">
                <span>Delete this application, its history and call log?</span>
                <button className="btn danger" onClick={async () => { try { await api.remove(a.app_id); onDeleted(); } catch (e) { setError(e.message); } }}>Delete</button>
                <button className="btn ghost" onClick={() => setConfirmDel(false)}>Keep it</button>
              </div>
            ) : (
              <button className="btn danger" onClick={() => setConfirmDel(true)}>Delete application</button>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
