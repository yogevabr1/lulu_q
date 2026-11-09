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

export async function generateIdeas(env, { vibe, deckLabel, lvl, wish, approved, refused, recent, homeFree, protocolLevel }) {
  const user = [
    `VIBE: ${VIBES[vibe] || VIBES.playful}`,
    `INTENSITY: ${['', 'light', 'medium', 'strong'][lvl] || 'medium'}`,
    deckLabel ? `TOPIC: ${deckLabel}` : 'TOPIC: any',
    wish ? `THE QUEEN WANTS: ${wish}` : '',
    `HOUSE FREE NOW: ${homeFree ? 'yes' : 'no — prefer ideas that are fine with the children around'}`,
    protocolLevel ? `TONIGHT'S PROTOCOL LEVEL: ${protocolLevel}/3` : '',
    `APPROVED (examples of what they like): ${approved.join(' | ') || '—'}`,
    `REFUSED (never anything like these): ${refused.join(' | ') || '—'}`,
    `RECENT (don't repeat): ${recent.join(' | ') || '—'}`
  ].filter(Boolean).join('\n');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: env.IDEAS_MODEL || 'claude-sonnet-5-5',
      max_tokens: 1200,
      system: SYSTEM,
      messages: [{ role: 'user', content: user }]
    })
  });
  if (!res.ok) {
    console.error('ideas api', res.status, (await res.text()).slice(0, 300));
    return { error: res.status === 401 ? 'bad key' : 'api error' };
  }
  const body = await res.json();
  const text = (body.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { ideas: parseIdeas(text) };
}

export function parseIdeas(text) {
  try {
    const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    return (json.ideas || []).slice(0, 6).map((x) => ({
      title: cleanText(x.title, 80),
      text: cleanText(x.text, 400),
      severity: SEVERITIES.includes(x.severity) ? x.severity : 'command',
      needsHome: !!x.needsHome
    })).filter((x) => x.title && x.text);
  } catch {
    return [];
  }
}
