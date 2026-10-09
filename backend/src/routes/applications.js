import { Router } from 'express';
import { q, q1, run, tx } from '../db.js';

const r = Router();

const MODES = ['On-site', 'Hybrid', 'Remote'];
const TYPES = ['Full-time', 'Part-time', 'Contract', 'Internship'];
const PLATFORMS = ['LinkedIn Easy Apply', 'LinkedIn to company site', 'Company website', 'Referral', 'Job portal', 'Other'];

const clean = v => (v === undefined || v === null ? null : String(v).trim() || null);
export const linkedinId = url => {
  const m = String(url || '').match(/(?:jobs\/view\/(?:[^/?#]*-)?|currentJobId=)(\d{6,})/);
  return m ? m[1] : null;
};
const notFound = msg => Object.assign(new Error(msg), { status: 404 });

/** Shared validation for create / update. Returns an error message or null. */
function validate(b) {
  if (!clean(b.company)) return 'Company is required.';
  if (!clean(b.title)) return 'Role / job title is required.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.applied_on || ''))) return 'Applied date must be a date (YYYY-MM-DD).';
  if (clean(b.work_mode) && !MODES.includes(b.work_mode)) return 'Work mode must be On-site, Hybrid or Remote.';
  if (clean(b.employment_type) && !TYPES.includes(b.employment_type)) return 'Unknown employment type.';
  if (clean(b.platform) && !PLATFORMS.includes(b.platform)) return 'Unknown platform.';
  if (b.priority !== undefined && b.priority !== null && b.priority !== '' && !(Number(b.priority) >= 1 && Number(b.priority) <= 5))
    return 'Priority must be between 1 and 5.';
  return null;
}

/** Find a company by name (case-insensitive, via COLLATE NOCASE) or create it. */
function findOrCreateCompany(b) {
  const found = q1('SELECT company_id FROM company WHERE name = ?', [clean(b.company)]);
  if (found) {
    run(`UPDATE company SET website = COALESCE(?, website), address = COALESCE(?, address), city = COALESCE(?, city)
          WHERE company_id = ?`, [clean(b.website), clean(b.address), clean(b.city), found.company_id]);
    return found.company_id;
  }
  return run('INSERT INTO company (name, website, address, city) VALUES (?,?,?,?)',
    [clean(b.company), clean(b.website), clean(b.address), clean(b.city)]).lastInsertRowid;
}

/** Company (find or create) → posting → application [→ recruiter], in one transaction. Returns app_id. */
export function createApplication(b, source = 'Manual') {
  return tx(() => {
    const companyId = findOrCreateCompany(b);
    const jobId = run(
      `INSERT INTO job_posting (company_id, title, location, work_mode, employment_type, job_url, external_job_id, salary_text, description)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [companyId, clean(b.title), clean(b.location), clean(b.work_mode), clean(b.employment_type),
       clean(b.job_url), linkedinId(b.job_url), clean(b.salary_text), clean(b.description)]).lastInsertRowid;
    const id = run(
      `INSERT INTO application (job_id, applied_on, platform, resume_version, priority, review, source) VALUES (?,?,?,?,?,?,?)`,
      [jobId, b.applied_on, clean(b.platform) || 'LinkedIn Easy Apply', clean(b.resume_version),
       b.priority ? Number(b.priority) : null, clean(b.review), source]).lastInsertRowid;
    if (clean(b.k_name)) {
      run('INSERT INTO contact (company_id, full_name, role_title, email, phone) VALUES (?,?,?,?,?)',
        [companyId, clean(b.k_name), clean(b.k_role), clean(b.k_email), clean(b.k_phone)]);
    }
    return id;
  });
}

// ---------- list ----------
r.get('/applications', (req, res) => {
  const { phase, q: search, sort } = req.query;
  const where = [], params = [];
  if (phase && phase !== 'All') { where.push('phase = ?'); params.push(phase); }
  if (search) {
    where.push('(company LIKE ? OR role LIKE ? OR location LIKE ? OR stage LIKE ? OR platform LIKE ? OR hr_name LIKE ? OR hr_phone LIKE ?)');
    const like = `%${search}%`; params.push(like, like, like, like, like, like, like);
  }
  const order = {
    oldest: 'applied_on ASC, app_id ASC',
    company: 'company COLLATE NOCASE ASC, applied_on DESC',
    priority: 'priority IS NULL, priority DESC, applied_on DESC',
  }[sort] || 'applied_on DESC, app_id DESC';
  const rows = q(`SELECT * FROM v_application_overview ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order}`, params);
  const counts = q('SELECT phase, COUNT(*) AS n FROM v_application_overview GROUP BY phase');
  res.json({ rows, counts: Object.fromEntries(counts.map(c => [c.phase, c.n])) });
});

// ---------- one application with everything ----------
r.get('/applications/:id', (req, res) => {
  const id = Number(req.params.id);
  const app = q1(
    `SELECT a.*, j.title, j.location, j.work_mode, j.employment_type, j.job_url, j.external_job_id, j.salary_text, j.description,
            c.company_id, c.name AS company, c.website, c.address, c.city, s.label AS stage_label, s.phase
       FROM application a
       JOIN job_posting j ON j.job_id = a.job_id
       JOIN company c     ON c.company_id = j.company_id
       JOIN stage s       ON s.stage_code = a.current_stage
      WHERE a.app_id = ?`, [id]);
  if (!app) return res.status(404).json({ error: 'Application not found.' });
  const contacts = q('SELECT * FROM contact WHERE company_id = ? ORDER BY full_name', [app.company_id]);
  const history = q(
    `SELECT h.*, sf.label AS from_label, st.label AS to_label
       FROM status_history h
       LEFT JOIN stage sf ON sf.stage_code = h.from_stage
       JOIN stage st      ON st.stage_code = h.to_stage
      WHERE h.app_id = ? ORDER BY h.changed_at, h.history_id`, [id]);
  const interactions = q(
    `SELECT i.*, k.full_name FROM interaction i LEFT JOIN contact k ON k.contact_id = i.contact_id
      WHERE i.app_id = ? ORDER BY i.occurred_at`, [id]);
  res.json({ ...app, contacts, history, interactions });
});

// ---------- create: company (find or create) → posting → application, in one transaction ----------
r.post('/applications', (req, res) => {
  const b = req.body || {};
  const err = validate(b);
  if (err) return res.status(400).json({ error: err });
  if (clean(b.k_email) && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.k_email))
    return res.status(400).json({ error: 'The recruiter email does not look complete (name@company.com).' });

  const appId = createApplication(b);
  res.status(201).json({ app_id: appId });
});

// ---------- update details ----------
r.put('/applications/:id', (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  const err = validate(b);
  if (err) return res.status(400).json({ error: err });

  tx(() => {
    const cur = q1(
      `SELECT a.job_id, j.company_id, c.name FROM application a
         JOIN job_posting j ON j.job_id = a.job_id JOIN company c ON c.company_id = j.company_id
        WHERE a.app_id = ?`, [id]);
    if (!cur) throw notFound('Application not found.');

    const sameCompany = cur.name.toLowerCase() === clean(b.company).toLowerCase();
    const companyId = sameCompany ? cur.company_id : findOrCreateCompany(b);
    run('UPDATE company SET name = ?, website = ?, address = ?, city = ? WHERE company_id = ?',
      [clean(b.company), clean(b.website), clean(b.address), clean(b.city), companyId]);
    run(`UPDATE job_posting SET company_id = ?, title = ?, location = ?, work_mode = ?, employment_type = ?,
                job_url = ?, external_job_id = ?, salary_text = ?, description = ? WHERE job_id = ?`,
      [companyId, clean(b.title), clean(b.location), clean(b.work_mode), clean(b.employment_type),
       clean(b.job_url), linkedinId(b.job_url), clean(b.salary_text), clean(b.description), cur.job_id]);
    run(`UPDATE application SET applied_on = ?, platform = ?, resume_version = ?, priority = ?, review = ?,
                last_updated = datetime('now','localtime') WHERE app_id = ?`,
      [b.applied_on, clean(b.platform) || 'LinkedIn Easy Apply', clean(b.resume_version),
       b.priority ? Number(b.priority) : null, clean(b.review), id]);
    if (!sameCompany) {
      run('DELETE FROM company WHERE company_id = ? AND NOT EXISTS (SELECT 1 FROM job_posting WHERE company_id = ?)',
        [cur.company_id, cur.company_id]);
    }
  });
  res.json({ ok: true });
});

// ---------- stage / viewed ----------
r.patch('/applications/:id/stage', (req, res) => {
  const { changes } = run('UPDATE application SET current_stage = ? WHERE app_id = ?',
    [String(req.body?.stage || ''), Number(req.params.id)]);
  if (!changes) return res.status(404).json({ error: 'Application not found.' });
  res.json({ ok: true });
});

r.patch('/applications/:id/viewed', (req, res) => {
  run('UPDATE application SET viewed_by_employer = ? WHERE app_id = ?', [req.body?.viewed ? 1 : 0, Number(req.params.id)]);
  res.json({ ok: true });
});

// ---------- delete: removing the posting cascades to application, history and calls;
//            trigger trg_cleanup_company removes the company if it has no postings left ----------
r.delete('/applications/:id', (req, res) => {
  const row = q1('SELECT job_id FROM application WHERE app_id = ?', [Number(req.params.id)]);
  if (!row) return res.status(404).json({ error: 'Application not found.' });
  run('DELETE FROM job_posting WHERE job_id = ?', [row.job_id]);
  res.json({ ok: true });
});

// ---------- interactions ----------
r.post('/applications/:id/interactions', (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  const when = String(b.occurred_at || '').replace('T', ' ');
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(when)) return res.status(400).json({ error: 'Pick the date and time of the call.' });
  tx(() => {
    let contactId = b.contact_id ? Number(b.contact_id) : null;
    if (!contactId && clean(b.new_contact?.full_name)) {
      const a = q1('SELECT j.company_id FROM application a JOIN job_posting j ON j.job_id = a.job_id WHERE a.app_id = ?', [id]);
      if (!a) throw notFound('Application not found.');
      const n = b.new_contact;
      contactId = run('INSERT INTO contact (company_id, full_name, role_title, email, phone) VALUES (?,?,?,?,?)',
        [a.company_id, clean(n.full_name), clean(n.role_title), clean(n.email), clean(n.phone)]).lastInsertRowid;
    }
    run('INSERT INTO interaction (app_id, contact_id, channel, direction, occurred_at, summary) VALUES (?,?,?,?,?,?)',
      [id, contactId, b.channel, b.direction, when.length === 16 ? when + ':00' : when, clean(b.summary)]);
  });
  res.status(201).json({ ok: true });
});

r.delete('/interactions/:id', (req, res) => {
  run('DELETE FROM interaction WHERE interaction_id = ?', [Number(req.params.id)]);
  res.json({ ok: true });
});

r.delete('/contacts/:id', (req, res) => {
  run('DELETE FROM contact WHERE contact_id = ?', [Number(req.params.id)]);
  res.json({ ok: true });
});

export default r;
