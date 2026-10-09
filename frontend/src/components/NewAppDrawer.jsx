import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { todayISO } from '../utils.js';
import { DetailFields, Field, formData } from './Fields.jsx';

export default function NewAppDrawer({ onClose, onSaved }) {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { setTimeout(() => document.getElementById('f-company')?.focus(), 30); }, []);

  async function submit(e) {
    e.preventDefault();
    const f = formData(e.target);
    if (!f.company || !f.title || !f.applied_on) return setError('Company, role and applied date are required.');
    setSaving(true);
    setError('');
    try {
      const { app_id } = await api.create(f);
      onSaved(app_id, `${f.company} — ${f.title}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="dT">
        <div className="dhead">
          <div><h2 id="dT">Log an application</h2><div className="r">Fill this in right after you apply.</div></div>
          <button className="btn ghost" onClick={onClose}>Close</button>
        </div>
        <form className="dbody" onSubmit={submit}>
          <DetailFields d={{ applied_on: todayISO(), platform: 'LinkedIn Easy Apply' }} />
          <div className="sec">
            <h3>Recruiter (optional)</h3>
            <div className="form">
              <Field name="k_name" label="Name" />
              <Field name="k_role" label="Their title" placeholder="Talent Acquisition" />
              <Field name="k_email" label="Email" type="email" />
              <Field name="k_phone" label="Phone" type="tel" />
            </div>
          </div>
          {error && <p className="msg err">{error}</p>}
          <div className="row">
            <button className="btn primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save application'}</button>
            <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </aside>
    </>
  );
}
