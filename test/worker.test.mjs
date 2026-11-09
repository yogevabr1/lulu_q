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

globalThis.fetch = async (url) => {
  if (String(url) === `https://${TEAM}/cdn-cgi/access/certs`) return new Response(JSON.stringify({ keys: [pubJwk] }));
  throw new Error('unexpected fetch ' + url);
};

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
  const res = await worker.fetch(new Request('https://lulu-q.example.workers.dev' + path, { method, headers, body: body ? JSON.stringify(body) : undefined }), envOverride || env);
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
