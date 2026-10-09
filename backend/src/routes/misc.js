import { Router } from 'express';
import fs from 'node:fs';
import { q, q1, dbReadOnly, SCHEMA_FILE, DB_FILE } from '../db.js';

const r = Router();

r.get('/health', (_req, res) => {
  const row = q1("SELECT sqlite_version() AS version, (SELECT COUNT(*) FROM application) AS applications");
  res.json({ ok: true, engine: 'SQLite', file: DB_FILE, ...row });
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
       LEFT JOIN contact k ON k.company_id = c.company_id
      WHERE c.name LIKE ? OR j.title LIKE ? OR k.full_name LIKE ? OR k.email LIKE ? OR c.website LIKE ?
         OR ${DIGITS('k.phone')} LIKE ?
      GROUP BY a.app_id
      ORDER BY a.applied_on DESC
      LIMIT 6`, [like, like, like, like, like, dl]);
  res.json(ids.map(({ app_id }) => {
    const a = q1(
      `SELECT a.app_id, a.applied_on, a.platform, a.resume_version, a.current_stage, s.label AS stage_label, s.phase,
              c.company_id, c.name AS company, j.title, j.location, j.work_mode
         FROM application a JOIN job_posting j ON j.job_id = a.job_id
         JOIN company c ON c.company_id = j.company_id JOIN stage s ON s.stage_code = a.current_stage
        WHERE a.app_id = ?`, [app_id]);
    a.contacts = q('SELECT full_name, role_title FROM contact WHERE company_id = ?', [a.company_id]);
    a.last_contact = q1('SELECT channel, occurred_at, summary FROM interaction WHERE app_id = ? ORDER BY occurred_at DESC LIMIT 1', [app_id]) || null;
    return a;
  }));
});

r.get('/dashboard', (_req, res) => {
  const kpi = q1(
    `SELECT COUNT(*) AS applied,
            SUM(viewed OR hr_called OR stage_code NOT IN ('APPLIED','GHOSTED','WITHDRAWN')) AS heard_back,
            SUM(hr_called) AS hr_calls,
            SUM(stage_code IN ('INTERVIEW','FINAL','OFFER','ACCEPTED')) AS interviews,
            SUM(stage_code IN ('OFFER','ACCEPTED')) AS offers,
            SUM(stage_code = 'REJECTED') AS rejected
       FROM v_application_overview`);
  const num = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Number(v) || 0]));
  res.json({
    kpi: num(kpi),
    pipeline: q('SELECT * FROM v_pipeline'),
    monthly: q('SELECT * FROM v_monthly_activity'),
    followups: q('SELECT * FROM v_followups_due LIMIT 8'),
    companies: q('SELECT * FROM v_company_summary LIMIT 10'),
  });
});

r.get('/schema', (_req, res) => res.type('text/plain').send(fs.readFileSync(SCHEMA_FILE, 'utf8')));

// SQL console: one statement, run on a READ-ONLY connection — the engine itself refuses any write.
r.post('/sql', (req, res) => {
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

r.get('/export/applications.csv', (_req, res) => {
  const rows = q('SELECT * FROM v_application_overview ORDER BY applied_on DESC');
  const cols = rows.length ? Object.keys(rows[0]) : ['company', 'role'];
  const cell = v => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const csv = [cols.join(','), ...rows.map(row => cols.map(c => cell(row[c])).join(','))].join('\n');
  res.setHeader('Content-Disposition', `attachment; filename="jobtrail-applications-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.type('text/csv').send(csv);
});

export default r;
