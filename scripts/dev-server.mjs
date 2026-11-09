// Local preview only (never deployed): runs the Worker against an in-memory
// SQLite database and signs a fake Access token for ?as=queen or ?as=slave.
// Run: node --experimental-sqlite scripts/dev-server.mjs  → http://localhost:8787/?as=queen
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import worker from '../src/worker.js';

const db = new DatabaseSync(':memory:');
const stmt = (sql, args = []) => ({
  bind: (...a) => stmt(sql, a),
  first: async () => db.prepare(sql).get(...args) ?? null,
  all: async () => ({ results: db.prepare(sql).all(...args) }),
  run: async () => db.prepare(sql).run(...args),
  _exec: () => db.prepare(sql).run(...args)
});

const TEAM = 'dev.cloudflareaccess.com', AUD = 'dev';
const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', keys.publicKey)), kid: 'dev' };
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, o) => String(u).startsWith(`https://${TEAM}/`) ? new Response(JSON.stringify({ keys: [jwk] })) : realFetch(u, o);
const b64 = (x) => Buffer.from(x).toString('base64url');
async function sign(email) {
  const h = b64(JSON.stringify({ alg: 'RS256', kid: 'dev' }));
  const p = b64(JSON.stringify({ email, aud: [AUD], iss: `https://${TEAM}`, exp: Math.floor(Date.now() / 1000) + 86400 }));
  const s = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64(s)}`;
}
const tokens = { queen: await sign('liorgra8@gmail.com'), slave: await sign('yogevabr@gmail.com') };

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const env = {
  DB: { prepare: (sql) => stmt(sql), batch: async (l) => l.map((s) => s._exec()) },
  ASSETS: {
    fetch: async (req) => {
      let p = new URL(req.url).pathname;
      if (p === '/') p = '/index.html';
      try {
        const body = await readFile(path.join('public', p));
        return new Response(body, { headers: { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' } });
      } catch { return new Response(await readFile('public/index.html'), { headers: { 'Content-Type': 'text/html' } }); }
    }
  },
  QUEEN_EMAIL: 'liorgra8@gmail.com', SLAVE_EMAIL: 'yogevabr@gmail.com', ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:8787');
  const cookie = req.headers.cookie || '';
  const as = url.searchParams.get('as') || (cookie.match(/dev_as=(\w+)/) || [])[1];
  const chunks = []; for await (const c of req) chunks.push(c);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
  if (tokens[as]) headers.set('Cf-Access-Jwt-Assertion', tokens[as]);
  const r = await worker.fetch(new Request(url, { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined }), env);
  const out = {}; r.headers.forEach((v, k) => (out[k] = v));
  if (url.searchParams.get('as')) out['set-cookie'] = `dev_as=${as}; Path=/`;
  res.writeHead(r.status, out);
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(8787, () => console.log('http://localhost:8787/?as=queen'));
