-- =====================================================================
--  JobTrail - every query the app uses to show your data
--  Each one is a button in the Database tab (backend/src/routes/reports.js).
--  In the app, ? is replaced by the signed-in user's id, so each person sees only their rows.
--  To try them yourself: open the Turso shell (or sqlite3 database/jobtrail.db) and
--  replace  user_id IS ?  with  user_id IS NULL  (the sample data) or your own user_id.
-- =====================================================================

-- 1. All applications - Every application with its stage, HR contact and latest contact date.
SELECT company AS "Company", role AS "Role", location AS "Location", work_mode AS "Work mode",
       site AS "Applied via", applied_on AS "Applied on", days_since_applied AS "Days since applied",
       stage AS "Stage", CASE WHEN viewed THEN 'Yes' ELSE 'No' END AS "Viewed", CASE WHEN hr_called THEN 'Yes' ELSE 'No' END AS "HR called",
       hr_name AS "HR name", hr_phone AS "HR phone", hr_email AS "HR email",
       last_contact AS "Last contact", source AS "Added by"
  FROM v_application_overview
 WHERE user_id IS ?
 ORDER BY applied_on DESC, app_id DESC;

-- 2. Overview - One line per application: where it stands and whether HR has been in touch.
SELECT company AS "Company", role AS "Role", applied_on AS "Applied on",
       days_since_applied AS "Days ago", stage AS "Stage",
       CASE WHEN viewed THEN 'Yes' ELSE 'No' END AS "Viewed", CASE WHEN hr_called THEN 'Yes' ELSE 'No' END AS "HR called"
  FROM v_application_overview
 WHERE user_id IS ?
 ORDER BY applied_on DESC;

-- 3. Who called me? - Every inbound phone or video call, newest first.
SELECT i.occurred_at AS "When", c.name AS "Company", j.title AS "Role",
       k.full_name AS "Who", k.phone AS "Phone", i.channel AS "How", i.summary AS "What was said"
  FROM interaction i
  JOIN application a  ON a.app_id = i.app_id
  JOIN job_posting j  ON j.job_id = a.job_id
  JOIN company c      ON c.company_id = j.company_id
  LEFT JOIN contact k ON k.contact_id = i.contact_id
 WHERE a.user_id IS ? AND i.direction = 'Inbound' AND i.channel IN ('Phone call','Video call')
 ORDER BY i.occurred_at DESC;

-- 4. Tests & interviews - Every round found in your emails or added by hand, with its result.
SELECT COALESCE(e.scheduled_at, e.due_by) AS "Date", c.name AS "Company", j.title AS "Role",
       e.event_type AS "Type", e.round_name AS "Round", e.mode AS "Mode",
       COALESCE(e.meeting_link, e.location) AS "Link / venue", k.full_name AS "HR", e.outcome AS "Result"
  FROM interview_event e
  JOIN application a  ON a.app_id = e.app_id
  JOIN job_posting j  ON j.job_id = a.job_id
  JOIN company c      ON c.company_id = j.company_id
  LEFT JOIN contact k ON k.contact_id = e.contact_id
 WHERE a.user_id IS ?
 ORDER BY COALESCE(e.scheduled_at, e.due_by) DESC;

-- 5. Follow up these - Still open, applied 7 or more days ago, and no contact in the last 7 days.
SELECT company AS "Company", role AS "Role", applied_on AS "Applied on",
       days_since_applied AS "Days ago", stage AS "Stage", hr_name AS "HR name", hr_email AS "HR email"
  FROM v_followups_due
 WHERE user_id IS ?;

-- 6. Response rate by site - How often each job site led to any reply.
SELECT site AS "Applied via", COUNT(*) AS "Applied",
       SUM(stage_code NOT IN ('APPLIED','GHOSTED')) AS "Got a reply",
       ROUND(100.0 * SUM(stage_code NOT IN ('APPLIED','GHOSTED')) / COUNT(*), 1) AS "Reply rate %"
  FROM v_application_overview
 WHERE user_id IS ?
 GROUP BY site
 ORDER BY "Reply rate %" DESC;

-- 7. Days to first call - How long companies took to make first contact after you applied.
SELECT c.name AS "Company", j.title AS "Role", a.applied_on AS "Applied on", f.first_contact AS "First contact",
       CAST(julianday(f.first_contact) - julianday(a.applied_on) AS INTEGER) AS "Days to first contact"
  FROM application a
  JOIN job_posting j ON j.job_id = a.job_id
  JOIN company c     ON c.company_id = j.company_id
  JOIN (SELECT app_id, MIN(occurred_at) AS first_contact
          FROM interaction WHERE direction = 'Inbound' GROUP BY app_id) f ON f.app_id = a.app_id
 WHERE a.user_id IS ?
 ORDER BY "Days to first contact";

-- 8. Same company, many roles - Companies where you applied for more than one role.
SELECT company AS "Company", COUNT(*) AS "Applications", GROUP_CONCAT(role, '; ') AS "Roles",
       MIN(applied_on) AS "First applied", MAX(applied_on) AS "Last applied"
  FROM (SELECT * FROM v_application_overview WHERE user_id IS ? ORDER BY applied_on)
 GROUP BY company_id
HAVING COUNT(*) > 1
 ORDER BY "Applications" DESC;

-- 9. Stage history - Every stage change, newest first.
SELECT h.changed_at AS "When", c.name AS "Company", j.title AS "Role",
       COALESCE(f.label, '—') AS "From", t.label AS "To"
  FROM status_history h
  JOIN application a ON a.app_id = h.app_id
  JOIN job_posting j ON j.job_id = a.job_id
  JOIN company c     ON c.company_id = j.company_id
  LEFT JOIN stage f  ON f.stage_code = h.from_stage
  JOIN stage t       ON t.stage_code = h.to_stage
 WHERE a.user_id IS ?
 ORDER BY h.changed_at DESC, h.history_id DESC;

-- 10. Recruiters - Everyone from a company who has been in touch.
SELECT k.full_name AS "Name", c.name AS "Company", k.role_title AS "Title",
       k.email AS "Email", k.phone AS "Phone"
  FROM contact k
  JOIN company c ON c.company_id = k.company_id
 WHERE k.user_id IS ?
 ORDER BY c.name, k.full_name;

-- 11. Emails read - Job emails JobTrail read from Gmail and what it did with each.
SELECT received_at AS "Received", platform AS "From", kind AS "Kind",
       company AS "Company", role AS "Role", status AS "Result", subject AS "Subject"
  FROM email_import
 WHERE user_id IS ?
 ORDER BY received_at DESC
 LIMIT 300;

-- =====================================================================
--  Handy queries for the viva
-- =====================================================================

-- Proof that an index is used (look for: SEARCH application USING INDEX idx_app_stage)
EXPLAIN QUERY PLAN SELECT * FROM application WHERE current_stage = 'APPLIED';

-- Every table, view, trigger and index in the database
SELECT type, name, tbl_name AS on_table FROM sqlite_master
WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name;

-- Structure and foreign keys of one table
PRAGMA table_info(application);
PRAGMA foreign_key_list(interaction);

-- Who has signed in (never SELECT * here: the table also holds Google sign-in tokens)
SELECT user_id, email, name, created_at, last_sync_at FROM app_user ORDER BY created_at DESC;

-- Constraint tests: each of these is REJECTED by the database (run them to show it)
-- INSERT INTO job_posting (company_id, title, work_mode) VALUES (1, 'X', 'Moon');   -- CHECK constraint failed
-- INSERT INTO company (name) VALUES ('kestrel labs');                                -- UNIQUE (COLLATE NOCASE)
-- UPDATE application SET current_stage = 'HIRED' WHERE app_id = 1;                   -- FOREIGN KEY constraint failed
-- UPDATE application SET priority = 9 WHERE app_id = 1;                              -- CHECK constraint failed
-- UPDATE status_history SET to_stage = 'OFFER' WHERE history_id = 1;                 -- status_history is append-only
