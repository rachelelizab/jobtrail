const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export { MON };

export const pad = n => String(n).padStart(2, '0');
export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function nowLocalInput() {
  const d = new Date();
  return `${todayISO()}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function fmtDate(s) {
  if (!s) return '';
  const [y, m, d] = String(s).slice(0, 10).split('-');
  return `${+d} ${MON[+m - 1]} ${y}`;
}
export function daysAgo(s) {
  if (!s) return null;
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  const a = new Date(y, m - 1, d), b = new Date();
  b.setHours(0, 0, 0, 0);
  return Math.round((b - a) / 864e5);
}
export function ago(s) {
  const n = daysAgo(s);
  if (n === null) return '';
  return n <= 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`;
}
export const trk = id => 'JT-' + String(id).padStart(4, '0');
export const phaseCls = (code, phase) => (code === 'WITHDRAWN' || code === 'GHOSTED' ? 'Muted' : phase);

export const MODES = ['On-site', 'Hybrid', 'Remote'];
export const TYPES = ['Full-time', 'Part-time', 'Contract', 'Internship'];
export const PLATFORMS = ['LinkedIn Easy Apply', 'LinkedIn to company site', 'Company website', 'Referral', 'Job portal', 'Other'];
export const CHANNELS = ['Phone call', 'Email', 'LinkedIn message', 'Video call', 'In person'];

// "Tue 14 Oct · 3:30 PM" / "Tue 14 Oct" for a date-only round
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function fmtWhen(s, hasTime = true) {
  if (!s) return '';
  const [d, t = '00:00'] = String(s).split(' ');
  const [y, m, day] = d.split('-').map(Number);
  const wd = WD[new Date(Date.UTC(y, m - 1, day)).getUTCDay()];
  const label = `${wd} ${day} ${MON[m - 1]}`;
  if (!hasTime) return label;
  let [h, min] = t.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${label} · ${h}:${String(min).padStart(2, '0')} ${ap}`;
}

/** One line saying when a test / interview is. */
export function eventWhen(e) {
  if (e.scheduled_at) return fmtWhen(e.scheduled_at, Boolean(e.has_time));
  if (e.due_by) return `Complete by ${fmtWhen(e.due_by, !String(e.due_by).endsWith('23:59:00'))}`;
  return 'Date to be confirmed';
}

/** "in 2 days" / "today" / "tomorrow" for the date of a round. */
export function until(s) {
  if (!s) return '';
  const n = -daysAgo(s);
  return n < 0 ? '' : n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`;
}
