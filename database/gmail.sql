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
  kind          TEXT     NOT NULL CHECK (kind IN ('applied','viewed','test','interview','offer','rejected','other')),
  company       TEXT,
  role          TEXT,
  location      TEXT,
  job_url       TEXT,
  status        TEXT     NOT NULL CHECK (status IN ('imported','updated','duplicate','review','ignored')),
  app_id        INTEGER  REFERENCES application(app_id) ON DELETE SET NULL,
  event_id      INTEGER  REFERENCES interview_event(event_id) ON DELETE SET NULL,
  processed_at  TEXT     NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_import_status ON email_import(status);

-- ---------------------------------------------------------------------
-- Tests and interviews read from emails and calendar invites
-- ("Round 1 – Online Assessment, complete by 12 Oct", "Technical round on 14 Oct at 3:30 PM, Google Meet")
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS interview_event (
  event_id           INTEGER  PRIMARY KEY AUTOINCREMENT,
  app_id             INTEGER  NOT NULL REFERENCES application(app_id) ON DELETE CASCADE,
  user_id            INTEGER  REFERENCES app_user(user_id) ON DELETE CASCADE,
  event_type         TEXT     NOT NULL CHECK (event_type IN ('Test','Interview','HR round','Assignment')),
  round_name         TEXT     NOT NULL,
  scheduled_at       TEXT     CHECK (scheduled_at IS NULL OR datetime(scheduled_at) IS NOT NULL),
  has_time           INTEGER  NOT NULL DEFAULT 1 CHECK (has_time IN (0,1)),   -- 0 = only the day is known
  ends_at            TEXT     CHECK (ends_at IS NULL OR datetime(ends_at) IS NOT NULL),
  due_by             TEXT     CHECK (due_by IS NULL OR datetime(due_by) IS NOT NULL),  -- deadline for a test / assignment
  mode               TEXT     CHECK (mode IS NULL OR mode IN ('Online','In person','Phone')),
  meeting_link       TEXT,
  location           TEXT,
  contact_id         INTEGER  REFERENCES contact(contact_id) ON DELETE SET NULL,
  outcome            TEXT     NOT NULL DEFAULT 'Scheduled'
                     CHECK (outcome IN ('Scheduled','Done','Passed','Not selected','Cancelled')),
  source             TEXT     NOT NULL DEFAULT 'Gmail' CHECK (source IN ('Gmail','Manual')),
  source_message_id  TEXT     UNIQUE,                                     -- the email it came from
  created_at         TEXT     NOT NULL DEFAULT (datetime('now','localtime')),
  CHECK (ends_at IS NULL OR scheduled_at IS NULL OR ends_at >= scheduled_at)
);
CREATE INDEX IF NOT EXISTS idx_event_app  ON interview_event(app_id);
CREATE INDEX IF NOT EXISTS idx_event_when ON interview_event(user_id, scheduled_at);

-- A new test / interview moves the application forward (never backwards, never out of Rejected / Accepted)
DROP TRIGGER IF EXISTS trg_event_advances_stage;
CREATE TRIGGER trg_event_advances_stage
AFTER INSERT ON interview_event
BEGIN
  UPDATE application
     SET current_stage = CASE NEW.event_type WHEN 'Test' THEN 'ASSESS' WHEN 'Assignment' THEN 'ASSESS'
                                             WHEN 'HR round' THEN 'FINAL' ELSE 'INTERVIEW' END
   WHERE app_id = NEW.app_id
     AND (SELECT is_terminal FROM stage WHERE stage_code = application.current_stage) = 0
     AND (SELECT sort_order FROM stage WHERE stage_code = application.current_stage)
       < (SELECT sort_order FROM stage WHERE stage_code =
            CASE NEW.event_type WHEN 'Test' THEN 'ASSESS' WHEN 'Assignment' THEN 'ASSESS'
                                WHEN 'HR round' THEN 'FINAL' ELSE 'INTERVIEW' END);
END;

-- Rejected or withdrawn: rounds still marked Scheduled are closed off
DROP TRIGGER IF EXISTS trg_close_rounds_on_rejection;
CREATE TRIGGER trg_close_rounds_on_rejection
AFTER UPDATE OF current_stage ON application
WHEN NEW.current_stage IN ('REJECTED','WITHDRAWN') AND OLD.current_stage <> NEW.current_stage
BEGIN
  UPDATE interview_event
     SET outcome = CASE NEW.current_stage WHEN 'REJECTED' THEN 'Not selected' ELSE 'Cancelled' END
   WHERE app_id = NEW.app_id AND outcome = 'Scheduled';
END;

-- An offer: every earlier round counts as passed
DROP TRIGGER IF EXISTS trg_rounds_passed_on_offer;
CREATE TRIGGER trg_rounds_passed_on_offer
AFTER UPDATE OF current_stage ON application
WHEN NEW.current_stage IN ('OFFER','ACCEPTED') AND OLD.current_stage <> NEW.current_stage
BEGIN
  UPDATE interview_event SET outcome = 'Passed' WHERE app_id = NEW.app_id AND outcome IN ('Scheduled','Done');
END;
CREATE INDEX IF NOT EXISTS idx_app_user     ON application(user_id);
CREATE INDEX IF NOT EXISTS idx_contact_user ON contact(user_id);

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
         a.user_id,
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
           (SELECT MAX(k2.contact_id) FROM contact k2 WHERE k2.company_id = c.company_id AND k2.user_id IS a.user_id)
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

-- ---------------------------------------------------------------------
-- What's coming up: tests and interviews from today on (plus any with no date yet)
-- ---------------------------------------------------------------------
DROP VIEW IF EXISTS v_upcoming_events;
CREATE VIEW v_upcoming_events AS
SELECT e.event_id, e.app_id, e.user_id, e.event_type, e.round_name, e.scheduled_at, e.has_time, e.ends_at, e.due_by,
       COALESCE(e.scheduled_at, e.due_by)                                   AS sort_at,
       e.mode, e.meeting_link, e.location, e.outcome,
       c.name AS company, j.title AS role, a.current_stage AS stage_code,
       k.full_name AS hr_name, k.phone AS hr_phone, k.email AS hr_email
FROM interview_event e
JOIN application a ON a.app_id = e.app_id
JOIN job_posting j ON j.job_id = a.job_id
JOIN company     c ON c.company_id = j.company_id
LEFT JOIN contact k ON k.contact_id = e.contact_id
WHERE e.outcome = 'Scheduled'
  AND (COALESCE(e.ends_at, e.due_by, e.scheduled_at) IS NULL
       OR COALESCE(e.ends_at, e.due_by, datetime(e.scheduled_at, CASE WHEN e.has_time THEN '+2 hours' ELSE '+1 day' END))
          >= datetime('now','localtime'))
ORDER BY sort_at IS NULL, sort_at;

-- ---------------------------------------------------------------------
-- Stage history dated by the email, not by the moment of the sync.
-- While an email is being applied, the sync puts the email's date in app_clock (one row);
-- the history triggers use it, and fall back to "now" for changes made by hand.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_clock (
  id        INTEGER PRIMARY KEY CHECK (id = 1),
  event_at  TEXT    CHECK (event_at IS NULL OR datetime(event_at) IS NOT NULL)
);
INSERT OR IGNORE INTO app_clock (id, event_at) VALUES (1, NULL);

DROP TRIGGER IF EXISTS trg_app_created;
CREATE TRIGGER trg_app_created
AFTER INSERT ON application
BEGIN
  INSERT INTO status_history (app_id, from_stage, to_stage, changed_at)
  VALUES (NEW.app_id, NULL, NEW.current_stage,
          COALESCE((SELECT event_at FROM app_clock WHERE id = 1), datetime('now','localtime')));
END;

DROP TRIGGER IF EXISTS trg_stage_changed;
CREATE TRIGGER trg_stage_changed
AFTER UPDATE OF current_stage ON application
WHEN OLD.current_stage <> NEW.current_stage
BEGIN
  INSERT INTO status_history (app_id, from_stage, to_stage, changed_at)
  VALUES (NEW.app_id, OLD.current_stage, NEW.current_stage,
          COALESCE((SELECT event_at FROM app_clock WHERE id = 1), datetime('now','localtime')));
  UPDATE application SET last_updated = datetime('now','localtime') WHERE app_id = NEW.app_id;
END;
