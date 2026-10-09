# JobTrail — Job Application Tracking System

**M.Tech DBMS course-outcome project.** A full-stack web application that tracks every job you apply for on LinkedIn (or anywhere else): company, role, date, location, recruiter, stage, viewed / not viewed, HR called / not called, rejected, and a timeline of every call and email.

**Problem it solves:** you apply to dozens of roles a week. Two weeks later HR calls and you can't remember the company, the role, or when you applied. JobTrail's “HR just called?” search answers that in one line.

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite (`frontend/`) |
| Backend | Node.js + Express 5 REST API (`backend/`) |
| Database | SQLite 3 via Node's built-in `node:sqlite` — tables, constraints, views, triggers, transactions (`database/`) |

**Nothing to install except Node.js.** The database is a single file (`database/jobtrail.db`) that the backend creates automatically, with sample data, the first time it starts.

---

## Run it (Mac / Windows / Linux)

You need **Node.js 22.13 or newer** (check with `node -v`). Then, in a terminal inside this folder:

```bash
npm run install:all     # once
npm run dev             # every time
```

Open **http://localhost:5173**. Stop with `Ctrl + C`.

- API: http://localhost:5050/api/health
- Start over with fresh sample data: `npm run db:reset` (or `npm run db:reset:empty` for an empty database), then `npm run dev` again.

**In VS Code:** File → Open Folder → this folder, then Terminal → New Terminal and run the two commands above. Install the recommended **SQLite Viewer** extension and click `database/jobtrail.db` to browse the tables.

---

## Project structure

```
jobtrail-fullstack/
├── database/
│   ├── schema.sql          7 tables, indexes, 5 views, 6 triggers (SQLite)
│   ├── seed.sql            sample companies, recruiters, applications, calls
│   ├── jobtrail.db         the database file (created on first run)
│   └── mysql-reference/    the same design for MySQL 8, incl. stored procedures
├── backend/
│   ├── api.http            ready-made API requests for the REST Client extension
│   ├── scripts/init-db.js  rebuilds jobtrail.db from schema.sql + seed.sql
│   └── src/
│       ├── server.js       Express app + error handling
│       ├── db.js           node:sqlite connection, query + transaction helpers
│       └── routes/
│           ├── applications.js   CRUD, stage, viewed, calls, contacts
│           └── misc.js           lookup, dashboard, schema, SQL console, CSV export
└── frontend/
    ├── vite.config.js      proxies /api → http://localhost:5050
    └── src/
        ├── App.jsx         layout, tabs, drawers
        ├── api.js          fetch wrapper for every endpoint
        └── components/     Lookup, Tracker, Pipeline, DatabaseView, AppDrawer, NewAppDrawer, Fields
```

## Database design (for the report / viva)

**Relations (3NF / BCNF)**

| Table | Key | Purpose |
|---|---|---|
| `company` | `company_id` PK, `name` UNIQUE | One row per employer (address, city, website) |
| `contact` | `contact_id` PK, `company_id` FK | Recruiters / HR at a company (1 company : N contacts) |
| `job_posting` | `job_id` PK, `company_id` FK | A role a company advertised (1 company : N postings) |
| `application` | `app_id` PK, `job_id` FK UNIQUE | My application to one posting (1 : 1), current stage, viewed flag, priority, notes |
| `stage` | `stage_code` PK | Lookup table for the 11 pipeline stages |
| `status_history` | `history_id` PK | Append-only audit trail of stage changes |
| `interaction` | `interaction_id` PK | Calls, emails, LinkedIn messages; `contact_id` FK is `SET NULL` on delete |

**Constraints:** PK, FK (`ON DELETE CASCADE` / `SET NULL`), `UNIQUE`, `NOT NULL`, `DEFAULT`, `CHECK` (work mode, employment type, platform, channel, direction, priority 1–5, e-mail shape, stage phase).

**Triggers**

| Trigger | When | Does |
|---|---|---|
| `trg_app_created` | AFTER INSERT on application | writes the first history row |
| `trg_stage_changed` | AFTER UPDATE OF current_stage | logs old → new stage in `status_history`, stamps `last_updated` |
| `trg_app_mark_viewed` | AFTER UPDATE OF current_stage | moving past “Applied” sets `viewed_by_employer = 1` |
| `trg_inbound_contact` | AFTER INSERT on interaction | an inbound call/email while waiting moves the application to `SCREEN` |
| `trg_history_readonly` | BEFORE UPDATE on status_history | `RAISE(ABORT, …)` — history can't be edited |
| `trg_cleanup_company` | AFTER DELETE on job_posting | removes a company once its last posting is gone |

**Transactions:** “Log an application” finds or creates the company (case-insensitive via `COLLATE NOCASE`), inserts the posting, then the application, inside one `BEGIN … COMMIT` — any error rolls all of it back.

**MySQL version:** `database/mysql-reference/` has the same schema for MySQL 8 with stored procedures (`sp_create_application`, `sp_delete_application`) and a stored function — include it in your report if your syllabus asks for PL/SQL-style routines.

**Views:** `v_application_overview`, `v_pipeline`, `v_followups_due`, `v_monthly_activity`, `v_company_summary`.

## REST API

| Method | Route | What it does |
|---|---|---|
| GET | `/api/health` | engine + version check |
| GET | `/api/applications?phase=&q=&sort=` | list from `v_application_overview` |
| GET | `/api/applications/:id` | one application + history + calls + recruiters |
| POST | `/api/applications` | create (transaction: company → posting → application) |
| PUT | `/api/applications/:id` | edit details (transaction) |
| PATCH | `/api/applications/:id/stage` | change stage (fires triggers) |
| PATCH | `/api/applications/:id/viewed` | set viewed flag |
| DELETE | `/api/applications/:id` | delete (FK cascades + cleanup trigger) |
| POST | `/api/applications/:id/interactions` | log a call / email (optionally a new recruiter) |
| DELETE | `/api/interactions/:id`, `/api/contacts/:id` | remove a log entry / recruiter |
| GET | `/api/lookup?q=` | “HR just called?” search |
| GET | `/api/dashboard` | KPIs + all views for the Pipeline tab |
| GET | `/api/schema` | returns `schema.sql` |
| POST | `/api/sql` | read-only SQL console (SELECT / WITH / PRAGMA / EXPLAIN on a read-only connection) |
| GET | `/api/export/applications.csv` | CSV download |

Try them from `backend/api.http` with the REST Client extension.

## 5-minute demo script (viva)

1. **Tracker:** 8 sample applications, filter chips by phase, search, sort.
2. **“HR just called?”:** type `98450` (part of a phone number) → shows Northwind, the role, the applied date and the recruiter.
3. **Log a call** on *Quarry Logistics* (stage *Applied*) as *Inbound Phone call* → the stage jumps to *HR / recruiter screen* and *Viewed* turns on. Explain `trg_inbound_contact` + `trg_app_mark_viewed`.
4. **Click a stage** → the timeline gets a row. Explain `trg_stage_changed`.
5. **Log an application** with a company that already exists in different case (`kestrel labs`) → no duplicate company. Explain the transaction + `UNIQUE COLLATE NOCASE`.
6. **Database tab:** ER diagram, run the presets (“Who called me?”, “Response rate by platform”, “Triggers & views”, “Foreign keys”).
7. Constraint demo in a terminal: `sqlite3 database/jobtrail.db "UPDATE status_history SET to_stage='OFFER';"` → *status_history is append-only*. `sqlite3 database/jobtrail.db "PRAGMA foreign_keys=ON; INSERT INTO job_posting(company_id,title,work_mode) VALUES (1,'x','Moon');"` → *CHECK constraint failed*. (macOS has `sqlite3` built in.)

## Troubleshooting

| Message | Fix |
|---|---|
| `No such built-in module: node:sqlite` | Node.js is too old. Install the current LTS from nodejs.org (22.13 or newer). |
| `Cannot reach the backend` in the website | The backend isn't running — use `npm run dev` from the project folder, not from Downloads. |
| `EADDRINUSE :::5050` | Something else uses port 5050. Run `PORT=5060 npm run dev --prefix backend` and change the proxy in `frontend/vite.config.js` to 5060. |
| Data looks wrong / want a clean demo | `npm run db:reset` |

## Build for production

```bash
npm run build --prefix frontend      # static files in frontend/dist
```
