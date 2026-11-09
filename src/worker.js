import {
  SEVERITIES, approvalPoints, displayStatus, validPin, cleanText,
  lockoutAfterFail, roleForEmail, tokenAlive,
  cardEnabled, cardNeedsHome, lvlToSeverity
} from './logic.js';
import { DECKS, CARDS } from './cards.js';
import { notify, vapidKeys } from './push.js';

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
      endpoint TEXT PRIMARY KEY, role TEXT NOT NULL, created INTEGER NOT NULL)`)
  ]);
  // Columns added after v1.
  const cols = (await db.prepare(`PRAGMA table_info(decrees)`).all()).results.map((c) => c.name);
  const add = [
    ['kind', `TEXT NOT NULL DEFAULT 'decree'`], ['deck', 'TEXT'], ['card_id', 'TEXT'],
    ['notified_soon', 'INTEGER'], ['notified_late', 'INTEGER']
  ].filter(([n]) => !cols.includes(n));
  if (add.length) await db.batch(add.map(([n, t]) => db.prepare(`ALTER TABLE decrees ADD COLUMN ${n} ${t}`)));
  schemaReady = true;
}

async function getSettings(db) {
  const rows = (await db.prepare(`SELECT key, value FROM settings WHERE key IN ('homeFree', 'paused', 'pausedBy')`).all()).results;
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { homeFree: m.homeFree === '1', paused: m.paused === '1', pausedBy: m.pausedBy || null };
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
    remindedAt: d.reminded_at, pointsAwarded: d.points_awarded,
    kind: d.kind || 'decree', deck: d.deck || null
  };
}

async function listAll(env) {
  const now = Date.now();
  const since = now - 30 * 24 * 60 * 60 * 1000;
  const rows = await env.DB.prepare(
    `SELECT * FROM decrees WHERE status != 'done' OR done_at > ? ORDER BY
       CASE status WHEN 'submitted' THEN 0 WHEN 'open' THEN 1 ELSE 2 END,
       COALESCE(deadline, 9e15) ASC, id DESC`
  ).bind(since).all();
  const total = await env.DB.prepare('SELECT COALESCE(SUM(delta), 0) AS t FROM points').first();
  const recent = await env.DB.prepare('SELECT delta, reason, created FROM points ORDER BY id DESC LIMIT 20').all();
  return {
    now,
    decrees: rows.results.map((d) => decreeOut(d, now)),
    points: { total: total.t, recent: recent.results },
    settings: await getSettings(env.DB)
  };
}

const other = (role) => (role === 'queen' ? 'slave' : 'queen');

async function handleApi(request, env, ctx, role, url) {
  const path = url.pathname.replace(/^\/api/, '');
  const method = request.method;
  const now = Date.now();
  const push = (roles) => ctx.waitUntil(notify(env, roles, env.VAPID_SUBJECT || url.origin));

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
    push([role]);
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
      push([other(role)]);
    }
    if (!stmts.length) return err(400, 'nothing to change');
    await env.DB.batch(stmts);
    return json(await listAll(env));
  }

  if (path === '/decrees' && method === 'GET') return json(await listAll(env));

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
    push(['slave']);
    return json(await listAll(env));
  }

  if (path === '/points' && method === 'POST') {
    if (role !== 'queen') return err(403, 'forbidden');
    const b = await readBody(request);
    const delta = Math.trunc(Number(b.delta));
    const reason = cleanText(b.reason, 200) || (delta >= 0 ? 'בונוס מהמלכה' : 'הפרה');
    if (!Number.isFinite(delta) || delta === 0 || Math.abs(delta) > 500) return err(400, 'bad delta');
    await env.DB.prepare('INSERT INTO points (delta, reason, created) VALUES (?, ?, ?)').bind(delta, reason, now).run();
    return json(await listAll(env));
  }

  // ----- cards -----
  if (path === '/cards' && method === 'GET') {
    return json({ decks: DECKS, cards: await allCards(env.DB), settings: await getSettings(env.DB) });
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
    push(['slave']);
    return json({ decks: DECKS, cards: await allCards(env.DB), settings: await getSettings(env.DB) });
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
      return json({ decks: DECKS, cards: await allCards(env.DB), settings: await getSettings(env.DB) });
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
      return json({ decks: DECKS, cards: await allCards(env.DB), settings: await getSettings(env.DB) });
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
      push(['slave']);
      return json(await listAll(env));
    }
  }

  // ----- decree actions -----
  const m = path.match(/^\/decrees\/(\d+)(?:\/(submit|approve|reject|remind))?$/);
  if (m) {
    const id = Number(m[1]);
    const action = m[2];
    const d = await env.DB.prepare('SELECT * FROM decrees WHERE id = ?').bind(id).first();
    if (!d) return err(404, 'not found');
    const b = await readBody(request);

    if (!action && method === 'DELETE') {
      if (role !== 'queen') return err(403, 'forbidden');
      await env.DB.prepare('DELETE FROM decrees WHERE id = ?').bind(id).run();
      return json(await listAll(env));
    }
    if (method !== 'POST') return err(405, 'method');

    if (action === 'submit') {
      if (role !== 'slave') return err(403, 'forbidden');
      if (d.status !== 'open') return err(409, 'not open');
      await env.DB.prepare(`UPDATE decrees SET status = 'submitted', report = ?, submitted_at = ?, reject_reason = '' WHERE id = ?`)
        .bind(cleanText(b.report, 1000), now, id).run();
      push(['queen']);
      return json(await listAll(env));
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
      await env.DB.batch(stmts);
      push(['slave']);
      return json(await listAll(env));
    }
    if (action === 'reject') {
      if (d.status !== 'submitted') return err(409, 'not submitted');
      await env.DB.prepare(`UPDATE decrees SET status = 'open', reject_reason = ?, submitted_at = NULL WHERE id = ?`)
        .bind(cleanText(b.reason, 500) || 'לא מספיק טוב', id).run();
      push(['slave']);
      return json(await listAll(env));
    }
    if (action === 'remind') {
      await env.DB.prepare('UPDATE decrees SET reminded_at = ? WHERE id = ?').bind(now, id).run();
      push(['slave']);
      return json(await listAll(env));
    }
  }

  return err(404, 'not found');
}

// ---------- scheduled: deadline reminders ----------

export async function runSchedule(env) {
  await ensureSchema(env.DB);
  const settings = await getSettings(env.DB);
  if (settings.paused) return;
  const now = Date.now();
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
  if (stmts.length) await env.DB.batch(stmts);
  const subject = env.VAPID_SUBJECT || 'mailto:noreply@example.com';
  if (soon.results.length) await notify(env, ['slave'], subject);
  if (late.results.length) await notify(env, ['slave', 'queen'], subject);
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
    return withHeaders(res);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runSchedule(env));
  }
};
