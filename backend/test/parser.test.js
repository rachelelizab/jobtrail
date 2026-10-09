// Run with:  npm test   (inside backend/)   — uses Node's built-in test runner, no packages needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLES as S } from './samples.js';
import { extractEvent, parseIcs, findPhone } from '../src/scheduleParser.js';
import { parseJobEmail, recruiterFrom, kindOf } from '../src/emailParser.js';

const kind = e => kindOf(`${e.subject}\n${e.text}`);

test('job-site confirmation emails become applications', () => {
  assert.deepEqual(
    (({ platform, kind, company, role }) => ({ platform, kind, company, role }))(parseJobEmail(S.linkedinApplied)),
    { platform: 'LinkedIn', kind: 'applied', company: 'Flipkart', role: 'Data Scientist' });
  const n = parseJobEmail(S.naukriApplied);
  assert.equal(n.company, 'Swiggy'); assert.equal(n.role, 'Data Analyst'); assert.equal(n.platform, 'Naukri');
  assert.equal(extractEvent(S.linkedinApplied), null, 'an application receipt is not a test or interview');
});

test('online test: round, deadline, link and HR from the signature', () => {
  assert.equal(kind(S.hrTest), 'test');
  const e = extractEvent(S.hrTest);
  assert.equal(e.event_type, 'Test');
  assert.equal(e.round_name, 'Round 1 – Online Assessment');
  assert.equal(e.due_by, '2026-10-12 23:59:00');
  assert.equal(e.meeting_link, 'https://www.hackerrank.com/test/abc123xyz');
  assert.deepEqual(recruiterFrom(S.hrTest), { full_name: 'Priya Raman', email: 'priya.raman@flipkart.com', phone: '+91 98450 21734', role_title: 'Talent Acquisition' });
});

test('interview from a careers@ address: date, time, Meet link, HR in signature', () => {
  const e = extractEvent(S.hrInterview);
  assert.equal(e.event_type, 'Interview');
  assert.equal(e.round_name, 'Technical Round');
  assert.equal(e.scheduled_at, '2026-10-14 15:30:00');
  assert.equal(e.mode, 'Online');
  assert.match(e.meeting_link, /meet\.google\.com/);
  const hr = recruiterFrom(S.hrInterview);
  assert.equal(hr.full_name, 'Arjun Mehta'); assert.equal(hr.phone, '99001 45528'); assert.equal(hr.role_title, 'Senior Recruiter');
});

test('calendar invite (.ics): exact time in IST, organiser as HR, Zoom id is not a phone', () => {
  assert.equal(kind(S.calendarInvite), 'interview');
  const e = extractEvent(S.calendarInvite);
  assert.equal(e.event_type, 'HR round');
  assert.equal(e.scheduled_at, '2026-10-16 11:00:00');
  assert.equal(e.ends_at, '2026-10-16 11:30:00');
  assert.deepEqual(e.organizer, { name: 'Neha Kulkarni', email: 'neha.k@zeptonow.com' });
  assert.equal(findPhone(S.calendarInvite.text), '');
  assert.equal(parseIcs(S.calendarInvite.ics).link, 'https://zoom.us/j/9876543210');
});

test('offer, rejection, and "selected for the next round" are told apart', () => {
  assert.equal(kind(S.offer), 'offer');
  assert.equal(kind(S.rejection), 'rejected');
  assert.equal(kind(S.nextRound), 'interview');
  assert.equal(extractEvent(S.rejection), null);
});

test('in-person round with Indian date format and venue', () => {
  const e = extractEvent(S.nextRound);
  assert.equal(e.round_name, 'Round 2 – Technical Interview');
  assert.equal(e.scheduled_at, '2026-10-17 11:00:00');
  assert.equal(e.mode, 'In person');
  assert.match(e.location, /Embassy Tech Village/);
});

test('walk-in: contact person and landline from the body', () => {
  const e = extractEvent(S.walkIn);
  assert.equal(e.round_name, 'Walk-in Interview');
  assert.equal(e.scheduled_at, '2026-10-20 10:00:00');
  assert.deepEqual(recruiterFrom(S.walkIn), { full_name: 'Kavya Rao', email: null, phone: '080-2852 0261', role_title: null });
});

test('HR emails in the Jobs label: company from the sender domain, role that looks like a job title', async () => {
  const { parseDirectEmail } = await import('../src/emailParser.js');
  const { parseIcs } = await import('../src/scheduleParser.js');
  const pick = e => (({ company, role }) => ({ company, role }))(parseDirectEmail(e));
  assert.deepEqual(pick(S.hrTest), { company: 'Flipkart', role: 'Data Scientist' });
  assert.deepEqual(pick(S.hrInterview), { company: 'Swiggy', role: 'Data Analyst' });
  assert.deepEqual(pick(S.offer), { company: 'Flipkart', role: 'Data Scientist' });
  assert.deepEqual(pick(S.rejection), { company: 'Zepto', role: 'Business Analyst' });
  assert.deepEqual(pick(S.walkIn), { company: 'Infosys', role: 'Data Analyst' });
  const inv = { ...S.calendarInvite, text: `${S.calendarInvite.text}\n${parseIcs(S.calendarInvite.ics).description}` };
  assert.deepEqual(pick(inv), { company: 'Zepto', role: 'Business Analyst' });
});

test('company hiring systems: the company from the email, never "Workday" or "Greenhouse"', () => {
  const pick = e => (({ platform, kind, company, role }) => ({ platform, kind, company, role }))(parseJobEmail(e));
  assert.deepEqual(pick(S.workdayApplied), { platform: 'Workday', kind: 'applied', company: 'PhonePe', role: 'Senior Data Analyst' });
  assert.deepEqual(pick(S.greenhouseApplied), { platform: 'Greenhouse', kind: 'applied', company: 'Razorpay', role: 'Data Scientist' });
  assert.deepEqual(pick(S.leverApplied), { platform: 'Lever', kind: 'applied', company: 'CRED', role: 'Product Analyst' });
  assert.deepEqual(pick(S.darwinboxRejected), { platform: 'Darwinbox', kind: 'rejected', company: 'Meesho', role: 'Business Analyst' });
  assert.deepEqual(pick(S.kekaInterview), { platform: 'Keka', kind: 'interview', company: 'Groww', role: 'Data Analyst' });
  assert.equal(extractEvent(S.kekaInterview).scheduled_at, '2026-10-21 14:00:00');
});
