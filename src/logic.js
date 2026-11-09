// Pure rules, kept apart from the Worker so they can be tested locally.

export const SEVERITIES = ['request', 'command', 'royal'];
export const BASE_POINTS = { request: 5, command: 10, royal: 20 };
export const ROLES = ['queen', 'slave'];

// ---------- cards ----------

// A vote of null means "hasn't decided": ordinary cards count as allowed,
// "green" cards count as not allowed until that person says yes.
export function voteAllows(vote, green) {
  if (vote === 1 || vote === true) return true;
  if (vote === 0 || vote === false) return false;
  return !green;
}

// A card can be used only if BOTH of you allow it. Either one can veto.
export function cardEnabled(card, votes) {
  return voteAllows(votes?.queen, card.green) && voteAllows(votes?.slave, card.green);
}

// Cards from private decks, or marked private, need "the house is free".
export function cardNeedsHome(card, decks) {
  return !!(card.priv || decks[card.deck]?.gated);
}

export function lvlToSeverity(lvl) {
  return lvl >= 3 ? 'royal' : lvl === 2 ? 'command' : 'request';
}

// Points the slave earns when the queen approves a decree.
// Late submission (after the deadline) earns half, rounded down.
export function approvalPoints(severity, deadline, submittedAt, kind = 'decree') {
  // Punishments and rewards are not paid in points.
  if (kind !== 'decree') return { points: 0, late: false };
  const base = BASE_POINTS[severity] ?? 0;
  const late = deadline != null && submittedAt != null && submittedAt > deadline;
  return { points: late ? Math.floor(base / 2) : base, late };
}

// Status shown to users. "overdue" is derived, never stored.
export function displayStatus(d, now) {
  if (d.status === 'open' && d.deadline != null && d.deadline < now) return 'overdue';
  return d.status;
}

export function validPin(pin) {
  return typeof pin === 'string' && /^\d{4,8}$/.test(pin);
}

export function cleanText(s, max) {
  if (typeof s !== 'string') return '';
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
}

// ---------- time in Israel (for recurring rituals) ----------

export const TZ = 'Asia/Jerusalem';

export function tzParts(ms, tz = TZ) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short'
  });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, wd };
}

function tzOffset(ms, tz) {
  const p = tzParts(ms, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) - Math.floor(ms / 60000) * 60000;
}

// Local wall-clock time in Israel -> UTC milliseconds (handles summer time).
export function localToUtc(y, m, d, h, mi, tz = TZ) {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let t = guess - tzOffset(guess, tz);
  t = guess - tzOffset(t, tz);
  return t;
}

export const RITUAL_FREQ = ['daily', 'weekly'];

// Decides whether a recurring ritual should create today's decree.
// It is created once per day, only while its time today is still ahead.
export function ritualDue(r, now, tz = TZ) {
  if (!r.active) return null;
  const p = tzParts(now, tz);
  const key = `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
  if (r.last_key === key) return null;
  if (r.freq === 'weekly' && p.wd !== r.weekday) return null;
  const [hh, mm] = String(r.time).split(':').map(Number);
  const deadline = localToUtc(p.y, p.m, p.d, hh, mm, tz);
  if (deadline <= now) return null;
  return { key, deadline };
}

export function validTime(s) {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

// The queen's status, shown at the top of the slave's screen.
export const MOODS = {
  free: { label: 'זמינה' },
  busy: { label: 'לא להפריע' },
  waiting: { label: 'מחכה לך' }
};

// What the slave can ask to exchange points for. The queen may refuse.
export const REDEEM_ITEMS = {
  sofa: { cost: 30, label: 'לשבת לידה על הספה ערב אחד' },
  outfit: { cost: 50, label: 'לבחור מה המלכה תלבש מחר' },
  free: { cost: 80, label: 'ערב אחד בלי פרוטוקול' },
  pamper: { cost: 150, label: 'ערב שבו המלכה מפנקת אותך, בתנאים שלה' }
};

// Maps a verified Access email to a role. Anything else gets no role.
export function roleForEmail(email, env) {
  if (typeof email !== 'string' || !email) return null;
  const e = email.trim().toLowerCase();
  const q = (env.QUEEN_EMAIL || '').trim().toLowerCase();
  const s = (env.SLAVE_EMAIL || '').trim().toLowerCase();
  if (q && e === q) return 'queen';
  if (s && e === s) return 'slave';
  return null;
}

// Unlock tokens: valid for 12 hours at most, and die after 30 idle minutes.
export const TOKEN_MAX_MS = 12 * 60 * 60 * 1000;
export const TOKEN_IDLE_MS = 30 * 60 * 1000;
export function tokenAlive(t, now) {
  return !!t && now - t.created < TOKEN_MAX_MS && now - t.last_seen < TOKEN_IDLE_MS;
}

// Failed PIN attempts: lock for 5 minutes after 5 fails, doubling after that.
export function lockoutAfterFail(fails, now) {
  if (fails < 5) return 0;
  const minutes = 5 * Math.pow(2, Math.min(fails - 5, 6));
  return now + minutes * 60 * 1000;
}
