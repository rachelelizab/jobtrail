// Google sign-in (OAuth 2.0) and read-only Gmail access, using plain fetch (no extra packages).
// Needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (see backend/.env.example).

const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const USERINFO = 'https://openidconnect.googleapis.com/v1/userinfo';
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
export const SCOPES = 'openid email profile https://www.googleapis.com/auth/gmail.readonly';

export const googleConfigured = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export function authUrl(redirectUri, state) {
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri, response_type: 'code',
    scope: SCOPES, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
  });
  return `${AUTH}?${q}`;
}

async function call(url, opts = {}) {
  const res = await fetch(url, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body.error_description || body.error?.message || body.error || `Google request failed (${res.status})`;
    throw Object.assign(new Error(String(msg)), { status: res.status === 401 ? 401 : 502 });
  }
  return body;
}

const form = o => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o) });

export const exchangeCode = (code, redirectUri) => call(TOKEN, form({
  code, redirect_uri: redirectUri, grant_type: 'authorization_code',
  client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET,
}));

export const refreshAccess = refreshToken => call(TOKEN, form({
  refresh_token: refreshToken, grant_type: 'refresh_token',
  client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET,
}));

const auth = token => ({ headers: { Authorization: `Bearer ${token}` } });
export const userInfo = token => call(USERINFO, auth(token));

/** All message ids matching a Gmail search (up to `max`). */
export async function listMessageIds(token, q, max = 300) {
  const ids = [];
  let pageToken;
  do {
    const p = new URLSearchParams({ q, maxResults: '100' });
    if (pageToken) p.set('pageToken', pageToken);
    const r = await call(`${GMAIL}/messages?${p}`, auth(token));
    for (const m of r.messages || []) ids.push(m.id);
    pageToken = r.nextPageToken;
  } while (pageToken && ids.length < max);
  return ids.slice(0, max);
}

const b64 = s => Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
const stripHtml = h => h
  .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d|table)>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/&middot;/g, '·')
  .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n');

/** One message → { id, from, subject, date (ISO), snippet, text, ics } — ics = calendar invite text, if any */
export async function getMessage(token, id) {
  const m = await call(`${GMAIL}/messages/${id}?format=full`, auth(token));
  const h = Object.fromEntries((m.payload?.headers || []).map(x => [x.name.toLowerCase(), x.value]));
  let plain = '', html = '', ics = '', icsAttachment = null;
  const isIcs = part => /^(text\/calendar|application\/ics)$/i.test(part.mimeType || '') || /\.ics$/i.test(part.filename || '');
  const walk = part => {
    if (!part) return;
    if (isIcs(part)) {
      if (part.body?.data) ics ||= b64(part.body.data);
      else if (part.body?.attachmentId) icsAttachment ||= part.body.attachmentId;
    } else if (part.mimeType === 'text/plain' && part.body?.data) plain += b64(part.body.data) + '\n';
    else if (part.mimeType === 'text/html' && part.body?.data) html += b64(part.body.data) + '\n';
    (part.parts || []).forEach(walk);
  };
  walk(m.payload);
  if (!ics && icsAttachment) {   // invite sent as an attachment: one more (read-only) request
    try { ics = b64((await call(`${GMAIL}/messages/${id}/attachments/${icsAttachment}`, auth(token))).data); } catch { /* invite unreadable: carry on */ }
  }
  return {
    id: m.id, from: h.from || '', subject: h.subject || '', snippet: m.snippet || '',
    date: new Date(Number(m.internalDate) || Date.parse(h.date) || Date.now()).toISOString(),
    text: (plain || stripHtml(html)).slice(0, 20000),
    ics: ics.slice(0, 20000),
  };
}
