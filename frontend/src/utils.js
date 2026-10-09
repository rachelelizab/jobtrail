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
