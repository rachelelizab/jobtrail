import { Router } from 'express';
import fs from 'node:fs';
import { q, q1, dbReadOnly, SCHEMA_FILE, DB_FILE, backupStatus } from '../db.js';
import { uid, isAdmin } from '../auth.js';

const r = Router();

r.get('/health', (_req, res) => {
  const row = q1("SELECT sqlite_version() AS version, (SELECT COUNT(*) FROM application) AS applications");
  res.json({ ok: true, engine: 'SQLite', file: DB_FILE, ...row, backup: backupStatus() });
});

r.get('/stages', (_req, res) => res.json(q('SELECT * FROM stage ORDER BY sort_order')));

r.get('/companies', (_req, res) => res.json(q('SELECT company_id, name FROM company ORDER BY name COLLATE NOCASE')));

// "HR just called?" — match company, role, recruiter name, email, website or phone digits
const DIGITS = col => `replace(replace(replace(replace(replace(IFNULL(${col},''),' ',''),'-',''),'+',''),'(',''),')','')`;
r.get('/lookup', (req, res) => {
  const raw = String(req.query.q || '').trim();
  if (!raw) return res.json([]);
  const like = `%${raw}%`;
  const digits = raw.replace(/\D/g, '');
  const dl = digits.length >= 4 ? `%${digits}%` : '__no_phone_match__';
  const ids = q(
    `SELECT a.app_id
       FROM application a
       JOIN job_posting j ON j.job_id = a.job_id
       JOIN company c     ON c.company_id = j.company_id
       LEFT JOIN contact k ON k.company_id = c.company_id AND k.user_id IS a.user_id
      WHERE a.user_id IS ?
        AND (c.name LIKE ? OR j.title LIKE ? OR k.full_name LIKE ? OR k.email LIKE ? OR c.website LIKE ?
             OR ${DIGITS('k.phone')} LIKE ?)
      GROUP BY a.app_id
      ORDER BY a.applied_on DESC
      LIMIT 6`, [uid(req), like, like, like, like, like, dl]);
  res.json(ids.map(({ app_id }) => {
    const a = q1(
      `SELECT a.app_id, a.applied_on, a.platform, a.resume_version, a.current_stage, s.label AS stage_label, s.phase,
              c.company_id, c.name AS company, j.title, j.location, j.work_mode
         FROM application a JOIN job_posting j ON j.job_id = a.job_id
         JOIN company c ON c.company_id = j.company_id JOIN stage s ON s.stage_code = a.current_stage
        WHERE a.app_id = ?`, [app_id]);
    a.contacts = q('SELECT full_name, role_title FROM contact WHERE company_id = ? AND user_id IS ?', [a.company_id, uid(req)]);
    a.last_contact = q1('SELECT channel, occurred_at, summary FROM interaction WHERE app_id = ? ORDER BY occurred_at DESC LIMIT 1', [app_id]) || null;
    return a;
  }));
});

// Dashboard: the same logic as the views v_pipeline / v_monthly_activity / v_company_summary,
// filtered to the person who is signed in (or the demo data when nobody is).
r.get('/dashboard', (req, res) => {
  const me = uid(req);
  const kpi = q1(
    `SELECT COUNT(*) AS applied,
            SUM(viewed OR hr_called OR stage_code NOT IN ('APPLIED','GHOSTED','WITHDRAWN')) AS heard_back,
            SUM(hr_called) AS hr_calls,
            SUM(stage_code IN ('INTERVIEW','FINAL','OFFER','ACCEPTED')) AS interviews,
            SUM(stage_code IN ('OFFER','ACCEPTED')) AS offers,
            SUM(stage_code = 'REJECTED') AS rejected
       FROM v_application_overview WHERE user_id IS ?`, [me]);
  const num = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Number(v) || 0]));
  res.json({
    kpi: num(kpi),
    pipeline: q(`SELECT s.sort_order, s.stage_code, s.label, s.phase, COUNT(a.app_id) AS applications
                   FROM stage s LEFT JOIN application a ON a.current_stage = s.stage_code AND a.user_id IS ?
                  GROUP BY s.stage_code ORDER BY s.sort_order`, [me]),
    monthly: q(`SELECT strftime('%Y-%m', applied_on) AS month, COUNT(*) AS applied,
                       SUM(current_stage NOT IN ('APPLIED','GHOSTED')) AS got_response,
                       SUM(current_stage IN ('INTERVIEW','FINAL','OFFER','ACCEPTED')) AS reached_interview
                  FROM application WHERE user_id IS ? GROUP BY month ORDER BY month`, [me]),
    followups: q('SELECT * FROM v_followups_due WHERE user_id IS ? LIMIT 8', [me]),
    companies: q(`SELECT company_id, company, COUNT(*) AS applications, GROUP_CONCAT(role, '; ') AS roles,
                         MIN(applied_on) AS first_applied, MAX(applied_on) AS last_applied
                    FROM (SELECT * FROM v_application_overview WHERE user_id IS ? ORDER BY applied_on)
                   GROUP BY company_id ORDER BY applications DESC, last_applied DESC LIMIT 10`, [me]),
  });
});

r.get('/schema', (_req, res) => res.type('text/plain').send(fs.readFileSync(SCHEMA_FILE, 'utf8')));

// SQL console: one statement, run on a READ-ONLY connection — the engine itself refuses any write.
r.post('/sql', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'The SQL console shows everyone\'s data, so only the project owner can use it on the live site.' });
  const sql = String(req.body?.sql || '').trim().replace(/;\s*$/, '');
  if (!sql) return res.status(400).json({ error: 'Type a query first.' });
  if (!/^(select|with|pragma|explain|values)\b/i.test(sql))
    return res.status(400).json({ error: 'The console is read-only. Start the query with SELECT, WITH, PRAGMA or EXPLAIN.' });
  try {
    const stmt = dbReadOnly.prepare(sql);
    const t0 = process.hrtime.bigint();
    const objs = stmt.all();
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const columns = typeof stmt.columns === 'function' ? stmt.columns().map(c => c.name) : Object.keys(objs[0] || {});
    const rows = objs.slice(0, 500).map(o => columns.map(c => o[c]));
    res.json({ columns, rows, total: objs.length, truncated: objs.length > 500, ms: Number(ms.toFixed(1)) });
  } catch (e) {
    res.status(400).json({ error: e.message.replace(/^.*?: /, '') || e.message });
  }
});

r.get('/export/applications.csv', (req, res) => {
  const rows = q('SELECT * FROM v_application_overview WHERE user_id IS ? ORDER BY applied_on DESC', [uid(req)]);
  const cols = rows.length ? Object.keys(rows[0]) : ['company', 'role'];
  const cell = v => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const csv = [cols.join(','), ...rows.map(row => cols.map(c => cell(row[c])).join(','))].join('\n');
  res.setHeader('Content-Disposition', `attachment; filename="jobtrail-applications-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.type('text/csv').send(csv);
});

export default r;
