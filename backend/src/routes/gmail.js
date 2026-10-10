import { Router } from 'express';
import crypto from 'node:crypto';
import { q, q1, run } from '../db.js';
import { createApplication } from './applications.js';
import { cookies, currentUser } from '../auth.js';
import { parseJobEmail, parseDirectEmail, gmailQuery, recruiterQuery, labelQuery, matchCompany, recruiterFrom, kindOf, PLATFORMS } from '../emailParser.js';
import { extractEvent, parseIcs } from '../scheduleParser.js';
import { googleConfigured, authUrl, exchangeCode, refreshAccess, userInfo, listMessageIds, getMessage } from '../google.js';

const r = Router();
const TZ = process.env.APP_TIMEZONE || 'Asia/Kolkata';
const FIRST_SYNC_DAYS = Number(process.env.GMAIL_FIRST_SYNC_DAYS || 365);
const JOBS_LABEL = process.env.GMAIL_JOBS_LABEL || 'Jobs';   // your own Gmail label for job emails (any sender)

// ---------- small helpers ----------
const isHttps = req => req.secure || req.headers['x-forwarded-proto'] === 'https';
function setCookie(req, res, name, value, maxAgeSec) {
  res.append('Set-Cookie', `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${isHttps(req) ? '; Secure' : ''}`);
}
const redirectUri = req => process.env.GOOGLE_REDIRECT_URI
  || `${isHttps(req) ? 'https' : 'http'}://${req.headers['x-forwarded-host'] || req.headers.host}/api/auth/google/callback`;
const localDate = iso => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });                 // YYYY-MM-DD
const localDateTime = iso => new Date(iso).toLocaleString('sv-SE', { timeZone: TZ }).slice(0, 19);   // YYYY-MM-DD HH:MM:SS

const needUser = (req, res) => {
  const u = currentUser(req);
  if (!u) res.status(401).json({ error: 'Sign in with Google first.' });
  return u;
};

// ---------- sign in / out ----------
r.get('/auth/status', (req, res) => {
  const user = currentUser(req);
  const review = user ? q1("SELECT COUNT(*) AS n FROM email_import WHERE status = 'review' AND user_id = ?", [user.user_id]).n : 0;
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
function findApplication(userId, company, role) {
  const base = `SELECT a.app_id, a.current_stage, a.viewed_by_employer, s.sort_order, s.is_terminal
                  FROM application a JOIN job_posting j ON j.job_id = a.job_id
                  JOIN company c ON c.company_id = j.company_id JOIN stage s ON s.stage_code = a.current_stage
                 WHERE a.user_id IS ? AND c.name = ?`;
  if (role) {
    const hit = q1(`${base} AND j.title = ? COLLATE NOCASE ORDER BY a.applied_on DESC LIMIT 1`, [userId, company, role]);
    if (hit) return hit;
  }
  const all = q(`${base} ORDER BY a.applied_on DESC`, [userId, company]);
  return all.length === 1 ? all[0] : null;
}

// ---------- stages, recruiters and rounds ----------
const STAGE = { APPLIED: 1, VIEWED: 2, SCREEN: 3, ASSESS: 4, INTERVIEW: 5, FINAL: 6, OFFER: 7 };
const KIND_STAGE = { test: 'ASSESS', interview: 'INTERVIEW', offer: 'OFFER', rejected: 'REJECTED' };

/** Move an application forward to `target` (never backwards; Rejected / Accepted / Withdrawn stay as they are). */
function advance(appId, target) {
  const a = q1(`SELECT a.current_stage, s.sort_order, s.is_terminal FROM application a JOIN stage s ON s.stage_code = a.current_stage WHERE a.app_id = ?`, [appId]);
  if (!a || a.is_terminal || a.current_stage === target) return false;
  if (target !== 'REJECTED' && a.sort_order >= STAGE[target]) return false;
  run('UPDATE application SET current_stage = ? WHERE app_id = ?', [target, appId]);
  return true;
}

/** Save the HR / recruiter (new, or fill in a missing phone / title / email). Returns contact_id or null. */
function saveRecruiter(companyId, userId, rec) {
  if (!rec?.full_name) return null;
  const known = q1(`SELECT contact_id, phone, email, role_title FROM contact
                     WHERE company_id = ? AND user_id IS ? AND ((? IS NOT NULL AND lower(email) = ?) OR full_name = ? COLLATE NOCASE)`,
    [companyId, userId, rec.email || null, rec.email || null, rec.full_name]);
  if (known) {
    run(`UPDATE contact SET phone = COALESCE(phone, ?), email = COALESCE(email, ?), role_title = COALESCE(role_title, ?) WHERE contact_id = ?`,
      [rec.phone || null, rec.email || null, rec.role_title || null, known.contact_id]);
    return known.contact_id;
  }
  return run('INSERT INTO contact (company_id, full_name, role_title, email, phone, user_id) VALUES (?,?,?,?,?,?)',
    [companyId, rec.full_name, rec.role_title || 'Recruiter / HR', rec.email || null, rec.phone || null, userId]).lastInsertRowid;
}

/**
 * Save a test / interview read from an email. The same round arriving again (a reminder or a new time)
 * updates the existing row instead of adding a second one. Returns event_id or null.
 */
function saveEvent(appId, userId, email, ev, contactId) {
  if (!ev) return null;
  const msg = `${userId}:${email.id}`;
  const seen = q1('SELECT event_id FROM interview_event WHERE source_message_id = ?', [msg]);
  if (seen) return seen.event_id;
  const same = q1(`SELECT event_id FROM interview_event WHERE app_id = ? AND outcome = 'Scheduled'
                    AND (round_name = ? COLLATE NOCASE OR (? IS NOT NULL AND scheduled_at = ?))`,
    [appId, ev.round_name, ev.scheduled_at, ev.scheduled_at]);
  if (same) {
    run(`UPDATE interview_event SET scheduled_at = COALESCE(?, scheduled_at), has_time = CASE WHEN ? IS NOT NULL THEN ? ELSE has_time END,
           ends_at = COALESCE(?, ends_at), due_by = COALESCE(?, due_by), mode = COALESCE(?, mode),
           meeting_link = COALESCE(?, meeting_link), location = COALESCE(?, location), contact_id = COALESCE(?, contact_id)
         WHERE event_id = ?`,
      [ev.scheduled_at, ev.scheduled_at, ev.has_time, ev.ends_at, ev.due_by, ev.mode, ev.meeting_link, ev.location, contactId, same.event_id]);
    return same.event_id;
  }
  // the trigger trg_event_advances_stage moves the application to Assessment / Interview / Final round
  return run(`INSERT INTO interview_event (app_id, user_id, event_type, round_name, scheduled_at, has_time, ends_at, due_by,
                                           mode, meeting_link, location, contact_id, source, source_message_id)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'Gmail',?)`,
    [appId, userId, ev.event_type, ev.round_name, ev.scheduled_at, ev.has_time, ev.ends_at, ev.due_by,
     ev.mode, ev.meeting_link, ev.location, contactId, msg]).lastInsertRowid;
}

/** Calendar-invite text joined to the body, so HR phone numbers and the role in the invite are read too. */
const withIcs = email => {
  const ics = parseIcs(email.ics);
  return ics ? { ...email, text: `${email.text}\n${ics.summary}\n${ics.description}` } : email;
};

/** Apply one parsed job-site email (LinkedIn, Naukri …) to the database. Returns { status, app_id, event_id }. */
export function applyEmail(p, email, userId) {
  if (!p || p.kind === 'other') return { status: 'ignored', app_id: null };

  // a company's own hiring system (Workday, Greenhouse …): the email is reliable even without a role
  if (p.ats && p.company && !p.role) p = { ...p, role: 'Role not mentioned in email' };
  if (p.kind === 'applied') {
    if (!p.company || !p.role) return { status: 'review', app_id: null };
    const dup = q1(`SELECT a.app_id FROM application a JOIN job_posting j ON j.job_id = a.job_id
                      JOIN company c ON c.company_id = j.company_id
                     WHERE a.user_id IS ? AND c.name = ? AND j.title = ? COLLATE NOCASE`, [userId, p.company, p.role]);
    if (dup) return { status: 'duplicate', app_id: dup.app_id };
    const app_id = createApplication({
      company: p.company, title: p.role, location: p.location || null, job_url: p.job_url || null,
      applied_on: localDate(email.date), platform: p.appPlatform, review: `Imported from ${p.platform} email`,
    }, 'Gmail', userId);
    return { status: 'imported', app_id };
  }

  if (!p.company) return { status: 'review', app_id: null };
  let a = findApplication(userId, p.company, p.role);
  let created = false;
  if (!a && p.ats) {
    // applied on the company's site with no earlier email: record the application, then this update
    createApplication({ company: p.company, title: p.role, applied_on: localDate(email.date), platform: p.appPlatform,
      job_url: p.job_url || null, review: `Created from a ${p.platform} email (applied on the company's site)` }, 'Gmail', userId);
    a = findApplication(userId, p.company, p.role);
    created = true;
  }
  if (!a) return { status: 'review', app_id: null };
  let changed = false, event_id = null;
  if (p.kind === 'viewed') {
    if (a.current_stage === 'APPLIED') { run("UPDATE application SET current_stage = 'VIEWED' WHERE app_id = ?", [a.app_id]); changed = true; }
    if (!a.viewed_by_employer) { run('UPDATE application SET viewed_by_employer = 1 WHERE app_id = ?', [a.app_id]); changed = true; }
  } else {
    const e = withIcs(email);
    const companyId = q1('SELECT j.company_id FROM application a JOIN job_posting j ON j.job_id = a.job_id WHERE a.app_id = ?', [a.app_id]).company_id;
    const contactId = saveRecruiter(companyId, userId, recruiterFrom(e));
    event_id = saveEvent(a.app_id, userId, email, extractEvent(e), contactId);
    if (KIND_STAGE[p.kind]) advance(a.app_id, KIND_STAGE[p.kind]);
    // keep the email in the call / email log (after the stage change, so the inbound trigger doesn't interfere)
    run(`INSERT INTO interaction (app_id, contact_id, channel, direction, occurred_at, summary) VALUES (?, ?, 'Email', 'Inbound', ?, ?)`,
      [a.app_id, contactId, localDateTime(email.date), `${p.platform} email: ${email.subject}`.slice(0, 300)]);
    changed = true;
  }
  return { status: created ? 'imported' : changed ? 'updated' : 'duplicate', app_id: a.app_id, event_id };
}

/**
 * An email straight from a company / recruiter (or anything in your Jobs label):
 * save the HR, the test / interview and its date, log the email, move the stage.
 * With `create` (Jobs label), a company you have no application for yet gets one.
 */
export function applyRecruiterEmail(email, userId, { create = false } = {}) {
  const e = withIcs(email);
  const companies = q(`SELECT DISTINCT c.company_id, c.name FROM company c
                         JOIN job_posting j ON j.company_id = c.company_id JOIN application a ON a.job_id = j.job_id
                        WHERE a.user_id IS ?`, [userId]);
  let c = matchCompany(e, companies);
  const kind = kindOf(`${e.subject}\n${e.text}`);
  let created = false;
  if (!c && create) {
    const d = parseDirectEmail(e);
    if (!d.company || kind === 'other' && !e.ics) return { status: 'ignored', app_id: null, company: d.company || null, kind };
    createApplication({ company: d.company, title: d.role || 'Role not mentioned in email', applied_on: localDate(email.date),
      platform: 'Company website', review: 'Created from an email in your Jobs label' }, 'Gmail', userId);
    c = q1('SELECT company_id, name FROM company WHERE name = ?', [d.company]);
    created = true;
  }
  if (!c) return { status: 'ignored', app_id: null, company: null, kind };

  const apps = q(`SELECT a.app_id, a.current_stage, s.sort_order, s.is_terminal, j.title
                    FROM application a JOIN job_posting j ON j.job_id = a.job_id JOIN stage s ON s.stage_code = a.current_stage
                   WHERE j.company_id = ? AND a.user_id IS ? ORDER BY s.is_terminal, a.applied_on DESC`, [c.company_id, userId]);
  if (!apps.length) return { status: 'ignored', app_id: null, company: c.name, kind };
  const text = `${e.subject}\n${e.text}`.toLowerCase();
  const a = apps.find(x => text.includes(x.title.toLowerCase())) || apps[0];

  const rec = recruiterFrom(e) || (parseIcs(email.ics)?.organizer ? { full_name: parseIcs(email.ics).organizer.name || parseIcs(email.ics).organizer.email, email: parseIcs(email.ics).organizer.email } : null);
  const contactId = saveRecruiter(c.company_id, userId, rec);
  const event_id = kind === 'rejected' || kind === 'offer' ? null : saveEvent(a.app_id, userId, email, extractEvent(e), contactId);
  if (KIND_STAGE[kind]) advance(a.app_id, KIND_STAGE[kind]);
  // logging the inbound email also moves a waiting application to "HR / recruiter screen" (trigger trg_inbound_contact)
  run(`INSERT INTO interaction (app_id, contact_id, channel, direction, occurred_at, summary) VALUES (?, ?, 'Email', 'Inbound', ?, ?)`,
    [a.app_id, contactId, localDateTime(email.date), `Email from ${rec?.full_name || c.name}: ${email.subject}`.slice(0, 300)]);
  return { status: created ? 'imported' : 'updated', app_id: a.app_id, company: c.name, kind, event_id };
}

/** Gmail search → the messages not read before. */
async function freshMessages(token, userId, query, max) {
  const ids = await listMessageIds(token, query, max);
  const fresh = ids.filter(id => !q1('SELECT 1 FROM email_import WHERE message_id = ?', [`${userId}:${id}`]));
  return { scanned: ids, fresh };
}

const running = new Set();
export async function syncUser(userId) {
  if (running.has(userId)) throw Object.assign(new Error('A sync is already running.'), { status: 409 });
  running.add(userId);
  try {
    const token = await accessToken(userId);
    const u = q1('SELECT last_sync_at FROM app_user WHERE user_id = ?', [userId]);
    const days = u.last_sync_at ? 30 : FIRST_SYNC_DAYS;
    const first = !u.last_sync_at;

    // 1) job-site emails  2) emails from companies / recruiters  3) everything in your Jobs label
    const searches = [
      await freshMessages(token, userId, gmailQuery(days), first ? 100 : 60),
      await freshMessages(token, userId, recruiterQuery(days), first ? 60 : 40),
      await freshMessages(token, userId, labelQuery(JOBS_LABEL, days), first ? 100 : 60),
    ];
    const inLabel = new Set(searches[2].fresh);
    const ids = [...new Set(searches.flatMap(s => s.fresh))];
    const emails = [];
    for (let i = 0; i < ids.length; i += 3) {                         // 8 at a time, to be gentle on the API
      emails.push(...await Promise.all(ids.slice(i, i + 3).map(id => getMessage(token, id)))); await new Promise(r => setTimeout(r, 500));
    }
    emails.sort((x, y) => x.date.localeCompare(y.date));             // oldest first: "applied" before "test" before "offer"

    const summary = { scanned: new Set(searches.flatMap(s => s.scanned)).size, new_emails: emails.length,
                      imported: 0, updated: 0, duplicate: 0, review: 0, ignored: 0, recruiter: 0, events: 0 };
    for (const e of emails) {
      const fromSite = PLATFORMS.some(p => p.match.test(e.from));
      let p = null, out;
      run('UPDATE app_clock SET event_at = ? WHERE id = 1', [localDateTime(e.date)]);   // history rows get the email's date
      try {
        if (fromSite) {
          p = parseJobEmail(e);
          out = applyEmail(p, e, userId);
        } else {
          out = applyRecruiterEmail(e, userId, { create: inLabel.has(e.id) });
          if (out.status !== 'ignored') summary.recruiter++;
        }
      } catch (err) {
        console.error('Could not import', e.subject, err.message);
        out = { status: fromSite ? 'review' : 'ignored', app_id: null };
      } finally {
        run('UPDATE app_clock SET event_at = NULL WHERE id = 1');
      }
      summary[out.status]++;
      if (out.event_id) summary.events++;
      run(`INSERT OR IGNORE INTO email_import (message_id, user_id, received_at, sender, subject, snippet, platform, kind,
                                               company, role, location, job_url, status, app_id, event_id)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [`${userId}:${e.id}`, userId, localDateTime(e.date), e.from.slice(0, 200), e.subject.slice(0, 300), e.snippet.slice(0, 300),
         p?.platform || 'Email', p?.kind || out.kind || 'other', p?.company || out.company || null, p?.role || null,
         p?.location || null, p?.job_url || null, out.status, out.app_id, out.event_id || null]);
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
  const u = needUser(req, res);
  if (!u) return;
  res.json(q(`SELECT message_id, received_at, platform, kind, subject, snippet, company, role, location, job_url
                FROM email_import WHERE status = 'review' AND user_id = ? ORDER BY received_at DESC LIMIT 50`, [u.user_id]));
});

r.post('/gmail/review/:id/add', (req, res) => {
  const u = needUser(req, res);
  if (!u) return;
  const row = q1("SELECT * FROM email_import WHERE message_id = ? AND status = 'review' AND user_id = ?", [req.params.id, u.user_id]);
  if (!row) return res.status(404).json({ error: 'That email is no longer in the review list.' });
  const company = String(req.body?.company || '').trim(), role = String(req.body?.role || '').trim();
  if (!company || !role) return res.status(400).json({ error: 'Company and role are both needed.' });
  const p = { platform: row.platform, appPlatform: row.platform === 'LinkedIn' ? 'LinkedIn Easy Apply' : 'Job portal',
    kind: row.kind === 'other' ? 'applied' : row.kind, company, role, location: row.location, job_url: row.job_url };
  const em = { date: row.received_at.replace(' ', 'T') + '+05:30', subject: row.subject };
  let out = applyEmail(p, em, u.user_id);
  if (out.status === 'review' && p.kind !== 'applied') out = applyEmail({ ...p, kind: 'applied' }, em, u.user_id);
  run('UPDATE email_import SET company = ?, role = ?, status = ?, app_id = ? WHERE message_id = ?',
    [company, role, out.status === 'review' ? 'review' : out.status, out.app_id, row.message_id]);
  res.json(out);
});

r.post('/gmail/review/:id/dismiss', (req, res) => {
  const u = needUser(req, res);
  if (!u) return;
  run("UPDATE email_import SET status = 'ignored' WHERE message_id = ? AND user_id = ?", [req.params.id, u.user_id]);
  res.json({ ok: true });
});

// ---------- background: re-check Gmail every few hours for everyone who connected ----------
export function startAutoSync() {
  const hours = Number(process.env.GMAIL_AUTO_SYNC_HOURS || 1);
  if (!googleConfigured() || !(hours > 0)) return;
  setInterval(async () => {
    for (const { user_id } of q('SELECT user_id FROM app_user WHERE refresh_token IS NOT NULL')) {
      try { await syncUser(user_id); } catch (e) { console.error('Auto-sync failed for user', user_id, e.message); }
    }
  }, hours * 3600 * 1000).unref();
}

export default r;
