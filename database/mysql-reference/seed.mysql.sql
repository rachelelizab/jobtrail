-- =====================================================================
--  JobTrail — sample data (fictional companies and people)
--  Dates are relative to today, so the dashboard always looks current.
--  Run after schema.sql:   mysql -u root -p jobtrail < seed.sql
-- =====================================================================
USE jobtrail;

-- ---------- companies ----------
INSERT INTO company (company_id, name, website, industry, address, city) VALUES
 (1, 'Northwind Analytics', 'northwind-analytics.example', 'Retail analytics', 'Outer Ring Road, Bellandur',        'Bengaluru'),
 (2, 'Kestrel Labs',        'kestrel-labs.example',        'AI / ML products', 'HSR Layout, Sector 2',              'Bengaluru'),
 (3, 'Halcyon Fintech',     'halcyon-fin.example',         'Fintech',          'Financial District, Nanakramguda',  'Hyderabad'),
 (4, 'Tessellate Health',   'tessellate.example',          'Health-tech',      'Whitefield Main Road',              'Bengaluru'),
 (5, 'Brightline Energy',   'brightline.example',          'Energy',           'Cyber City, DLF Phase 2',           'Gurugram'),
 (6, 'Quarry Logistics',    'quarrylogistics.example',     'Supply chain',     'Electronic City Phase 1',           'Bengaluru');

-- ---------- recruiters ----------
INSERT INTO contact (contact_id, company_id, full_name, role_title, email, phone) VALUES
 (1, 1, 'Priya Raman',    'Talent Acquisition Partner', 'priya.raman@northwind-analytics.example', '+91 98450 21734'),
 (2, 2, 'Arjun Mehta',    'Senior Recruiter',           'arjun.m@kestrel-labs.example',            '+91 99001 45528'),
 (3, 4, 'Neha Kulkarni',  'HR Business Partner',        'neha.k@tessellate.example',               '+91 80 4718 2200');

-- ---------- job postings ----------
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

-- ---------- applications (all start at APPLIED; the triggers log history) ----------
INSERT INTO application (app_id, job_id, applied_on, platform, resume_version, priority, review) VALUES
 (1, 1, CURDATE() - INTERVAL 18 DAY, 'LinkedIn Easy Apply',      'DS_resume_v3',        5, 'Strong fit: time-series + Python. Round 2 is a case study on promo uplift.'),
 (2, 2, CURDATE() - INTERVAL 16 DAY, 'LinkedIn Easy Apply',      'DS_resume_v3',        3, NULL),
 (3, 3, CURDATE() - INTERVAL 24 DAY, 'LinkedIn to company site', 'DS_resume_v3',        4, NULL),
 (4, 4, CURDATE() - INTERVAL 27 DAY, 'LinkedIn Easy Apply',      'DS_resume_v3',        3, 'SQL test went fine; rejected after assessment. Ask for feedback.'),
 (5, 5, CURDATE() - INTERVAL 11 DAY, 'Referral',                 'DS_resume_v4_health', 4, NULL),
 (6, 6, CURDATE() - INTERVAL 33 DAY, 'LinkedIn Easy Apply',      'DS_resume_v3',        2, NULL),
 (7, 7, CURDATE() - INTERVAL  4 DAY, 'LinkedIn Easy Apply',      'DS_resume_v3',        4, NULL),
 (8, 8, CURDATE() - INTERVAL  9 DAY, 'Company website',          'DS_resume_v3',        3, NULL);

-- ---------- move applications through the pipeline (each UPDATE fires the triggers) ----------
UPDATE application SET current_stage = 'VIEWED'    WHERE app_id IN (1, 2, 4, 8);
UPDATE application SET current_stage = 'SCREEN'    WHERE app_id IN (1, 4, 8);
UPDATE application SET current_stage = 'ASSESS'    WHERE app_id IN (1, 4, 8);
UPDATE application SET current_stage = 'INTERVIEW' WHERE app_id = 1;
UPDATE application SET current_stage = 'REJECTED'  WHERE app_id = 4;
UPDATE application SET current_stage = 'GHOSTED'   WHERE app_id = 6;

-- ---------- calls and emails ----------
-- app 3 is still APPLIED: this inbound call fires trg_inbound_contact and moves it to SCREEN
INSERT INTO interaction (app_id, contact_id, channel, direction, occurred_at, summary) VALUES
 (1, 1, 'Phone call', 'Inbound', TIMESTAMP(CURDATE() - INTERVAL 13 DAY, '14:20:00'), 'Priya called to schedule HR screen; CTC expectation discussed.'),
 (1, 1, 'Email',      'Inbound', TIMESTAMP(CURDATE() - INTERVAL  9 DAY, '10:02:00'), 'Technical round invite for next week.'),
 (3, 2, 'Phone call', 'Inbound', TIMESTAMP(CURDATE() - INTERVAL  6 DAY, '11:45:00'), 'Arjun asked about notice period. Said he would share an assessment link.'),
 (8, 3, 'Email',      'Inbound', TIMESTAMP(CURDATE() - INTERVAL  3 DAY, '17:30:00'), 'Take-home SQL + dashboard task, due in 5 days.');

-- ---------- back-date the demo history so the timeline reads naturally ----------
SET @jobtrail_maintenance = 1;
UPDATE status_history h
JOIN application a ON a.app_id = h.app_id
JOIN stage s       ON s.stage_code = h.to_stage
SET h.changed_at = CASE
      WHEN h.from_stage IS NULL THEN TIMESTAMP(a.applied_on, '10:05:00')
      ELSE TIMESTAMP(a.applied_on + INTERVAL LEAST(DATEDIFF(CURDATE(), a.applied_on),
                     FLOOR(s.sort_order * DATEDIFF(CURDATE(), a.applied_on) / 9)) DAY, '11:30:00')
    END;
SET @jobtrail_maintenance = NULL;
