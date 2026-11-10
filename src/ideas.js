// Task ideas for the queen, from Claude, with your own limits built into the prompt.
// Needs a Worker secret ANTHROPIC_API_KEY. Nothing identifying is sent: no names,
// no emails — only the request, card titles, and recent decree titles.

import { cleanText } from './logic.js';

export const VIBES = {
  soft: 'soft and pampering',
  playful: 'playful and cheeky',
  strict: 'strict and demanding',
  tease: 'teasing — slow build-up, anticipation, being made to wait and want',
  sexual: 'sexual — her pleasure first, orgasm control, edging, permission, oral service, toys, being used for her enjoyment',
  dirty: 'dirty and degrading — messy, raw and humiliating: spit, sweat, worn clothes and feet after a long day, crawling, floors, being her object'
};
const SEVERITIES = ['request', 'command', 'royal'];

const SYSTEM = `You help a married adult couple invent tasks for a private, consensual dominance-and-submission game they play at home.
The wife is "the queen" (המלכה). The husband is her servant. The queen gives orders; he carries them out.

Write FOUR new task ideas the queen could give him. Rules you never break:
- Stay inside what they both approved. The APPROVED list shows the style and intensity they like. Never suggest anything resembling an item in the REFUSED list.
- Be bold. They are experienced adults who chose this: teasing, sexual control, humiliation, dirty/messy degradation and hard pain are all welcome when they fit the VIBE, the INTENSITY and the APPROVED list. Don't water ideas down or add disclaimers. At strong intensity, ideas should be genuinely intense.
- Never involve other people, never anything near or noticeable by children, nothing that others in public would notice.
- No medical risk: nothing restricting breathing, nothing on the neck, nothing that breaks skin, nothing with real danger. Impact only on buttocks, thighs or palms.
- Wording: direct, sensual and suggestive, but not a graphic description of sex acts.
- Anything sexual or degrading gets needsHome: true.
- Not a repeat of RECENT tasks. Concrete and doable tonight or this week at home, with a clear end (time, count, or result).
- Write in natural Hebrew. Address him as "אתה" and refer to her as "המלכה". Title: 1–3 words. Text: one or two short sentences.
- severity: "request" (light), "command" (medium) or "royal" (strong) — match the requested intensity.
- needsHome: true if it should only happen when the children are out or asleep.

Answer with JSON only, no other text:
{"ideas":[{"title":"...","text":"...","severity":"command","needsHome":false}]}`;

// For the servant: things HE offers to do for her. She still decides.
// The daily surprise challenge: small, remote, done the same day.
const CHALLENGE_SYSTEM = `You help a married adult couple with a private, consensual dominance-and-submission game.
The wife is "the queen" (המלכה). The husband serves her. Write THREE options for today's SURPRISE CHALLENGE: a small task she sends him during his workday (09:00–17:00) that he completes TODAY, away from her.

Rules you never break:
- Light and quick: a few minutes of effort at most, or a simple rule he keeps for the rest of the day.
- Doable remotely while at work: messages or voice notes to her, a discreet rule, something he wears or carries, a reminder of her, anticipation for tonight, a report this evening.
- Completely invisible to coworkers; nobody else involved; nothing that could embarrass him or break workplace rules. A private photo for her is fine only alone in a locked restroom, on his own phone.
- Stay inside what they both approved (APPROVED shows their style). Never anything resembling REFUSED. Learn from LOVED, avoid DISLIKED. Not a repeat of RECENT.
- Varied: the three options should feel different from each other (e.g. a report, a rule, something teasing).
- Clear end: by a time today, a count, or a report tonight.
- Natural Hebrew, addressing him as "אתה" and her as "המלכה". Title 1–3 words; text one or two short sentences.
- severity is "request". needsHome is false.

Answer with JSON only, no other text:
{"ideas":[{"title":"...","text":"...","severity":"request","needsHome":false}]}`;

const OFFER_SYSTEM = `You help a married adult couple with a private, consensual dominance-and-submission game they play at home.
The wife is "the queen" (המלכה). The husband serves her. Here HE asks for ideas of what he could OFFER her — service, devotion, pampering, rituals, and (when the VIBE asks for it) teasing, sexual service, submission or degradation he puts himself through for her. She decides whether to accept.

Write FOUR offer ideas. Rules you never break:
- Stay inside what they both approved; the APPROVED list shows their style. Never anything resembling the REFUSED list.
- Centred on her pleasure: things she would love to receive or watch. Be bold when the VIBE and INTENSITY ask for it — don't water down, no disclaimers.
- Never involve other people, never anything near or noticeable by children, nothing others in public would notice.
- No medical risk: nothing restricting breathing, nothing on the neck, nothing that breaks skin.
- Wording: direct, sensual and suggestive, but not a graphic description of sex acts. Anything sexual or degrading gets needsHome: true.
- Not a repeat of RECENT items. Concrete, doable at home tonight or this week.
- Natural Hebrew, written as his offer to her: title 1–3 words, text one or two short sentences, addressing her as "המלכה" (e.g. "אכין למלכה…").
- severity: "request" (small), "command" (medium) or "royal" (big gesture) — match the requested intensity.
- needsHome: true if it should only happen when the children are out or asleep.

Answer with JSON only, no other text:
{"ideas":[{"title":"...","text":"...","severity":"command","needsHome":false}]}`;

export async function generateIdeas(env, { vibe, deckLabel, lvl, wish, approved, refused, recent, homeFree, protocolLevel, mode, work, loved = [], disliked = [] }) {
  const user = [
    `VIBE: ${VIBES[vibe] || VIBES.playful}`,
    `INTENSITY: ${['', 'light', 'medium', 'strong'][lvl] || 'medium'}`,
    work ? `TOPIC: AT HIS WORKPLACE — things he does during his workday, away from her. Completely invisible to coworkers and nobody else involved: secret rules, timed messages or check-ins to her, small rituals, things he wears or carries under his clothes, posture or behaviour rules, thinking-of-her tasks, discreet anticipation for tonight. Private photos for her are fine when taken alone in a locked restroom, on his personal phone, and sent only to her (e.g. proof he is wearing what she ordered). Nothing anyone else could see or notice, and no sexual acts at work. needsHome is false.`
      : deckLabel ? `TOPIC: ${deckLabel}` : 'TOPIC: any',
    wish ? (mode === 'offer' ? `HE WANTS TO OFFER SOMETHING LIKE: ${wish}` : `THE QUEEN WANTS: ${wish}`) : '',
    `HOUSE FREE NOW: ${homeFree ? 'yes' : 'no — prefer ideas that are fine with the children around'}`,
    protocolLevel ? `TONIGHT'S PROTOCOL LEVEL: ${protocolLevel}/3` : '',
    `APPROVED (examples of what they like): ${approved.join(' | ') || '—'}`,
    `REFUSED (never anything like these): ${refused.join(' | ') || '—'}`,
    `RECENT (don't repeat): ${recent.join(' | ') || '—'}`,
    loved.length ? `LOVED — acts they both rated highly after doing them. Learn from these: propose NEW ideas with similar mechanics, mood, intensity and what made them work (read their words). Don't repeat them:\n- ${loved.join('\n- ')}` : '',
    disliked.length ? `DISLIKED — at least one of them rated these low. Steer away from what these have in common:\n- ${disliked.join('\n- ')}` : ''
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
        system: mode === 'offer' ? OFFER_SYSTEM : mode === 'challenge' ? CHALLENGE_SYSTEM : SYSTEM,
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
