// Pure rules, kept apart from the Worker so they can be tested locally.

export const SEVERITIES = ['request', 'command', 'royal'];
export const BASE_POINTS = { request: 5, command: 10, royal: 20 };
export const ROLES = ['queen', 'slave'];

// Points the slave earns when the queen approves a decree.
// Late submission (after the deadline) earns half, rounded down.
export function approvalPoints(severity, deadline, submittedAt) {
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
