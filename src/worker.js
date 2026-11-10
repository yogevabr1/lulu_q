import {
  SEVERITIES, approvalPoints, displayStatus, validPin, cleanText,
  lockoutAfterFail, roleForEmail, tokenAlive,
  cardEnabled, cardNeedsHome, lvlToSeverity,
  ritualDue, validTime, RITUAL_FREQ, REDEEM_ITEMS, tzParts, MOODS
} from './logic.js';
import { DECKS, CARDS } from './cards.js';
import { notify, vapidKeys } from './push.js';
import { generateIdeas, VIBES, checkKey } from './ideas.js';
import { tzParts as _tz } from './logic.js';

// ---------- responses ----------

const SEC_HEADERS = {
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY'
};

function withHeaders(res, extra = {}) {
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries({ ...SEC_HEADERS, ...extra })) r.headers.set(k, v);
  return r;
}
const json = (data, status = 200) => withHeaders(new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
}));
const notFound = () => withHeaders(new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain' } }));
const err = (status, message) => json({ error: message }, status);

// ---------- Cloudflare Access verification ----------

let certCache = { team: null, keys: null, at: 0 };

function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const b64urlJson = (s) => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

async function accessKeys(team) {
  const now = Date.now();
  if (certCache.team === team && certCache.keys && now - certCache.at < 60 * 60 * 1000) return certCache.keys;
  const res = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error('certs fetch failed');
  const body = await res.json();
  certCache = { team, keys: body.keys || [], at: now };
  return certCache.keys;
}

function getCookie(request, name) {
  const c = request.headers.get('Cookie') || '';
  for (const part of c.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

// Returns the verified email, or null. Fails closed on any problem.
async function verifiedEmail(request, env) {
  const team = (env.ACCESS_TEAM_DOMAIN || '').trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  const aud = (env.ACCESS_AUD || '').trim();
  if (!team || !aud) return null;
  const jwt = request.headers.get('Cf-Access-Jwt-Assertion') || getCookie(request, 'CF_Authorization');
  if (!jwt) return null;
  try {
    const [h, p, s] = jwt.split('.');
    if (!h || !p || !s) return null;
    const header = b64urlJson(h);
    const payload = b64urlJson(p);
    if (header.alg !== 'RS256') return null;
    let keys = await accessKeys(team);
    let jwk = keys.find((k) => k.kid === header.kid);
    if (!jwk) { certCache.at = 0; keys = await accessKeys(team); jwk = keys.find((k) => k.kid === header.kid); }
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(s), new TextEncoder().encode(`${h}.${p}`));
    if (!ok) return null;
    const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!auds.includes(aud)) return null;
    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== 'number' || payload.exp < nowSec) return null;
    if (typeof payload.nbf === 'number' && payload.nbf > nowSec + 60) return null;
    if (payload.iss !== `https://${team}`) return null;
    return typeof payload.email === 'string' ? payload.email : null;
  } catch {
    return null;
  }
}

// ---------- database ----------

let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS pins (
      role TEXT PRIMARY KEY, hash TEXT NOT NULL, salt TEXT NOT NULL,
      fails INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS tokens (
      token TEXT PRIMARY KEY, role TEXT NOT NULL, created INTEGER NOT NULL, last_seen INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS decrees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
      severity TEXT NOT NULL, deadline INTEGER,
      status TEXT NOT NULL DEFAULT 'open',
      report TEXT NOT NULL DEFAULT '', reject_reason TEXT NOT NULL DEFAULT '',
      created INTEGER NOT NULL, submitted_at INTEGER, done_at INTEGER, reminded_at INTEGER,
      points_awarded INTEGER)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS points (
      id INTEGER PRIMARY KEY AUTOINCREMENT, delta INTEGER NOT NULL,
      reason TEXT NOT NULL, decree_id INTEGER, created INTEGER NOT NULL)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS decrees_status ON decrees(status, deadline)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS card_votes (
      card_id TEXT NOT NULL, role TEXT NOT NULL, ok INTEGER NOT NULL, updated INTEGER NOT NULL,
      PRIMARY KEY (card_id, role))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS custom_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT, deck TEXT NOT NULL, lvl INTEGER NOT NULL,
      title TEXT NOT NULL, text TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS push_subs (
      endpoint TEXT PRIMARY KEY, role TEXT NOT NULL, created INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS rituals (
      id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
      severity TEXT NOT NULL, freq TEXT NOT NULL, weekday INTEGER, time TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1, last_key TEXT, created INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS redeems (
      id INTEGER PRIMARY KEY AUTOINCREMENT, item TEXT NOT NULL, cost INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', created INTEGER NOT NULL, decided INTEGER)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS offers (
      id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending', created INTEGER NOT NULL, decided INTEGER)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS waits (
      id INTEGER PRIMARY KEY AUTOINCREMENT, note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending',
      answer TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL, decided INTEGER)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL, text TEXT NOT NULL,
      tab TEXT, ref TEXT, created INTEGER NOT NULL, seen INTEGER)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS events_role ON events(role, id)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS checkins (
      id INTEGER PRIMARY KEY AUTOINCREMENT, decree_id INTEGER NOT NULL, title TEXT NOT NULL,
      queen_score INTEGER, queen_note TEXT, slave_score INTEGER, slave_note TEXT, created INTEGER NOT NULL)`)
  ]);
  // Columns added after v1.
  const cols = (await db.prepare(`PRAGMA table_info(decrees)`).all()).results.map((c) => c.name);
  const add = [
    ['kind', `TEXT NOT NULL DEFAULT 'decree'`], ['deck', 'TEXT'], ['card_id', 'TEXT'],
    ['notified_soon', 'INTEGER'], ['notified_late', 'INTEGER'], ['started_at', 'INTEGER'],
    ['ext_status', 'TEXT'], ['ext_until', 'INTEGER'], ['ext_reason', 'TEXT'], ['ext_answer', 'TEXT']
  ].filter(([n]) => !cols.includes(n));
  if (add.length) await db.batch(add.map(([n, t]) => db.prepare(`ALTER TABLE decrees ADD COLUMN ${n} ${t}`)));
  schemaReady = true;
}

async function getSettings(db) {
  const rows = (await db.prepare(
    `SELECT key, value FROM settings WHERE key IN ('homeFree', 'paused', 'pausedBy', 'mood', 'protocol', 'protocolLevel', 'protocolSince', 'summary',
      'statusText', 'statusAt', 'statusReqAt', 'statusReqDue', 'statusReqLate', 'statusLateBy')`
  ).all()).results;
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  let summary = null;
  try { summary = m.summary ? JSON.parse(m.summary) : null; } catch {}
  return {
    homeFree: m.homeFree === '1', paused: m.paused === '1', pausedBy: m.pausedBy || null,
    mood: MOODS[m.mood] ? m.mood : 'free',
    protocol: m.protocol === '1', protocolLevel: Number(m.protocolLevel) || 2, protocolSince: Number(m.protocolSince) || null,
    summary,
    status: {
      text: m.statusText || '', at: Number(m.statusAt) || null,
      demandAt: Number(m.statusReqAt) || null, demandDue: Number(m.statusReqDue) || null, lateNotified: m.statusReqLate === '1',
      lateBy: Number(m.statusLateBy) || null
    }
  };
}
const setSetting = (db, key, value) => db.prepare(
  `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(key, String(value));

// ---------- PIN hashing ----------

const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
function randomHex(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return toHex(a); }

async function hashPin(pin, saltHex) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256);
  return toHex(bits);
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// ---------- cards ----------

// Expectation review: you only see the other's mark on a card once you have
// marked that card yourself, so nobody answers to please the other.
// "Left" is how many cards each of you hasn't marked yet (new cards included).
async function cardsPayload(db, role) {
  const theirs = role === 'queen' ? 'slave' : 'queen';
  const all = await allCards(db);
  const left = (r) => all.filter((c) => c.votes[r] == null).length;
  const cards = all.map((c) => (c.votes[role] == null && c.votes[theirs] != null
    ? { ...c, votes: { ...c.votes, [theirs]: null }, theirsHidden: true }
    : c));
  return { decks: DECKS, cards, settings: await getSettings(db), review: { queenLeft: left('queen'), slaveLeft: left('slave') } };
}

async function allCards(db) {
  const votes = (await db.prepare('SELECT card_id, role, ok FROM card_votes').all()).results;
  const vmap = {};
  for (const v of votes) (vmap[v.card_id] ||= {})[v.role] = v.ok;
  const custom = (await db.prepare('SELECT * FROM custom_cards ORDER BY id').all()).results.map((c) => ({
    id: 'cu' + c.id, deck: c.deck, lvl: c.lvl, title: c.title, text: c.text,
    green: !!DECKS[c.deck]?.allGreen, priv: false, custom: true
  }));
  return [...CARDS, ...custom].map((c) => {
    const v = vmap[c.id] || {};
    const votes2 = { queen: v.queen ?? null, slave: v.slave ?? null };
    return { ...c, custom: !!c.custom, votes: votes2, enabled: cardEnabled(c, votes2), needsHome: cardNeedsHome(c, DECKS) };
  });
}

// ---------- API ----------

async function readBody(request) {
  try { return await request.json(); } catch { return {}; }
}

async function requireToken(request, env, role) {
  const token = request.headers.get('X-Lulu-Token') || '';
  if (!/^[0-9a-f]{64}$/.test(token)) return false;
  const now = Date.now();
  const t = await env.DB.prepare('SELECT * FROM tokens WHERE token = ?').bind(token).first();
  if (!t || t.role !== role || !tokenAlive(t, now)) return false;
  await env.DB.prepare('UPDATE tokens SET last_seen = ? WHERE token = ?').bind(now, token).run();
  return true;
}

function decreeOut(d, now) {
  return {
    id: d.id, title: d.title, note: d.note, severity: d.severity, deadline: d.deadline,
    status: displayStatus(d, now), report: d.report, rejectReason: d.reject_reason,
    created: d.created, submittedAt: d.submitted_at, doneAt: d.done_at,
    remindedAt: d.reminded_at, pointsAwarded: d.points_awarded, startedAt: d.started_at || null,
    extension: d.ext_status ? { status: d.ext_status, until: d.ext_until, reason: d.ext_reason || '', answer: d.ext_answer || '' } : null,
    kind: d.kind || 'decree', deck: d.deck || null
  };
}

async function listAll(env, role) {
  const now = Date.now();
  const since = now - 30 * 24 * 60 * 60 * 1000;
  const rows = await env.DB.prepare(
    `SELECT * FROM decrees WHERE status != 'done' OR done_at > ? ORDER BY
       CASE status WHEN 'submitted' THEN 0 WHEN 'open' THEN 1 ELSE 2 END,
       COALESCE(deadline, 9e15) ASC, id DESC`
  ).bind(since).all();
  const total = await env.DB.prepare('SELECT COALESCE(SUM(delta), 0) AS t FROM points').first();
  const recent = await env.DB.prepare('SELECT delta, reason, created FROM points ORDER BY id DESC LIMIT 20').all();
  const rituals = await env.DB.prepare('SELECT id, title, note, severity, freq, weekday, time, active FROM rituals ORDER BY time, id').all();
  const redeems = await env.DB.prepare(
    `SELECT id, item, cost, status, created, decided FROM redeems WHERE status = 'pending' OR decided > ? ORDER BY id DESC LIMIT 20`
  ).bind(since).all();
  return {
    now,
    decrees: rows.results.map((d) => decreeOut(d, now)),
    points: { total: total.t, recent: recent.results },
    settings: await getSettings(env.DB),
    rituals: rituals.results,
    redeems: redeems.results.map((r) => ({ ...r, label: REDEEM_ITEMS[r.item]?.label || r.item })),
    redeemItems: REDEEM_ITEMS,
    offers: (await env.DB.prepare(
      `SELECT id, title, note, status, created, decided FROM offers WHERE status = 'pending' OR decided > ? ORDER BY id DESC LIMIT 20`
    ).bind(since).all()).results,
    checkins: await checkinsFor(env.DB, role, since),
    wait: await waitState(env.DB),
    unseen: role ? (await env.DB.prepare('SELECT COUNT(*) AS c FROM events WHERE role = ? AND seen IS NULL').bind(role).first()).c : 0
  };
}

// Each of you sees your own answer right away; the other's only once both answered.
// The waiting counter: days since the queen last gave permission.
async function waitState(db) {
  const rows = (await db.prepare(`SELECT key, value FROM settings WHERE key IN ('waitSince', 'waitRecord')`).all()).results;
  const m = Object.fromEntries(rows.map((r) => [r.key, Number(r.value) || null]));
  const history = (await db.prepare('SELECT id, note, status, answer, created, decided FROM waits ORDER BY id DESC LIMIT 15').all()).results;
  return { since: m.waitSince || null, record: m.waitRecord || 0, pending: history.find((h) => h.status === 'pending') || null, history };
}

// Ends the current wait at `now`: keeps the longest wait as the record.
async function endWait(db, now) {
  const w = await waitState(db);
  const stmts = [setSetting(db, 'waitSince', now)];
  if (w.since && now - w.since > w.record) stmts.push(setSetting(db, 'waitRecord', now - w.since));
  return stmts;
}

// What your ratings teach the ideas: acts you both loved, and acts either of you didn't.
// Skips (0) are ignored. The best and worst go into the prompt as examples.
async function tasteFromRatings(db) {
  const rows = (await db.prepare(
    `SELECT c.title, c.queen_score AS q, c.slave_score AS s, c.queen_note AS qn, c.slave_note AS sn, d.note AS what
       FROM checkins c LEFT JOIN decrees d ON d.id = c.decree_id
      WHERE c.queen_score > 0 AND c.slave_score > 0 ORDER BY c.id DESC LIMIT 200`
  ).all()).results;
  const words = (r) => [r.qn, r.sn].filter(Boolean).map((x) => x.slice(0, 80)).join(' / ');
  const line = (r) => `${r.title}${r.what ? ` (${r.what.slice(0, 120)})` : ''} — ★${r.q}/${r.s}${words(r) ? ` — they said: ${words(r)}` : ''}`;
  const loved = rows.filter((r) => r.q + r.s >= 8).sort((a, b) => b.q + b.s - (a.q + a.s)).slice(0, 12).map(line);
  const disliked = rows.filter((r) => Math.min(r.q, r.s) <= 2).slice(0, 10).map(line);
  return { loved, disliked, count: rows.length };
}

async function addEvents(db, roles, text, target = {}) {
  const now = Date.now();
  const list = Array.isArray(roles) ? roles : [roles];
  await db.batch([
    ...list.map((r) => db.prepare('INSERT INTO events (role, text, tab, ref, created) VALUES (?, ?, ?, ?, ?)')
      .bind(r, String(text).slice(0, 200), target.tab || null, target.id != null ? String(target.id) : null, now)),
    db.prepare('DELETE FROM events WHERE created < ?').bind(now - 60 * 24 * 3600 * 1000)
  ]);
}

async function checkinsFor(db, role, since) {
  if (!role) return [];
  const col = role === 'queen' ? 'queen_score' : 'slave_score';
  const rows = (await db.prepare(
    `SELECT * FROM checkins WHERE created > ? OR ${col} IS NULL ORDER BY id DESC LIMIT 60`
  ).bind(since).all()).results;
  return rows.map((c) => {
    const both = c.queen_score != null && c.slave_score != null;
    const mine = role === 'queen' ? { score: c.queen_score, note: c.queen_note } : { score: c.slave_score, note: c.slave_note };
    const theirs = role === 'queen' ? { score: c.slave_score, note: c.slave_note } : { score: c.queen_score, note: c.queen_note };
    return { id: c.id, decreeId: c.decree_id, title: c.title, created: c.created, mine, theirs: both ? theirs : null, both, answered: mine.score != null };
  });
}

const other = (role) => (role === 'queen' ? 'slave' : 'queen');

async function handleApi(request, env, ctx, role, url) {
  const path = url.pathname.replace(/^\/api/, '');
  const method = request.method;
  const now = Date.now();
  // Every notification is also saved as a readable event for the inbox.
  const push = (roles, text, target) => ctx.waitUntil((async () => {
    if (text) await addEvents(env.DB, roles, text, target);
    await notify(env, roles, env.VAPID_SUBJECT || url.origin);
  })());

  if (path === '/me' && method === 'GET') {
    const pin = await env.DB.prepare('SELECT role FROM pins WHERE role = ?').bind(role).first();
    return json({ role, hasPin: !!pin });
  }

  if (path === '/pin' && method === 'POST') {
    const body = await readBody(request);
    if (!validPin(body.pin)) return err(400, 'PIN must be 4-8 digits');
    const existing = await env.DB.prepare('SELECT role FROM pins WHERE role = ?').bind(role).first();
    if (existing && !(await requireToken(request, env, role))) return err(401, 'locked');
    const salt = randomHex(16);
    const hash = await hashPin(body.pin, salt);
    await env.DB.prepare(
      `INSERT INTO pins (role, hash, salt, fails, locked_until) VALUES (?, ?, ?, 0, 0)
       ON CONFLICT(role) DO UPDATE SET hash = excluded.hash, salt = excluded.salt, fails = 0, locked_until = 0`
    ).bind(role, hash, salt).run();
    return json({ ok: true });
  }

  if (path === '/unlock' && method === 'POST') {
    const body = await readBody(request);
    const row = await env.DB.prepare('SELECT * FROM pins WHERE role = ?').bind(role).first();
    if (!row) return err(409, 'no pin');
    if (row.locked_until > now) return json({ error: 'locked', until: row.locked_until }, 429);
    const ok = validPin(body.pin) && safeEqual(await hashPin(body.pin, row.salt), row.hash);
    if (!ok) {
      const fails = row.fails + 1;
      const until = lockoutAfterFail(fails, now);
      await env.DB.prepare('UPDATE pins SET fails = ?, locked_until = ? WHERE role = ?').bind(fails, until, role).run();
      return json({ error: 'wrong', until: until || null }, 401);
    }
    const token = randomHex(32);
    await env.DB.batch([
      env.DB.prepare('UPDATE pins SET fails = 0, locked_until = 0 WHERE role = ?').bind(role),
      env.DB.prepare('INSERT INTO tokens (token, role, created, last_seen) VALUES (?, ?, ?, ?)').bind(token, role, now, now),
      env.DB.prepare('DELETE FROM tokens WHERE last_seen < ?').bind(now - 24 * 60 * 60 * 1000)
    ]);
    return json({ token });
  }

  // Everything below needs an unlocked session.
  if (!(await requireToken(request, env, role))) return err(401, 'locked');

  if (path === '/lock' && method === 'POST') {
    const token = request.headers.get('X-Lulu-Token');
    await env.DB.prepare('DELETE FROM tokens WHERE token = ?').bind(token).run();
    return json({ ok: true });
  }

  // ----- push notifications -----
  if (path === '/push/key' && method === 'GET') {
    const keys = await vapidKeys(env.DB);
    return json({ key: keys.publicRaw });
  }
  if (path === '/push/subscribe' && method === 'POST') {
    const b = await readBody(request);
    const endpoint = typeof b.endpoint === 'string' ? b.endpoint : '';
    if (!/^https:\/\/[^\s]{10,2000}$/.test(endpoint)) return err(400, 'bad endpoint');
    await env.DB.prepare(`INSERT INTO push_subs (endpoint, role, created) VALUES (?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET role = excluded.role`).bind(endpoint, role, now).run();
    return json({ ok: true });
  }
  if (path === '/push/unsubscribe' && method === 'POST') {
    const b = await readBody(request);
    await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ? AND role = ?').bind(String(b.endpoint || ''), role).run();
    return json({ ok: true });
  }
  if (path === '/push/test' && method === 'POST') {
    push([role], 'התראת בדיקה', { tab: 'limits' });
    return json({ ok: true });
  }

  // ----- settings: house free (queen), pause (either of you) -----
  if (path === '/settings' && method === 'POST') {
    const b = await readBody(request);
    const stmts = [];
    if (typeof b.homeFree === 'boolean') {
      if (role !== 'queen') return err(403, 'forbidden');
      stmts.push(setSetting(env.DB, 'homeFree', b.homeFree ? 1 : 0));
    }
    if (typeof b.paused === 'boolean') {
      stmts.push(setSetting(env.DB, 'paused', b.paused ? 1 : 0));
      stmts.push(setSetting(env.DB, 'pausedBy', b.paused ? role : ''));
      if (b.paused) stmts.push(setSetting(env.DB, 'protocol', 0));
      push([other(role)], b.paused ? `${role === 'queen' ? 'המלכה' : 'העבד'} הפעיל/ה הפוגה` : 'ההפוגה הסתיימה', { tab: 'decrees' });
    }
    if (typeof b.mood === 'string') {
      if (role !== 'queen') return err(403, 'forbidden');
      if (!MOODS[b.mood]) return err(400, 'bad mood');
      stmts.push(setSetting(env.DB, 'mood', b.mood));
      if (b.mood === 'waiting') push(['slave'], 'המלכה מחכה לך', { tab: 'decrees' });
    }
    if (typeof b.protocol === 'boolean') {
      if (role !== 'queen') return err(403, 'forbidden');
      if (b.protocol && (await getSettings(env.DB)).paused) return err(409, 'paused');
      stmts.push(setSetting(env.DB, 'protocol', b.protocol ? 1 : 0));
      if (b.protocol) { stmts.push(setSetting(env.DB, 'protocolSince', now)); push(['slave'], 'הפרוטוקול פעיל', { tab: 'decrees' }); }
    }
    if (b.protocolLevel !== undefined) {
      if (role !== 'queen') return err(403, 'forbidden');
      if (![1, 2, 3].includes(b.protocolLevel)) return err(400, 'bad level');
      stmts.push(setSetting(env.DB, 'protocolLevel', b.protocolLevel));
    }
    if (b.dismissSummary === true) {
      if (role !== 'queen') return err(403, 'forbidden');
      const cur = (await getSettings(env.DB)).summary;
      if (cur) stmts.push(setSetting(env.DB, 'summary', JSON.stringify({ ...cur, dismissed: true })));
    }
    if (!stmts.length) return err(400, 'nothing to change');
    await env.DB.batch(stmts);
    return json(await listAll(env, role));
  }

  if (path === '/decrees' && method === 'GET') return json(await listAll(env, role));

  if (path === '/decrees' && method === 'POST') {
    if (role !== 'queen') return err(403, 'forbidden');
    if ((await getSettings(env.DB)).paused) return err(409, 'paused');
    const b = await readBody(request);
    const title = cleanText(b.title, 200);
    const note = cleanText(b.note, 1000);
    const severity = SEVERITIES.includes(b.severity) ? b.severity : 'command';
    const deadline = Number.isFinite(b.deadline) ? Math.floor(b.deadline) : null;
    if (!title) return err(400, 'title required');
    await env.DB.prepare(
      'INSERT INTO decrees (title, note, severity, deadline, created) VALUES (?, ?, ?, ?, ?)'
    ).bind(title, note, severity, deadline, now).run();
    push(['slave'], `צו חדש: ${title}`, { tab: 'decrees', id: 'new' });
    return json(await listAll(env, role));
  }

  if (path === '/points' && method === 'POST') {
    if (role !== 'queen') return err(403, 'forbidden');
    const b = await readBody(request);
    const delta = Math.trunc(Number(b.delta));
    const reason = cleanText(b.reason, 200) || (delta >= 0 ? 'בונוס מהמלכה' : 'הפרה');
    if (!Number.isFinite(delta) || delta === 0 || Math.abs(delta) > 500) return err(400, 'bad delta');
    await env.DB.prepare('INSERT INTO points (delta, reason, created) VALUES (?, ?, ?)').bind(delta, reason, now).run();
    return json(await listAll(env, role));
  }

  // ----- recurring rituals (queen) -----
  if (path === '/rituals' && method === 'POST') {
    if (role !== 'queen') return err(403, 'forbidden');
    const b = await readBody(request);
    const title = cleanText(b.title, 200);
    const freq = RITUAL_FREQ.includes(b.freq) ? b.freq : null;
    const weekday = freq === 'weekly' ? Number(b.weekday) : null;
    if (!title || !freq || !validTime(b.time)) return err(400, 'bad ritual');
    if (freq === 'weekly' && !(Number.isInteger(weekday) && weekday >= 0 && weekday <= 6)) return err(400, 'bad weekday');
    const severity = SEVERITIES.includes(b.severity) ? b.severity : 'command';
    await env.DB.prepare('INSERT INTO rituals (title, note, severity, freq, weekday, time, created) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(title, cleanText(b.note, 1000), severity, freq, weekday, b.time, now).run();
    ctx.waitUntil(runSchedule(env));
    return json(await listAll(env, role));
  }
  const rm = path.match(/^\/rituals\/(\d+)(?:\/(toggle))?$/);
  if (rm) {
    if (role !== 'queen') return err(403, 'forbidden');
    const id = Number(rm[1]);
    if (!rm[2] && method === 'DELETE') await env.DB.prepare('DELETE FROM rituals WHERE id = ?').bind(id).run();
    else if (rm[2] && method === 'POST') await env.DB.prepare('UPDATE rituals SET active = 1 - active WHERE id = ?').bind(id).run();
    else return err(405, 'method');
    return json(await listAll(env, role));
  }

  // ----- point redemptions: the slave asks, the queen decides -----
  if (path === '/redeem' && method === 'POST') {
    if (role !== 'slave') return err(403, 'forbidden');
    const b = await readBody(request);
    const item = REDEEM_ITEMS[b.item];
    if (!item) return err(400, 'bad item');
    const total = (await env.DB.prepare('SELECT COALESCE(SUM(delta), 0) AS t FROM points').first()).t;
    const pending = (await env.DB.prepare(`SELECT COALESCE(SUM(cost), 0) AS t FROM redeems WHERE status = 'pending'`).first()).t;
    if (total - pending < item.cost) return err(409, 'not enough points');
    await env.DB.prepare('INSERT INTO redeems (item, cost, created) VALUES (?, ?, ?)').bind(b.item, item.cost, now).run();
    push(['queen'], `העבד מבקש להמיר ${item.cost} נקודות: ${item.label}`, { tab: 'points' });
    return json(await listAll(env, role));
  }
  const xm = path.match(/^\/redeem\/(\d+)\/(approve|deny)$/);
  if (xm && method === 'POST') {
    if (role !== 'queen') return err(403, 'forbidden');
    const rq = await env.DB.prepare('SELECT * FROM redeems WHERE id = ?').bind(Number(xm[1])).first();
    if (!rq) return err(404, 'not found');
    if (rq.status !== 'pending') return err(409, 'already decided');
    const stmts = [env.DB.prepare('UPDATE redeems SET status = ?, decided = ? WHERE id = ?')
      .bind(xm[2] === 'approve' ? 'approved' : 'denied', now, rq.id)];
    if (xm[2] === 'approve') stmts.push(env.DB.prepare('INSERT INTO points (delta, reason, created) VALUES (?, ?, ?)')
      .bind(-rq.cost, 'הומר: ' + (REDEEM_ITEMS[rq.item]?.label || rq.item), now));
    await env.DB.batch(stmts);
    push(['slave'], `${xm[2] === 'approve' ? 'המלכה אישרה' : 'המלכה סירבה ל'}המרה: ${REDEEM_ITEMS[rq.item]?.label || ''}`, { tab: 'points' });
    return json(await listAll(env, role));
  }

  // ----- notifications inbox -----
  if (path === '/events' && method === 'GET') {
    const rows = (await env.DB.prepare('SELECT id, text, tab, ref, created, seen FROM events WHERE role = ? ORDER BY id DESC LIMIT 80').bind(role).all()).results;
    return json({ events: rows });
  }
  if (path === '/events/seen' && method === 'POST') {
    await env.DB.prepare('UPDATE events SET seen = ? WHERE role = ? AND seen IS NULL').bind(now, role).run();
    return json({ ok: true });
  }

  // ----- "what I'm doing now": the slave reports, the queen can demand an update -----
  if (path === '/status' && method === 'POST') {
    if (role !== 'slave') return err(403, 'forbidden');
    const b = await readBody(request);
    const text = cleanText(b.text, 160);
    if (!text) return err(400, 'text required');
    const st = (await getSettings(env.DB)).status;
    const stmts = [setSetting(env.DB, 'statusText', text), setSetting(env.DB, 'statusAt', now)];
    if (st.demandAt) {
      stmts.push(setSetting(env.DB, 'statusReqAt', ''), setSetting(env.DB, 'statusReqDue', ''), setSetting(env.DB, 'statusReqLate', '0'));
      // A late update is not punished automatically: the queen decides.
      if (st.demandDue && now > st.demandDue) stmts.push(setSetting(env.DB, 'statusLateBy', now - st.demandDue));
    }
    await env.DB.batch(stmts);
    push(['queen'], `העבד עכשיו: ${text}`, { tab: 'decrees', id: 'status' });
    return json(await listAll(env, role));
  }
  if (path === '/status/demand' && method === 'POST') {
    if (role !== 'queen') return err(403, 'forbidden');
    const b = await readBody(request);
    const minutes = [5, 10, 15, 30].includes(b.minutes) ? b.minutes : 10;
    await env.DB.batch([
      setSetting(env.DB, 'statusReqAt', now), setSetting(env.DB, 'statusReqDue', now + minutes * 60000), setSetting(env.DB, 'statusReqLate', '0')
    ]);
    push(['slave'], `המלכה דורשת עדכון תוך ${minutes} דק׳`, { tab: 'decrees', id: 'status' });
    return json(await listAll(env, role));
  }
  if (path === '/status/late' && method === 'POST') {
    if (role !== 'queen') return err(403, 'forbidden');
    const b = await readBody(request);
    const stmts = [setSetting(env.DB, 'statusLateBy', '')];
    if (b.penalize === true) stmts.push(env.DB.prepare('INSERT INTO points (delta, reason, created) VALUES (?, ?, ?)').bind(-5, 'עדכון סטטוס באיחור', now));
    await env.DB.batch(stmts);
    if (b.penalize === true) push(['slave'], 'ירדו 5 נקודות על עדכון באיחור', { tab: 'points' });
    return json(await listAll(env, role));
  }
  if (path === '/status/cancel' && method === 'POST') {
    if (role !== 'queen') return err(403, 'forbidden');
    await env.DB.batch([setSetting(env.DB, 'statusReqAt', ''), setSetting(env.DB, 'statusReqDue', ''), setSetting(env.DB, 'statusReqLate', '0')]);
    return json(await listAll(env, role));
  }

  // ----- waiting counter & asking permission -----
  if (path === '/wait/start' && method === 'POST') {
    // The slave can set the starting date once; after that only the queen changes it.
    const b = await readBody(request);
    const t = Math.floor(Number(b.since));
    if (!Number.isFinite(t) || t > now || t < now - 3 * 365 * 24 * 3600 * 1000) return err(400, 'bad date');
    const w = await waitState(env.DB);
    if (role !== 'queen' && w.since) return err(403, 'forbidden');
    await setSetting(env.DB, 'waitSince', t).run();
    return json(await listAll(env, role));
  }
  if (path === '/wait/ask' && method === 'POST') {
    if (role !== 'slave') return err(403, 'forbidden');
    const w = await waitState(env.DB);
    if (w.pending) return err(409, 'already asked');
    const b = await readBody(request);
    await env.DB.prepare('INSERT INTO waits (note, created) VALUES (?, ?)').bind(cleanText(b.note, 300), now).run();
    push(['queen'], 'העבד מבקש רשות', { tab: 'decrees', id: 'wait' });
    return json(await listAll(env, role));
  }
  if (path === '/wait/release' && method === 'POST') {
    if (role !== 'queen') return err(403, 'forbidden');
    await env.DB.batch(await endWait(env.DB, now));
    push(['slave'], 'המלכה שחררה אותך — המונה אופס', { tab: 'decrees', id: 'wait' });
    return json(await listAll(env, role));
  }
  const wm = path.match(/^\/wait\/(\d+)\/(yes|no|later)$/);
  if (wm && method === 'POST') {
    if (role !== 'queen') return err(403, 'forbidden');
    const row = await env.DB.prepare('SELECT * FROM waits WHERE id = ?').bind(Number(wm[1])).first();
    if (!row) return err(404, 'not found');
    if (row.status !== 'pending') return err(409, 'already answered');
    const b = await readBody(request);
    const stmts = [env.DB.prepare('UPDATE waits SET status = ?, answer = ?, decided = ? WHERE id = ?')
      .bind(wm[2], cleanText(b.answer, 300), now, row.id)];
    if (wm[2] === 'yes') stmts.push(...(await endWait(env.DB, now)));
    await env.DB.batch(stmts);
    push(['slave'], `המלכה ענתה: ${{ yes: 'כן', no: 'לא', later: 'אולי מחר' }[wm[2]]}`, { tab: 'decrees', id: 'wait' });
    return json(await listAll(env, role));
  }

  // ----- service offers: the slave proposes, the queen turns it into a decree -----
  if (path === '/offers' && method === 'POST') {
    if (role !== 'slave') return err(403, 'forbidden');
    const b = await readBody(request);
    const title = cleanText(b.title, 200);
    if (!title) return err(400, 'title required');
    await env.DB.prepare('INSERT INTO offers (title, note, created) VALUES (?, ?, ?)').bind(title, cleanText(b.note, 1000), now).run();
    push(['queen'], `הצעת שירות: ${title}`, { tab: 'decrees', id: 'offers' });
    return json(await listAll(env, role));
  }
  const om = path.match(/^\/offers\/(\d+)\/(accept|decline)$/);
  if (om && method === 'POST') {
    if (role !== 'queen') return err(403, 'forbidden');
    const o = await env.DB.prepare('SELECT * FROM offers WHERE id = ?').bind(Number(om[1])).first();
    if (!o) return err(404, 'not found');
    if (o.status !== 'pending') return err(409, 'already decided');
    const b = await readBody(request);
    const stmts = [env.DB.prepare('UPDATE offers SET status = ?, decided = ? WHERE id = ?')
      .bind(om[2] === 'accept' ? 'accepted' : 'declined', now, o.id)];
    if (om[2] === 'accept') {
      if ((await getSettings(env.DB)).paused) return err(409, 'paused');
      const severity = SEVERITIES.includes(b.severity) ? b.severity : 'command';
      const deadline = Number.isFinite(b.deadline) ? Math.floor(b.deadline) : null;
      stmts.push(env.DB.prepare('INSERT INTO decrees (title, note, severity, deadline, created) VALUES (?, ?, ?, ?, ?)')
        .bind(o.title, o.note, severity, deadline, now));
    }
    await env.DB.batch(stmts);
    push(['slave'], om[2] === 'accept' ? `המלכה הפכה את ההצעה לצו: ${o.title}` : `המלכה ויתרה על ההצעה: ${o.title}`, { tab: 'decrees' });
    return json(await listAll(env, role));
  }

  // ----- quick punishment: one tap draws an allowed punishment card and sends it -----
  if (path === '/punish' && method === 'POST') {
    if (role !== 'queen') return err(403, 'forbidden');
    const settings = await getSettings(env.DB);
    if (settings.paused) return err(409, 'paused');
    const b = await readBody(request);
    const pool = (await allCards(env.DB)).filter((c) => c.deck === 'punish' && c.enabled && (!c.needsHome || settings.homeFree));
    if (!pool.length) return err(409, 'no cards');
    const pick = new Uint32Array(1); crypto.getRandomValues(pick);
    const card = pool[pick[0] % pool.length];
    const because = cleanText(b.because, 200);
    const deadline = Number.isFinite(b.deadline) ? Math.floor(b.deadline) : null;
    await env.DB.prepare(
      'INSERT INTO decrees (title, note, severity, deadline, created, kind, deck, card_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(card.title, card.text + (because ? ` (בעקבות: ${because})` : ''), lvlToSeverity(card.lvl), deadline, now, 'card', 'punish', card.id).run();
    push(['slave'], `נשלף עונש: ${card.title}`, { tab: 'decrees', id: 'new' });
    return json({ ...(await listAll(env, role)), punished: { title: card.title, text: card.text } });
  }

  // ----- ratings after a completed decree (0 = skipped) -----
  const km = path.match(/^\/checkins\/(\d+)$/);
  if (km && method === 'POST') {
    const b = await readBody(request);
    const score = Math.trunc(Number(b.score));
    if (!(score >= 0 && score <= 5)) return err(400, 'score 0-5');
    const col = role === 'queen' ? 'queen' : 'slave';
    const res = await env.DB.prepare(`UPDATE checkins SET ${col}_score = ?, ${col}_note = ? WHERE id = ? AND ${col}_score IS NULL`)
      .bind(score, score ? cleanText(b.note, 500) : '', Number(km[1])).run();
    if ((res.meta?.changes ?? res.changes) !== 1) return err(409, 'already answered');
    const row = await env.DB.prepare('SELECT queen_score, slave_score FROM checkins WHERE id = ?').bind(Number(km[1])).first();
    if (row && row.queen_score != null && row.slave_score != null && score) push([other(role)], 'שניכם דירגתם — הדירוגים נחשפו', { tab: 'limits', id: 'ratings' });
    return json(await listAll(env, role));
  }

  // ----- expectation review -----
  // Kept for older pages: finishing just tells the other one, nothing is unlocked by it.
  if (path === '/review/done' && method === 'POST') {
    push([other(role)], `${role === 'queen' ? 'המלכה' : 'העבד'} סימן/ה קלפים בתיאום הציפיות`, { tab: 'limits' });
    return json(await cardsPayload(env.DB, role));
  }

  // ----- connection check for ideas (both of you) -----
  if (path === '/ideas/check' && method === 'POST') {
    return json(await checkKey(env));
  }

  // ----- task ideas from Claude (queen only) -----
  if (path === '/ideas' && method === 'POST') {
    // The queen gets task ideas; the slave gets ideas for services to offer her.
    if (!env.ANTHROPIC_API_KEY) return err(503, 'not configured');
    // At most 40 requests a day, as a cost guard.
    const p = _tz(now);
    const dayKey = `ideas_${p.y}-${p.m}-${p.d}`;
    const used = Number((await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(dayKey).first())?.value || 0);
    if (used >= 40) return err(429, 'daily limit');
    await setSetting(env.DB, dayKey, used + 1).run();

    const b = await readBody(request);
    const settings = await getSettings(env.DB);
    const cards = await allCards(env.DB);
    const work = b.deck === 'work';
    const deck = DECKS[b.deck] ? b.deck : null;
    const lvl = [1, 2, 3].includes(b.lvl) ? b.lvl : 2;
    const workDecks = ['rules', 'worship', 'service', 'punish'];
    const pool = cards.filter((c) => c.enabled).filter((c) => (work ? workDecks.includes(c.deck) && !c.needsHome
      : (!deck || c.deck === deck) && (!c.needsHome || settings.homeFree)));
    const shuffle = (a) => a.map((x) => [Math.random(), x]).sort((m, n) => m[0] - n[0]).map((x) => x[1]);
    const approved = shuffle(pool).slice(0, 30).map((c) => `${c.title}: ${c.text}`);
    const refused = cards.filter((c) => c.votes.queen === 0 || c.votes.slave === 0).map((c) => c.title).slice(0, 80);
    const taste = await tasteFromRatings(env.DB);
    const recent = (await env.DB.prepare('SELECT title FROM decrees WHERE created > ? ORDER BY id DESC LIMIT 30')
      .bind(now - 14 * 24 * 3600 * 1000).all()).results.map((r) => r.title);
    const out = await generateIdeas(env, {
      vibe: VIBES[b.vibe] ? b.vibe : 'playful', deckLabel: deck ? DECKS[deck].label : null, lvl,
      wish: cleanText(b.wish, 300), approved, refused, recent, loved: taste.loved, disliked: taste.disliked,
      homeFree: settings.homeFree, protocolLevel: settings.protocol ? settings.protocolLevel : null,
      mode: role === 'slave' ? 'offer' : 'task', work
    });
    if (out.error) return err(502, out.error);
    return json({ ideas: out.ideas, why: out.why || null, left: 39 - used, learnedFrom: taste.count });
  }

  // ----- cards -----
  if (path === '/cards' && method === 'GET') {
    return json(await cardsPayload(env.DB, role));
  }
  if (path === '/cards' && method === 'POST') {
    if (role !== 'queen') return err(403, 'forbidden');
    const b = await readBody(request);
    const title = cleanText(b.title, 80);
    const text = cleanText(b.text, 500);
    const deck = DECKS[b.deck] ? b.deck : null;
    const lvl = [1, 2, 3].includes(b.lvl) ? b.lvl : 2;
    if (!title || !deck) return err(400, 'title and deck required');
    await env.DB.prepare('INSERT INTO custom_cards (deck, lvl, title, text, created) VALUES (?, ?, ?, ?, ?)')
      .bind(deck, lvl, title, text, now).run();
    push(['slave'], `קלף חדש בחפיסה: ${title} — אפשר לסמן ✓ או ✗`, { tab: 'decrees' });
    return json(await cardsPayload(env.DB, role));
  }
  const cm = path.match(/^\/cards\/([a-z]{2}\d{1,6})(?:\/(vote|send))?$/);
  if (cm) {
    const [, cardId, action] = cm;
    const cards = await allCards(env.DB);
    const card = cards.find((c) => c.id === cardId);
    if (!card) return err(404, 'not found');
    const b = await readBody(request);

    if (!action && method === 'DELETE') {
      if (role !== 'queen' || !card.custom) return err(403, 'forbidden');
      await env.DB.batch([
        env.DB.prepare('DELETE FROM custom_cards WHERE id = ?').bind(Number(cardId.slice(2))),
        env.DB.prepare('DELETE FROM card_votes WHERE card_id = ?').bind(cardId)
      ]);
      return json(await cardsPayload(env.DB, role));
    }
    if (method !== 'POST') return err(405, 'method');

    if (action === 'vote') {
      // Each of you can only change your own vote.
      if (b.ok === null) {
        await env.DB.prepare('DELETE FROM card_votes WHERE card_id = ? AND role = ?').bind(cardId, role).run();
      } else {
        await env.DB.prepare(`INSERT INTO card_votes (card_id, role, ok, updated) VALUES (?, ?, ?, ?)
          ON CONFLICT(card_id, role) DO UPDATE SET ok = excluded.ok, updated = excluded.updated`)
          .bind(cardId, role, b.ok ? 1 : 0, now).run();
      }
      return json(await cardsPayload(env.DB, role));
    }
    if (action === 'send') {
      if (role !== 'queen') return err(403, 'forbidden');
      const settings = await getSettings(env.DB);
      if (settings.paused) return err(409, 'paused');
      if (!card.enabled) return err(409, 'card not allowed');
      if (card.needsHome && !settings.homeFree) return err(409, 'house not free');
      const deadline = Number.isFinite(b.deadline) ? Math.floor(b.deadline) : null;
      const kind = card.deck === 'reward' ? 'reward' : 'card';
      await env.DB.prepare(
        'INSERT INTO decrees (title, note, severity, deadline, created, kind, deck, card_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(card.title, card.text, lvlToSeverity(card.lvl), deadline, now, kind, card.deck, card.id).run();
      push(['slave'], `${kind === 'reward' ? 'פרס' : 'קלף'} מהמלכה: ${card.title}`, { tab: 'decrees', id: 'new' });
      return json(await listAll(env, role));
    }
  }

  // ----- decree actions -----
  const m = path.match(/^\/decrees\/(\d+)(?:\/(start|submit|approve|reject|remind|extend|extend-yes|extend-no))?$/);
  if (m) {
    const id = Number(m[1]);
    const action = m[2];
    const d = await env.DB.prepare('SELECT * FROM decrees WHERE id = ?').bind(id).first();
    if (!d) return err(404, 'not found');
    const b = await readBody(request);

    if (!action && method === 'DELETE') {
      if (role !== 'queen') return err(403, 'forbidden');
      await env.DB.prepare('DELETE FROM decrees WHERE id = ?').bind(id).run();
      return json(await listAll(env, role));
    }
    if (method !== 'POST') return err(405, 'method');

    // ----- asking for more time -----
    if (action === 'extend') {
      if (role !== 'slave') return err(403, 'forbidden');
      if (d.status !== 'open') return err(409, 'not open');
      if (d.ext_status === 'pending') return err(409, 'already asked');
      const until = Math.floor(Number(b.until));
      const reason = cleanText(b.reason, 300);
      if (!reason) return err(400, 'reason required');
      if (!Number.isFinite(until) || until <= now || (d.deadline && until <= d.deadline) || until > now + 30 * 24 * 3600 * 1000) return err(400, 'bad time');
      await env.DB.prepare(`UPDATE decrees SET ext_status = 'pending', ext_until = ?, ext_reason = ?, ext_answer = '' WHERE id = ?`)
        .bind(until, reason, id).run();
      push(['queen'], `בקשת הארכה: ${d.title}`, { tab: 'decrees', id });
      return json(await listAll(env, role));
    }
    if (action === 'extend-yes' || action === 'extend-no') {
      if (role !== 'queen') return err(403, 'forbidden');
      if (d.ext_status !== 'pending') return err(409, 'nothing to answer');
      const answer = cleanText(b.answer, 300);
      if (action === 'extend-yes') {
        await env.DB.prepare(`UPDATE decrees SET ext_status = 'approved', ext_answer = ?, deadline = ext_until,
          notified_soon = NULL, notified_late = NULL WHERE id = ?`).bind(answer, id).run();
      } else {
        await env.DB.prepare(`UPDATE decrees SET ext_status = 'denied', ext_answer = ? WHERE id = ?`).bind(answer, id).run();
      }
      push(['slave'], `${action === 'extend-yes' ? 'ההארכה אושרה' : 'ההארכה נדחתה'}: ${d.title}`, { tab: 'decrees', id });
      return json(await listAll(env, role));
    }
    if (action === 'start') {
      if (role !== 'slave') return err(403, 'forbidden');
      if (d.status !== 'open') return err(409, 'not open');
      if (!d.started_at) {
        await env.DB.prepare('UPDATE decrees SET started_at = ? WHERE id = ?').bind(now, id).run();
        push(['queen'], `העבד התחיל: ${d.title}`, { tab: 'decrees', id });
      }
      return json(await listAll(env, role));
    }
    if (action === 'submit') {
      if (role !== 'slave') return err(403, 'forbidden');
      if (d.status !== 'open') return err(409, 'not open');
      await env.DB.prepare(`UPDATE decrees SET status = 'submitted', report = ?, submitted_at = ?, reject_reason = '' WHERE id = ?`)
        .bind(cleanText(b.report, 1000), now, id).run();
      push(['queen'], `${d.kind === 'reward' ? 'העבד מבקש לממש' : 'הוגש לאישורך'}: ${d.title}`, { tab: 'decrees', id });
      return json(await listAll(env, role));
    }
    if (role !== 'queen') return err(403, 'forbidden');
    if (action === 'approve') {
      if (d.status !== 'submitted') return err(409, 'not submitted');
      const { points, late } = approvalPoints(d.severity, d.deadline, d.submitted_at, d.kind || 'decree');
      const bonus = Math.max(0, Math.min(50, Math.trunc(Number(b.bonus) || 0)));
      const stmts = [
        env.DB.prepare(`UPDATE decrees SET status = 'done', done_at = ?, points_awarded = ? WHERE id = ?`).bind(now, points + bonus, id)
      ];
      if (points) stmts.push(env.DB.prepare('INSERT INTO points (delta, reason, decree_id, created) VALUES (?, ?, ?, ?)')
        .bind(points, (late ? 'בוצע באיחור: ' : 'בוצע: ') + d.title, id, now));
      if (bonus) stmts.push(env.DB.prepare('INSERT INTO points (delta, reason, decree_id, created) VALUES (?, ?, ?, ?)')
        .bind(bonus, 'מעבר לנדרש: ' + d.title, id, now));
      // After every completed decree, both of you rate it privately (stars + a few words).
      stmts.push(env.DB.prepare('INSERT INTO checkins (decree_id, title, created) VALUES (?, ?, ?)').bind(id, d.title, now));
      await env.DB.batch(stmts);
      push(['slave'], `אושר: ${d.title}${points + bonus ? ` · +${points + bonus}` : ''} — אפשר לדרג`, { tab: 'decrees', id });
      return json(await listAll(env, role));
    }
    if (action === 'reject') {
      if (d.status !== 'submitted') return err(409, 'not submitted');
      await env.DB.prepare(`UPDATE decrees SET status = 'open', reject_reason = ?, submitted_at = NULL, started_at = NULL WHERE id = ?`)
        .bind(cleanText(b.reason, 500) || 'לא מספיק טוב', id).run();
      push(['slave'], `לא מספיק טוב: ${d.title}`, { tab: 'decrees', id });
      return json(await listAll(env, role));
    }
    if (action === 'remind') {
      await env.DB.prepare('UPDATE decrees SET reminded_at = ? WHERE id = ?').bind(now, id).run();
      push(['slave'], `תזכורת חמורה: ${d.title}`, { tab: 'decrees', id });
      return json(await listAll(env, role));
    }
  }

  return err(404, 'not found');
}

// ---------- scheduled: deadline reminders ----------

async function weeklySummary(env, now) {
  const p = tzParts(now);
  if (p.wd !== 0 || p.h < 8) return false; // Sunday from 08:00, Israel time
  const week = `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
  const claim = await env.DB.prepare(
    `INSERT INTO settings (key, value) VALUES ('summaryWeek', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE value != excluded.value`
  ).bind(week).run();
  if ((claim.meta?.changes ?? claim.changes) !== 1) return false;
  const from = now - 7 * 24 * 60 * 60 * 1000;
  const q1 = (sql, ...a) => env.DB.prepare(sql).bind(...a).first();
  const done = (await q1(`SELECT COUNT(*) AS c FROM decrees WHERE status = 'done' AND done_at > ?`, from)).c;
  const late = (await q1(`SELECT COUNT(*) AS c FROM decrees WHERE deadline > ? AND deadline <= ? AND
    ((status = 'open') OR (submitted_at IS NOT NULL AND submitted_at > deadline))`, from, now)).c;
  const up = (await q1('SELECT COALESCE(SUM(delta), 0) AS t FROM points WHERE delta > 0 AND created > ?', from)).t;
  const down = (await q1('SELECT COALESCE(SUM(delta), 0) AS t FROM points WHERE delta < 0 AND created > ?', from)).t;
  const offers = (await q1('SELECT COUNT(*) AS c FROM offers WHERE created > ?', from)).c;
  const forgot = await q1(`SELECT title, COUNT(*) AS c FROM decrees WHERE deadline > ? AND deadline <= ? AND
    ((status = 'open') OR (submitted_at IS NOT NULL AND submitted_at > deadline)) GROUP BY title ORDER BY c DESC LIMIT 1`, from, now);
  const summary = { week, at: now, done, late, up, down: -down, offers, forgotten: forgot ? forgot.title : null };
  await setSetting(env.DB, 'summary', JSON.stringify(summary)).run();
  return true;
}

export async function runSchedule(env) {
  await ensureSchema(env.DB);
  const now = Date.now();
  const subject0 = env.VAPID_SUBJECT || 'mailto:noreply@example.com';
  if (await weeklySummary(env, now)) { await addEvents(env.DB, ['queen'], 'סיכום השבוע מוכן', { tab: 'decrees' }); await notify(env, ['queen'], subject0); }
  const settings = await getSettings(env.DB);
  const st = settings.status;
  if (st.demandDue && now > st.demandDue && !st.lateNotified) {
    await setSetting(env.DB, 'statusReqLate', '1').run();
    await addEvents(env.DB, ['queen', 'slave'], 'הזמן לעדכון הסטטוס נגמר', { tab: 'decrees', id: 'status' });
    await notify(env, ['queen', 'slave'], subject0);
  }
  if (settings.paused) return;
  const soon = await env.DB.prepare(
    `SELECT id FROM decrees WHERE status = 'open' AND deadline IS NOT NULL AND deadline > ? AND deadline <= ? AND notified_soon IS NULL`
  ).bind(now, now + 60 * 60 * 1000).all();
  const late = await env.DB.prepare(
    `SELECT id FROM decrees WHERE status = 'open' AND deadline IS NOT NULL AND deadline <= ? AND notified_late IS NULL`
  ).bind(now).all();
  const stmts = [
    ...soon.results.map((r) => env.DB.prepare('UPDATE decrees SET notified_soon = ? WHERE id = ?').bind(now, r.id)),
    ...late.results.map((r) => env.DB.prepare('UPDATE decrees SET notified_late = ? WHERE id = ?').bind(now, r.id))
  ];
  // Recurring rituals: create today's decree once, before its time.
  const rituals = (await env.DB.prepare('SELECT * FROM rituals WHERE active = 1').all()).results;
  let created = 0;
  for (const r of rituals) {
    const due = ritualDue(r, now);
    if (!due) continue;
    // Claim the day first so two overlapping runs can't create it twice.
    const claim = await env.DB.prepare('UPDATE rituals SET last_key = ? WHERE id = ? AND (last_key IS NULL OR last_key != ?)')
      .bind(due.key, r.id, due.key).run();
    if ((claim.meta?.changes ?? claim.changes) !== 1) continue;
    stmts.push(env.DB.prepare(
      `INSERT INTO decrees (title, note, severity, deadline, created, kind) VALUES (?, ?, ?, ?, ?, 'decree')`
    ).bind(r.title, r.note, r.severity, due.deadline, now));
    created++;
  }
  if (stmts.length) await env.DB.batch(stmts);
  const subject = env.VAPID_SUBJECT || 'mailto:noreply@example.com';
  const titles = async (rows) => (await Promise.all(rows.map((r) => env.DB.prepare('SELECT title FROM decrees WHERE id = ?').bind(r.id).first()))).map((x) => x?.title).filter(Boolean);
  if (created) { await addEvents(env.DB, ['slave'], created === 1 ? 'צו קבוע חדש להיום' : `${created} צווים קבועים להיום`, { tab: 'decrees', id: 'new' }); await notify(env, ['slave'], subject); }
  if (soon.results.length) { await addEvents(env.DB, ['slave'], `נשארה פחות משעה: ${(await titles(soon.results)).join(', ')}`, { tab: 'decrees', id: soon.results[0].id }); await notify(env, ['slave'], subject); }
  if (late.results.length) { await addEvents(env.DB, ['slave', 'queen'], `באיחור: ${(await titles(late.results)).join(', ')}`, { tab: 'decrees', id: late.results[0].id }); await notify(env, ['slave', 'queen'], subject); }
}

// ---------- entry ----------

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/robots.txt') {
      return withHeaders(new Response('User-agent: *\nDisallow: /\n', { headers: { 'Content-Type': 'text/plain' } }));
    }

    const email = await verifiedEmail(request, env);
    const role = roleForEmail(email, env);
    if (!role) return notFound();

    if (url.pathname.startsWith('/api/')) {
      try {
        await ensureSchema(env.DB);
        return await handleApi(request, env, ctx, role, url);
      } catch (e) {
        console.error(e);
        return err(500, 'server error');
      }
    }

    const res = await env.ASSETS.fetch(request);
    // Always check for a newer version, so updates show up right after a deploy.
    const type = res.headers.get('Content-Type') || '';
    const fresh = /html|javascript|css|manifest/.test(type) ? { 'Cache-Control': 'no-cache' } : {};
    return withHeaders(res, fresh);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runSchedule(env));
  }
};
