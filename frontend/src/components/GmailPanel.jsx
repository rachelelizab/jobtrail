import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

const NOTICES = {
  connected: 'Gmail connected. Importing your job emails…',
  cancelled: 'Google sign-in was cancelled.',
  failed: 'Google sign-in did not work. Please try again.',
  denied: 'This Google account is not allowed to use this JobTrail.',
};

function summaryText(s) {
  const parts = [];
  if (s.imported) parts.push(`${s.imported} new application${s.imported > 1 ? 's' : ''} added`);
  if (s.updated) parts.push(`${s.updated} updated`);
  if (s.review) parts.push(`${s.review} to check`);
  return parts.length ? parts.join(' · ') : 'No new job emails since the last check.';
}

export default function GmailPanel({ version, onChanged }) {
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [review, setReview] = useState([]);
  const [showReview, setShowReview] = useState(false);

  const load = useCallback(() => api.authStatus().then(setSt).catch(() => setSt({ configured: false })), []);
  const loadReview = useCallback(() => api.gmailReview().then(setReview).catch(() => setReview([])), []);

  const sync = useCallback(async () => {
    setBusy(true);
    setMsg('Reading your job emails…');
    try {
      const s = await api.gmailSync();
      setMsg(summaryText(s));
      onChanged();
      load();
      loadReview();
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }, [load, loadReview, onChanged]);

  // first load: show sign-in result, then sync automatically if it's been a while
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    const g = p.get('gmail');
    if (g) { setMsg(NOTICES[g] || ''); history.replaceState(null, '', location.pathname); }
    api.authStatus().then(s => {
      setSt(s);
      if (!s.user) return;
      loadReview();
      const last = s.user.last_sync_at ? Date.parse(s.user.last_sync_at.replace(' ', 'T')) : 0;
      if (g === 'connected' || Date.now() - last > 60 * 60 * 1000) sync();
    }).catch(() => setSt({ configured: false }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (st?.user) loadReview(); }, [version]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!st) return null;
  if (!st.configured) {
    return (
      <section className="gmail off">
        <span>Gmail import is not set up on this server yet (Google keys missing). You can still add applications by hand.</span>
      </section>
    );
  }

  if (!st.user) {
    return (
      <section className="gmail">
        <div>
          <b>Import your applications automatically</b>
          <span>Sign in with Google and JobTrail will read your LinkedIn, Naukri, Internshala and Indeed job emails (read-only) and add every application for you.</span>
          {msg && <span className="gmsg">{msg}</span>}
        </div>
        <a className="btn primary" href="/api/auth/google">Sign in with Google</a>
      </section>
    );
  }

  const logout = async () => { await api.logout(); setMsg(''); setReview([]); load(); };

  return (
    <section className="gmail">
      <div>
        <b>Gmail connected · {st.user.email}</b>
        <span>{busy ? 'Syncing…' : st.user.last_sync_at ? `Last checked ${st.user.last_sync_at.slice(0, 16)}` : 'Not synced yet'}{msg && !busy ? ` · ${msg}` : ''}</span>
      </div>
      <div className="row">
        {review.length > 0 && (
          <button className="btn sm" onClick={() => setShowReview(v => !v)}>{showReview ? 'Hide' : 'Check'} {review.length} email{review.length > 1 ? 's' : ''}</button>
        )}
        <button className="btn sm primary" onClick={sync} disabled={busy}>{busy ? 'Syncing…' : 'Sync now'}</button>
        <button className="btn sm ghost" onClick={logout}>Sign out</button>
      </div>
      {showReview && review.length > 0 && (
        <div className="greview">
          <p className="muted">These job emails could not be read clearly. Fill in the company and role, then add them (or ignore them).</p>
          {review.map(r => <ReviewRow key={r.message_id} r={r} onDone={() => { loadReview(); onChanged(); }} />)}
        </div>
      )}
    </section>
  );
}

function ReviewRow({ r, onDone }) {
  const [company, setCompany] = useState(r.company || '');
  const [role, setRole] = useState(r.role || '');
  const [err, setErr] = useState('');
  const add = async () => {
    try { await api.gmailReviewAdd(r.message_id, { company, role }); onDone(); } catch (e) { setErr(e.message); }
  };
  const dismiss = async () => { await api.gmailReviewDismiss(r.message_id); onDone(); };
  return (
    <div className="grow-row">
      <div className="gsub"><span className="mono">{r.platform} · {String(r.received_at).slice(0, 10)}</span> {r.subject}</div>
      <div className="row">
        <input placeholder="Company" value={company} onChange={e => setCompany(e.target.value)} />
        <input placeholder="Role" value={role} onChange={e => setRole(e.target.value)} />
        <button className="btn sm primary" onClick={add}>Add</button>
        <button className="btn sm ghost" onClick={dismiss}>Ignore</button>
      </div>
      {err && <p className="msg err">{err}</p>}
    </div>
  );
}
