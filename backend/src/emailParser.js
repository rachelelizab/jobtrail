// Reads a job-site email (LinkedIn, Naukri, Internshala, Indeed) and works out
//   - which platform sent it
//   - what kind of update it is: applied / viewed / interview / rejected / other
//   - the company, the role, the location and the job link, where it can find them.
// Email templates change over time, so every pattern here is a "best effort".
// Anything that can't be read clearly is sent to the review list instead of being guessed.

export const PLATFORMS = [
  { name: 'LinkedIn', domain: 'linkedin.com', appPlatform: 'LinkedIn Easy Apply' },
  { name: 'Naukri', domain: 'naukri.com', appPlatform: 'Job portal' },
  { name: 'Internshala', domain: 'internshala.com', appPlatform: 'Job portal' },
  { name: 'Indeed', domain: 'indeed.com', appPlatform: 'Job portal' },
  { name: 'Foundit', domain: 'foundit.in', appPlatform: 'Job portal' },
  { name: 'Foundit', domain: 'monsterindia.com', appPlatform: 'Job portal' },
  { name: 'Instahyre', domain: 'instahyre.com', appPlatform: 'Job portal' },
  { name: 'Wellfound', domain: 'wellfound.com', appPlatform: 'Job portal' },
  { name: 'Glassdoor', domain: 'glassdoor.com', appPlatform: 'Job portal' },
  { name: 'Hirist', domain: 'hirist.tech', appPlatform: 'Job portal' },
  { name: 'Hirist', domain: 'hirist.com', appPlatform: 'Job portal' },
  { name: 'Cutshort', domain: 'cutshort.io', appPlatform: 'Job portal' },
  { name: 'Shine', domain: 'shine.com', appPlatform: 'Job portal' },
  { name: 'iimjobs', domain: 'iimjobs.com', appPlatform: 'Job portal' },
  { name: 'Unstop', domain: 'unstop.com', appPlatform: 'Job portal' },
  { name: 'Apna', domain: 'apna.co', appPlatform: 'Job portal' },
].map(p => ({ ...p, match: new RegExp(`[@.]${p.domain.replace('.', '\\.')}\\b`, 'i') }));

const SITES = [...new Set(PLATFORMS.map(p => p.domain))].join(' OR ');

// Gmail search used to find job-site emails (last N days).
export const gmailQuery = days =>
  `from:(${SITES}) ` +
  `(application OR applied OR applying OR interview OR shortlisted OR unfortunately OR regret) newer_than:${days}d`;

const KINDS = [
  ['rejected', /\b(unfortunately|regret to inform|we regret|not (?:be )?moving forward|decided (?:to )?(?:move|go|proceed) forward with other|not been selected|not selected|position has been filled|will not be proceeding)\b/i],
  ['interview', /\b(interview|shortlisted|short-listed|next round|assessment invite|invited you to|schedule a call)\b/i],
  ['viewed', /\b(viewed your application|application was viewed|has been viewed|recruiter viewed|application viewed)\b/i],
  ['applied', /\b(application (?:was |has been )?(?:sent|submitted|received)|you(?:'ve| have)? applied|successfully applied|applied (?:for|to)|thank(?:s| you) for (?:applying|your application)|application for .+ (?:at|with) )/i],
];

const tidy = s => (s || '')
  .replace(/\s+/g, ' ')
  .replace(/^[\s"'“”‘’:,-]+|[\s"'“”‘’.!,:;-]+$/g, '')
  .trim();

// Words that show the "company" we found is really part of a sentence, not a name.
const BAD = /^(the|a|an|your|this|our|we|you|it|job|position|role|opportunity|linkedin|naukri|internshala|indeed|foundit|monster|instahyre|wellfound|glassdoor|hirist|cutshort|shine|iimjobs|unstop|apna)$/i;
const okName = s => s && s.length >= 2 && s.length <= 80 && !BAD.test(s) && !/https?:|@/.test(s);

function fromSubject(subject) {
  const s = subject.replace(/^(re|fwd?):\s*/i, '');
  const pats = [
    // "Your application was sent to Infosys"  /  "Application sent to Infosys for Data Analyst"
    [/application (?:was |has been )?(?:sent|submitted) (?:to|at) (.+?)(?: for (?:the )?(?:role of |position of |post of )?(.+))?$/i, m => ({ company: m[1], role: m[2] })],
    // "Your application was viewed by Infosys"
    [/viewed by (.+)$/i, m => ({ company: m[1] })],
    // "Your application to Data Analyst at Infosys" / "Application for Data Analyst at Infosys" / "applied for X with Y"
    [/(?:application|applied|applying) (?:for|to) (?:the )?(?:role of |position of |post of )?(.+?) (?:at|with|in) (.+)$/i, m => ({ role: m[1], company: m[2] })],
    // "Data Analyst at Infosys: interview invitation"
    [/^(.+?) (?:at|@) (.+?)(?: [-–|:] .*)?$/i, m => ({ role: m[1], company: m[2] })],
    // "Infosys - Data Analyst"
    [/^(?:update (?:from|on) )?([^-–|:]+?) [-–|] (.+)$/i, m => ({ company: m[1], role: m[2] })],
  ];
  for (const [re, pick] of pats) {
    const m = s.match(re);
    if (m) {
      const o = pick(m);
      return { company: tidy(o.company), role: tidy(o.role) };
    }
  }
  return {};
}

function fromBody(text) {
  const out = {};
  const label = (names) => {
    const m = text.match(new RegExp(`(?:^|\\n)\\s*(?:${names})\\s*[:\\-]\\s*([^\\n]{2,90})`, 'i'));
    return m ? tidy(m[1]) : '';
  };
  out.role = label('role|job title|position|designation|profile|job role|internship');
  out.company = label('company|company name|organisation|organization|employer');
  out.location = label('location|job location|city');
  // LinkedIn layout: "<Role>\n<Company> · <Location>"  or "<Role> · <Company> · <Location>"
  const dot = text.match(/(?:^|\n)\s*([^\n·]{3,80})\s*\n\s*([^\n·]{2,60})\s*·\s*([^\n]{2,60})/);
  if (dot) {
    out.role ||= tidy(dot[1]); out.company ||= tidy(dot[2]); out.location ||= tidy(dot[3]);
  }
  // "for the role of X at Y" anywhere in the text
  const roleAt = text.match(/(?:for|to) (?:the )?(?:role of |position of |post of )?([A-Z][^\n.,]{2,70}?) (?:at|with) ([A-Z][^\n.,]{1,60})/);
  if (roleAt) { out.role ||= tidy(roleAt[1]); out.company ||= tidy(roleAt[2]); }
  return out;
}

function jobLink(text) {
  const m = text.match(/https?:\/\/[^\s"'<>]*(?:linkedin\.com\/(?:comm\/)?jobs\/view\/\d+|naukri\.com\/job-listings-[^\s"'<>]+|internshala\.com\/(?:internship|job)\/detail\/[^\s"'<>]+|indeed\.com\/viewjob\?jk=[^\s"'<>&]+|(?:foundit\.in|instahyre\.com|wellfound\.com|glassdoor\.(?:com|co\.in)|hirist\.(?:tech|com)|cutshort\.io|shine\.com|iimjobs\.com|unstop\.com|apna\.co)\/[^\s"'<>]*job[^\s"'<>]*)/i);
  return m ? m[0].replace(/[).,]+$/, '') : '';
}

/**
 * @param {{from:string, subject:string, text:string}} email
 * @returns {{platform, appPlatform, kind, company, role, location, job_url}|null}  null = not from a job site
 */
export function parseJobEmail({ from = '', subject = '', text = '' }) {
  const p = PLATFORMS.find(x => x.match.test(from));
  if (!p) return null;
  const all = `${subject}\n${text}`;
  const kind = (KINDS.find(([, re]) => re.test(all)) || ['other'])[0];
  const s = fromSubject(subject);
  const b = fromBody(text);
  const cleanCompany = c => tidy((c || '').replace(/\s+(?:has|have|was|were|is|are)\b.*$/i, '').replace(/\s*[(\[].*$/, ''));
  const cleanRole = r => tidy((r || '')
    .replace(/^.*?\b(?:shortlisted|selected|invited|considered|interview(?: invitation| invite)?|application (?:submitted|sent|received)|applied|applying)\b\s*(?:for|to|:)\s*/i, '')
    .replace(/^[^:]{0,40}:\s*/, '')
    .replace(/^(?:the )?(?:role|position|post) of\s+/i, ''));
  const sc = cleanCompany(s.company), bc = cleanCompany(b.company), sr = cleanRole(s.role), br = cleanRole(b.role);
  let company = okName(sc) ? sc : okName(bc) ? bc : '';
  let role = okName(sr) ? sr : okName(br) ? br : '';
  if (company && role && company.toLowerCase() === role.toLowerCase()) role = '';
  return {
    platform: p.name, appPlatform: p.appPlatform, kind,
    company, role, location: okName(b.location) ? b.location : '', job_url: jobLink(all),
  };
}

// ---------------------------------------------------------------------
// Emails that come straight from a recruiter / company (not from a job site),
// e.g. "Interview for Data Analyst - Infosys" from priya.raman@infosys.com
// ---------------------------------------------------------------------
export const recruiterQuery = days =>
  `-from:(${SITES}) -category:promotions -category:social ` +
  `(interview OR shortlisted OR "your application" OR "your profile" OR "job opportunity" OR "next round" OR unfortunately) newer_than:${days}d`;

const GENERIC_LOCAL = /^(no-?reply|do-?not-?reply|careers?|jobs?|hr|recruit(?:ment|ing|er)?|talent|hiring|notifications?|info|team|support)\b/i;
const FREE_MAIL = /@(gmail|yahoo|outlook|hotmail|live|icloud|rediffmail|proton(?:mail)?)\./i;
const squash = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const SUFFIX = /\s+(pvt\.?|private|ltd\.?|limited|inc\.?|llp|llc|technologies|technology|solutions|services|software|india|consulting|labs?|group)\b.*$/i;

/** Split a From header into { name, email }. */
export function parseFrom(from) {
  const m = String(from).match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>/);
  const email = (m ? m[2] : String(from)).trim().toLowerCase();
  let name = m ? m[1].trim() : '';
  if (!name || /@/.test(name)) name = '';
  return { name, email };
}

/** Indian mobile numbers (with or without +91), e.g. +91 98450 12345, 9845012345 */
export function findPhone(text) {
  const m = String(text).match(/(?:\+?91[\s-]?)?(?:\(0\)\s?)?[6-9]\d{4}[\s-]?\d{5}(?!\d)/);
  return m ? m[0].replace(/\s+/g, ' ').trim() : '';
}

/**
 * Which of my companies is this email about?  `companies` = [{company_id, name}].
 * Matches the sender's domain (priya@infosys.com -> Infosys) or the company name in the subject / first part of the body.
 */
export function matchCompany(email, companies) {
  const { email: addr } = parseFrom(email.from);
  const domain = FREE_MAIL.test(addr) ? '' : squash(addr.split('@')[1]?.split('.').slice(0, -1).join(''));
  const hay = `${email.subject}\n${String(email.text).slice(0, 1500)}`.toLowerCase();
  let best = null;
  for (const c of companies) {
    const core = c.name.replace(SUFFIX, '').trim() || c.name;
    const key = squash(core);
    if (key.length < 3) continue;
    const inDomain = domain && domain.includes(key);
    const inText = new RegExp(`(^|[^a-z0-9])${core.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(hay);
    if ((inDomain || inText) && (!best || key.length > best.key.length)) best = { ...c, key, inDomain };
  }
  return best;
}

/** Recruiter details from the sender: real person only (not careers@ / no-reply@). */
export function recruiterFrom(email) {
  const { name, email: addr } = parseFrom(email.from);
  const local = addr.split('@')[0] || '';
  if (GENERIC_LOCAL.test(local) || GENERIC_LOCAL.test(name)) return null;
  const pretty = name || local.split(/[._-]+/).filter(w => /^[a-z]{2,}$/i.test(w)).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
  if (!pretty) return null;
  return { full_name: pretty.slice(0, 80), email: addr, phone: findPhone(email.text) || null };
}

export const kindOf = text => (KINDS.find(([, re]) => re.test(text)) || ['other'])[0];
