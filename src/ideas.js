// Task ideas for the queen, from Claude, with your own limits built into the prompt.
// Needs a Worker secret ANTHROPIC_API_KEY. Nothing identifying is sent: no names,
// no emails — only the request, card titles, and recent decree titles.

import { cleanText } from './logic.js';

export const VIBES = { soft: 'רך ומפנק', playful: 'שובב ומתגרה', strict: 'קשוח ותובעני' };
const SEVERITIES = ['request', 'command', 'royal'];

const SYSTEM = `You help a married adult couple invent tasks for a private, consensual dominance-and-submission game they play at home.
The wife is "the queen" (המלכה). The husband is her servant. The queen gives orders; he carries them out.

Write FOUR new task ideas the queen could give him. Rules you never break:
- Stay inside what they both approved. The APPROVED list shows the style and intensity they like. Never suggest anything resembling an item in the REFUSED list.
- Never involve other people, never anything near or noticeable by children, nothing that others in public would notice.
- No medical risk: nothing restricting breathing, nothing on the neck, nothing that breaks skin, nothing with real danger. Impact only on buttocks, thighs or palms.
- Non-graphic wording. Suggestive is fine; explicit sexual description is not.
- Not a repeat of RECENT tasks. Concrete and doable tonight or this week at home, with a clear end (time, count, or result).
- Write in natural Hebrew. Address him as "אתה" and refer to her as "המלכה". Title: 1–3 words. Text: one or two short sentences.
- severity: "request" (light), "command" (medium) or "royal" (strong) — match the requested intensity.
- needsHome: true if it should only happen when the children are out or asleep.

Answer with JSON only, no other text:
{"ideas":[{"title":"...","text":"...","severity":"command","needsHome":false}]}`;

// For the servant: things HE offers to do for her. She still decides.
const OFFER_SYSTEM = `You help a married adult couple with a private, consensual dominance-and-submission game they play at home.
The wife is "the queen" (המלכה). The husband serves her. Here HE asks for ideas of services he could OFFER her — acts of service, devotion, pampering and small rituals. She decides whether to accept.

Write FOUR offer ideas. Rules you never break:
- Stay inside what they both approved; the APPROVED list shows their style. Never anything resembling the REFUSED list.
- Thoughtful and generous, centred on her comfort and pleasure: things she would love to receive.
- Never involve other people, never anything near or noticeable by children, nothing others in public would notice.
- No medical risk. Non-graphic wording.
- Not a repeat of RECENT items. Concrete, doable at home tonight or this week.
- Natural Hebrew, written as his offer to her: title 1–3 words, text one or two short sentences, addressing her as "המלכה" (e.g. "אכין למלכה…").
- severity: "request" (small), "command" (medium) or "royal" (big gesture) — match the requested intensity.
- needsHome: true if it should only happen when the children are out or asleep.

Answer with JSON only, no other text:
{"ideas":[{"title":"...","text":"...","severity":"command","needsHome":false}]}`;

export async function generateIdeas(env, { vibe, deckLabel, lvl, wish, approved, refused, recent, homeFree, protocolLevel, mode }) {
  const user = [
    `VIBE: ${VIBES[vibe] || VIBES.playful}`,
    `INTENSITY: ${['', 'light', 'medium', 'strong'][lvl] || 'medium'}`,
    deckLabel ? `TOPIC: ${deckLabel}` : 'TOPIC: any',
    wish ? (mode === 'offer' ? `HE WANTS TO OFFER SOMETHING LIKE: ${wish}` : `THE QUEEN WANTS: ${wish}`) : '',
    `HOUSE FREE NOW: ${homeFree ? 'yes' : 'no — prefer ideas that are fine with the children around'}`,
    protocolLevel ? `TONIGHT'S PROTOCOL LEVEL: ${protocolLevel}/3` : '',
    `APPROVED (examples of what they like): ${approved.join(' | ') || '—'}`,
    `REFUSED (never anything like these): ${refused.join(' | ') || '—'}`,
    `RECENT (don't repeat): ${recent.join(' | ') || '—'}`
  ].filter(Boolean).join('\n');

  let why = 'empty';
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: env.IDEAS_MODEL || 'claude-sonnet-5-5',
        max_tokens: 3000,
        system: mode === 'offer' ? OFFER_SYSTEM : SYSTEM,
        messages: [{ role: 'user', content: user + (attempt ? '\n\nReply with the JSON object only.' : '') }]
      })
    });
    if (!res.ok) {
      console.error('ideas api', res.status, (await res.text()).slice(0, 300));
      return { error: res.status === 401 ? 'bad key' : 'api error' };
    }
    const body = await res.json();
    const text = (body.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    const ideas = parseIdeas(text);
    if (ideas.length) return { ideas };
    why = body.stop_reason === 'refusal' ? 'refused' : body.stop_reason === 'max_tokens' ? 'cut' : 'format';
    console.error('ideas empty', body.stop_reason, text.slice(0, 500));
  }
  return { ideas: [], why };
}

function rawIdeas(text) {
  try {
    const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    if (Array.isArray(json.ideas)) return json.ideas;
    if (Array.isArray(json)) return json;
  } catch {}
  // Cut off or wrapped: keep every complete {...} that has a title.
  const out = [];
  for (const m of text.matchAll(/\{[^{}]*"title"[^{}]*\}/g)) {
    try { out.push(JSON.parse(m[0])); } catch {}
  }
  return out;
}

export function parseIdeas(text) {
  try {
    return rawIdeas(text || '').slice(0, 6).map((x) => ({
      title: cleanText(x.title, 80),
      text: cleanText(x.text, 400),
      severity: SEVERITIES.includes(x.severity) ? x.severity : 'command',
      needsHome: !!x.needsHome
    })).filter((x) => x.title && x.text);
  } catch {
    return [];
  }
}

// A tiny request just to see whether the key works. Costs next to nothing.
export async function checkKey(env) {
  if (!env.ANTHROPIC_API_KEY) return { ok: false, reason: 'missing' };
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: env.IDEAS_MODEL || 'claude-sonnet-5-5', max_tokens: 5, messages: [{ role: 'user', content: 'ping' }] })
    });
    if (res.ok) return { ok: true };
    let message = '';
    try { message = (await res.json())?.error?.message || ''; } catch {}
    const reason = res.status === 401 ? 'bad key' : res.status === 403 ? 'forbidden'
      : res.status === 404 ? 'model' : res.status === 429 ? 'rate' : /credit|balance|billing/i.test(message) ? 'credit' : 'other';
    return { ok: false, reason, status: res.status, message: message.slice(0, 200) };
  } catch {
    return { ok: false, reason: 'network' };
  }
}
