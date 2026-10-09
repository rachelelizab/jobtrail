import { Router } from 'express';
import crypto from 'node:crypto';
import { q, q1, run } from '../db.js';
import { createApplication } from './applications.js';
import { parseJobEmail, gmailQuery, recruiterQuery, matchCompany, recruiterFrom, kindOf } from '../emailParser.js';
import { googleConfigured, authUrl, exchangeCode, refreshAccess, userInfo, listMessageIds, getMessage } from '../google.js';

const r = Router();
const TZ = process.env.APP_TIMEZONE || 'Asia/Kolkata';
const FIRST_SYNC_DAYS = Number(process.env.GMAIL_FIRST_SYNC_DAYS || 365);

// ---------- small helpers ----------
const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean)
  .map(c => { const i = c.indexOf('='); return [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1).trim())]; }));
const isHttps = req => req.secure || req.headers['x-forwarded-proto'] === 'https';
function setCookie(req, res, name, value, maxAgeSec) {
  res.append('Set-Cookie', `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${isHttps(req) ? '; Secure' : ''}`);
}
const redirectUri = req => process.env.GOOGLE_REDIRECT_URI
  || `${isHttps(req) ? 'https' : 'http'}://${req.headers['x-forwarded-host'] || req.headers.host}/api/auth/google/callback`;
const localDate = iso => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });                 // YYYY-MM-DD
const localDateTime = iso => new Date(iso).toLocaleString('sv-SE', { timeZone: TZ }).slice(0, 19);   // YYYY-MM-DD HH:MM:SS

export function currentUser(req) {
  const sid = cookies(req).jt_sid;
  if (!sid) return null;
  return q1(`SELECT u.user_id, u.email, u.name, u.last_sync_at, u.refresh_token IS NOT NULL AS can_sync
               FROM user_session s JOIN app_user u ON u.user_id = s.user_id WHERE s.session_id = ?`, [sid]) || null;
}
const needUser = (req, res) => {
  const u = currentUser(req);
  if (!u) res.status(401).json({ error: 'Sign in with Google first.' });
  return u;
};

// ---------- sign in / out ----------
r.get('/auth/status', (req, res) => {
  const user = currentUser(req);
  const review = user ? q1("SELECT COUNT(*) AS n FROM email_import WHERE status = 'review'").n : 0;
  res.json({ configured: googleConfigured(), user, review });
});

r.get('/auth/google', (req, res) => {
  if (!googleConfigured()) return res.status(503).send('Google sign-in is not set up yet: add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.');
  const state = crypto.randomBytes(16).toString('hex');
  setCookie(req, res, 'jt_state', state, 600);
  res.redirect(authUrl(redirectUri(req), state));
});

r.get('/auth/google/callback', async (req, res) => {
  try {
    if (req.query.error) return res.redirect('/?gmail=cancelled');
    if (!req.query.state || req.query.state !== cookies(req).jt_state) return res.redirect('/?gmail=failed');
    const tok = await exchangeCode(String(req.query.code || ''), redirectUri(req));
    const info = await userInfo(tok.access_token);
    const allowed = (process.env.ALLOWED_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (allowed.length && !allowed.includes(String(info.email).toLowerCase())) return res.redirect('/?gmail=denied');

    const existing = q1('SELECT user_id FROM app_user WHERE google_sub = ?', [info.sub]);
    const expires = Date.now() + (tok.expires_in || 3600) * 1000;
    let userId;
    if (existing) {
      userId = existing.user_id;
      run(`UPDATE app_user SET email = ?, name = ?, access_token = ?, token_expires = ?,
             refresh_token = COALESCE(?, refresh_token) WHERE user_id = ?`,
        [info.email, info.name || null, tok.access_token, expires, tok.refresh_token || null, userId]);
    } else {
      userId = run(`INSERT INTO app_user (google_sub, email, name, access_token, token_expires, refresh_token) VALUES (?,?,?,?,?,?)`,
        [info.sub, info.email, info.name || null, tok.access_token, expires, tok.refresh_token || null]).lastInsertRowid;
    }
    const sid = crypto.randomBytes(24).toString('hex');
    run('INSERT INTO user_session (session_id, user_id) VALUES (?,?)', [sid, userId]);
    setCookie(req, res, 'jt_sid', sid, 60 * 60 * 24 * 30);
    setCookie(req, res, 'jt_state', '', 0);
    res.redirect('/?gmail=connected');
  } catch (e) {
    console.error('Google sign-in failed:', e.message);
    res.redirect('/?gmail=failed');
  }
});

r.post('/auth/logout', (req, res) => {
  const sid = cookies(req).jt_sid;
  if (sid) run('DELETE FROM user_session WHERE session_id = ?', [sid]);
  setCookie(req, res, 'jt_sid', '', 0);
  res.json({ ok: true });
});

// ---------- sync ----------
async function accessToken(userId) {
  const u = q1('SELECT access_token, token_expires, refresh_token FROM app_user WHERE user_id = ?', [userId]);
  if (u?.access_token && u.token_expires > Date.now() + 60_000) return u.access_token;
  if (!u?.refresh_token) throw Object.assign(new Error('Gmail access has expired. Sign in with Google again.'), { status: 401 });
  const t = await refreshAccess(u.refresh_token);
  run('UPDATE app_user SET access_token = ?, token_expires = ? WHERE user_id = ?', [t.access_token, Date.now() + (t.expires_in || 3600) * 1000, userId]);
  return t.access_token;
}

/** Find the application an update email is about: company + role, or the company's only application. */
function findApplication(company, role) {
  const base = `SELECT a.app_id, a.current_stage, a.viewed_by_employer, s.sort_order, s.is_terminal
                  FROM application a JOIN job_posting j ON j.job_id = a.job_id
                  JOIN company c ON c.company_id = j.company_id JOIN stage s ON s.stage_code = a.current_stage
                 WHERE c.name = ?`;
  if (role) {
    const hit = q1(`${base} AND j.title = ? COLLATE NOCASE ORDER BY a.applied_on DESC LIMIT 1`, [company, role]);
    if (hit) return hit;
  }
  const all = q(`${base} ORDER BY a.applied_on DESC`, [company]);
  return all.length === 1 ? all[0] : null;
}

const STAGE_ORDER = { INTERVIEW: 5 };

/** Apply one parsed email to the database. Returns { status, app_id }. */
export function applyEmail(p, email) {
  if (!p || p.kind === 'other') return { status: 'ignored', app_id: null };

  if (p.kind === 'applied') {
    if (!p.company || !p.role) return { status: 'review', app_id: null };
    const dup = q1(`SELECT a.app_id FROM application a JOIN job_posting j ON j.job_id = a.job_id
                      JOIN company c ON c.company_id = j.company_id
                     WHERE c.name = ? AND j.title = ? COLLATE NOCASE`, [p.company, p.role]);
    if (dup) return { status: 'duplicate', app_id: dup.app_id };
    const app_id = createApplication({
      company: p.company, title: p.role, location: p.location || null, job_url: p.job_url || null,
      applied_on: localDate(email.date), platform: p.appPlatform, review: `Imported from ${p.platform} email`,
    }, 'Gmail');
    return { status: 'imported', app_id };
  }

  if (!p.company) return { status: 'review', app_id: null };
  const a = findApplication(p.company, p.role);
  if (!a) return { status: 'review', app_id: null };
  let changed = false;
  if (p.kind === 'viewed') {
    if (a.current_stage === 'APPLIED') { run("UPDATE application SET current_stage = 'VIEWED' WHERE app_id = ?", [a.app_id]); changed = true; }
    if (!a.viewed_by_employer) { run('UPDATE application SET viewed_by_employer = 1 WHERE app_id = ?', [a.app_id]); changed = true; }
  } else {
    const target = p.kind === 'rejected' ? 'REJECTED' : 'INTERVIEW';
    const move = !a.is_terminal && (target === 'REJECTED' || a.sort_order < STAGE_ORDER.INTERVIEW);
    if (move) { run('UPDATE application SET current_stage = ? WHERE app_id = ?', [target, a.app_id]); changed = true; }
    // keep the email in the call / email log (after the stage change, so the inbound trigger doesn't interfere)
    run(`INSERT INTO interaction (app_id, channel, direction, occurred_at, summary) VALUES (?, 'Email', 'Inbound', ?, ?)`,
      [a.app_id, localDateTime(email.date), `${p.platform} email: ${email.subject}`.slice(0, 300)]);
    changed = true;
  }
  return { status: changed ? 'updated' : 'duplicate', app_id: a.app_id };
}


/** An email straight from a recruiter/company: save the recruiter, log the email, move the stage. */
export function applyRecruiterEmail(email) {
  const companies = q('SELECT company_id, name FROM company');
  const c = matchCompany(email, companies);
  if (!c) return { status: 'ignored', app_id: null, company: null };
  const apps = q(`SELECT a.app_id, a.current_stage, s.sort_order, s.is_terminal, j.title
                    FROM application a JOIN job_posting j ON j.job_id = a.job_id JOIN stage s ON s.stage_code = a.current_stage
                   WHERE j.company_id = ? ORDER BY s.is_terminal, a.applied_on DESC`, [c.company_id]);
  if (!apps.length) return { status: 'ignored', app_id: null, company: c.name };
  const text = `${email.subject}\n${email.text}`.toLowerCase();
  const a = apps.find(x => text.includes(x.title.toLowerCase())) || apps[0];

  // recruiter → contact table (new, or fill in a missing phone)
  let contactId = null;
  const rec = recruiterFrom(email);
  if (rec) {
    const known = q1('SELECT contact_id, phone FROM contact WHERE company_id = ? AND (lower(email) = ? OR full_name = ? COLLATE NOCASE)',
      [c.company_id, rec.email, rec.full_name]);
    if (known) {
      contactId = known.contact_id;
      if (!known.phone && rec.phone) run('UPDATE contact SET phone = ? WHERE contact_id = ?', [rec.phone, contactId]);
    } else {
      contactId = run('INSERT INTO contact (company_id, full_name, role_title, email, phone) VALUES (?,?,?,?,?)',
        [c.company_id, rec.full_name, 'Recruiter / HR', rec.email, rec.phone]).lastInsertRowid;
    }
  }
  const kind = kindOf(text);
  if (kind === 'rejected' && !a.is_terminal) run("UPDATE application SET current_stage = 'REJECTED' WHERE app_id = ?", [a.app_id]);
  if (kind === 'interview' && !a.is_terminal && a.sort_order < STAGE_ORDER.INTERVIEW)
    run("UPDATE application SET current_stage = 'INTERVIEW' WHERE app_id = ?", [a.app_id]);
  // logging the inbound email also moves a waiting application to "HR / recruiter screen" (trigger trg_inbound_contact)
  run(`INSERT INTO interaction (app_id, contact_id, channel, direction, occurred_at, summary) VALUES (?, ?, 'Email', 'Inbound', ?, ?)`,
    [a.app_id, contactId, localDateTime(email.date), `Email from ${rec?.full_name || c.name}: ${email.subject}`.slice(0, 300)]);
  return { status: 'updated', app_id: a.app_id, company: c.name, kind };
}

const running = new Set();
export async function syncUser(userId) {
  if (running.has(userId)) throw Object.assign(new Error('A sync is already running.'), { status: 409 });
  running.add(userId);
  try {
    const token = await accessToken(userId);
    const u = q1('SELECT last_sync_at FROM app_user WHERE user_id = ?', [userId]);
    const days = u.last_sync_at ? 30 : FIRST_SYNC_DAYS;
    const ids = await listMessageIds(token, gmailQuery(days), u.last_sync_at ? 200 : 500);
    const fresh = ids.filter(id => !q1('SELECT 1 FROM email_import WHERE message_id = ?', [id]));

    const emails = [];
    for (let i = 0; i < fresh.length; i += 8) {                       // 8 at a time, to be gentle on the API
      emails.push(...await Promise.all(fresh.slice(i, i + 8).map(id => getMessage(token, id))));
    }
    emails.sort((x, y) => x.date.localeCompare(y.date));             // oldest first: "applied" before "viewed"

    const summary = { scanned: ids.length, new_emails: emails.length, imported: 0, updated: 0, duplicate: 0, review: 0, ignored: 0 };
    for (const e of emails) {
      const p = parseJobEmail(e);
      let out;
      try { out = applyEmail(p, e); }
      catch (err) { console.error('Could not import', e.subject, err.message); out = { status: 'review', app_id: null }; }
      summary[out.status]++;
      run(`INSERT OR IGNORE INTO email_import (message_id, user_id, received_at, sender, subject, snippet, platform, kind,
                                               company, role, location, job_url, status, app_id)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [e.id, userId, localDateTime(e.date), e.from.slice(0, 200), e.subject.slice(0, 300), e.snippet.slice(0, 300),
         p?.platform || null, p?.kind || 'other', p?.company || null, p?.role || null, p?.location || null, p?.job_url || null,
         out.status, out.app_id]);
    }
    // 2) emails sent directly by recruiters / companies you applied to
    const rids = await listMessageIds(token, recruiterQuery(days), u.last_sync_at ? 100 : 300);
    const rfresh = rids.filter(id => !q1('SELECT 1 FROM email_import WHERE message_id = ?', [id]));
    const remails = [];
    for (let i = 0; i < rfresh.length; i += 8) remails.push(...await Promise.all(rfresh.slice(i, i + 8).map(id => getMessage(token, id))));
    remails.sort((x, y) => x.date.localeCompare(y.date));
    summary.scanned += rids.length; summary.new_emails += remails.length; summary.recruiter = 0;
    for (const e of remails) {
      let out;
      try { out = applyRecruiterEmail(e); } catch (err) { console.error('Recruiter email failed', e.subject, err.message); out = { status: 'ignored', app_id: null }; }
      if (out.status === 'updated') { summary.updated++; summary.recruiter++; } else summary.ignored++;
      run(`INSERT OR IGNORE INTO email_import (message_id, user_id, received_at, sender, subject, snippet, platform, kind, company, status, app_id)
           VALUES (?,?,?,?,?,?,'Email',?,?,?,?)`,
        [e.id, userId, localDateTime(e.date), e.from.slice(0, 200), e.subject.slice(0, 300), e.snippet.slice(0, 300),
         out.kind || 'other', out.company || null, out.status, out.app_id]);
    }

    run("UPDATE app_user SET last_sync_at = datetime('now','localtime') WHERE user_id = ?", [userId]);
    return summary;
  } finally {
    running.delete(userId);
  }
}

r.post('/gmail/sync', async (req, res) => {
  const u = needUser(req, res);
  if (!u) return;
  res.json(await syncUser(u.user_id));
});

// ---------- review list: emails that could not be read clearly ----------
r.get('/gmail/review', (req, res) => {
  if (!needUser(req, res)) return;
  res.json(q(`SELECT message_id, received_at, platform, kind, subject, snippet, company, role, location, job_url
                FROM email_import WHERE status = 'review' ORDER BY received_at DESC LIMIT 50`));
});

r.post('/gmail/review/:id/add', (req, res) => {
  if (!needUser(req, res)) return;
  const row = q1("SELECT * FROM email_import WHERE message_id = ? AND status = 'review'", [req.params.id]);
  if (!row) return res.status(404).json({ error: 'That email is no longer in the review list.' });
  const company = String(req.body?.company || '').trim(), role = String(req.body?.role || '').trim();
  if (!company || !role) return res.status(400).json({ error: 'Company and role are both needed.' });
  const p = { platform: row.platform, appPlatform: row.platform === 'LinkedIn' ? 'LinkedIn Easy Apply' : 'Job portal',
    kind: row.kind === 'other' ? 'applied' : row.kind, company, role, location: row.location, job_url: row.job_url };
  let out = applyEmail(p, { date: row.received_at.replace(' ', 'T'), subject: row.subject });
  if (out.status === 'review' && p.kind !== 'applied') out = applyEmail({ ...p, kind: 'applied' }, { date: row.received_at.replace(' ', 'T'), subject: row.subject });
  run('UPDATE email_import SET company = ?, role = ?, status = ?, app_id = ? WHERE message_id = ?',
    [company, role, out.status === 'review' ? 'review' : out.status, out.app_id, row.message_id]);
  res.json(out);
});

r.post('/gmail/review/:id/dismiss', (req, res) => {
  if (!needUser(req, res)) return;
  run("UPDATE email_import SET status = 'ignored' WHERE message_id = ?", [req.params.id]);
  res.json({ ok: true });
});

// ---------- background: re-check Gmail every few hours for everyone who connected ----------
export function startAutoSync() {
  const hours = Number(process.env.GMAIL_AUTO_SYNC_HOURS || 3);
  if (!googleConfigured() || !(hours > 0)) return;
  setInterval(async () => {
    for (const { user_id } of q('SELECT user_id FROM app_user WHERE refresh_token IS NOT NULL')) {
      try { await syncUser(user_id); } catch (e) { console.error('Auto-sync failed for user', user_id, e.message); }
    }
  }, hours * 3600 * 1000).unref();
}

export default r;
