// "My data" reports — ready-made views of the signed-in person's own applications.
// Users click a button and see a table; they never type SQL. Every query is fixed here on the
// server and filtered by the signed-in user (user_id IS ?), so nobody can see anyone else's rows.
// The same queries are listed in database/queries.sql and explained in docs/DATABASE.md.
import { Router } from 'express';
import { q } from '../db.js';
import { uid } from '../auth.js';

const YES = col => `CASE WHEN ${col} THEN 'Yes' ELSE 'No' END`;

export const REPORTS = {
  all: {
    title: 'All applications',
    about: 'Every application with its stage, HR contact and latest contact date.',
    sql: `SELECT company AS "Company", role AS "Role", location AS "Location", work_mode AS "Work mode",
                 site AS "Applied via", applied_on AS "Applied on", days_since_applied AS "Days since applied",
                 stage AS "Stage", ${YES('viewed')} AS "Viewed", ${YES('hr_called')} AS "HR called",
                 hr_name AS "HR name", hr_phone AS "HR phone", hr_email AS "HR email",
                 last_contact AS "Last contact", source AS "Added by"
            FROM v_application_overview
           WHERE user_id IS ?
           ORDER BY applied_on DESC, app_id DESC`,
  },
  overview: {
    title: 'Overview',
    about: 'One line per application: where it stands and whether HR has been in touch.',
    sql: `SELECT company AS "Company", role AS "Role", applied_on AS "Applied on",
                 days_since_applied AS "Days ago", stage AS "Stage",
                 ${YES('viewed')} AS "Viewed", ${YES('hr_called')} AS "HR called"
            FROM v_application_overview
           WHERE user_id IS ?
           ORDER BY applied_on DESC`,
  },
  calls: {
    title: 'Who called me?',
    about: 'Every inbound phone or video call, newest first.',
    sql: `SELECT i.occurred_at AS "When", c.name AS "Company", j.title AS "Role",
                 k.full_name AS "Who", k.phone AS "Phone", i.channel AS "How", i.summary AS "What was said"
            FROM interaction i
            JOIN application a  ON a.app_id = i.app_id
            JOIN job_posting j  ON j.job_id = a.job_id
            JOIN company c      ON c.company_id = j.company_id
            LEFT JOIN contact k ON k.contact_id = i.contact_id
           WHERE a.user_id IS ? AND i.direction = 'Inbound' AND i.channel IN ('Phone call','Video call')
           ORDER BY i.occurred_at DESC`,
  },
  rounds: {
    title: 'Tests & interviews',
    about: 'Every round found in your emails or added by hand, with its result.',
    sql: `SELECT COALESCE(e.scheduled_at, e.due_by) AS "Date", c.name AS "Company", j.title AS "Role",
                 e.event_type AS "Type", e.round_name AS "Round", e.mode AS "Mode",
                 COALESCE(e.meeting_link, e.location) AS "Link / venue", k.full_name AS "HR", e.outcome AS "Result"
            FROM interview_event e
            JOIN application a  ON a.app_id = e.app_id
            JOIN job_posting j  ON j.job_id = a.job_id
            JOIN company c      ON c.company_id = j.company_id
            LEFT JOIN contact k ON k.contact_id = e.contact_id
           WHERE a.user_id IS ?
           ORDER BY COALESCE(e.scheduled_at, e.due_by) DESC`,
  },
  followups: {
    title: 'Follow up these',
    about: 'Still open, applied 7 or more days ago, and no contact in the last 7 days.',
    sql: `SELECT company AS "Company", role AS "Role", applied_on AS "Applied on",
                 days_since_applied AS "Days ago", stage AS "Stage", hr_name AS "HR name", hr_email AS "HR email"
            FROM v_followups_due
           WHERE user_id IS ?`,
  },
  platforms: {
    title: 'Response rate by site',
    about: 'How often each job site led to any reply.',
    sql: `SELECT site AS "Applied via", COUNT(*) AS "Applied",
                 SUM(stage_code NOT IN ('APPLIED','GHOSTED')) AS "Got a reply",
                 ROUND(100.0 * SUM(stage_code NOT IN ('APPLIED','GHOSTED')) / COUNT(*), 1) AS "Reply rate %"
            FROM v_application_overview
           WHERE user_id IS ?
           GROUP BY site
           ORDER BY "Reply rate %" DESC`,
  },
  firstcall: {
    title: 'Days to first call',
    about: 'How long companies took to make first contact after you applied.',
    sql: `SELECT c.name AS "Company", j.title AS "Role", a.applied_on AS "Applied on", f.first_contact AS "First contact",
                 CAST(julianday(f.first_contact) - julianday(a.applied_on) AS INTEGER) AS "Days to first contact"
            FROM application a
            JOIN job_posting j ON j.job_id = a.job_id
            JOIN company c     ON c.company_id = j.company_id
            JOIN (SELECT app_id, MIN(occurred_at) AS first_contact
                    FROM interaction WHERE direction = 'Inbound' GROUP BY app_id) f ON f.app_id = a.app_id
           WHERE a.user_id IS ?
           ORDER BY "Days to first contact"`,
  },
  companies: {
    title: 'Same company, many roles',
    about: 'Companies where you applied for more than one role.',
    sql: `SELECT company AS "Company", COUNT(*) AS "Applications", GROUP_CONCAT(role, '; ') AS "Roles",
                 MIN(applied_on) AS "First applied", MAX(applied_on) AS "Last applied"
            FROM (SELECT * FROM v_application_overview WHERE user_id IS ? ORDER BY applied_on)
           GROUP BY company_id
          HAVING COUNT(*) > 1
           ORDER BY "Applications" DESC`,
  },
  history: {
    title: 'Stage history',
    about: 'Every stage change, newest first.',
    sql: `SELECT h.changed_at AS "When", c.name AS "Company", j.title AS "Role",
                 COALESCE(f.label, '—') AS "From", t.label AS "To"
            FROM status_history h
            JOIN application a ON a.app_id = h.app_id
            JOIN job_posting j ON j.job_id = a.job_id
            JOIN company c     ON c.company_id = j.company_id
            LEFT JOIN stage f  ON f.stage_code = h.from_stage
            JOIN stage t       ON t.stage_code = h.to_stage
           WHERE a.user_id IS ?
           ORDER BY h.changed_at DESC, h.history_id DESC`,
  },
  recruiters: {
    title: 'Recruiters',
    about: 'Everyone from a company who has been in touch.',
    sql: `SELECT k.full_name AS "Name", c.name AS "Company", k.role_title AS "Title",
                 k.email AS "Email", k.phone AS "Phone"
            FROM contact k
            JOIN company c ON c.company_id = k.company_id
           WHERE k.user_id IS ?
           ORDER BY c.name, k.full_name`,
  },
  emails: {
    title: 'Emails read',
    about: 'Job emails JobTrail read from Gmail and what it did with each.',
    sql: `SELECT received_at AS "Received", platform AS "From", kind AS "Kind",
                 company AS "Company", role AS "Role", status AS "Result", subject AS "Subject"
            FROM email_import
           WHERE user_id IS ?
           ORDER BY received_at DESC
           LIMIT 300`,
  },
};

function runReport(key, req) {
  const rep = REPORTS[key];
  if (!rep) return null;
  const rows = q(rep.sql, [uid(req)]);
  const columns = rows.length ? Object.keys(rows[0]) : (rep.sql.match(/AS "([^"]+)"/g) || []).map(s => s.slice(4, -1));
  return { key, title: rep.title, about: rep.about, columns: [...new Set(columns)], rows: rows.map(r => columns.map(c => r[c])) };
}

const r = Router();

r.get('/reports', (_req, res) => res.json(Object.entries(REPORTS).map(([key, v]) => ({ key, title: v.title, about: v.about }))));

r.get('/reports/:key.csv', (req, res) => {
  const out = runReport(req.params.key, req);
  if (!out) return res.status(404).send('No such report');
  const cell = v => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const csv = [out.columns.map(cell).join(','), ...out.rows.map(row => row.map(cell).join(','))].join('\n');
  const name = out.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  res.setHeader('Content-Disposition', `attachment; filename="jobtrail-${name}-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.type('text/csv').send('﻿' + csv);   // BOM so Excel opens Indian names and ₹ correctly
});

r.get('/reports/:key', (req, res) => {
  const out = runReport(req.params.key, req);
  if (!out) return res.status(404).json({ error: 'No such report' });
  res.json(out);
});

export default r;
