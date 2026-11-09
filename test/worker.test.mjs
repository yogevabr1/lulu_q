// End-to-end test of the Worker with a real SQLite database standing in for D1
// and a locally signed Cloudflare Access token.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/worker.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => db.prepare(sql).run(...args),
    _exec: () => db.prepare(sql).run(...args)
  });
  return { prepare: (sql) => stmt(sql), batch: async (list) => list.map((s) => s._exec()) };
}

const TEAM = 'test-team.cloudflareaccess.com';
const AUD = 'aud-123';
const b64url = (buf) => Buffer.from(buf).toString('base64url');

const keys = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true, ['sign', 'verify']);
const pubJwk = { ...(await crypto.subtle.exportKey('jwk', keys.publicKey)), kid: 'k1', alg: 'RS256' };
const otherKeys = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true, ['sign', 'verify']);

const pushes = [];
const claudeCalls = [];
globalThis.fetch = async (url, opts) => {
  if (String(url) === `https://${TEAM}/cdn-cgi/access/certs`) return new Response(JSON.stringify({ keys: [pubJwk] }));
  if (String(url).startsWith('https://push.example/')) { pushes.push({ url: String(url), auth: opts.headers.Authorization }); return new Response(null, { status: 201 }); }
  if (String(url).startsWith('https://gone.example/')) return new Response(null, { status: 410 });
  if (String(url) === 'https://api.anthropic.com/v1/messages') {
    claudeCalls.push({ headers: opts.headers, body: JSON.parse(opts.body) });
    return new Response(JSON.stringify({ content: [{ type: 'text', text: 'הנה: {"ideas":[{"title":"כוס תה","text":"להכין למלכה תה לפני השינה.","severity":"request","needsHome":false},{"title":"","text":"ריק"}]}' }] }));
  }
  throw new Error('unexpected fetch ' + url);
};
const waits = [];
const ctx = { waitUntil: (p) => waits.push(p) };
const flush = async () => { while (waits.length) await waits.shift(); };

async function jwt(email, { aud = AUD, exp = Math.floor(Date.now() / 1000) + 3600, key = keys.privateKey, iss = `https://${TEAM}` } = {}) {
  const h = b64url(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' }));
  const p = b64url(JSON.stringify({ email, aud: [aud], exp, iss }));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(sig)}`;
}

const env = {
  DB: d1(),
  ASSETS: { fetch: async () => new Response('<html>app</html>', { headers: { 'Content-Type': 'text/html' } }) },
  QUEEN_EMAIL: 'liorgra8@gmail.com', SLAVE_EMAIL: 'yogevabr@gmail.com',
  ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD
};

async function call(path, { token, method = 'GET', body, lulu, envOverride } = {}) {
  const headers = {};
  if (token) headers['Cf-Access-Jwt-Assertion'] = token;
  if (lulu) headers['X-Lulu-Token'] = lulu;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await worker.fetch(new Request('https://lulu-q.example.workers.dev' + path, { method, headers, body: body ? JSON.stringify(body) : undefined }), envOverride || env, ctx);
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, res };
}

const QUEEN = await jwt('liorgra8@gmail.com');
const SLAVE = await jwt('yogevabr@gmail.com');

test('strangers and broken tokens get a plain 404, even for the page', async () => {
  for (const t of [undefined, await jwt('stranger@gmail.com'), await jwt('liorgra8@gmail.com', { aud: 'other' }),
    await jwt('liorgra8@gmail.com', { exp: 10 }), await jwt('liorgra8@gmail.com', { key: otherKeys.privateKey }),
    await jwt('liorgra8@gmail.com', { iss: 'https://evil.example' }), 'garbage.token.here']) {
    for (const p of ['/', '/api/me', '/app.js']) {
      const r = await call(p, { token: t });
      assert.equal(r.status, 404, `${p} should be hidden`);
      assert.equal(r.data, 'Not Found');
    }
  }
});

test('fails closed while Access is not configured', async () => {
  const r = await call('/api/me', { token: QUEEN, envOverride: { ...env, ACCESS_AUD: '' } });
  assert.equal(r.status, 404);
});

test('the two accounts see their own role and robots are kept out', async () => {
  assert.deepEqual((await call('/api/me', { token: QUEEN })).data, { role: 'queen', hasPin: false });
  assert.deepEqual((await call('/api/me', { token: SLAVE })).data, { role: 'slave', hasPin: false });
  const page = await call('/', { token: QUEEN });
  assert.equal(page.status, 200);
  assert.equal(page.res.headers.get('X-Robots-Tag'), 'noindex, nofollow, noarchive');
  assert.match((await call('/robots.txt')).data, /Disallow: \//);
});

test('full flow: pins, decree, submit, approve, points, permissions', async () => {
  // Nothing works before unlocking.
  assert.equal((await call('/api/decrees', { token: QUEEN })).status, 401);

  assert.equal((await call('/api/pin', { token: QUEEN, method: 'POST', body: { pin: '12' } })).status, 400);
  assert.equal((await call('/api/pin', { token: QUEEN, method: 'POST', body: { pin: '2468' } })).status, 200);
  assert.equal((await call('/api/pin', { token: SLAVE, method: 'POST', body: { pin: '1357' } })).status, 200);
  // A PIN cannot be overwritten without being unlocked.
  assert.equal((await call('/api/pin', { token: SLAVE, method: 'POST', body: { pin: '0000' } })).status, 401);

  assert.equal((await call('/api/unlock', { token: QUEEN, method: 'POST', body: { pin: '1357' } })).status, 401);
  const q = (await call('/api/unlock', { token: QUEEN, method: 'POST', body: { pin: '2468' } })).data.token;
  const s = (await call('/api/unlock', { token: SLAVE, method: 'POST', body: { pin: '1357' } })).data.token;
  assert.match(q, /^[0-9a-f]{64}$/);

  // A token only works for its own account.
  assert.equal((await call('/api/decrees', { token: SLAVE, lulu: q })).status, 401);

  // Only the queen creates decrees.
  assert.equal((await call('/api/decrees', { token: SLAVE, lulu: s, method: 'POST', body: { title: 'x' } })).status, 403);
  const deadline = Date.now() + 3600 * 1000;
  let r = await call('/api/decrees', { token: QUEEN, lulu: q, method: 'POST', body: { title: 'לנקות את המטבח <b>', severity: 'royal', deadline, note: 'עד שיבריק' } });
  assert.equal(r.status, 200);
  const id = r.data.decrees[0].id;
  assert.equal(r.data.decrees[0].status, 'open');
  assert.equal(r.data.decrees[0].title, 'לנקות את המטבח <b>');

  // Only the slave submits; only the queen approves.
  assert.equal((await call(`/api/decrees/${id}/approve`, { token: QUEEN, lulu: q, method: 'POST' })).status, 409);
  assert.equal((await call(`/api/decrees/${id}/submit`, { token: QUEEN, lulu: q, method: 'POST' })).status, 403);
  r = await call(`/api/decrees/${id}/submit`, { token: SLAVE, lulu: s, method: 'POST', body: { report: 'מבריק' } });
  assert.equal(r.data.decrees[0].status, 'submitted');
  assert.equal((await call(`/api/decrees/${id}/approve`, { token: SLAVE, lulu: s, method: 'POST' })).status, 403);

  // Reject sends it back with a reason.
  r = await call(`/api/decrees/${id}/reject`, { token: QUEEN, lulu: q, method: 'POST', body: { reason: 'יש כתמים' } });
  assert.equal(r.data.decrees[0].status, 'open');
  assert.equal(r.data.decrees[0].rejectReason, 'יש כתמים');

  await call(`/api/decrees/${id}/submit`, { token: SLAVE, lulu: s, method: 'POST' });
  r = await call(`/api/decrees/${id}/approve`, { token: QUEEN, lulu: q, method: 'POST', body: { bonus: 5 } });
  assert.equal(r.data.decrees[0].status, 'done');
  assert.equal(r.data.points.total, 25);

  // Manual points, queen only.
  assert.equal((await call('/api/points', { token: SLAVE, lulu: s, method: 'POST', body: { delta: 100 } })).status, 403);
  r = await call('/api/points', { token: QUEEN, lulu: q, method: 'POST', body: { delta: -15, reason: 'ויכוח' } });
  assert.equal(r.data.points.total, 10);
  assert.equal(r.data.points.recent[0].reason, 'ויכוח');

  // Overdue shows up from the deadline alone.
  r = await call('/api/decrees', { token: QUEEN, lulu: q, method: 'POST', body: { title: 'כביסה', deadline: Date.now() - 1000 } });
  const late = r.data.decrees.find((d) => d.title === 'כביסה');
  assert.equal(late.status, 'overdue');
  r = await call(`/api/decrees/${late.id}/remind`, { token: QUEEN, lulu: q, method: 'POST' });
  assert.ok(r.data.decrees.find((d) => d.id === late.id).remindedAt);

  // Late submission earns half.
  await call(`/api/decrees/${late.id}/submit`, { token: SLAVE, lulu: s, method: 'POST' });
  r = await call(`/api/decrees/${late.id}/approve`, { token: QUEEN, lulu: q, method: 'POST' });
  assert.equal(r.data.points.total, 15);

  // Lock kills the token.
  await call('/api/lock', { token: SLAVE, lulu: s, method: 'POST' });
  assert.equal((await call('/api/decrees', { token: SLAVE, lulu: s })).status, 401);
});

test('five wrong PINs lock the account for a while', async () => {
  for (let i = 0; i < 5; i++) await call('/api/unlock', { token: SLAVE, method: 'POST', body: { pin: '9999' } });
  const r = await call('/api/unlock', { token: SLAVE, method: 'POST', body: { pin: '1357' } });
  assert.equal(r.status, 429);
  assert.ok(r.data.until > Date.now());
});

test('cards: vetoes, green cards, house-free, sending, rewards, pause, push', async () => {
  const q = (await call('/api/unlock', { token: QUEEN, method: 'POST', body: { pin: '2468' } })).data.token;
  // The slave was locked out by the previous test; reset that for this one.
  await env.DB.prepare('UPDATE pins SET fails = 0, locked_until = 0').run();
  const s = (await call('/api/unlock', { token: SLAVE, method: 'POST', body: { pin: '1357' } })).data.token;

  let r = await call('/api/cards', { token: SLAVE, lulu: s });
  const byId = (id) => r.data.cards.find((c) => c.id === id);
  assert.ok(r.data.cards.length > 100);
  assert.equal(byId('pu01').enabled, true);           // ordinary card: allowed by default
  assert.equal(byId('hu35').enabled, false);          // green card: locked until both say yes
  assert.equal(byId('wa01').enabled, false);          // whole water deck is green
  assert.ok(!r.data.cards.some((c) => c.title === 'בלי מסכים'));

  // Either one can veto; only your own vote changes.
  r = await call('/api/cards/pu01/vote', { token: SLAVE, lulu: s, method: 'POST', body: { ok: false } });
  assert.equal(byId('pu01').enabled, false);
  assert.equal(byId('pu01').votes.slave, 0);
  assert.equal(byId('pu01').votes.queen, null);
  r = await call('/api/cards/pu01/vote', { token: SLAVE, lulu: s, method: 'POST', body: { ok: null } });
  assert.equal(byId('pu01').enabled, true);

  // Green needs both.
  r = await call('/api/cards/hu35/vote', { token: QUEEN, lulu: q, method: 'POST', body: { ok: true } });
  assert.equal(byId('hu35').enabled, false);
  r = await call('/api/cards/hu35/vote', { token: SLAVE, lulu: s, method: 'POST', body: { ok: true } });
  assert.equal(byId('hu35').enabled, true);

  // Only the queen sends; vetoed cards and private cards are refused.
  assert.equal((await call('/api/cards/pu02/send', { token: SLAVE, lulu: s, method: 'POST' })).status, 403);
  assert.equal((await call('/api/cards/wa01/send', { token: QUEEN, lulu: q, method: 'POST' })).data.error, 'card not allowed');
  assert.equal((await call('/api/cards/hu35/send', { token: QUEEN, lulu: q, method: 'POST' })).data.error, 'house not free');
  assert.equal((await call('/api/cards/fe13/send', { token: QUEEN, lulu: q, method: 'POST' })).data.error, 'house not free');
  assert.equal((await call('/api/settings', { token: SLAVE, lulu: s, method: 'POST', body: { homeFree: true } })).status, 403);
  r = await call('/api/settings', { token: QUEEN, lulu: q, method: 'POST', body: { homeFree: true } });
  assert.equal(r.data.settings.homeFree, true);

  // Push subscription, then sending a card notifies the slave.
  await call('/api/push/subscribe', { token: SLAVE, lulu: s, method: 'POST', body: { endpoint: 'https://push.example/slave-1' } });
  await call('/api/push/subscribe', { token: QUEEN, lulu: q, method: 'POST', body: { endpoint: 'https://gone.example/queen-old' } });
  pushes.length = 0;
  r = await call('/api/cards/hu35/send', { token: QUEEN, lulu: q, method: 'POST', body: { deadline: Date.now() + 3600e3 } });
  await flush();
  const sent = r.data.decrees.find((d) => d.kind === 'card');
  assert.equal(sent.title, 'הפה');
  assert.equal(sent.deck, 'humil');
  assert.equal(sent.severity, 'royal');
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].url, 'https://push.example/slave-1');
  assert.match(pushes[0].auth, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);

  // Completing a punishment card earns no points.
  const before = r.data.points.total;
  await call(`/api/decrees/${sent.id}/submit`, { token: SLAVE, lulu: s, method: 'POST' });
  await flush();
  r = await call(`/api/decrees/${sent.id}/approve`, { token: QUEEN, lulu: q, method: 'POST' });
  assert.equal(r.data.points.total, before);

  // A dead push endpoint gets removed.
  await call('/api/push/test', { token: QUEEN, lulu: q, method: 'POST' }); await flush();
  assert.equal((await env.DB.prepare(`SELECT COUNT(*) AS c FROM push_subs WHERE role = 'queen'`).first()).c, 0);

  // Rewards go through the same flow.
  r = await call('/api/cards/re06/send', { token: QUEEN, lulu: q, method: 'POST' });
  assert.equal(r.data.decrees.find((d) => d.kind === 'reward').title, 'שבח');

  // Custom card: queen only, slave can veto it.
  assert.equal((await call('/api/cards', { token: SLAVE, lulu: s, method: 'POST', body: { title: 'x', deck: 'punish' } })).status, 403);
  r = await call('/api/cards', { token: QUEEN, lulu: q, method: 'POST', body: { title: 'כריעת הבוקר', text: 'עשר דקות', deck: 'punish', lvl: 1 } });
  const mine = r.data.cards.find((c) => c.custom);
  assert.equal(mine.title, 'כריעת הבוקר');
  r = await call(`/api/cards/${mine.id}/vote`, { token: SLAVE, lulu: s, method: 'POST', body: { ok: false } });
  assert.equal(r.data.cards.find((c) => c.id === mine.id).enabled, false);

  // Pause: either can pull it; nothing new can be ordered while it's on.
  r = await call('/api/settings', { token: SLAVE, lulu: s, method: 'POST', body: { paused: true } });
  assert.equal(r.data.settings.paused, true);
  assert.equal(r.data.settings.pausedBy, 'slave');
  assert.equal((await call('/api/decrees', { token: QUEEN, lulu: q, method: 'POST', body: { title: 'x' } })).data.error, 'paused');
  assert.equal((await call('/api/cards/pu02/send', { token: QUEEN, lulu: q, method: 'POST' })).data.error, 'paused');
  await call('/api/settings', { token: QUEEN, lulu: q, method: 'POST', body: { paused: false } });
  assert.equal((await call('/api/decrees', { token: QUEEN, lulu: q, method: 'POST', body: { title: 'אחרי ההפוגה', deadline: Date.now() + 30 * 60e3 } })).status, 200);
});

test('scheduled reminders fire once per decree', async () => {
  await flush();
  pushes.length = 0;
  const { runSchedule } = await import('../src/worker.js');
  await runSchedule(env);
  const firstRound = pushes.length;
  assert.ok(firstRound >= 1);
  await runSchedule(env);
  assert.equal(pushes.length, firstRound);
});

test('rituals and point redemptions', async () => {
  await env.DB.prepare('UPDATE pins SET fails = 0, locked_until = 0').run();
  const q = (await call('/api/unlock', { token: QUEEN, method: 'POST', body: { pin: '2468' } })).data.token;
  const s = (await call('/api/unlock', { token: SLAVE, method: 'POST', body: { pin: '1357' } })).data.token;

  // Rituals: queen only; the scheduler creates today's decree once.
  assert.equal((await call('/api/rituals', { token: SLAVE, lulu: s, method: 'POST', body: { title: 'x', freq: 'daily', time: '23:59' } })).status, 403);
  assert.equal((await call('/api/rituals', { token: QUEEN, lulu: q, method: 'POST', body: { title: 'x', freq: 'daily', time: '7:30' } })).status, 400);
  const p = (await import('../src/logic.js')).tzParts(Date.now());
  const later = `${String(Math.min(p.h + 1, 23)).padStart(2, '0')}:59`;
  let r = await call('/api/rituals', { token: QUEEN, lulu: q, method: 'POST', body: { title: 'קפה למיטה', freq: 'daily', time: later, severity: 'command' } });
  await flush();
  const { runSchedule } = await import('../src/worker.js');
  await runSchedule(env); await runSchedule(env);
  r = await call('/api/decrees', { token: SLAVE, lulu: s });
  assert.equal(r.data.rituals.length, 1);
  assert.equal(r.data.decrees.filter((d) => d.title === 'קפה למיטה').length, 1);
  r = await call(`/api/rituals/${r.data.rituals[0].id}/toggle`, { token: QUEEN, lulu: q, method: 'POST' });
  assert.equal(r.data.rituals[0].active, 0);

  // Redemptions: needs enough free points, queen decides, approval deducts.
  await call('/api/points', { token: QUEEN, lulu: q, method: 'POST', body: { delta: 100, reason: 'בדיקה' } });
  r = await call('/api/decrees', { token: SLAVE, lulu: s });
  const start = r.data.points.total;
  assert.equal((await call('/api/redeem', { token: QUEEN, lulu: q, method: 'POST', body: { item: 'sofa' } })).status, 403);
  r = await call('/api/redeem', { token: SLAVE, lulu: s, method: 'POST', body: { item: 'sofa' } });
  const id = r.data.redeems[0].id;
  assert.equal(r.data.points.total, start); // nothing taken until approved
  if (start - 30 < 150) assert.equal((await call('/api/redeem', { token: SLAVE, lulu: s, method: 'POST', body: { item: 'pamper' } })).data.error, 'not enough points');
  assert.equal((await call(`/api/redeem/${id}/approve`, { token: SLAVE, lulu: s, method: 'POST' })).status, 403);
  r = await call(`/api/redeem/${id}/approve`, { token: QUEEN, lulu: q, method: 'POST' });
  assert.equal(r.data.points.total, start - 30);
  assert.equal((await call(`/api/redeem/${id}/deny`, { token: QUEEN, lulu: q, method: 'POST' })).status, 409);
});

test('offers, quick punishment, check-ins, mood, protocol, weekly summary', async () => {
  await env.DB.prepare('UPDATE pins SET fails = 0, locked_until = 0').run();
  await env.DB.prepare(`UPDATE settings SET value = '0' WHERE key = 'paused'`).run();
  const q = (await call('/api/unlock', { token: QUEEN, method: 'POST', body: { pin: '2468' } })).data.token;
  const s = (await call('/api/unlock', { token: SLAVE, method: 'POST', body: { pin: '1357' } })).data.token;

  // Offers
  assert.equal((await call('/api/offers', { token: QUEEN, lulu: q, method: 'POST', body: { title: 'x' } })).status, 403);
  let r = await call('/api/offers', { token: SLAVE, lulu: s, method: 'POST', body: { title: 'אמבט רגליים הערב', note: 'עם מלח' } });
  const offer = r.data.offers[0];
  assert.equal(offer.status, 'pending');
  assert.equal((await call(`/api/offers/${offer.id}/accept`, { token: SLAVE, lulu: s, method: 'POST' })).status, 403);
  r = await call(`/api/offers/${offer.id}/accept`, { token: QUEEN, lulu: q, method: 'POST', body: { severity: 'royal' } });
  const fromOffer = r.data.decrees.find((d) => d.title === 'אמבט רגליים הערב');
  assert.equal(fromOffer.severity, 'royal');
  assert.equal(r.data.offers.find((o) => o.id === offer.id).status, 'accepted');

  // Quick punishment only draws allowed punishment cards
  r = await call('/api/punish', { token: QUEEN, lulu: q, method: 'POST', body: { because: 'כביסה' } });
  assert.equal(r.status, 200);
  const pun = r.data.decrees.find((d) => d.kind === 'card' && d.deck === 'punish' && d.note.includes('בעקבות: כביסה'));
  assert.ok(pun);
  assert.equal((await call('/api/punish', { token: SLAVE, lulu: s, method: 'POST' })).status, 403);

  // Check-in after a strong card; hidden until both answer
  await call('/api/settings', { token: QUEEN, lulu: q, method: 'POST', body: { homeFree: true } });
  r = await call('/api/cards/pa02/send', { token: QUEEN, lulu: q, method: 'POST' });
  const strong = r.data.decrees.find((d) => d.title === 'הכלי' && d.status === 'open');
  await call(`/api/decrees/${strong.id}/submit`, { token: SLAVE, lulu: s, method: 'POST' });
  r = await call(`/api/decrees/${strong.id}/approve`, { token: QUEEN, lulu: q, method: 'POST' });
  const ci = r.data.checkins.find((c) => c.title === 'הכלי');
  assert.equal(ci.answered, false);
  r = await call(`/api/checkins/${ci.id}`, { token: QUEEN, lulu: q, method: 'POST', body: { score: 5, note: 'עוד' } });
  assert.equal(r.data.checkins.find((c) => c.id === ci.id).theirs, null);
  r = await call('/api/decrees', { token: SLAVE, lulu: s });
  assert.equal(r.data.checkins.find((c) => c.id === ci.id).theirs, null); // slave can't peek
  assert.equal(r.data.checkins.find((c) => c.id === ci.id).answered, false);
  r = await call(`/api/checkins/${ci.id}`, { token: SLAVE, lulu: s, method: 'POST', body: { score: 4, note: 'קצת פחות' } });
  const both = r.data.checkins.find((c) => c.id === ci.id);
  assert.deepEqual([both.mine.score, both.theirs.score, both.theirs.note], [4, 5, 'עוד']);
  assert.equal((await call(`/api/checkins/${ci.id}`, { token: SLAVE, lulu: s, method: 'POST', body: { score: 1 } })).status, 409);

  // Mood and protocol: queen only; pause switches the protocol off
  assert.equal((await call('/api/settings', { token: SLAVE, lulu: s, method: 'POST', body: { mood: 'waiting' } })).status, 403);
  r = await call('/api/settings', { token: QUEEN, lulu: q, method: 'POST', body: { mood: 'waiting', protocol: true, protocolLevel: 3 } });
  assert.deepEqual([r.data.settings.mood, r.data.settings.protocol, r.data.settings.protocolLevel], ['waiting', true, 3]);
  r = await call('/api/settings', { token: SLAVE, lulu: s, method: 'POST', body: { paused: true } });
  assert.equal(r.data.settings.protocol, false);
  await call('/api/settings', { token: SLAVE, lulu: s, method: 'POST', body: { paused: false } });

  // Weekly summary: Sunday 08:00+ Israel time, once per week
  const { runSchedule } = await import('../src/worker.js');
  const realNow = Date.now;
  Date.now = () => Date.parse('2026-11-15T07:00:00Z'); // Sunday 09:00 local
  try {
    pushes.length = 0;
    await runSchedule(env);
  } finally { Date.now = realNow; }
  r = await call('/api/decrees', { token: QUEEN, lulu: q });
  const sm = r.data.settings.summary;
  assert.equal(sm.week, '2026-11-15');
  assert.ok(sm.done >= 1);
  Date.now = () => Date.parse('2026-11-15T09:00:00Z');
  try { await runSchedule(env); } finally { Date.now = realNow; }
  r = await call('/api/settings', { token: QUEEN, lulu: q, method: 'POST', body: { dismissSummary: true } });
  assert.equal(r.data.settings.summary.dismissed, true);
});

test('expectation review: you see the other mark on a card only after marking it yourself', async () => {
  await env.DB.prepare('UPDATE pins SET fails = 0, locked_until = 0').run();
  const q = (await call('/api/unlock', { token: QUEEN, method: 'POST', body: { pin: '2468' } })).data.token;
  const s = (await call('/api/unlock', { token: SLAVE, method: 'POST', body: { pin: '1357' } })).data.token;
  await call('/api/cards/se01/vote', { token: QUEEN, lulu: q, method: 'POST', body: { ok: true } });

  let r = await call('/api/cards', { token: SLAVE, lulu: s });
  let c = r.data.cards.find((x) => x.id === 'se01');
  assert.equal(c.votes.queen, null);          // hidden: the slave hasn't answered this card
  assert.equal(c.theirsHidden, true);
  const slaveLeft = r.data.review.slaveLeft;
  assert.ok(slaveLeft > 0);

  r = await call('/api/cards/se01/vote', { token: SLAVE, lulu: s, method: 'POST', body: { ok: false } });
  c = r.data.cards.find((x) => x.id === 'se01');
  assert.deepEqual(c.votes, { queen: 1, slave: 0 }); // both answered: visible
  assert.equal(c.enabled, false);
  assert.equal(r.data.review.slaveLeft, slaveLeft - 1);

  // A new custom card shows up as unanswered for both.
  const before = r.data.review.queenLeft;
  r = await call('/api/cards', { token: QUEEN, lulu: q, method: 'POST', body: { title: 'קלף חדש', deck: 'service', lvl: 1 } });
  assert.equal(r.data.review.slaveLeft, slaveLeft);
  assert.equal(r.data.review.queenLeft, before + 1);
});

test('ideas from Claude: queen only, needs a key, limits go into the prompt', async () => {
  await env.DB.prepare('UPDATE pins SET fails = 0, locked_until = 0').run();
  const q = (await call('/api/unlock', { token: QUEEN, method: 'POST', body: { pin: '2468' } })).data.token;
  const s = (await call('/api/unlock', { token: SLAVE, method: 'POST', body: { pin: '1357' } })).data.token;
  assert.equal((await call('/api/ideas', { token: QUEEN, lulu: q, method: 'POST', body: {} })).data.error, 'not configured');

  const withKey = { ...env, ANTHROPIC_API_KEY: 'test-key' };
  assert.equal((await call('/api/ideas', { token: SLAVE, lulu: s, method: 'POST', body: {}, envOverride: withKey })).status, 403);
  await call('/api/cards/pu03/vote', { token: SLAVE, lulu: s, method: 'POST', body: { ok: false } });
  const r = await call('/api/ideas', { token: QUEEN, lulu: q, method: 'POST', body: { vibe: 'soft', deck: 'service', lvl: 1, wish: 'משהו נעים' }, envOverride: withKey });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.ideas, [{ title: 'כוס תה', text: 'להכין למלכה תה לפני השינה.', severity: 'request', needsHome: false }]);
  const sent = claudeCalls.at(-1);
  assert.equal(sent.headers['x-api-key'], 'test-key');
  const prompt = sent.body.messages[0].content;
  assert.match(prompt, /REFUSED[^\n]*שתיקה/);      // a vetoed card is listed as off-limits
  assert.match(prompt, /THE QUEEN WANTS: משהו נעים/);
  assert.doesNotMatch(prompt + sent.body.system, /gmail|ליאור|יוגב/i); // nothing identifying
});

test('ideas connection check', async () => {
  await env.DB.prepare('UPDATE pins SET fails = 0, locked_until = 0').run();
  const s = (await call('/api/unlock', { token: SLAVE, method: 'POST', body: { pin: '1357' } })).data.token;
  assert.deepEqual((await call('/api/ideas/check', { token: SLAVE, lulu: s, method: 'POST' })).data, { ok: false, reason: 'missing' });
  const r = await call('/api/ideas/check', { token: SLAVE, lulu: s, method: 'POST', envOverride: { ...env, ANTHROPIC_API_KEY: 'k' } });
  assert.deepEqual(r.data, { ok: true });
});
