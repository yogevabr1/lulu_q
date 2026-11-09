// Web Push without libraries. Pushes carry no payload at all: the phone only
// learns "something changed" and shows a neutral notification. That keeps
// task content away from Apple/Google push servers and off the lock screen.

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const enc = (obj) => b64url(new TextEncoder().encode(JSON.stringify(obj)));

// VAPID keys are created on first use and kept in the database, so there is
// nothing to configure in the Cloudflare dashboard.
export async function vapidKeys(db) {
  const row = await db.prepare(`SELECT value FROM settings WHERE key = 'vapid'`).first();
  if (row) return JSON.parse(row.value);
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const publicRaw = b64url(await crypto.subtle.exportKey('raw', pair.publicKey));
  const keys = { privateJwk, publicRaw };
  await db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('vapid', ?)`).bind(JSON.stringify(keys)).run();
  // Another request may have won the race; always use what is stored.
  const stored = await db.prepare(`SELECT value FROM settings WHERE key = 'vapid'`).first();
  return JSON.parse(stored.value);
}

async function vapidHeader(endpoint, keys, subject) {
  const aud = new URL(endpoint).origin;
  const header = enc({ typ: 'JWT', alg: 'ES256' });
  const payload = enc({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject });
  const key = await crypto.subtle.importKey('jwk', keys.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(`${header}.${payload}`));
  return `vapid t=${header}.${payload}.${b64url(sig)}, k=${keys.publicRaw}`;
}

// Sends an empty push to every device of the given roles.
export async function notify(env, roles, subject) {
  try {
    const list = Array.isArray(roles) ? roles : [roles];
    if (!list.length) return;
    const marks = list.map(() => '?').join(',');
    const subs = await env.DB.prepare(`SELECT endpoint FROM push_subs WHERE role IN (${marks})`).bind(...list).all();
    if (!subs.results.length) return;
    const keys = await vapidKeys(env.DB);
    await Promise.all(subs.results.map(async ({ endpoint }) => {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { Authorization: await vapidHeader(endpoint, keys, subject), TTL: '86400', Urgency: 'high', 'Content-Length': '0' }
        });
        if (res.status === 404 || res.status === 410) {
          await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(endpoint).run();
        }
      } catch (e) {
        console.error('push failed', e);
      }
    }));
  } catch (e) {
    console.error('notify failed', e);
  }
}
