-- =====================================================================
--  JobTrail — Job Application Tracking System
--  M.Tech DBMS course-outcome project
--  Target: MySQL 8.0.16+  (also runs on MariaDB 10.6+)
--
--  Contents
--    1. Database
--    2. Tables (7)            — 3NF / BCNF, PK/FK/UNIQUE/CHECK constraints
--    3. Indexes
--    4. Stored function (1)
--    5. Views (5)
--    6. Triggers (5)
--    7. Stored procedures (2)
--
--  Run with:  mysql -u root -p < schema.sql     (or open in MySQL Workbench)
--  or from the backend folder:  npm run db:init
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. DATABASE
-- ---------------------------------------------------------------------
DROP DATABASE IF EXISTS jobtrail;
CREATE DATABASE jobtrail CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE jobtrail;

-- ---------------------------------------------------------------------
-- 2. TABLES
-- ---------------------------------------------------------------------

-- 2.1 STAGE — lookup table for the hiring pipeline
CREATE TABLE stage (
  stage_code   VARCHAR(12)  PRIMARY KEY,
  label        VARCHAR(40)  NOT NULL UNIQUE,
  phase        VARCHAR(10)  NOT NULL CHECK (phase IN ('Waiting','Active','Won','Closed')),
  sort_order   TINYINT      NOT NULL UNIQUE,
  is_terminal  BOOLEAN      NOT NULL DEFAULT FALSE
);

INSERT INTO stage (stage_code, label, phase, sort_order, is_terminal) VALUES
 ('APPLIED',   'Applied',               'Waiting',  1, FALSE),
 ('VIEWED',    'Viewed by employer',    'Waiting',  2, FALSE),
 ('SCREEN',    'HR / recruiter screen', 'Active',   3, FALSE),
 ('ASSESS',    'Assessment / test',     'Active',   4, FALSE),
 ('INTERVIEW', 'Technical interview',   'Active',   5, FALSE),
 ('FINAL',     'Final / HR round',      'Active',   6, FALSE),
 ('OFFER',     'Offer received',        'Won',      7, FALSE),
 ('ACCEPTED',  'Offer accepted',        'Won',      8, TRUE),
 ('REJECTED',  'Rejected',              'Closed',   9, TRUE),
 ('WITHDRAWN', 'Withdrawn by me',       'Closed',  10, TRUE),
 ('GHOSTED',   'No response',           'Closed',  11, TRUE);

-- 2.2 COMPANY
CREATE TABLE company (
  company_id    INT           AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(120)  NOT NULL UNIQUE,          -- case-insensitive via collation
  website       VARCHAR(255),
  industry      VARCHAR(80),
  address       VARCHAR(255),
  city          VARCHAR(80),
  country       VARCHAR(60)   DEFAULT 'India',
  linkedin_url  VARCHAR(255),
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2.3 CONTACT — recruiters / hiring managers at a company
CREATE TABLE contact (
  contact_id    INT           AUTO_INCREMENT PRIMARY KEY,
  company_id    INT           NOT NULL,
  full_name     VARCHAR(120)  NOT NULL,
  role_title    VARCHAR(120),
  email         VARCHAR(160),
  phone         VARCHAR(30),
  linkedin_url  VARCHAR(255),
  CONSTRAINT fk_contact_company FOREIGN KEY (company_id)
    REFERENCES company(company_id) ON DELETE CASCADE,
  CONSTRAINT chk_contact_email CHECK (email IS NULL OR email = '' OR email LIKE '%_@_%._%')
);

-- 2.4 JOB_POSTING — one role advertised by one company
CREATE TABLE job_posting (
  job_id           INT           AUTO_INCREMENT PRIMARY KEY,
  company_id       INT           NOT NULL,
  title            VARCHAR(160)  NOT NULL,
  location         VARCHAR(120),
  work_mode        VARCHAR(10),
  employment_type  VARCHAR(12),
  job_url          VARCHAR(500),
  external_job_id  VARCHAR(32),          -- LinkedIn job id parsed from /jobs/view/<id>
  salary_text      VARCHAR(80),
  description      TEXT,                 -- JD snapshot: postings get taken down
  CONSTRAINT fk_job_company FOREIGN KEY (company_id)
    REFERENCES company(company_id) ON DELETE CASCADE,
  CONSTRAINT chk_job_mode CHECK (work_mode IS NULL OR work_mode IN ('On-site','Hybrid','Remote')),
  CONSTRAINT chk_job_type CHECK (employment_type IS NULL OR employment_type IN ('Full-time','Part-time','Contract','Internship'))
);

-- 2.5 APPLICATION — my application to one posting (1:1 with job_posting)
CREATE TABLE application (
  app_id              INT           AUTO_INCREMENT PRIMARY KEY,
  job_id              INT           NOT NULL UNIQUE,
  applied_on          DATE          NOT NULL,
  platform            VARCHAR(30)   NOT NULL DEFAULT 'LinkedIn Easy Apply',
  resume_version      VARCHAR(60),
  current_stage       VARCHAR(12)   NOT NULL DEFAULT 'APPLIED',
  viewed_by_employer  BOOLEAN       NOT NULL DEFAULT FALSE,
  priority            TINYINT,                                   -- how much I want it, 1–5
  review              TEXT,                                      -- my notes
  created_at          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_updated        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_app_job   FOREIGN KEY (job_id)        REFERENCES job_posting(job_id) ON DELETE CASCADE,
  CONSTRAINT fk_app_stage FOREIGN KEY (current_stage) REFERENCES stage(stage_code),
  CONSTRAINT chk_app_platform CHECK (platform IN ('LinkedIn Easy Apply','LinkedIn to company site',
                                                  'Company website','Referral','Job portal','Other')),
  CONSTRAINT chk_app_priority CHECK (priority IS NULL OR priority BETWEEN 1 AND 5)
);

-- 2.6 STATUS_HISTORY — audit trail, written only by triggers, append-only
CREATE TABLE status_history (
  history_id   INT          AUTO_INCREMENT PRIMARY KEY,
  app_id       INT          NOT NULL,
  from_stage   VARCHAR(12),
  to_stage     VARCHAR(12)  NOT NULL,
  changed_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_hist_app  FOREIGN KEY (app_id)     REFERENCES application(app_id) ON DELETE CASCADE,
  CONSTRAINT fk_hist_from FOREIGN KEY (from_stage) REFERENCES stage(stage_code),
  CONSTRAINT fk_hist_to   FOREIGN KEY (to_stage)   REFERENCES stage(stage_code)
);

-- 2.7 INTERACTION — calls, emails, messages ("did HR call me?")
CREATE TABLE interaction (
  interaction_id  INT          AUTO_INCREMENT PRIMARY KEY,
  app_id          INT          NOT NULL,
  contact_id      INT,
  channel         VARCHAR(20)  NOT NULL,
  direction       VARCHAR(8)   NOT NULL,
  occurred_at     DATETIME     NOT NULL,
  summary         TEXT,
  CONSTRAINT fk_int_app     FOREIGN KEY (app_id)     REFERENCES application(app_id) ON DELETE CASCADE,
  CONSTRAINT fk_int_contact FOREIGN KEY (contact_id) REFERENCES contact(contact_id) ON DELETE SET NULL,
  CONSTRAINT chk_int_channel   CHECK (channel IN ('Phone call','Email','LinkedIn message','Video call','In person')),
  CONSTRAINT chk_int_direction CHECK (direction IN ('Inbound','Outbound'))
);

-- ---------------------------------------------------------------------
-- 3. INDEXES  (FK columns are indexed automatically by InnoDB)
-- ---------------------------------------------------------------------
CREATE INDEX idx_app_applied_on ON application(applied_on);
CREATE INDEX idx_contact_name   ON contact(full_name);
CREATE INDEX idx_contact_phone  ON contact(phone);
CREATE INDEX idx_int_when       ON interaction(app_id, occurred_at);
CREATE INDEX idx_hist_when      ON status_history(app_id, changed_at);

-- ---------------------------------------------------------------------
-- 4. STORED FUNCTION
-- ---------------------------------------------------------------------
DELIMITER $$
CREATE FUNCTION fn_days_since(d DATE) RETURNS INT
NOT DETERMINISTIC NO SQL
BEGIN
  RETURN DATEDIFF(CURDATE(), d);
END$$
DELIMITER ;

-- ---------------------------------------------------------------------
-- 5. VIEWS
-- ---------------------------------------------------------------------
CREATE VIEW v_application_overview AS
SELECT a.app_id,
       c.company_id,
       c.name                              AS company,
       j.title                             AS role,
       j.location,
       j.work_mode,
       a.applied_on,
       fn_days_since(a.applied_on)         AS days_since_applied,
       a.current_stage                     AS stage_code,
       s.label                             AS stage,
       s.phase,
       a.viewed_by_employer                AS viewed,
       EXISTS (SELECT 1 FROM interaction i
               WHERE i.app_id = a.app_id AND i.direction = 'Inbound'
                 AND i.channel IN ('Phone call','Video call')) AS hr_called,
       (a.current_stage = 'REJECTED')      AS rejected,
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
GROUP BY s.sort_order, s.stage_code, s.label, s.phase
ORDER BY s.sort_order;

CREATE VIEW v_followups_due AS
SELECT o.*
FROM v_application_overview o
JOIN stage s ON s.stage_code = o.stage_code
WHERE s.is_terminal = FALSE
  AND o.days_since_applied >= 7
  AND COALESCE(DATEDIFF(NOW(), o.last_contact), 999) >= 7
ORDER BY o.days_since_applied DESC;

CREATE VIEW v_monthly_activity AS
SELECT DATE_FORMAT(a.applied_on, '%Y-%m')                               AS month,
       COUNT(*)                                                          AS applied,
       SUM(a.current_stage NOT IN ('APPLIED','GHOSTED'))                 AS got_response,
       SUM(a.current_stage IN ('INTERVIEW','FINAL','OFFER','ACCEPTED')) AS reached_interview
FROM application a
GROUP BY DATE_FORMAT(a.applied_on, '%Y-%m')
ORDER BY month;

CREATE VIEW v_company_summary AS
SELECT c.company_id,
       c.name                                         AS company,
       COUNT(a.app_id)                                AS applications,
       GROUP_CONCAT(j.title ORDER BY a.applied_on SEPARATOR '; ') AS roles,
       MIN(a.applied_on)                              AS first_applied,
       MAX(a.applied_on)                              AS last_applied
FROM company c
JOIN job_posting j ON j.company_id = c.company_id
JOIN application a ON a.job_id = j.job_id
GROUP BY c.company_id, c.name
ORDER BY applications DESC, last_applied DESC;

-- ---------------------------------------------------------------------
-- 6. TRIGGERS
-- ---------------------------------------------------------------------
DELIMITER $$

-- (a) every new application opens its history
CREATE TRIGGER trg_app_created
AFTER INSERT ON application
FOR EACH ROW
BEGIN
  INSERT INTO status_history (app_id, from_stage, to_stage) VALUES (NEW.app_id, NULL, NEW.current_stage);
END$$

-- (b) moving past "Applied" (except Withdrawn / No response) means the employer viewed it
CREATE TRIGGER trg_app_mark_viewed
BEFORE UPDATE ON application
FOR EACH ROW
BEGIN
  IF NEW.current_stage <> OLD.current_stage
     AND NEW.current_stage NOT IN ('APPLIED','WITHDRAWN','GHOSTED') THEN
    SET NEW.viewed_by_employer = TRUE;
  END IF;
END$$

-- (c) every stage change is logged
CREATE TRIGGER trg_stage_changed
AFTER UPDATE ON application
FOR EACH ROW
BEGIN
  IF NEW.current_stage <> OLD.current_stage THEN
    INSERT INTO status_history (app_id, from_stage, to_stage)
    VALUES (NEW.app_id, OLD.current_stage, NEW.current_stage);
  END IF;
END$$

-- (d) an inbound call / email while still waiting moves the application to "HR screen"
CREATE TRIGGER trg_inbound_contact
AFTER INSERT ON interaction
FOR EACH ROW
BEGIN
  IF NEW.direction = 'Inbound' THEN
    UPDATE application SET current_stage = 'SCREEN'
    WHERE app_id = NEW.app_id AND current_stage IN ('APPLIED','VIEWED','GHOSTED');
  END IF;
END$$

-- (e) history is append-only (a maintenance flag lets the seed script back-date demo rows)
CREATE TRIGGER trg_history_readonly
BEFORE UPDATE ON status_history
FOR EACH ROW
BEGIN
  IF COALESCE(@jobtrail_maintenance, 0) = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'status_history is append-only';
  END IF;
END$$

-- ---------------------------------------------------------------------
-- 7. STORED PROCEDURES
-- ---------------------------------------------------------------------

-- 7.1 Log a new application in one transaction:
--     find-or-create the company, create the posting, create the application.
CREATE PROCEDURE sp_create_application(
  IN  p_company          VARCHAR(120),
  IN  p_website          VARCHAR(255),
  IN  p_address          VARCHAR(255),
  IN  p_city             VARCHAR(80),
  IN  p_title            VARCHAR(160),
  IN  p_location         VARCHAR(120),
  IN  p_work_mode        VARCHAR(10),
  IN  p_employment_type  VARCHAR(12),
  IN  p_job_url          VARCHAR(500),
  IN  p_external_job_id  VARCHAR(32),
  IN  p_salary_text      VARCHAR(80),
  IN  p_description      TEXT,
  IN  p_applied_on       DATE,
  IN  p_platform         VARCHAR(30),
  IN  p_resume_version   VARCHAR(60),
  IN  p_priority         TINYINT,
  IN  p_review           TEXT,
  OUT p_app_id           INT
)
BEGIN
  DECLARE v_company_id INT DEFAULT NULL;
  DECLARE v_job_id INT;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  START TRANSACTION;

  SELECT company_id INTO v_company_id FROM company WHERE name = TRIM(p_company) LIMIT 1;
  IF v_company_id IS NULL THEN
    INSERT INTO company (name, website, address, city)
    VALUES (TRIM(p_company), NULLIF(p_website,''), NULLIF(p_address,''), NULLIF(p_city,''));
    SET v_company_id = LAST_INSERT_ID();
  ELSE
    UPDATE company
       SET website = COALESCE(NULLIF(p_website,''), website),
           address = COALESCE(NULLIF(p_address,''), address),
           city    = COALESCE(NULLIF(p_city,''),    city)
     WHERE company_id = v_company_id;
  END IF;

  INSERT INTO job_posting (company_id, title, location, work_mode, employment_type, job_url,
                           external_job_id, salary_text, description)
  VALUES (v_company_id, TRIM(p_title), NULLIF(p_location,''), NULLIF(p_work_mode,''),
          NULLIF(p_employment_type,''), NULLIF(p_job_url,''), NULLIF(p_external_job_id,''),
          NULLIF(p_salary_text,''), NULLIF(p_description,''));
  SET v_job_id = LAST_INSERT_ID();

  INSERT INTO application (job_id, applied_on, platform, resume_version, priority, review)
  VALUES (v_job_id, p_applied_on, COALESCE(NULLIF(p_platform,''), 'LinkedIn Easy Apply'),
          NULLIF(p_resume_version,''), p_priority, NULLIF(p_review,''));
  SET p_app_id = LAST_INSERT_ID();

  COMMIT;
END$$

-- 7.2 Delete an application and clean up the posting and any company left with no postings.
CREATE PROCEDURE sp_delete_application(IN p_app_id INT)
BEGIN
  DECLARE v_job_id INT;
  DECLARE v_company_id INT;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  START TRANSACTION;
  SELECT a.job_id, j.company_id INTO v_job_id, v_company_id
    FROM application a JOIN job_posting j ON j.job_id = a.job_id
   WHERE a.app_id = p_app_id;

  DELETE FROM job_posting WHERE job_id = v_job_id;      -- cascades to application, history, interactions
  DELETE FROM company
   WHERE company_id = v_company_id
     AND NOT EXISTS (SELECT 1 FROM job_posting WHERE company_id = v_company_id);
  COMMIT;
END$$

DELIMITER ;
