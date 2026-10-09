// Who is making this request?  Reads the session cookie set after "Sign in with Google".
import { q1 } from './db.js';

export const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean)
  .map(c => { const i = c.indexOf('='); return [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1).trim())]; }));

export function currentUser(req) {
  const sid = cookies(req).jt_sid;
  if (!sid) return null;
  return q1(`SELECT u.user_id, u.email, u.name, u.last_sync_at, u.refresh_token IS NOT NULL AS can_sync
               FROM user_session s JOIN app_user u ON u.user_id = s.user_id WHERE s.session_id = ?`, [sid]) || null;
}

/** Owner id for this request: the signed-in user's id, or null = the shared demo data (not signed in). */
export const uid = req => currentUser(req)?.user_id ?? null;

/** Only the project owner (ADMIN_EMAILS) may use the SQL console once Google sign-in is switched on. */
export function isAdmin(req) {
  if (!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)) return true;   // local demo without Google
  const admins = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const u = currentUser(req);
  return Boolean(u && admins.includes(String(u.email).toLowerCase()));
}
