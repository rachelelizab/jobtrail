-- =====================================================================
--  JobTrail — Gmail import (added Oct 2026)
--  Runs automatically every time the backend starts (safe to re-run).
-- =====================================================================

-- A person who signed in with Google
CREATE TABLE IF NOT EXISTS app_user (
  user_id        INTEGER  PRIMARY KEY AUTOINCREMENT,
  google_sub     TEXT     NOT NULL UNIQUE,          -- Google's id for the account
  email          TEXT     NOT NULL,
  name           TEXT,
  refresh_token  TEXT,                              -- lets the server read Gmail later (read-only)
  access_token   TEXT,
  token_expires  INTEGER,                           -- epoch ms
  last_sync_at   TEXT,
  created_at     TEXT     NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Browser sessions (cookie jt_sid)
CREATE TABLE IF NOT EXISTS user_session (
  session_id  TEXT     PRIMARY KEY,
  user_id     INTEGER  NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  created_at  TEXT     NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Every job email that was read, so the same email is never processed twice
CREATE TABLE IF NOT EXISTS email_import (
  message_id    TEXT     PRIMARY KEY,               -- Gmail message id
  user_id       INTEGER  REFERENCES app_user(user_id) ON DELETE SET NULL,
  received_at   TEXT,
  sender        TEXT,
  subject       TEXT,
  snippet       TEXT,
  platform      TEXT,                               -- LinkedIn, Naukri, Internshala, Indeed
  kind          TEXT     NOT NULL CHECK (kind IN ('applied','viewed','interview','rejected','other')),
  company       TEXT,
  role          TEXT,
  location      TEXT,
  job_url       TEXT,
  status        TEXT     NOT NULL CHECK (status IN ('imported','updated','duplicate','review','ignored')),
  app_id        INTEGER  REFERENCES application(app_id) ON DELETE SET NULL,
  processed_at  TEXT     NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_import_status ON email_import(status);

-- ---------------------------------------------------------------------
-- Tracker view with the HR contact and the source of each application.
-- Replaces the version in schema.sql (re-created on every start).
-- The HR shown is the recruiter of this application's latest email/call,
-- otherwise the most recently added recruiter at that company.
-- ---------------------------------------------------------------------
DROP VIEW IF EXISTS v_followups_due;
DROP VIEW IF EXISTS v_application_overview;

CREATE VIEW v_application_overview AS
SELECT x.*,
       k.full_name AS hr_name,
       k.phone     AS hr_phone,
       k.email     AS hr_email
FROM (
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
         a.priority,
         a.source,
         COALESCE((SELECT e.platform FROM email_import e
                    WHERE e.app_id = a.app_id AND e.kind = 'applied' AND e.platform <> 'Email' LIMIT 1),
                  CASE WHEN a.platform LIKE 'LinkedIn%' THEN 'LinkedIn' ELSE a.platform END)  AS site,
         COALESCE(
           (SELECT i.contact_id FROM interaction i
             WHERE i.app_id = a.app_id AND i.contact_id IS NOT NULL
             ORDER BY i.occurred_at DESC LIMIT 1),
           (SELECT MAX(k2.contact_id) FROM contact k2 WHERE k2.company_id = c.company_id)
         )                                                               AS hr_contact_id
  FROM application a
  JOIN job_posting j ON j.job_id = a.job_id
  JOIN company     c ON c.company_id = j.company_id
  JOIN stage       s ON s.stage_code = a.current_stage
) x
LEFT JOIN contact k ON k.contact_id = x.hr_contact_id;

CREATE VIEW v_followups_due AS
SELECT o.*
FROM v_application_overview o
JOIN stage s ON s.stage_code = o.stage_code
WHERE s.is_terminal = 0
  AND o.days_since_applied >= 7
  AND COALESCE(julianday('now','localtime') - julianday(o.last_contact), 999) >= 7
ORDER BY o.days_since_applied DESC;
