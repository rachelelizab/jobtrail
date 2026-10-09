// Reads the "what happens next" part of a job email — free, rule-based, no AI service:
//   - what kind of step it is: online test / interview / HR round / take-home assignment
//   - the round name ("Round 1 – Technical", "Aptitude test", "HR discussion")
//   - the date and time, or the deadline for a test
//   - online link (Meet, Zoom, Teams, HackerRank …) or the venue
//   - the HR / recruiter in the signature (name, title, phone, email)
//   - calendar invites (.ics) attached by Google Calendar / Outlook
// Every pattern is best effort; anything unclear is left empty rather than guessed.

const TZ = process.env.APP_TIMEZONE || 'Asia/Kolkata';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MON_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const pad = n => String(n).padStart(2, '0');

/** Local calendar date (in APP_TIMEZONE) of an ISO instant → {y, m, d}. */
function localYMD(iso) {
  const [y, m, d] = new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ }).split('-').map(Number);
  return { y, m, d };
}
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const validDate = (y, m, d) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};
const addDays = (s, n) => { const t = new Date(s + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

// ------------------------------------------------------------------ kind of step
const TEST = /\b(online (?:test|assessment)|assessment|aptitude|coding (?:test|challenge|round|assessment)|technical (?:test|assessment)|hackerrank|hackerearth|codility|mettl|codesignal|imocha|testgorilla|hirepro|amcat|wheebox|test link|written test)\b/i;
const ASSIGN = /\b(take[- ]?home|assignment|case study (?:submission|task)|home task)\b/i;
const HR = /\b(hr (?:round|interview|discussion|call)|final (?:round|discussion)|managerial round|salary discussion|culture fit)\b/i;
const INTERVIEW = /\b(interview|round|discussion|screening call|telephonic|virtual meeting|f2f|face[- ]to[- ]face|meet(?:ing)? with)\b/i;

const ROUND = new RegExp([
  String.raw`round\s*(?:-|:|#)?\s*(\d{1,2}|one|two|three|four|i{1,3}|iv)\b(?:\s*[-–:(]\s*([a-z][a-z /&]{2,30}?)(?:\)|\.|,|\n| on | at | for | with | is | will | has | was |$))?`,
  String.raw`\b(first|second|third|fourth|final|1st|2nd|3rd|4th)\s+(?:technical\s+|hr\s+)?round\b`,
  String.raw`\b(technical|hr|managerial|coding|aptitude|screening|telephonic|virtual|f2f|face[- ]to[- ]face|director|culture[- ]fit|group discussion|walk[- ]?in)\s+(round|interview|test|call|discussion)\b`,
  String.raw`\b(online assessment|online test|aptitude test|coding test|coding challenge|written test|take[- ]?home assignment|case study)\b`,
].join('|'), 'i');

const WORD_NUM = { one: 1, two: 2, three: 3, four: 4, i: 1, ii: 2, iii: 3, iv: 4, first: 1, second: 2, third: 3, fourth: 4, '1st': 1, '2nd': 2, '3rd': 3, '4th': 4 };
const title = s => s.replace(/\s+/g, ' ').trim().replace(/\b(hr|f2f)\b/gi, m => m.toUpperCase()).replace(/(^|\s)([a-z])/g, (_, a, b) => a + b.toUpperCase());

export function stepType(text) {
  if (ASSIGN.test(text)) return 'Assignment';
  if (TEST.test(text)) return 'Test';
  if (HR.test(text)) return 'HR round';
  if (INTERVIEW.test(text)) return 'Interview';
  return null;
}

export function roundName(text, type) {
  const m = text.match(ROUND);
  if (m) {
    if (m[1]) { const n = WORD_NUM[m[1].toLowerCase()] || m[1]; return `Round ${n}${m[2] ? ' – ' + title(m[2]) : ''}`; }
    if (m[3]) { const n = WORD_NUM[m[3].toLowerCase()]; return m[3].toLowerCase() === 'final' ? 'Final round' : `Round ${n}`; }
    if (m[4]) return title(`${m[4]} ${m[5]}`);
    if (m[6]) return title(m[6]);
  }
  return { Test: 'Online test', Assignment: 'Take-home assignment', 'HR round': 'HR round', Interview: 'Interview' }[type] || 'Next step';
}

// ------------------------------------------------------------------ dates and times
const DATE_PATTERNS = [
  // 12 October 2026 / 12th Oct, 2026 / 12-Oct-2026 / Friday, 12 Oct
  { re: new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)?[\s\-/]*(?:of\s+)?${MON_RE}\.?,?[\s\-/]*(\d{4})?`, 'gi'), pick: m => ({ d: +m[1], m: MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1, y: m[3] ? +m[3] : null }) },
  // October 12, 2026 / Oct 12th
  { re: new RegExp(String.raw`\b${MON_RE}\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b,?\s*(\d{4})?`, 'gi'), pick: m => ({ d: +m[2], m: MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, y: m[3] ? +m[3] : null }) },
  // 2026-10-12
  { re: /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g, pick: m => ({ y: +m[1], m: +m[2], d: +m[3] }) },
  // 12/10/2026 or 12-10-26 (Indian order: day first)
  { re: /\b(\d{1,2})[/.-](\d{1,2})[/.-](20\d{2}|\d{2})\b/g, pick: m => ({ d: +m[1], m: +m[2], y: m[3].length === 2 ? 2000 + +m[3] : +m[3] }) },
];
const RELATIVE = /\b(today|tomorrow|day after tomorrow)\b/gi;
const TIME = /\b(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?![a-z])|\b([01]?\d|2[0-3]):([0-5]\d)\s*(?:hrs?|hours|IST)?\b/gi;
const NEAR = /\b(date|time|schedul|when|slot|on |at |interview|test|assessment|round|deadline|due|complete|submit|before|by )/i;

/** All dates mentioned, with position, in YYYY-MM-DD, resolved against the email's own date. */
function findDates(text, sentIso) {
  const ref = localYMD(sentIso);
  const refStr = ymd(ref.y, ref.m, ref.d);
  const out = [];
  for (const { re, pick } of DATE_PATTERNS) {
    for (const m of text.matchAll(re)) {
      let { y, m: mo, d } = pick(m);
      if (!mo || mo < 1 || mo > 12) continue;
      if (!y) {           // no year written: the next time this date comes round (allowing a week back)
        y = ref.y;
        if (validDate(y, mo, d) && ymd(y, mo, d) < addDays(refStr, -7)) y += 1;
      }
      if (!validDate(y, mo, d)) continue;
      out.push({ date: ymd(y, mo, d), index: m.index, len: m[0].length });
    }
  }
  for (const m of text.matchAll(RELATIVE)) {
    const w = m[1].toLowerCase();
    out.push({ date: addDays(refStr, w === 'today' ? 0 : w === 'tomorrow' ? 1 : 2), index: m.index, len: m[0].length });
  }
  return out.sort((a, b) => a.index - b.index);
}

function findTimes(text) {
  const out = [];
  for (const m of text.matchAll(TIME)) {
    let h, min;
    if (m[3]) {
      h = +m[1]; min = m[2] ? +m[2] : 0;
      if (h < 1 || h > 12) continue;
      const pm = /^p/i.test(m[3]);
      if (pm && h < 12) h += 12;
      if (!pm && h === 12) h = 0;
    } else { h = +m[4]; min = +m[5]; }
    out.push({ time: `${pad(h)}:${pad(min)}`, index: m.index });
  }
  return out;
}

/**
 * When is the step?  Picks the first date that is not before the email (a test deadline counts too),
 * and the time written closest to it.
 * @returns {{scheduled_at:string|null, has_time:boolean, due_by:string|null}}
 */
export function whenOf(text, sentIso, type) {
  const ref = localYMD(sentIso);
  const refStr = ymd(ref.y, ref.m, ref.d);
  const dates = findDates(text, sentIso).filter(d => d.date >= refStr && d.date <= addDays(refStr, 180));
  const times = findTimes(text);
  let deadline = null;

  // "complete within 48 hours" / "valid for 3 days"
  const within = text.match(/\b(?:within|in the next|valid (?:for|till)|expires in)\s+(\d{1,3})\s*(hours?|hrs?|days?)\b/i);
  if (within) {
    const n = +within[1], days = /^d/i.test(within[2]) ? n : Math.ceil(n / 24);
    deadline = `${addDays(refStr, days)} 23:59:00`;
  }
  // a date written right after "by / before / deadline / due / last date"
  const due = dates.find(d => /\b(by|before|deadline|due|last date|on or before|latest by|complete by|submit by|expires?)\b[^.\n]{0,25}$/i.test(text.slice(Math.max(0, d.index - 40), d.index)));

  // the date of the step itself: prefer one on a line that talks about date/time/schedule
  const candidates = dates.filter(d => d !== due);
  const best = candidates.find(d => NEAR.test(lineAround(text, d.index))) || candidates[0] || null;

  let scheduled_at = null, has_time = false;
  if (best) {
    const t = times.filter(x => Math.abs(x.index - best.index) < 160).sort((a, b) => Math.abs(a.index - best.index) - Math.abs(b.index - best.index))[0];
    scheduled_at = `${best.date} ${t ? t.time : '00:00'}:00`;
    has_time = Boolean(t);
  }
  if (due) {
    const t = times.find(x => x.index > due.index && x.index - due.index < 60);
    deadline = `${due.date} ${t ? t.time : '23:59'}:00`;
  }
  // a test with only a deadline: show it on the deadline
  if (!scheduled_at && deadline && (type === 'Test' || type === 'Assignment')) return { scheduled_at: null, has_time: false, due_by: deadline };
  return { scheduled_at, has_time, due_by: deadline };
}

function lineAround(text, i) {
  const s = text.lastIndexOf('\n', i) + 1;
  const e = text.indexOf('\n', i);
  return text.slice(Math.max(s, i - 120), e < 0 ? i + 120 : Math.min(e, i + 120));
}

// ------------------------------------------------------------------ where
const LINK = /https?:\/\/(?:[\w-]+\.)*(?:meet\.google\.com|zoom\.us|teams\.microsoft\.com|teams\.live\.com|webex\.com|gotomeet(?:ing)?\.com|whereby\.com|hackerrank\.com|hackerearth\.com|codility\.com|mettl\.com|codesignal\.com|imocha\.io|testgorilla\.com|hirepro\.in|amcat\.in|wheebox\.com|interviewbit\.com|hirevue\.com|calendly\.com)[^\s"'<>)\]]*/i;
export function placeOf(text) {
  const link = (text.match(LINK) || [''])[0].replace(/[.,;]+$/, '');
  const label = text.match(/(?:^|\n)\s*(?:venue|address|location|interview location|office address|reporting address)\s*[:\-]\s*([^\n]{5,160})/i);
  const location = label ? label[1].trim() : '';
  let mode = null;
  if (link) mode = 'Online';
  else if (location && !/online|virtual|remote|video/i.test(location) || /\b(walk[- ]?in|in[- ]person|face[- ]to[- ]face|f2f|visit (?:our|the) office|report (?:to|at) (?:our|the) office)\b/i.test(text)) mode = 'In person';
  else if (/\b(telephonic|phone (?:call|interview|screen)|call you (?:on|at))\b/i.test(text)) mode = 'Phone';
  else if (/\b(online|virtual|video call|google meet|zoom|ms teams|microsoft teams)\b/i.test(text)) mode = 'Online';
  return { mode, meeting_link: link || null, location: location || null };
}

// ------------------------------------------------------------------ phone numbers
/** Indian mobile first (+91 98450 12345, 9845012345); landline (080-4718 2200) only when the line says phone/tel/contact. */
export function findPhone(text) {
  const s = String(text).replace(/https?:\/\/\S+/g, ' ');      // meeting ids in Zoom/Meet links are not phone numbers
  const mob = s.match(/(?:\+?91[\s-]?|\b0)?(?<![\d])[6-9]\d{4}[\s-]?\d{5}(?!\d)/);
  if (mob) return mob[0].replace(/\s+/g, ' ').trim();
  for (const line of s.split('\n')) {
    if (!/\b(phone|ph|tel|telephone|contact|call|mobile|mob|landline|office)\b/i.test(line)) continue;
    const land = line.match(/(?:\+91[\s-]?|\b0)\d{2,4}[\s-]\d{3,4}[\s-]?\d{3,4}\b/);
    if (land) return land[0].replace(/\s+/g, ' ').trim();
  }
  return '';
}

// ------------------------------------------------------------------ HR in the body / signature
const SIGNOFF = /^(?:regards|best regards|warm regards|kind regards|thanks(?: (?:&|and) regards)?|thank you|sincerely|cheers|best|with regards)[,!.]*\s*$/i;
const NAME_LINE = /^(?:[A-Z][a-zA-Z.'-]{1,20})(?:\s+[A-Z][a-zA-Z.'-]{0,20}){0,3}$/;
const HR_TITLE = /\b(recruit\w*|talent|acquisition|hr\b|human resources|people|hiring|staffing|sourcing)/i;
const GENERIC = /^(no-?reply|do-?not-?reply|careers?|jobs?|hr|recruit(?:ment|ing|er)?|talent|hiring|notifications?|info|team|support|alerts?|messages?|updates?)\b/i;

export function hrFromBody(text) {
  const lines = String(text).split('\n').map(l => l.trim());
  // 1) labelled: "HR Name: Priya Raman" / "Contact person - Priya (98450 21734)"
  const lab = String(text).match(/(?:^|\n)[ \t]*(?:hr name|recruiter(?: name)?|contact person|point of contact|spoc|coordinator|hr contact|contact)[ \t]*[:\-][ \t]*([A-Z][A-Za-z.']*(?:[ \t]+[A-Z][A-Za-z.']*){0,3})(?=[ \t]*(?:[,(|\n]|\+?\d|$))/i);
  let name = lab ? lab[1].trim() : '';
  let role = '';
  // 2) signature after "Regards,"
  if (!name) {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!SIGNOFF.test(lines[i])) continue;
      const next = lines.slice(i + 1).filter(Boolean);
      if (next[0] && NAME_LINE.test(next[0]) && !GENERIC.test(next[0]) && !/team$/i.test(next[0])) {
        name = next[0];
        if (next[1] && HR_TITLE.test(next[1]) && next[1].length < 70) role = next[1].replace(/\s*[|,–-]\s*[^|,–-]*$/, '').trim() || next[1];
      }
      break;
    }
  }
  if (!name) return null;
  const tail = lab ? String(text).slice(lab.index, lab.index + 300) : lines.slice(-12).join('\n');
  const emails = (tail.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) || []).filter(e => !GENERIC.test(e.split('@')[0]));
  return { full_name: name.slice(0, 80), role_title: role || null, phone: findPhone(tail) || findPhone(text) || null, email: emails[0]?.toLowerCase() || null };
}

// ------------------------------------------------------------------ calendar invites (.ics)
const unfold = s => s.replace(/\r?\n[ \t]/g, '');
function icsTime(v, params) {
  // 20261012T093000Z (UTC) | 20261012T150000 with TZID | 20261012 (all-day)
  const m = String(v).match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/);
  if (!m) return null;
  const [, y, mo, d, h, mi, , z] = m;
  if (!h) return { at: `${y}-${mo}-${d} 00:00:00`, has_time: false };
  if (z) {
    const local = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi)).toLocaleString('sv-SE', { timeZone: TZ }).slice(0, 16);
    return { at: `${local}:00`, has_time: true };
  }
  return { at: `${y}-${mo}-${d} ${h}:${mi}:00`, has_time: true };  // TZID / floating: take as written
}

/** First VEVENT in an .ics text → {summary, scheduled_at, has_time, ends_at, location, link, organizer:{name,email}} */
export function parseIcs(ics) {
  if (!ics || !/BEGIN:VEVENT/i.test(ics)) return null;
  const body = unfold(ics).split(/BEGIN:VEVENT/i)[1].split(/END:VEVENT/i)[0];
  const get = key => {
    const m = body.match(new RegExp(`(?:^|\\n)${key}((?:;[^:\\n]*)?):([^\\n\\r]*)`, 'i'));
    return m ? { params: m[1], value: m[2].replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').trim() } : null;
  };
  const start = get('DTSTART'), end = get('DTEND');
  if (!start) return null;
  const s = icsTime(start.value, start.params), e = end ? icsTime(end.value, end.params) : null;
  const desc = get('DESCRIPTION')?.value || '';
  const loc = get('LOCATION')?.value || '';
  const org = get('ORGANIZER');
  const orgName = org?.params.match(/CN="?([^";:]+)"?/i)?.[1] || '';
  const orgMail = org?.value.replace(/^mailto:/i, '').toLowerCase() || '';
  const link = (`${loc}\n${desc}\n${get('URL')?.value || ''}`.match(LINK) || [''])[0] || null;
  return {
    summary: get('SUMMARY')?.value || '', scheduled_at: s?.at || null, has_time: Boolean(s?.has_time), ends_at: e?.at || null,
    location: loc && !LINK.test(loc) ? loc : null, link, description: desc,
    organizer: orgMail ? { name: orgName, email: orgMail } : null,
  };
}

// ------------------------------------------------------------------ everything together
/**
 * The next step described by an email, or null if it does not describe one.
 * @param {{subject:string, text:string, date:string, ics?:string}} email
 */
export function extractEvent(email) {
  const ics = parseIcs(email.ics);
  const text = `${email.subject}\n${email.text || ''}${ics ? `\n${ics.summary}\n${ics.description}` : ''}`;
  const type = stepType(text);
  if (!type && !ics) return null;
  // a rejection or a plain "application received" is not a step
  if (!ics && /\b(unfortunately|regret to inform|not (?:be )?moving forward|not been selected|application (?:was |has been )?(?:sent|received|submitted))\b/i.test(text)
      && !/\b(invite|invitation|schedul|shortlisted|next round)\b/i.test(text)) return null;
  const t = type || 'Interview';
  const when = ics ? { scheduled_at: ics.scheduled_at, has_time: ics.has_time, due_by: null } : whenOf(text, email.date, t);
  const place = placeOf(text);
  if (ics?.link) { place.meeting_link = ics.link; place.mode = 'Online'; }
  if (ics?.location && !place.location) { place.location = ics.location; place.mode ||= 'In person'; }
  // an invitation with neither a date, a deadline, a link nor a round name is too vague to save
  const name = roundName(text, t);
  if (!when.scheduled_at && !when.due_by && !place.meeting_link && name === roundName('', t) && !/\b(invite|invitation|shortlisted|schedul)\b/i.test(text)) return null;
  return {
    event_type: t, round_name: name, scheduled_at: when.scheduled_at, has_time: when.has_time ? 1 : 0, due_by: when.due_by,
    ends_at: ics?.ends_at || null, mode: place.mode, meeting_link: place.meeting_link, location: place.location,
    organizer: ics?.organizer || null,
  };
}
