-- =====================================================================
--  JobTrail — sample data (fictional companies and people)
--  Dates are relative to today, so the dashboard always looks current.
-- =====================================================================

INSERT INTO company (company_id, name, website, industry, address, city) VALUES
 (1, 'Northwind Analytics', 'northwind-analytics.example', 'Retail analytics', 'Outer Ring Road, Bellandur',       'Bengaluru'),
 (2, 'Kestrel Labs',        'kestrel-labs.example',        'AI / ML products', 'HSR Layout, Sector 2',             'Bengaluru'),
 (3, 'Halcyon Fintech',     'halcyon-fin.example',         'Fintech',          'Financial District, Nanakramguda', 'Hyderabad'),
 (4, 'Tessellate Health',   'tessellate.example',          'Health-tech',      'Whitefield Main Road',             'Bengaluru'),
 (5, 'Brightline Energy',   'brightline.example',          'Energy',           'Cyber City, DLF Phase 2',          'Gurugram'),
 (6, 'Quarry Logistics',    'quarrylogistics.example',     'Supply chain',     'Electronic City Phase 1',          'Bengaluru');

INSERT INTO contact (contact_id, company_id, full_name, role_title, email, phone) VALUES
 (1, 1, 'Priya Raman',   'Talent Acquisition Partner', 'priya.raman@northwind-analytics.example', '+91 98450 21734'),
 (2, 2, 'Arjun Mehta',   'Senior Recruiter',           'arjun.m@kestrel-labs.example',            '+91 99001 45528'),
 (3, 4, 'Neha Kulkarni', 'HR Business Partner',        'neha.k@tessellate.example',               '+91 80 4718 2200');

INSERT INTO job_posting (job_id, company_id, title, location, work_mode, employment_type, job_url, external_job_id, salary_text, description) VALUES
 (1, 1, 'Data Scientist - Demand Forecasting', 'Bengaluru', 'Hybrid',  'Full-time', 'https://www.linkedin.com/jobs/view/4012345678', '4012345678', NULL,
     'Build and own forecasting models for 4,000+ SKUs. Python, SQL, Prophet/LightGBM, experiment design. 2-5 years.'),
 (2, 1, 'ML Engineer',                         'Bengaluru', 'On-site', 'Full-time', NULL, NULL, NULL, NULL),
 (3, 2, 'Applied Scientist - NLP',             'Remote',    'Remote',  'Full-time', NULL, NULL, '₹28-36 LPA', NULL),
 (4, 3, 'Risk Data Analyst',                   'Hyderabad', 'Hybrid',  'Full-time', NULL, NULL, NULL, NULL),
 (5, 4, 'Data Scientist - Clinical Ops',       'Bengaluru', 'Hybrid',  'Full-time', NULL, NULL, NULL, NULL),
 (6, 5, 'Analytics Engineer',                  'Gurugram',  'Hybrid',  'Full-time', NULL, NULL, NULL, NULL),
 (7, 6, 'Operations Research Scientist',       'Bengaluru', 'On-site', 'Full-time', 'https://www.linkedin.com/jobs/view/4023456789', '4023456789', NULL, NULL),
 (8, 4, 'Data Analyst - Patient Insights',     'Bengaluru', 'On-site', 'Full-time', NULL, NULL, NULL, NULL);

INSERT INTO application (app_id, job_id, applied_on, platform, resume_version, priority, review) VALUES
 (1, 1, date('now','localtime','-18 day'), 'LinkedIn Easy Apply',      'DS_resume_v3',        5, 'Strong fit: time-series + Python. Round 2 is a case study on promo uplift.'),
 (2, 2, date('now','localtime','-16 day'), 'LinkedIn Easy Apply',      'DS_resume_v3',        3, NULL),
 (3, 3, date('now','localtime','-24 day'), 'LinkedIn to company site', 'DS_resume_v3',        4, NULL),
 (4, 4, date('now','localtime','-27 day'), 'LinkedIn Easy Apply',      'DS_resume_v3',        3, 'SQL test went fine; rejected after assessment. Ask for feedback.'),
 (5, 5, date('now','localtime','-11 day'), 'Referral',                 'DS_resume_v4_health', 4, NULL),
 (6, 6, date('now','localtime','-33 day'), 'LinkedIn Easy Apply',      'DS_resume_v3',        2, NULL),
 (7, 7, date('now','localtime','-4 day'),  'LinkedIn Easy Apply',      'DS_resume_v3',        4, NULL),
 (8, 8, date('now','localtime','-9 day'),  'Company website',          'DS_resume_v3',        3, NULL);

-- move applications through the pipeline (each UPDATE fires the triggers)
UPDATE application SET current_stage = 'VIEWED'    WHERE app_id IN (1, 2, 4, 8);
UPDATE application SET current_stage = 'SCREEN'    WHERE app_id IN (1, 4, 8);
UPDATE application SET current_stage = 'ASSESS'    WHERE app_id IN (1, 4, 8);
UPDATE application SET current_stage = 'INTERVIEW' WHERE app_id = 1;
UPDATE application SET current_stage = 'REJECTED'  WHERE app_id = 4;
UPDATE application SET current_stage = 'GHOSTED'   WHERE app_id = 6;

-- app 3 is still APPLIED: this inbound call fires trg_inbound_contact and moves it to SCREEN
INSERT INTO interaction (app_id, contact_id, channel, direction, occurred_at, summary) VALUES
 (1, 1, 'Phone call', 'Inbound', datetime(date('now','localtime','-13 day'), '+14 hours', '+20 minutes'), 'Priya called to schedule HR screen; CTC expectation discussed.'),
 (1, 1, 'Email',      'Inbound', datetime(date('now','localtime','-9 day'),  '+10 hours', '+2 minutes'),  'Technical round invite for next week.'),
 (3, 2, 'Phone call', 'Inbound', datetime(date('now','localtime','-6 day'),  '+11 hours', '+45 minutes'), 'Arjun asked about notice period. Said he would share an assessment link.'),
 (8, 3, 'Email',      'Inbound', datetime(date('now','localtime','-3 day'),  '+17 hours', '+30 minutes'), 'Take-home SQL + dashboard task, due in 5 days.');

-- back-date the demo history so the timeline reads naturally
-- (the append-only trigger is lifted for this one maintenance step, then restored)
DROP TRIGGER trg_history_readonly;
UPDATE status_history SET changed_at = (
  SELECT CASE
           WHEN status_history.from_stage IS NULL THEN datetime(a.applied_on, '+10 hours', '+5 minutes')
           ELSE datetime(a.applied_on,
                         '+' || MIN(CAST(julianday(date('now','localtime')) - julianday(a.applied_on) AS INTEGER),
                                    (s.sort_order * CAST(julianday(date('now','localtime')) - julianday(a.applied_on) AS INTEGER)) / 9) || ' days',
                         '+11 hours', '+30 minutes')
         END
  FROM application a JOIN stage s ON s.stage_code = status_history.to_stage
  WHERE a.app_id = status_history.app_id);
CREATE TRIGGER trg_history_readonly
BEFORE UPDATE ON status_history
BEGIN
  SELECT RAISE(ABORT, 'status_history is append-only');
END;
