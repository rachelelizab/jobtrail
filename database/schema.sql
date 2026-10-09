-- =====================================================================
--  JobTrail — Job Application Tracking System
--  M.Tech DBMS course-outcome project
--  Engine: SQLite 3 (built into Node.js 22.13+ — nothing to install)
--  A MySQL 8 version of the same design is in database/mysql-reference/.
--
--  Contents
--    1. Tables (7)      — 3NF / BCNF, PK / FK / UNIQUE / CHECK / NOT NULL / DEFAULT
--    2. Indexes
--    3. Views (5)
--    4. Triggers (6)
--
--  The backend runs this file automatically the first time it starts.
--  To inspect the database yourself:  sqlite3 database/jobtrail.db
-- =====================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------
-- 1. TABLES
-- ---------------------------------------------------------------------

-- 1.1 STAGE — lookup table for the hiring pipeline
CREATE TABLE stage (
  stage_code   TEXT     PRIMARY KEY,
  label        TEXT     NOT NULL UNIQUE,
  phase        TEXT     NOT NULL CHECK (phase IN ('Waiting','Active','Won','Closed')),
  sort_order   INTEGER  NOT NULL UNIQUE,
  is_terminal  INTEGER  NOT NULL DEFAULT 0 CHECK (is_terminal IN (0,1))
);

INSERT INTO stage (stage_code, label, phase, sort_order, is_terminal) VALUES
 ('APPLIED',   'Applied',               'Waiting',  1, 0),
 ('VIEWED',    'Viewed by employer',    'Waiting',  2, 0),
 ('SCREEN',    'HR / recruiter screen', 'Active',   3, 0),
 ('ASSESS',    'Assessment / test',     'Active',   4, 0),
 ('INTERVIEW', 'Technical interview',   'Active',   5, 0),
 ('FINAL',     'Final / HR round',      'Active',   6, 0),
 ('OFFER',     'Offer received',        'Won',      7, 0),
 ('ACCEPTED',  'Offer accepted',        'Won',      8, 1),
 ('REJECTED',  'Rejected',              'Closed',   9, 1),
 ('WITHDRAWN', 'Withdrawn by me',       'Closed',  10, 1),
 ('GHOSTED',   'No response',           'Closed',  11, 1);

-- 1.2 COMPANY
CREATE TABLE company (
  company_id    INTEGER  PRIMARY KEY AUTOINCREMENT,
  name          TEXT     NOT NULL UNIQUE COLLATE NOCASE,   -- "Kestrel Labs" = "kestrel labs"
  website       TEXT,
  industry      TEXT,
  address       TEXT,
  city          TEXT,
  country       TEXT     DEFAULT 'India',
  linkedin_url  TEXT,
  created_at    TEXT     NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 1.3 CONTACT — recruiters / hiring managers at a company
CREATE TABLE contact (
  contact_id    INTEGER  PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER  NOT NULL REFERENCES company(company_id) ON DELETE CASCADE,
  full_name     TEXT     NOT NULL,
  role_title    TEXT,
  email         TEXT     CHECK (email IS NULL OR email LIKE '%_@_%._%'),
  phone         TEXT,
  linkedin_url  TEXT
);

-- 1.4 JOB_POSTING — one role advertised by one company
CREATE TABLE job_posting (
  job_id           INTEGER  PRIMARY KEY AUTOINCREMENT,
  company_id       INTEGER  NOT NULL REFERENCES company(company_id) ON DELETE CASCADE,
  title            TEXT     NOT NULL,
  location         TEXT,
  work_mode        TEXT     CHECK (work_mode IS NULL OR work_mode IN ('On-site','Hybrid','Remote')),
  employment_type  TEXT     CHECK (employment_type IS NULL OR employment_type IN ('Full-time','Part-time','Contract','Internship')),
  job_url          TEXT,
  external_job_id  TEXT,          -- LinkedIn job id parsed from /jobs/view/<id>
  salary_text      TEXT,
  description      TEXT           -- JD snapshot: postings get taken down
);

-- 1.5 APPLICATION — my application to one posting (1:1 with job_posting)
CREATE TABLE application (
  app_id              INTEGER  PRIMARY KEY AUTOINCREMENT,
  job_id              INTEGER  NOT NULL UNIQUE REFERENCES job_posting(job_id) ON DELETE CASCADE,
  applied_on          TEXT     NOT NULL CHECK (date(applied_on) IS NOT NULL),
  platform            TEXT     NOT NULL DEFAULT 'LinkedIn Easy Apply'
                      CHECK (platform IN ('LinkedIn Easy Apply','LinkedIn to company site',
                                          'Company website','Referral','Job portal','Other')),
  resume_version      TEXT,
  current_stage       TEXT     NOT NULL DEFAULT 'APPLIED' REFERENCES stage(stage_code),
  viewed_by_employer  INTEGER  NOT NULL DEFAULT 0 CHECK (viewed_by_employer IN (0,1)),
  priority            INTEGER  CHECK (priority IS NULL OR priority BETWEEN 1 AND 5),
  review              TEXT,
  created_at          TEXT     NOT NULL DEFAULT (datetime('now','localtime')),
  last_updated        TEXT     NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 1.6 STATUS_HISTORY — audit trail, written only by triggers, append-only
CREATE TABLE status_history (
  history_id   INTEGER  PRIMARY KEY AUTOINCREMENT,
  app_id       INTEGER  NOT NULL REFERENCES application(app_id) ON DELETE CASCADE,
  from_stage   TEXT     REFERENCES stage(stage_code),
  to_stage     TEXT     NOT NULL REFERENCES stage(stage_code),
  changed_at   TEXT     NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 1.7 INTERACTION — calls, emails, messages ("did HR call me?")
CREATE TABLE interaction (
  interaction_id  INTEGER  PRIMARY KEY AUTOINCREMENT,
  app_id          INTEGER  NOT NULL REFERENCES application(app_id) ON DELETE CASCADE,
  contact_id      INTEGER  REFERENCES contact(contact_id) ON DELETE SET NULL,
  channel         TEXT     NOT NULL CHECK (channel IN ('Phone call','Email','LinkedIn message','Video call','In person')),
  direction       TEXT     NOT NULL CHECK (direction IN ('Inbound','Outbound')),
  occurred_at     TEXT     NOT NULL CHECK (datetime(occurred_at) IS NOT NULL),
  summary         TEXT
);

-- ---------------------------------------------------------------------
-- 2. INDEXES
-- ---------------------------------------------------------------------
CREATE INDEX idx_app_stage       ON application(current_stage);
CREATE INDEX idx_app_applied_on  ON application(applied_on);
CREATE INDEX idx_job_company     ON job_posting(company_id);
CREATE INDEX idx_contact_company ON contact(company_id);
CREATE INDEX idx_int_app_when    ON interaction(app_id, occurred_at);
CREATE INDEX idx_hist_app_when   ON status_history(app_id, changed_at);

-- ---------------------------------------------------------------------
-- 3. VIEWS
-- ---------------------------------------------------------------------
CREATE VIEW v_application_overview AS
SELECT a.app_id,
       c.company_id,
       c.name                                                          AS company,
       j.title                                                         AS role,
       j.location,
       j.work_mode,
       a.applied_on,
       CAST(julianday(date('now','localtime')) - julianday(a.applied_on) AS INTEGER) AS days_since_applied,
       a.current_stage                                                 AS stage_code,
       s.label                                                         AS stage,
       s.phase,
       a.viewed_by_employer                                            AS viewed,
       EXISTS (SELECT 1 FROM interaction i
               WHERE i.app_id = a.app_id AND i.direction = 'Inbound'
                 AND i.channel IN ('Phone call','Video call'))         AS hr_called,
       (a.current_stage = 'REJECTED')                                  AS rejected,
       (SELECT MAX(i.occurred_at) FROM interaction i WHERE i.app_id = a.app_id) AS last_contact,
       a.platform,
       a.priority
FROM application a
JOIN job_posting j ON j.job_id = a.job_id
JOIN company     c ON c.company_id = j.company_id
JOIN stage       s ON s.stage_code = a.current_stage;

CREATE VIEW v_pipeline AS
SELECT s.sort_order, s.stage_code, s.label, s.phase, COUNT(a.app_id) AS applications
FROM stage s
LEFT JOIN application a ON a.current_stage = s.stage_code
GROUP BY s.stage_code
ORDER BY s.sort_order;

CREATE VIEW v_followups_due AS
SELECT o.*
FROM v_application_overview o
JOIN stage s ON s.stage_code = o.stage_code
WHERE s.is_terminal = 0
  AND o.days_since_applied >= 7
  AND COALESCE(julianday('now','localtime') - julianday(o.last_contact), 999) >= 7
ORDER BY o.days_since_applied DESC;

CREATE VIEW v_monthly_activity AS
SELECT strftime('%Y-%m', a.applied_on)                                  AS month,
       COUNT(*)                                                          AS applied,
       SUM(a.current_stage NOT IN ('APPLIED','GHOSTED'))                 AS got_response,
       SUM(a.current_stage IN ('INTERVIEW','FINAL','OFFER','ACCEPTED')) AS reached_interview
FROM application a
GROUP BY month
ORDER BY month;

CREATE VIEW v_company_summary AS
SELECT c.company_id,
       c.name                                AS company,
       COUNT(x.app_id)                       AS applications,
       GROUP_CONCAT(x.title, '; ')           AS roles,
       MIN(x.applied_on)                     AS first_applied,
       MAX(x.applied_on)                     AS last_applied
FROM company c
JOIN (SELECT j.company_id, j.title, a.app_id, a.applied_on
        FROM job_posting j JOIN application a ON a.job_id = j.job_id
       ORDER BY a.applied_on) x ON x.company_id = c.company_id
GROUP BY c.company_id
ORDER BY applications DESC, last_applied DESC;

-- ---------------------------------------------------------------------
-- 4. TRIGGERS
-- ---------------------------------------------------------------------

-- (a) every new application opens its history
CREATE TRIGGER trg_app_created
AFTER INSERT ON application
BEGIN
  INSERT INTO status_history (app_id, from_stage, to_stage) VALUES (NEW.app_id, NULL, NEW.current_stage);
END;

-- (b) every stage change is logged and the row is time-stamped
CREATE TRIGGER trg_stage_changed
AFTER UPDATE OF current_stage ON application
WHEN OLD.current_stage <> NEW.current_stage
BEGIN
  INSERT INTO status_history (app_id, from_stage, to_stage) VALUES (NEW.app_id, OLD.current_stage, NEW.current_stage);
  UPDATE application SET last_updated = datetime('now','localtime') WHERE app_id = NEW.app_id;
END;

-- (c) moving past "Applied" (except Withdrawn / No response) means the employer viewed it
CREATE TRIGGER trg_app_mark_viewed
AFTER UPDATE OF current_stage ON application
WHEN NEW.current_stage NOT IN ('APPLIED','WITHDRAWN','GHOSTED') AND NEW.viewed_by_employer = 0
BEGIN
  UPDATE application SET viewed_by_employer = 1 WHERE app_id = NEW.app_id;
END;

-- (d) an inbound call / email while still waiting moves the application to "HR screen"
CREATE TRIGGER trg_inbound_contact
AFTER INSERT ON interaction
WHEN NEW.direction = 'Inbound'
BEGIN
  UPDATE application SET current_stage = 'SCREEN'
  WHERE app_id = NEW.app_id AND current_stage IN ('APPLIED','VIEWED','GHOSTED');
END;

-- (e) history is append-only
CREATE TRIGGER trg_history_readonly
BEFORE UPDATE ON status_history
BEGIN
  SELECT RAISE(ABORT, 'status_history is append-only');
END;

-- (f) when the last posting of a company is deleted, remove the orphaned company
CREATE TRIGGER trg_cleanup_company
AFTER DELETE ON job_posting
WHEN NOT EXISTS (SELECT 1 FROM job_posting WHERE company_id = OLD.company_id)
BEGIN
  DELETE FROM company WHERE company_id = OLD.company_id;
END;
