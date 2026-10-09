// Reads a job-site email (LinkedIn, Naukri, Internshala, Indeed) and works out
//   - which platform sent it
//   - what kind of update it is: applied / viewed / interview / rejected / other
//   - the company, the role, the location and the job link, where it can find them.
// It also finds offers and online tests; dates, rounds and links come from scheduleParser.js.
// Email templates change over time, so every pattern here is a "best effort".
// Anything that can't be read clearly is sent to the review list instead of being guessed.

import { findPhone, hrFromBody } from './scheduleParser.js';

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
  // Company hiring systems: the email is from the company, sent through these services
  ...[['Workday', 'myworkday.com'], ['Workday', 'workday.com'], ['Greenhouse', 'greenhouse.io'], ['Greenhouse', 'greenhouse-mail.io'],
      ['Lever', 'lever.co'], ['SmartRecruiters', 'smartrecruiters.com'], ['iCIMS', 'icims.com'], ['SuccessFactors', 'successfactors.com'],
      ['SuccessFactors', 'successfactors.eu'], ['SuccessFactors', 'sapsf.com'], ['Taleo', 'taleo.net'], ['Ashby', 'ashbyhq.com'],
      ['Workable', 'workable.com'], ['Workable', 'workablemail.com'], ['Zoho Recruit', 'zohorecruit.com'], ['Zoho Recruit', 'zohorecruit.in'],
      ['Darwinbox', 'darwinbox.in'], ['Darwinbox', 'darwinbox.com'], ['Keka', 'keka.com'], ['Freshteam', 'freshteam.com'],
      ['Jobvite', 'jobvite.com'], ['BambooHR', 'bamboohr.com'], ['Recruitee', 'recruitee.com'], ['Breezy', 'breezy.hr'],
      ['Teamtailor', 'teamtailor.com'], ['Superset', 'joinsuperset.com'], ['HirePro', 'hirepro.in'], ['Eightfold', 'eightfold.ai']]
    .map(([name, domain]) => ({ name, domain, appPlatform: 'Company website', ats: true })),
].map(p => ({ ...p, match: new RegExp(`[@.]${p.domain.replace('.', '\\.')}\\b`, 'i') }));

const SITES = [...new Set(PLATFORMS.map(p => p.domain))].join(' OR ');

// Gmail search used to find job-site emails (last N days).
export const gmailQuery = days =>
  `from:(${SITES}) ` +
  `(application OR applied OR applying OR interview OR shortlisted OR unfortunately OR regret OR assessment OR test OR offer OR selected) newer_than:${days}d`;

// Everything you file under your own Gmail label (default "Jobs"), from any sender.
export const labelQuery = (label, days) => `label:${String(label).trim().replace(/\s+/g, '-')} newer_than:${days}d`;

const KINDS = [
  ['rejected', /\b(unfortunately|regret to inform|we regret|not (?:be )?moving forward|decided (?:to )?(?:move|go|proceed) forward with other|not been selected|not selected|position has been filled|will not be proceeding)\b/i],
  // an offer — but "selected for the next round / for the interview" is still an interview
  ['offer', /\b(offer letter|letter of offer|offer of employment|pleased to (?:extend|offer)|happy to offer|job offer|(?:you have been|you've been|you are) (?:finally )?selected(?! for (?:the )?(?:next|second|third|final|\d\w*|technical|hr|online|first) ?(?:round|stage|interview|test|assessment)?)(?! to (?:attend|appear|take))|welcome (?:on ?board|aboard) to)\b/i],
  ['test', /\b(online (?:test|assessment)|assessment (?:link|invite|invitation)|coding (?:test|challenge|assessment)|aptitude test|hackerrank|hackerearth|codility|mettl|codesignal|imocha|testgorilla|take[- ]?home (?:assignment|task)|test link)\b/i],
  ['interview', /\b(interview|shortlisted|short-listed|next round|assessment invite|invited you to|schedule a call|round \d|(?:hr|technical|final|managerial|director) round|invitation:)/i],
  ['viewed', /\b(viewed your application|application was viewed|has been viewed|recruiter viewed|application viewed)\b/i],
  ['applied', /\b(application (?:was |has been )?(?:sent|submitted|received)|you(?:'ve| have)? applied|successfully applied|applied (?:for|to)|thank(?:s| you) for (?:applying|your application|your interest)|received your application|application for .+ (?:at|with) )/i],
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
  if (p.ats) return parseAtsEmail(p, { from, subject, text }, kind);
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
  `(interview OR shortlisted OR "your application" OR "your profile" OR "job opportunity" OR "next round" OR unfortunately OR assessment OR "online test" OR "offer letter" OR invitation) newer_than:${days}d`;

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

// Phone numbers: mobiles anywhere, landlines on a "phone / contact" line (see scheduleParser.js)
export { findPhone };

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

/**
 * Recruiter details: the sender when it is a real person (not careers@ / no-reply@),
 * otherwise the HR named in the email ("HR Name: …", "Contact person: …") or in the signature.
 * Name, title, email and phone are filled in from whichever place has them.
 */
export function recruiterFrom(email) {
  const { name, email: addr } = parseFrom(email.from);
  const local = addr.split('@')[0] || '';
  const body = hrFromBody(email.text || '');
  const genericSender = GENERIC_LOCAL.test(local) || GENERIC_LOCAL.test(name) || /\b(team|notifications?|alerts?|via)\b/i.test(name);
  if (!genericSender) {
    const pretty = name || local.split(/[._-]+/).filter(w => /^[a-z]{2,}$/i.test(w)).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
    if (pretty) {
      const same = body && squash(body.full_name).includes(squash(pretty).slice(0, 5));
      return { full_name: pretty.slice(0, 80), email: addr, phone: (same && body.phone) || findPhone(email.text) || null,
               role_title: (same && body.role_title) || null };
    }
  }
  if (!body) return null;
  return { full_name: body.full_name, email: body.email || (genericSender ? null : addr), phone: body.phone, role_title: body.role_title };
}

export const kindOf = text => (KINDS.find(([, re]) => re.test(text)) || ['other'])[0];

/**
 * An email you filed under your Jobs label that is not from a job site (e.g. straight from a company's HR).
 * Company: the sender's company domain, spelled as the email writes it ("zeptonow.com" + "Zepto – HR Round" → Zepto).
 * Role: a phrase that looks like a job title (Analyst, Engineer, Scientist, Intern …).
 */
const ROLE_WORD = /\b(analyst|scientist|engineer|developer|programmer|architect|manager|intern(ship)?|associate|consultant|designer|specialist|executive|officer|administrator|researcher|trainee|tester|sde|devops|lead|director|accountant|advisor|coordinator|technician|strategist|writer|editor|marketer|representative|fellow|apprentice)\b/i;
const NOT_COMPANY = /\b(offer|letter|application|applying|steps?|update|invitation|invite|round|interview|test|assessment|your|candidate|congratulations|regarding|re|status|schedule[sd]?|reminder)\b|\d/i;
const roleOk = r => r && ROLE_WORD.test(r) && r.length <= 70;

export function parseDirectEmail(email) {
  const all = `${email.subject || ''}\n${email.text || ''}`;
  const { email: addr, name } = parseFrom(email.from);
  const root = FREE_MAIL.test(addr) ? '' : squash((addr.split('@')[1] || '').split('.').slice(-2, -1)[0] || '');

  // company: a capitalised word/phrase in the email that the sender's domain begins with
  let company = '';
  if (root.length >= 3) {
    const words = all.slice(0, 2500).match(/\b[A-Z][A-Za-z0-9&.]+(?:\s+[A-Z][A-Za-z0-9&.]+){0,2}/g) || [];
    const prefixes = words.flatMap(w => { const ws = w.split(/\s+/); return ws.map((_, i) => ws.slice(0, i + 1).join(' ')); });
    const hit = prefixes.map(w => w.replace(SUFFIX, '').trim()).filter(w => squash(w).length >= 3 && root.startsWith(squash(w)) && !NOT_COMPANY.test(w))
      .sort((a, b) => squash(b).length - squash(a).length)[0];
    company = hit || root[0].toUpperCase() + root.slice(1);
  } else {
    const s = fromSubject(email.subject || ''), b = fromBody(email.text || '');
    company = [s.company, b.company].map(tidy).find(c => okName(c) && !NOT_COMPANY.test(c)) || '';
  }

  // role: labelled ("Role: …"), "for the X role/position", or a subject part that looks like a job title
  const b = fromBody(email.text || ''), s = fromSubject(email.subject || '');
  const strip = r => tidy(String(r || '').replace(new RegExp(`\\s*[-–|@,]?\\s*(?:at |with )?${company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b.*$`, 'i'), ''));
  const phrase = all.match(/\b(?:for|as) (?:the |a |an )?(?:role of |position of |post of )?([A-Z][A-Za-z/&+ ]{2,50}?)(?: role| position| opening| profile|\.|,| at | with |\n)/);
  const parts = String(email.subject || '').split(/\s+[-–|:]\s+|:\s+/).map(tidy);
  const role = [b.role, phrase?.[1], ...parts, s.role].map(strip).find(roleOk) || '';
  return { company, role, kind: kindOf(all) };
}


// ---------------------------------------------------------------------
// Hiring-system emails (Workday, Greenhouse, Lever, Darwinbox, Keka …):
// "Thank you for applying to Razorpay!", from "Razorpay Hiring Team <no-reply@us.greenhouse-mail.io>".
// The company comes from the wording or the sender's display name — never from the service's address.
// ---------------------------------------------------------------------
const ATS_NAMES = /\b(workday|greenhouse|lever|smartrecruiters|icims|successfactors|taleo|ashby|workable|zoho( recruit)?|darwinbox|keka|freshteam|jobvite|bamboohr|recruitee|breezy|teamtailor|superset|hirepro|eightfold)\b/i;
const SENDER_NOISE = /\b(via|careers?|jobs?|hiring|recruit(?:ing|ment|er|ers)?|talent(?: acquisition)?|team|hr|people|no-?reply|do-?not-?reply|notifications?|ta)\b/gi;
const REQ_ID = /\s*[(\[]?\b(?:JR|R|REQ|Req|ID|Job ?ID|Ref)?[-#: ]*\d{4,}[)\]]?\s*$/;

function parseAtsEmail(p, { from, subject, text }, kind) {
  const all = `${subject}\n${text}`;
  const cut = s => tidy(String(s || '').replace(/\s+(?:for|and|as|in|on|is|has|we|our|team)\b.*$/i, ''));
  // company from the wording
  const fromText = [
    all.match(/\b(?:applying|applied|application|apply) (?:to|at|with) ([A-Z][\w&.'-]*(?: [A-Z][\w&.'-]*){0,3})/),
    all.match(/\bthank(?:s| you) for (?:your )?(?:interest in|considering|choosing) ([A-Z][\w&.'-]*(?: [A-Z][\w&.'-]*){0,3})/),
    all.match(/\b(?:role|position|opening|job)\b[^\n.]{0,40}? at ([A-Z][\w&.'-]*(?: [A-Z][\w&.'-]*){0,3})/),
    all.match(/\b(?:interview|test|assessment)\b[^\n.]{0,60}? (?:at|with) ([A-Z][\w&.'-]*(?: [A-Z][\w&.'-]*){0,3})/),
  ].map(m => m && cut(m[1])).filter(c => c && okName(c) && !ATS_NAMES.test(c) && !ROLE_WORD.test(c));
  // company from the display name: "Razorpay Hiring Team" → Razorpay; "flipkart@myworkday.com" → Flipkart
  const { name, email: addr } = parseFrom(from);
  let shown = tidy(name.replace(ATS_NAMES, '').replace(SENDER_NOISE, ' ').replace(/[|,:]+/g, ' '));
  if (!shown && /workday/i.test(addr)) shown = (addr.split('@')[0] || '').replace(/[^a-z]/gi, ' ').trim();
  if (shown && shown === shown.toLowerCase()) shown = shown.replace(/\b\w/g, c => c.toUpperCase());
  const display = okName(shown) && !ATS_NAMES.test(shown) ? shown : '';
  // prefer the wording when it agrees with the display name (keeps "CRED" over "Cred"), else whichever exists
  const agree = fromText.find(c => display && squash(c) === squash(display));
  const company = agree || fromText[0] || display;

  // role
  const b = fromBody(text);
  const rx = [
    b.role,
    all.match(/\b(?:position|role|post|job) of ([A-Z][^\n.,(]{2,60})/)?.[1],
    all.match(/\b(?:for|to) (?:the |our )?([A-Z][A-Za-z/&+ -]{2,60}?) (?:role|position|opening|job)\b/)?.[1],
    all.match(/\bapplication (?:for|to) (?:the )?([A-Z][^\n.,(]{2,60}?)(?: at | with | role| position|[.,(\n]|$)/)?.[1],
    all.match(/\b(?:interview|test|assessment) for (?:the )?([A-Z][^\n.,(]{2,60}?)(?: at | with | role| position|[.,(\n]|$)/)?.[1],
    ...String(subject).split(/\s+[-–|:]\s+|:\s+/),
  ];
  const role = rx.map(r => tidy(String(r || '').replace(REQ_ID, '').replace(/\s+(?:role|position|opening|job|profile|vacancy)\s*$/i, ''))).find(r => roleOk(r) && (!company || r.toLowerCase() !== company.toLowerCase())) || '';
  return { platform: p.name, appPlatform: p.appPlatform, kind, company, role, location: okName(b.location) ? b.location : '', job_url: jobLink(all), ats: true };
}
