// End-to-end test of the Gmail sync against a simulated Gmail (no Google account needed).
// Run with:  npm test   (inside backend/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { SAMPLES as S } from './samples.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobtrail-'));
process.env.DB_FILE = path.join(dir, 'test.db');
process.env.GOOGLE_CLIENT_ID = 'test'; process.env.GOOGLE_CLIENT_SECRET = 'test';
process.env.APP_TIMEZONE = 'Asia/Kolkata';

// ---- simulated Gmail: which search finds which email ----
const SITES = /@(?:[\w-]+\.)*(linkedin\.com|naukri\.com|myworkday\.com|greenhouse-mail\.io|lever\.co|darwinbox\.in|keka\.com)\b/i;
const inbox = [
  { ...S.linkedinApplied }, { ...S.naukriApplied }, { ...S.hrTest }, { ...S.hrInterview },
  { ...S.calendarInvite, label: true }, { ...S.nextRound }, { ...S.rejection, label: true }, { ...S.offer }, { ...S.walkIn },
  { ...S.workdayApplied }, { ...S.greenhouseApplied }, { ...S.leverApplied }, { ...S.darwinboxRejected }, { ...S.kekaInterview },
];
const b64 = s => Buffer.from(s, 'utf8').toString('base64url');
function asGmail(m) {
  const parts = [{ mimeType: 'text/plain', body: { data: b64(m.text) } }];
  if (m.ics) parts.push({ mimeType: 'application/ics', filename: 'invite.ics', body: { attachmentId: `att-${m.id}` } });
  return { id: m.id, snippet: m.text.slice(0, 80), internalDate: String(Date.parse(m.date)),
           payload: { mimeType: 'multipart/mixed', headers: [{ name: 'From', value: m.from }, { name: 'Subject', value: m.subject }], parts } };
}
const json = body => ({ ok: true, status: 200, json: async () => body });
globalThis.fetch = async (url) => {
  const u = new URL(url);
  if (u.hostname === 'oauth2.googleapis.com') return json({ access_token: 'tok', expires_in: 3600 });
  const att = u.pathname.match(/attachments\/att-(\w+)$/);
  if (att) return json({ data: b64(inbox.find(m => m.id === att[1]).ics) });
  const one = u.pathname.match(/messages\/(\w+)$/);
  if (one) return json(asGmail(inbox.find(m => m.id === one[1])));
  const q = u.searchParams.get('q') || '';
  const hits = inbox.filter(m => q.startsWith('label:') ? m.label
    : q.startsWith('-from:') ? !SITES.test(m.from) : SITES.test(m.from));
  return json({ messages: hits.map(m => ({ id: m.id })) });
};

const { run, q, q1 } = await import('../src/db.js');
const { syncUser } = await import('../src/routes/gmail.js');
const userId = run(`INSERT INTO app_user (google_sub, email, name, refresh_token) VALUES ('sub-1', 'rachel@example.com', 'Rachel', 'refresh')`).lastInsertRowid;
const summary = await syncUser(userId);
const app = (company) => q1(`SELECT a.app_id, j.title, a.current_stage, a.source FROM application a JOIN job_posting j ON j.job_id = a.job_id
                              JOIN company c ON c.company_id = j.company_id WHERE a.user_id = ? AND c.name = ?`, [userId, company]);
const rounds = appId => q('SELECT round_name, event_type, scheduled_at, due_by, mode, meeting_link, location, outcome FROM interview_event WHERE app_id = ? ORDER BY event_id', [appId]);

test('every job email is read once, nothing needs typing', () => {
  assert.equal(summary.new_emails, 14);
  assert.equal(summary.review, 0);
  assert.equal(q('SELECT 1 FROM application WHERE user_id = ?', [userId]).length, 8,
    'Flipkart, Swiggy, Zepto + PhonePe, Razorpay, CRED, Meesho, Groww — not Infosys (never applied, not in the label)');
});

test('Flipkart: applied → online test → round 2 → offer; rounds marked passed', () => {
  const a = app('Flipkart');
  assert.equal(a.title, 'Data Scientist'); assert.equal(a.current_stage, 'OFFER');
  const r = rounds(a.app_id);
  assert.deepEqual(r.map(x => [x.round_name, x.outcome]), [['Round 1 – Online Assessment', 'Passed'], ['Round 2 – Technical Interview', 'Passed']]);
  assert.equal(r[0].due_by, '2026-10-12 23:59:00'); assert.match(r[0].meeting_link, /hackerrank/);
  assert.equal(r[1].scheduled_at, '2026-10-17 11:00:00'); assert.equal(r[1].mode, 'In person');
  const hr = q1('SELECT full_name, phone, role_title, email FROM contact WHERE user_id = ? AND full_name = ?', [userId, 'Priya Raman']);
  assert.deepEqual(hr, { full_name: 'Priya Raman', phone: '+91 98450 21734', role_title: 'Talent Acquisition', email: 'priya.raman@flipkart.com' });
});

test('Swiggy (Naukri): technical round with date, time, Meet link and HR from the signature', () => {
  const a = app('Swiggy');
  assert.equal(a.current_stage, 'INTERVIEW');
  const [r] = rounds(a.app_id);
  assert.equal(r.round_name, 'Technical Round'); assert.equal(r.scheduled_at, '2026-10-14 15:30:00'); assert.match(r.meeting_link, /meet\.google/);
  assert.deepEqual(q1('SELECT full_name, phone, role_title FROM contact WHERE user_id = ? AND full_name = ?', [userId, 'Arjun Mehta']),
    { full_name: 'Arjun Mehta', phone: '99001 45528', role_title: 'Senior Recruiter' });
});

test('Zepto (only in the Jobs label): application created from a calendar invite, then rejected', () => {
  const a = app('Zepto');
  assert.equal(a.title, 'Business Analyst'); assert.equal(a.current_stage, 'REJECTED'); assert.equal(a.source, 'Gmail');
  const [r] = rounds(a.app_id);
  assert.equal(r.event_type, 'HR round'); assert.equal(r.scheduled_at, '2026-10-16 11:00:00'); assert.equal(r.outcome, 'Not selected');
  assert.ok(q1('SELECT 1 FROM contact WHERE user_id = ? AND email = ?', [userId, 'neha.k@zeptonow.com']));
});

test('company hiring-system emails (applied on the company site) need no typing either', () => {
  assert.deepEqual(app('PhonePe') && [app('PhonePe').title, app('PhonePe').current_stage], ['Senior Data Analyst', 'APPLIED']);
  assert.equal(app('Razorpay').title, 'Data Scientist');
  assert.equal(app('CRED').title, 'Product Analyst');
  assert.deepEqual([app('Meesho').title, app('Meesho').current_stage], ['Business Analyst', 'REJECTED']);
  const g = app('Groww');
  assert.deepEqual([g.title, g.current_stage], ['Data Analyst', 'INTERVIEW']);
  assert.equal(rounds(g.app_id)[0].scheduled_at, '2026-10-21 14:00:00');
  assert.equal(q1('SELECT phone FROM contact WHERE user_id = ? AND full_name = ?', [userId, 'Sneha Iyer']).phone, '+91 91234 56789');
  assert.equal(q1("SELECT COUNT(*) AS n FROM company WHERE name IN ('Workday','Greenhouse','Myworkday','Lever','Keka')").n, 0);
});

test('stage history is dated by each email, not by the sync', () => {
  const h = q("SELECT to_stage, changed_at FROM status_history WHERE app_id = ? ORDER BY history_id", [app('Flipkart').app_id]);
  assert.deepEqual(h.map(x => [x.to_stage, x.changed_at.slice(0, 10)]),
    [['APPLIED', '2026-10-09'], ['ASSESS', '2026-10-10'], ['INTERVIEW', '2026-10-13'], ['OFFER', '2026-10-20']]);
});

test('a second sync reads nothing again', async () => {
  const again = await syncUser(userId);
  assert.equal(again.new_emails, 0);
  assert.equal(q('SELECT 1 FROM interview_event WHERE user_id = ?', [userId]).length, 5);
});

test('other people never see these applications', () => {
  assert.equal(q('SELECT 1 FROM v_application_overview WHERE user_id IS NULL AND company = ?', ['Zepto']).length, 0);
});
