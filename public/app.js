// Lulu — a private two-person app. The first screen is a plain passcode
// pad on purpose; the court only appears after the right PIN.

const app = document.getElementById('app');
const LOCK_AFTER_MS = 5 * 60 * 1000;
const POLL_MS = 30 * 1000;

const S = {
  me: null, token: null, data: null, tab: 'decrees', sheet: null,
  pin: '', pinMode: 'unlock', pinFirst: '', pinMsg: '', pinBad: false, busy: false,
  hiddenAt: 0, toast: '', draft: null,
  cards: null, deck: 'punish', level: 0, drawn: null, limDeck: 'punish', cardDraft: null, pushState: ''
};

// ---------- helpers ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const SEV = { request: 'בקשה', command: 'פקודה', royal: 'צו מלכותי' };
const DECK_LABEL = { punish: 'עונש', service: 'שירות', worship: 'פולחן', humil: 'השפלה', bind: 'ריסון וחושים', pain: 'כאב', feet: 'רגליים', rules: 'חוקי היום', reward: 'פרס', water: 'מים' };
const DECK_ORDER = ['punish', 'service', 'worship', 'feet', 'humil', 'bind', 'pain', 'rules', 'reward', 'water'];
const dots = (n) => '◆'.repeat(n) + '◇'.repeat(3 - n);
const STATUS_Q = { open: 'בביצוע', submitted: 'ממתין לחותמך', overdue: 'באיחור', done: 'אושר' };
const STATUS_S = { open: 'בביצוע', submitted: 'הוגש', overdue: 'באיחור', done: 'אושר' };

const pad2 = (n) => String(n).padStart(2, '0');
function hhmm(d) { return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
function dayKey(d) { return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); }

function fmtWhen(ts) {
  if (ts == null) return 'ללא מועד';
  const d = new Date(ts), now = new Date();
  const tom = new Date(now); tom.setDate(now.getDate() + 1);
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (dayKey(d) === dayKey(now)) return 'היום ' + hhmm(d);
  if (dayKey(d) === dayKey(tom)) return 'מחר ' + hhmm(d);
  if (dayKey(d) === dayKey(yest)) return 'אתמול ' + hhmm(d);
  return d.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'numeric' }) + ' ' + hhmm(d);
}

function span(ms) {
  const m = Math.round(Math.abs(ms) / 60000);
  if (m < 60) return m <= 1 ? 'דקה' : m + ' דקות';
  const h = Math.round(m / 60);
  if (h < 48) return h === 1 ? 'שעה' : h === 2 ? 'שעתיים' : h + ' שעות';
  const d = Math.round(h / 24);
  return d === 2 ? 'יומיים' : d + ' ימים';
}
function rel(ts, now) {
  if (ts == null) return '';
  const diff = ts - now;
  return diff >= 0 ? 'עוד ' + span(diff) : 'באיחור של ' + span(diff);
}

const icon = {
  lock: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="5" y="11" width="14" height="9"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  crown: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true"><path d="M3 18h18M4 18L3 8l5 4 4-7 4 7 5-4-1 10"/></svg>',
  scroll: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M6 3h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6M6 3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2M9 8h7M9 12h7M9 16h4"/></svg>',
  coin: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 3l7 9-7 9-7-9z"/></svg>',
  plus: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#f6ece0" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  x: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#b8a690" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  check: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#c9a45c" stroke-width="2" aria-hidden="true"><path d="M4 12l5 5L20 6"/></svg>',
  pause: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M9 5v14M15 5v14"/></svg>',
  cards: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="4" y="5" width="11" height="16" rx="1"/><path d="M9 3h10a1 1 0 0 1 1 1v14"/></svg>',
  book: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21V5M8 7h7"/></svg>',
  home: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 11l9-7 9 7v9H3z"/></svg>',
  warn: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#e8828f" stroke-width="1.6" stroke-linecap="round" aria-hidden="true" style="flex:none"><path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17v.5"/></svg>'
};

// ---------- api ----------

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (S.token) headers['X-Lulu-Token'] = S.token;
  let res;
  try {
    res = await fetch('/api' + path, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined, credentials: 'same-origin', cache: 'no-store' });
  } catch {
    return { error: 'network' };
  }
  let data = {};
  try { data = await res.json(); } catch {}
  if (res.status === 401 && data.error === 'locked' && S.token) { lock(false); return { error: 'locked' }; }
  if (!res.ok) return { error: data.error || 'error', status: res.status, ...data };
  return data;
}

// ---------- lock screen (neutral on purpose) ----------

function setNeutral() {
  document.body.className = 'neutral';
  document.querySelector('meta[name="theme-color"]').setAttribute('content', '#f2f2f7');
}
function setCourt() {
  if (!document.getElementById('court-fonts')) {
    const l = document.createElement('link');
    l.id = 'court-fonts'; l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Frank+Ruhl+Libre:wght@400;700;900&family=Assistant:wght@400;600;700&family=Bellefair&family=UnifrakturMaguntia&display=swap';
    document.head.appendChild(l);
  }
  document.body.className = 'court';
  document.querySelector('meta[name="theme-color"]').setAttribute('content', '#0b0809');
}

function renderLock() {
  setNeutral();
  const titles = { create: 'בחירת קוד גישה', confirm: 'אימות קוד הגישה', unlock: 'הזינו קוד גישה' };
  const hint = S.pinMsg || (S.pinMode === 'create' ? '4 עד 8 ספרות' : S.pinMode === 'confirm' ? 'הקלידו שוב את אותו הקוד' : '');
  const len = Math.max(4, S.pin.length);
  const dots = Array.from({ length: Math.min(8, len) }, (_, i) => `<span class="dot${i < S.pin.length ? ' on' : ''}"></span>`).join('');
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => `<button class="key" data-k="${k}" ${S.busy ? 'disabled' : ''}>${k}</button>`).join('');
  app.innerHTML = `
    <main class="lock">
      <h1>${titles[S.pinMode]}</h1>
      <div class="dots" aria-label="${S.pin.length} ספרות הוקלדו">${dots}</div>
      <p class="${S.pinBad ? 'bad' : ''}" role="status">${esc(hint)}</p>
      <div class="pad">
        ${keys}
        <button class="key ghost" data-k="del" aria-label="מחיקה" ${S.busy ? 'disabled' : ''}>מחק</button>
        <button class="key" data-k="0" ${S.busy ? 'disabled' : ''}>0</button>
        <button class="key ghost" data-k="ok" ${S.busy || S.pin.length < 4 ? 'disabled' : ''}>אישור</button>
      </div>
    </main>`;
}

async function pinKey(k) {
  if (S.busy) return;
  if (k === 'del') { S.pin = S.pin.slice(0, -1); S.pinMsg = ''; S.pinBad = false; return renderLock(); }
  if (k === 'ok') return pinSubmit();
  if (S.pin.length >= 8) return;
  S.pin += k; S.pinMsg = ''; S.pinBad = false;
  renderLock();
}

async function pinSubmit() {
  const pin = S.pin;
  if (pin.length < 4) return;
  if (S.pinMode === 'create') { S.pinFirst = pin; S.pin = ''; S.pinMode = 'confirm'; return renderLock(); }
  S.busy = true; renderLock();
  if (S.pinMode === 'confirm') {
    if (pin !== S.pinFirst) {
      S.busy = false; S.pin = ''; S.pinFirst = ''; S.pinMode = 'create'; S.pinMsg = 'הקודים לא תאמו. נסו שוב.'; S.pinBad = true;
      return renderLock();
    }
    const r = await api('/pin', { method: 'POST', body: { pin } });
    if (r.error) { S.busy = false; S.pin = ''; S.pinMode = 'create'; S.pinMsg = 'משהו השתבש. נסו שוב.'; S.pinBad = true; return renderLock(); }
    S.pinMode = 'unlock';
  }
  const r = await api('/unlock', { method: 'POST', body: { pin } });
  S.busy = false; S.pin = '';
  if (r.token) { S.token = r.token; S.pinMsg = ''; S.pinBad = false; await enterCourt(); return; }
  S.pinBad = true;
  if (r.until) {
    const mins = Math.ceil((r.until - Date.now()) / 60000);
    S.pinMsg = `יותר מדי ניסיונות. נסו שוב בעוד ${mins} דקות.`;
  } else S.pinMsg = r.error === 'network' ? 'אין חיבור.' : 'קוד שגוי';
  renderLock();
}

function lock(callServer = true) {
  if (callServer && S.token) api('/lock', { method: 'POST' });
  S.token = null; S.data = null; S.sheet = null; S.tab = 'decrees';
  S.pin = ''; S.pinMode = 'unlock'; S.pinMsg = ''; S.pinBad = false;
  renderLock();
}

// ---------- the court ----------

async function enterCourt() {
  setCourt();
  app.innerHTML = '';
  await refresh();
  checkPush();
  let seen = true;
  try { seen = localStorage.getItem('lulu_tour_' + S.me.role) === '1'; } catch {}
  if (!seen && S.data) { S.sheet = { type: 'tour', i: 0 }; render(); }
  loadCards();
}

async function refresh() {
  if (!S.token) return;
  const r = await api('/decrees');
  if (r.decrees) { S.data = r; render(); }
}

function render() {
  if (!S.token) return renderLock();
  if (!S.data) return;
  if (S.review) return renderReview();
  const q = S.me.role === 'queen';
  const st = S.data.settings || {};
  const body = S.tab === 'points' ? pointsView(q)
    : S.tab === 'cards' && q ? cardsView()
    : S.tab === 'limits' ? limitsView(q)
    : (q ? queenDecrees() : slaveDecrees());
  const pauseBanner = st.paused ? `<div class="banner gold" role="status" style="justify-content:space-between;align-items:center">
      <span><strong>הפוגה פעילה.</strong> הכול מוקפא${st.pausedBy ? ` — ${st.pausedBy === S.me.role ? 'הפעלת' : (st.pausedBy === 'queen' ? 'המלכה הפעילה' : 'העבד הפעיל')}` : ''}.</span>
      <button class="btn" data-act="unpause" style="min-height:40px;flex:none">חזרה</button>
    </div>` : '';
  app.innerHTML = `
    <div class="shell">
      <header class="top">
        <div class="brand">
          <div class="mono"><span>R</span></div>
          <div>
            <div class="kicker">${q ? 'שלום, הוד מעלתך' : 'המלכה מצפה.'}</div>
            <h1 class="title">${q ? 'חדר הכס' : 'יומן העבד'}</h1>
          </div>
        </div>
        <div style="display:flex;gap:6px">
          ${st.paused ? '' : `<button class="btn quiet" data-act="pause" aria-label="הפוגה — לעצור הכול" title="הפוגה" style="min-width:44px;padding:8px 10px">${icon.pause}</button>`}
          <button class="btn quiet" data-act="lock" aria-label="נעילה" style="min-width:44px;padding:8px 10px">${icon.lock}</button>
        </div>
      </header>
      <main class="main">${pauseBanner}${body}<div class="foot">◆ דבר המלכה הוא חוק ◆</div></main>
      ${navView(q)}
    </div>
    ${S.sheet ? sheetView() : ''}
    ${S.toast ? `<div class="toast" role="status">${esc(S.toast)}</div>` : ''}`;
}

function navView(q) {
  const on = (t) => (S.tab === t ? ' on' : '');
  if (q) {
    return `<nav class="nav"><div class="in" style="grid-template-columns:repeat(5,minmax(0,1fr))">
      <button class="${on('decrees')}" data-act="tab" data-tab="decrees">${icon.scroll}צווים</button>
      <button class="${on('cards')}" data-act="tab" data-tab="cards">${icon.cards}קלפים</button>
      <div><button class="fab" data-act="new" aria-label="גזירה חדשה">${icon.plus}</button></div>
      <button class="${on('points')}" data-act="tab" data-tab="points">${icon.coin}נקודות</button>
      <button class="${on('limits')}" data-act="tab" data-tab="limits">${icon.book}חוקים</button>
    </div></nav>`;
  }
  return `<nav class="nav"><div class="in">
    <button class="${on('decrees')}" data-act="tab" data-tab="decrees">${icon.scroll}צווים</button>
    <button class="${on('points')}" data-act="tab" data-tab="points">${icon.coin}נקודות</button>
    <button class="${on('limits')}" data-act="tab" data-tab="limits">${icon.book}חוקים</button>
  </div></nav>`;
}

function card(d, q, now) {
  const late = d.status === 'overdue';
  const when = d.status === 'done'
    ? 'אושר ' + fmtWhen(d.doneAt) + (d.pointsAwarded != null ? ` · ${d.pointsAwarded}+` : '')
    : d.status === 'submitted' ? 'הוגש ' + fmtWhen(d.submittedAt)
    : d.deadline != null ? `עד ${fmtWhen(d.deadline)} · ${rel(d.deadline, now)}` : 'ללא מועד';
  const statusTxt = (q ? STATUS_Q : STATUS_S)[d.status];
  const reward = d.kind === 'reward';
  let actions = '';
  if (q) {
    if (d.status === 'submitted' && reward) actions = `<div class="row2"><button class="btn gold" data-act="approve" data-id="${d.id}">אשרי מימוש</button><button class="btn quiet" data-act="reject" data-id="${d.id}">לא עכשיו</button></div>`;
    else if (d.status === 'submitted') actions = `<div class="row2"><button class="btn gold" data-act="approve" data-id="${d.id}">אשרי ביצוע</button><button class="btn red" data-act="reject" data-id="${d.id}">לא מספיק טוב</button></div>`;
    else if (late) {
      const sent = d.remindedAt && now - d.remindedAt < 12 * 3600 * 1000;
      actions = `<div class="row2"><button class="btn red" data-act="remind" data-id="${d.id}" ${sent ? 'disabled' : ''}>${sent ? 'התזכורת נשלחה' : 'תזכורת חמורה'}</button>
        <button class="btn blood" style="font-size:16px;min-height:44px" data-act="punish" data-id="${d.id}">שלפי עונש</button></div>`;
    }
    if (d.status !== 'done') actions += `<button class="link" data-act="del" data-id="${d.id}">בטלי את הצו</button>`;
  } else {
    if (reward && (d.status === 'open' || late)) actions = `<button class="btn gold" data-act="submit" data-id="${d.id}">לבקש לממש</button>`;
    else if (d.status === 'open' || late) actions = `<button class="btn" data-act="submit" data-id="${d.id}" style="display:flex;align-items:center;justify-content:center;gap:8px">${icon.check}ביצעתי — הגש לאישורה</button>`;
    else if (d.status === 'submitted') actions = `<span class="st submitted">${reward ? 'ממתין לאישור המלכה…' : 'ממתין לחותם המלכה…'}</span>`;
    else actions = `<span class="st">${reward ? 'מומש' : 'המלכה מרוצה'}</span>`;
  }
  const label = d.kind === 'card' || reward ? `<span class="sev ${reward ? 'command' : d.severity}">${reward ? 'פרס מהמלכה' : 'קלף · ' + esc(DECK_LABEL[d.deck] || '')}</span>` : `<span class="sev ${d.severity}">${SEV[d.severity]}</span>`;
  const note = d.note ? `<p class="quote">${d.kind !== 'decree' ? '' : q ? 'הערתך: ' : 'הוראות המלכה: '}${esc(d.note)}</p>` : '';
  const report = d.status === 'submitted' && d.report ? `<p class="quote">דיווח העבד: ${esc(d.report)}</p>` : '';
  const rejected = d.status !== 'done' && d.status !== 'submitted' && d.rejectReason ? `<p class="quote red">${q ? 'דחית' : 'המלכה דחתה'}: ${esc(d.rejectReason)}</p>` : '';
  return `<article class="card ${d.status}">
    <div class="meta">${label}<span class="st ${d.status}">${statusTxt}</span></div>
    <h3>${esc(d.title)}</h3>
    <span class="when${late ? ' late' : ''}">${when}</span>
    ${note}${report}${rejected}${actions}
  </article>`;
}

function queenDecrees() {
  const { decrees, now, points } = S.data;
  const c = (s) => decrees.filter((d) => d.status === s).length;
  const active = decrees.filter((d) => d.status !== 'done');
  const done = decrees.filter((d) => d.status === 'done');
  return `
    <div class="stats">
      <div class="stat"><b>${c('open') + c('overdue')}</b><span>פתוחים</span></div>
      <div class="stat gold"><b>${c('submitted')}</b><span>לאישורך</span></div>
      <div class="stat red"><b>${c('overdue')}</b><span>באיחור</span></div>
    </div>
    ${reviewBanner()}
    ${eveningPanel()}
    ${summaryCard()}
    ${offerRequests(true)}
    ${checkinPrompts()}
    ${redeemRequests(true)}
    <div class="sec"><h2>מגילת הצווים</h2><span>נקודות העבד: ${points.total}</span></div>
    ${active.length ? active.map((d) => card(d, true, now)).join('') : '<p class="empty">אין צווים פתוחים. העבד מחכה לגזירה.</p>'}
    ${ritualsList()}
    ${done.length ? `<div class="sec"><h2>בוצעו לאחרונה</h2><span>30 יום</span></div>${done.map((d) => card(d, true, now)).join('')}` : ''}`;
}

const WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const WD_SHORT = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const ritualWhen = (r) => (r.freq === 'daily' ? 'כל יום' : 'כל יום ' + WEEKDAYS[r.weekday]) + ' עד ' + r.time;

const MOOD = { free: 'זמינה', busy: 'לא להפריע', waiting: 'מחכה לך' };

function eveningPanel() {
  const st = S.data.settings;
  const moods = Object.entries(MOOD).map(([k, l]) => `<button class="chip${st.mood === k ? ' on' : ''}" data-act="mood" data-m="${k}">${l}</button>`).join('');
  const lv = [1, 2, 3].map((n) => `<button class="chip${st.protocolLevel === n ? ' on' : ''}" data-act="plevel" data-l="${n}" aria-label="עוצמה ${n}">${'◆'.repeat(n)}</button>`).join('');
  return `<section class="panel">
    <div class="field"><span class="lbl">מצב המלכה</span><div class="chips">${moods}</div></div>
    <div class="field">
      <span class="lbl">פרוטוקול ${st.protocol ? `<b class="live">פעיל מ־${hhmm(new Date(st.protocolSince))}</b>` : ''}</span>
      <div class="chips" style="grid-template-columns:1.4fr repeat(3,minmax(0,1fr))">
        <button class="chip${st.protocol ? ' on' : ''}" data-act="protocol">${st.protocol ? 'כבי' : 'הפעילי'}</button>${lv}
      </div>
    </div>
  </section>`;
}

function slaveStatus() {
  const st = S.data.settings;
  const parts = [];
  if (st.protocol) parts.push(`<div class="banner gold"><span><strong>הפרוטוקול פעיל</strong> · עוצמה ${'◆'.repeat(st.protocolLevel)} · פונים רק "המלכה"</span></div>`);
  parts.push(`<div class="moodline ${st.mood}"><span class="dotm"></span>המלכה: <strong>${MOOD[st.mood]}</strong></div>`);
  return parts.join('');
}

function summaryCard() {
  const sm = S.data.settings.summary;
  if (!sm || sm.dismissed || S.data.now - sm.at > 3 * 24 * 3600 * 1000) return '';
  return `<section class="hero">
    <div style="display:flex;justify-content:space-between;align-items:center"><span class="k">סיכום השבוע</span><button class="x" data-act="dismissSummary" aria-label="סגירה">${icon.x}</button></div>
    <div class="stats">
      <div class="stat"><b>${sm.done}</b><span>בוצעו</span></div>
      <div class="stat${sm.late ? ' red' : ''}"><b>${sm.late}</b><span>איחורים</span></div>
      <div class="stat gold"><b>${sm.up - sm.down}</b><span>נקודות נטו</span></div>
    </div>
    <span class="when">${sm.up} נקודות נצברו, ${sm.down} ירדו${sm.offers ? ` · ${sm.offers} הצעות שירות` : ''}.</span>
    ${sm.forgotten ? `<span class="when">הכי נשכח: <strong>${esc(sm.forgotten)}</strong></span>` : '<span class="when">שום טקס לא נשכח השבוע.</span>'}
  </section>`;
}

function offerRequests(q) {
  const list = (S.data.offers || []).filter((o) => q ? o.status === 'pending' : true).slice(0, q ? 20 : 3);
  if (!list.length) return '';
  return list.map((o) => {
    if (q) return `<div class="banner gold" style="flex-direction:column;align-items:stretch">
      <span>העבד מציע שירות: <strong>${esc(o.title)}</strong>${o.note ? ` — ${esc(o.note)}` : ''}</span>
      <div class="row2"><button class="btn gold" data-act="offerYes" data-id="${o.id}">הפכי לצו</button><button class="btn quiet" data-act="offerNo" data-id="${o.id}">לא עכשיו</button></div>
    </div>`;
    const st = o.status === 'pending' ? 'ממתין למלכה…' : o.status === 'accepted' ? 'המלכה הפכה לצו' : 'המלכה דחתה';
    return `<div class="moodline"><span>ההצעה שלך: <strong>${esc(o.title)}</strong> — ${st}</span></div>`;
  }).join('');
}

function checkinPrompts() {
  const open = (S.data.checkins || []).filter((c) => !c.answered);
  return open.map((c) => `<div class="banner gold" style="flex-direction:column;align-items:stretch">
    <span><strong>צ'ק־אין אחרי "${esc(c.title)}"</strong>. רק אתם רואים, ואחד לא רואה את השני עד ששניכם עונים.</span>
    <button class="btn gold" data-act="checkin" data-id="${c.id}">לענות</button>
  </div>`).join('');
}

function checkinResults() {
  const list = (S.data.checkins || []).filter((c) => c.answered);
  if (!list.length) return '<p class="empty">אין עדיין. צ\'ק־אין נפתח אחרי כל קלף ◆◆◆.</p>';
  const them = S.me.role === 'queen' ? 'העבד' : 'המלכה';
  return list.map((c) => `<div class="limrow">
    <div class="lt"><span class="t">${esc(c.title)}</span><span class="d">${fmtWhen(c.created)}</span></div>
    <p>אני: ${'★'.repeat(c.mine.score)}${'☆'.repeat(5 - c.mine.score)}${c.mine.note ? ` — ${esc(c.mine.note)}` : ''}</p>
    <p>${them}: ${c.theirs ? `${'★'.repeat(c.theirs.score)}${'☆'.repeat(5 - c.theirs.score)}${c.theirs.note ? ` — ${esc(c.theirs.note)}` : ''}` : 'עוד לא ענה. התשובה תופיע כששניכם עניתם.'}</p>
  </div>`).join('');
}

// ---------- expectation review: every unanswered card, one at a time ----------

function reviewList() {
  if (!S.cards) return [];
  return [...S.cards.cards].sort((a, b) => DECK_ORDER.indexOf(a.deck) - DECK_ORDER.indexOf(b.deck) || a.lvl - b.lvl);
}
const myVote = (c) => c.votes[S.me.role];
const unanswered = () => reviewList().filter((c) => myVote(c) !== 0 && myVote(c) !== 1);

function reviewBanner() {
  if (!S.cards) return '';
  const left = unanswered().length;
  if (!left) return '';
  const total = reviewList().length;
  const q = S.me.role === 'queen';
  const fresh = left === total;
  return `<section class="hero">
    <span class="k">תיאום ציפיות</span>
    <h2 style="font-size:20px">${fresh ? `${total} קלפים מחכים לך` : left === 1 ? 'קלף אחד שעוד לא סימנת' : `${left} קלפים שעוד לא סימנת`}</h2>
    <span class="when">${fresh ? 'עוברים על כל קלף ומסמנים ✓ רוצה או ✗ לא.' : 'עוברים רק על הקלפים שעוד לא סימנת — כולל קלפים חדשים.'} ${q ? 'העבד' : 'המלכה'} רואה את הסימון שלך על קלף רק אחרי שסימן גם בעצמו.</span>
    <button class="btn gold" data-act="reviewStart">${fresh ? 'להתחיל' : 'לסמן'}</button>
  </section>`;
}

async function startReview(all) {
  if (!S.cards) await loadCards();
  const list = all ? reviewList() : unanswered();
  S.review = { ids: list.map((c) => c.id), i: 0 };
  window.scrollTo(0, 0);
  render();
}

const reviewCards = () => S.review.ids.map((id) => S.cards.cards.find((c) => c.id === id)).filter(Boolean);

async function reviewVote(ok) {
  const list = reviewCards();
  const c = list[S.review.i];
  if (!c) return;
  // Optimistic: move on at once, save in the background.
  const prev = myVote(c);
  c.votes[S.me.role] = ok ? 1 : 0;
  S.review.i++;
  render();
  const r = await api(`/cards/${c.id}/vote`, { method: 'POST', body: { ok } });
  if (r.error) { c.votes[S.me.role] = prev; S.review.i = list.indexOf(c); toast('לא נשמר. נסו שוב.'); }
}

async function finishReview() {
  const r = await api('/review/done', { method: 'POST' });
  if (r.cards) S.cards = r;
  S.review = null; S.tab = 'limits';
  window.scrollTo(0, 0);
  toast('נשמר');
}

function renderReview() {
  const list = reviewCards();
  const i = S.review.i;
  const total = list.length;
  const pct = total ? Math.round((Math.min(i, total) / total) * 100) : 100;
  let body;
  if (i >= total) {
    const yes = list.filter((c) => myVote(c) === 1).length;
    body = `<div class="bigcard"><div class="mid">
        <div class="mono big"><span>R</span></div>
        <h2>סיימת</h2>
        <p>${yes} ✓ · ${total - yes} ✗</p>
        <p>ההשוואה מחכה במסך "חוקים" — על כל קלף ששניכם כבר סימנתם.</p>
      </div></div>
      <div class="row2"><button class="btn quiet" data-act="rvBack" ${total ? '' : 'disabled'}>לחזור לקלף האחרון</button><button class="btn gold" data-act="rvFinish">לתוצאות</button></div>`;
  } else {
    const c = list[i];
    const mine = myVote(c);
    const gated = S.cards.decks[c.deck]?.gated || c.needsHome;
    body = `<div class="bigcard${gated ? ' red' : ''}">
        <div class="top2"><span>${DECK_LABEL[c.deck] || ''} · ${dots(c.lvl)}</span><span class="glyph">R</span></div>
        <div class="mid"><h2>${esc(c.title)}</h2><p>${esc(c.text)}</p></div>
        ${c.green ? '<p class="fine">קלף רגיש: ייפתח רק אם שניכם מסמנים ✓</p>' : gated ? '<p class="fine">רק כשהבית פנוי</p>' : ''}
      </div>
      <div class="row2 rv">
        <button class="btn rvno${mine === 0 ? ' on' : ''}" data-act="rvNo">✗ לא</button>
        <button class="btn rvyes${mine === 1 ? ' on' : ''}" data-act="rvYes">✓ רוצה</button>
      </div>
      <div class="row2">
        <button class="btn quiet" data-act="rvBack" ${i === 0 ? 'disabled' : ''}>הקודם</button>
        <button class="btn quiet" data-act="rvExit">להמשיך אחר כך</button>
      </div>`;
  }
  app.innerHTML = `<div class="shell"><header class="top">
      <div class="brand"><div class="mono"><span>R</span></div><div><div class="kicker">תיאום ציפיות</div><h1 class="title">${Math.min(i + 1, total)} / ${total}</h1></div></div>
      <button class="btn quiet" data-act="rvExit" aria-label="יציאה" style="min-width:44px;padding:8px 10px">${icon.x}</button>
    </header>
    <div class="rvbar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>
    <main class="main" style="padding-bottom:calc(32px + env(safe-area-inset-bottom))">${body}</main></div>
    ${S.toast ? `<div class="toast" role="status">${esc(S.toast)}</div>` : ''}`;
}

function reviewResults() {
  if (!S.cards) return '';
  const me = S.me.role;
  const themName = me === 'queen' ? 'העבד' : 'המלכה';
  const themLeft = me === 'queen' ? S.cards.review?.slaveLeft : S.cards.review?.queenLeft;
  const list = reviewList();
  const marked = (v) => v === 0 || v === 1;
  const shared = list.filter((c) => marked(c.votes.queen) && marked(c.votes.slave));
  const myLeft = unanswered().length;
  if (!shared.length) {
    if (myLeft) return '';
    return `<div class="banner gold"><span><strong>תיאום ציפיות:</strong> סימנת הכול. ההשוואה תופיע כאן ברגע ש${themName} ${me === 'queen' ? 'יסמן' : 'תסמן'}.</span></div>`;
  }
  const both = shared.filter((c) => c.votes.queen === 1 && c.votes.slave === 1);
  const none = shared.filter((c) => c.votes.queen === 0 && c.votes.slave === 0);
  const split = shared.filter((c) => c.votes.queen !== c.votes.slave);
  const who = (c) => (c.votes.queen === 1 ? 'המלכה רוצה, העבד לא' : 'העבד רוצה, המלכה לא');
  const waiting = [
    myLeft ? `${myLeft} קלפים עוד מחכים לך` : '',
    themLeft ? `${themLeft} קלפים עוד מחכים ל${themName === 'העבד' ? 'עבד' : 'מלכה'}` : ''
  ].filter(Boolean).join(' · ');
  return `<section class="hero">
    <span class="k">תיאום ציפיות</span>
    <div class="stats">
      <div class="stat gold"><b>${both.length}</b><span>שניכם ✓</span></div>
      <div class="stat${split.length ? ' red' : ''}"><b>${split.length}</b><span>לדבר עליהם</span></div>
      <div class="stat"><b>${none.length}</b><span>שניכם ✗</span></div>
    </div>
    <span class="when">${waiting ? waiting + '. ' : ''}קלף שאחד מכם סימן ✗ לא נשלף. אפשר לשנות סימון בכל רגע ברשימה למטה.</span>
  </section>
  ${split.length ? `<div class="sec"><h2>על מה לדבר</h2><span>${split.length} קלפים</span></div>
    ${split.map((c) => `<div class="limrow off"><div class="lt"><span class="t">${esc(c.title)}</span><span class="d">${DECK_LABEL[c.deck]} · ${dots(c.lvl)}</span></div><p>${esc(c.text)}</p><p><strong style="color:var(--rose)">${who(c)}</strong></p></div>`).join('')}` : ''}
  <button class="btn quiet" data-act="reviewAll">לעבור שוב על כל הקלפים</button>`;
}

// ---------- ideas from Claude ----------

const VIBE = { soft: 'רך', playful: 'שובב', strict: 'קשוח' };

function ideasSheet(close) {
  const I = S.ideas;
  const q = S.me.role === 'queen';
  const chip = (act, key, cur, label) => `<button class="chip${cur === key ? ' on' : ''}" data-act="${act}" data-v="${key}">${label}</button>`;
  const decks = [['', 'הכול'], ...DECK_ORDER.filter((k) => (q ? k !== 'reward' && k !== 'water' : ['service', 'worship', 'feet'].includes(k))).map((k) => [k, DECK_LABEL[k]])];
  let results = '';
  if (I.loading) results = '<p class="empty">חושבת על רעיונות…</p>';
  else if (I.error) results = `<div class="banner"><span>${esc(I.error)}</span></div>`;
  else if (I.list) results = I.list.length ? I.list.map((x, i) => `<div class="card ${x.severity === 'royal' ? 'overdue' : ''}">
      <div class="meta"><span class="sev ${x.severity}">${SEV[x.severity]}</span>${x.needsHome ? '<span class="st">רק כשהבית פנוי</span>' : ''}</div>
      <h3>${esc(x.title)}</h3><p class="when" style="margin:0">${esc(x.text)}</p>
      ${q ? `<div class="row2"><button class="btn gold" data-act="ideaUse" data-i="${i}">גזרי</button><button class="btn quiet" data-act="ideaCard" data-i="${i}">לקלפים</button></div>`
          : `<button class="btn gold" data-act="ideaOffer" data-i="${i}">להציע למלכה</button>`}
    </div>`).join('') : '<p class="empty">לא יצא כלום. נסי שוב.</p>';
  return `<div class="sheetwrap" data-act="backdrop"><section class="sheet" role="dialog" aria-modal="true" aria-label="רעיונות">
    <div class="hd"><h2>${q ? '✨ רעיונות' : '✨ רעיונות לשירות'}</h2>${close}</div>
    <div class="field"><span class="lbl">אווירה</span><div class="chips">${Object.entries(VIBE).map(([k, l]) => chip('ideaVibe', k, I.vibe, l)).join('')}</div></div>
    <div class="field"><span class="lbl">נושא</span><div class="chiprow">${decks.map(([k, l]) => chip('ideaDeck', k, I.deck, l)).join('')}</div></div>
    <div class="field"><span class="lbl">עוצמה</span><div class="chips">${[1, 2, 3].map((n) => chip('ideaLvl', String(n), String(I.lvl), '◆'.repeat(n))).join('')}</div></div>
    <div class="field"><label for="i-wish">${q ? 'מה בא לך? (לא חובה)' : 'כיוון משלך? (לא חובה)'}</label><input id="i-wish" maxlength="300" value="${esc(I.wish)}" placeholder="${q ? 'למשל: משהו עם הרגליים, לפני השינה' : 'למשל: לפנק אותה אחרי יום ארוך'}"></div>
    <button class="btn blood" data-act="ideaGo" ${I.loading ? 'disabled' : ''}>${I.list ? 'עוד רעיונות' : q ? 'תני לי רעיונות' : 'תן לי רעיונות'}</button>
    <p class="when" style="text-align:center">רק בתוך מה ששניכם סימנתם ✓. מה שאחד סימן ✗ — לא יוצע.</p>
    ${results}
  </section></div>`;
}

async function askIdeas() {
  const w = document.getElementById('i-wish');
  if (w) S.ideas.wish = w.value;
  S.ideas.loading = true; S.ideas.error = ''; render();
  const r = await api('/ideas', { method: 'POST', body: { vibe: S.ideas.vibe, deck: S.ideas.deck || null, lvl: S.ideas.lvl, wish: S.ideas.wish } });
  S.ideas.loading = false;
  if (r.ideas) {
    S.ideas.list = r.ideas;
    if (!r.ideas.length) S.ideas.error = r.why === 'refused' ? 'Claude לא רצה להציע משהו לבקשה הזאת. נסו לנסח אחרת או להוריד עוצמה.'
      : r.why === 'cut' ? 'התשובה נקטעה. נסו שוב.' : 'התשובה הגיעה בפורמט לא צפוי. נסו שוב.';
  }
  else S.ideas.error = r.error === 'not configured' ? 'הרעיונות עוד לא מחוברים. צריך להוסיף מפתח ב־Cloudflare.'
    : r.error === 'daily limit' ? 'הגעתם למכסה היומית. מחר יש עוד.'
    : 'לא הצלחתי להביא רעיונות. נסו שוב.';
  if (S.sheet?.type === 'ideas') render();
}

// ---------- the guide ("how it works"), different for each of you ----------

const TOUR = {
  queen: [
    ['ברוכה הבאה לחדר הכס', ['כאן את גוזרת, העבד מבצע, ורק את מאשרת.', 'זה כלי עזר למשחק שלכם, לא המשחק עצמו. מותר לכבות אותו לימים.']],
    ['גזירה', ['היהלום האדום שבתחתית פותח גזירה חדשה: משימה, עד מתי, וחומרה (בקשה, פקודה, צו מלכותי).', 'אפשר לבחור "כל יום" או "כל שבוע" — והצו ייווצר לבד, עם טקסים מוצעים כמו קפה למיטה או דיווח ערב.']],
    ['אישור', ['כשהעבד מגיש, הצו מופיע בזהב עם הדיווח שלו. "אשרי ביצוע" — אפשר עם בונוס. "לא מספיק טוב" — חוזר לביצוע, ואפשר גם עם עונש.', 'צו באיחור? "תזכורת חמורה" או "שלפי עונש" — קלף עונש מאושר נשלף ונשלח בלחיצה.']],
    ['קלפים', ['מסך "קלפים": שבע חפיסות, מסנן עוצמה (◆ עד ◆◆◆), שליפה אקראית או בחירה, ו"הענקי לעבד".', 'השפלה, כאב ומים — רק כשמסומן "הבית פנוי". ב"+ קלף משלך" מוסיפים קלפים חדשים.']],
    ['נקודות', ['העבד צובר על צווים שבוצעו, ומפסיד על הפרות. במסך "נקודות" יש כפתורים מהירים: בונוס, פנייה שגויה, ויכוח.', 'כשהעבד מבקש להמיר נקודות — הבקשה מופיעה אצלך. את מחליטה.']],
    ['מצב הערב', ['למעלה במסך הצווים: מצב המלכה (זמינה, לא להפריע, מחכה לך) ומתג הפרוטוקול עם עוצמה לערב.', 'העבד יכול להציע שירות ביוזמתו — את הופכת לצו או מוותרת.']],
    ['גבולות וצ\'ק־אין', ['במסך "חוקים" כל אחד מכם יכול לפסול כל קלף. קלף שאחד פוסל — לא נשלף. קלפים מסומנים "ירוק" נעולים עד ששניכם מאשרים.', 'אחרי כל קלף ◆◆◆ שניכם מקבלים צ\'ק־אין קצר. אף אחד לא רואה את התשובה של השני עד ששניכם עניתם.']],
    ['ביטחון', ['⏸ למעלה — הפוגה: עוצר הכול, לשניכם, בכל רגע. 🔒 — נעילה מיידית. אחרי 5 דקות ברקע האפליקציה ננעלת לבד.', 'ההתראות תמיד ניטרליות: "יש עדכון חדש". מפעילים אותן במסך "חוקים".']],
    ['ועכשיו: תיאום ציפיות', ['לפני שמתחילים, כל אחד מכם עובר על כל הקלפים ומסמן ✓ או ✗.', 'אף אחד לא רואה את הסימונים של השני עד ששניכם מסיימים — ואז תראו יחד על מה הסכמתם ועל מה כדאי לדבר. הכפתור מחכה במסך הצווים.']]
  ],
  slave: [
    ['יומן העבד', ['כאן אתה רואה מה המלכה גזרה, ועד מתי. אתה מבצע ומגיש — רק היא מאשרת.', 'זה כלי עזר למשחק שלכם, לא המשחק עצמו.']],
    ['הצווים', ['למעלה — הצו הבא וכמה זמן נשאר. "ביצעתי — הגש לאישורה" שולח לה, עם דיווח אם תרצה.', 'אם היא דוחה, הצו חוזר אליך עם הסיבה. איחור — אדום, ואולי עונש.']],
    ['קלפים ופרסים', ['קלפים שהמלכה שולפת מגיעים אליך כצווים, עם החפיסה שלהם.', 'פרס מגיע בזהב — "לבקש לממש" כשתרצה להשתמש בו.']],
    ['נקודות', ['בקשה 5, פקודה 10, צו מלכותי 20 — וחצי באיחור. הפרות מורידות.', 'במסך "נקודות" אפשר לבקש להמיר. המלכה רשאית לסרב.']],
    ['מצב המלכה והצעת שירות', ['למעלה תראה את מצב המלכה, ומתי הפרוטוקול פעיל — אז פונים רק "המלכה".', '"הצעת שירות" — אתה מציע משהו ביוזמתך, והיא מחליטה אם זה הופך לצו. אין רעיון? ✨ רעיונות לשירות.']],
    ['גבולות וצ\'ק־אין', ['במסך "חוקים" אתה יכול לפסול כל קלף, בלי להסביר. קלפים מסומנים "ירוק" נעולים עד ששניכם מאשרים.', 'אחרי כל קלף ◆◆◆ — צ\'ק־אין קצר ופרטי. התשובות נחשפות רק כששניכם עניתם.']],
    ['ביטחון', ['⏸ למעלה — הפוגה: עוצר הכול, בכל רגע, בלי עונש. 🔒 — נעילה מיידית.', 'ההתראות תמיד ניטרליות. מפעילים אותן במסך "חוקים".']],
    ['ועכשיו: תיאום ציפיות', ['לפני שמתחילים, כל אחד מכם עובר על כל הקלפים ומסמן ✓ או ✗ — בכנות.', 'המלכה לא רואה את הסימונים שלך עד ששניכם מסיימים. אז תראו יחד על מה הסכמתם ועל מה כדאי לדבר. הכפתור מחכה במסך הצווים.']]
  ]
};

function tourSheet() {
  const steps = TOUR[S.me.role];
  const i = Math.min(S.sheet.i, steps.length - 1);
  const [title, paras] = steps[i];
  const last = i === steps.length - 1;
  return `<div class="sheetwrap"><section class="sheet tour" role="dialog" aria-modal="true" aria-label="איך זה עובד">
    <div class="hd"><span class="k">${i + 1} / ${steps.length}</span><button class="x" data-act="tourDone" aria-label="סגירה">${icon.x}</button></div>
    <div class="mono big" style="margin:8px auto 18px"><span>R</span></div>
    <h2 style="text-align:center">${esc(title)}</h2>
    ${paras.map((p) => `<p>${esc(p)}</p>`).join('')}
    <div class="tdots">${steps.map((_, j) => `<span class="${j === i ? 'on' : ''}"></span>`).join('')}</div>
    <div class="row2">
      <button class="btn quiet" data-act="tourBack" ${i === 0 ? 'disabled' : ''}>הקודם</button>
      ${last ? '<button class="btn gold" data-act="tourDone">סיום</button>' : '<button class="btn gold" data-act="tourNext">הבא</button>'}
    </div>
  </section></div>`;
}

function ritualsList() {
  const list = S.data.rituals || [];
  if (!list.length) return `<div class="sec"><h2>צווים קבועים</h2><span>טקסים שחוזרים לבד</span></div>
    <p class="empty">אין עדיין. בגזירה חדשה אפשר לבחור "כל יום" או "כל שבוע".</p>`;
  return `<div class="sec"><h2>צווים קבועים</h2><span>נוצרים לבד בכל יום</span></div>
    ${list.map((r) => `<div class="card${r.active ? '' : ' done'}" style="gap:6px">
      <div class="meta"><span class="sev ${r.severity}">${SEV[r.severity]}</span><span class="st">${r.active ? ritualWhen(r) : 'מושהה'}</span></div>
      <h3 style="text-decoration:none">${esc(r.title)}</h3>
      <div class="row2">
        <button class="btn quiet" data-act="ritToggle" data-id="${r.id}">${r.active ? 'השהי' : 'הפעילי שוב'}</button>
        <button class="btn red" data-act="ritDel" data-id="${r.id}">מחקי</button>
      </div>
    </div>`).join('')}`;
}

function redeemRequests(q) {
  const pend = (S.data.redeems || []).filter((r) => r.status === 'pending');
  if (!pend.length) return '';
  return pend.map((r) => `<div class="banner gold" style="flex-direction:column;align-items:stretch">
    <span>${q ? 'העבד מבקש להמיר' : 'ביקשת להמיר'} <strong>${r.cost} נקודות</strong>: ${esc(r.label)}</span>
    ${q ? `<div class="row2"><button class="btn gold" data-act="redeemOk" data-id="${r.id}">אשרי</button><button class="btn quiet" data-act="redeemNo" data-id="${r.id}">סרבי</button></div>` : '<span class="when">ממתין להחלטת המלכה…</span>'}
  </div>`).join('');
}

function slaveDecrees() {
  const { decrees, now, points } = S.data;
  const open = decrees.filter((d) => d.status === 'open' || d.status === 'overdue');
  const overdue = decrees.filter((d) => d.status === 'overdue');
  const upcoming = open.filter((d) => d.status === 'open' && d.deadline != null).sort((a, b) => a.deadline - b.deadline)[0];
  const reminded = decrees.find((d) => d.status !== 'done' && d.remindedAt && now - d.remindedAt < 24 * 3600 * 1000);
  const rest = decrees.filter((d) => d.status !== 'done' && !(d.status === 'open' || d.status === 'overdue'));
  const done = decrees.filter((d) => d.status === 'done');
  const hero = upcoming ? `
    <section class="hero">
      <span class="k">הצו הבא של המלכה</span>
      <h2>${esc(upcoming.title)}</h2>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
        <span class="when">${SEV[upcoming.severity]} · עד ${fmtWhen(upcoming.deadline)}</span>
        <span class="cd">${esc(span(upcoming.deadline - now))}</span>
      </div>
    </section>` : '';
  const banners = [
    reminded ? `<div class="banner">${icon.warn}<span>הודעה מהכס: <strong>${esc(reminded.title)}</strong>. המלכה שמה לב.</span></div>` : '',
    overdue.length && !reminded ? `<div class="banner">${icon.warn}<span>${overdue.length === 1 ? 'צו אחד באיחור' : overdue.length + ' צווים באיחור'}. כדאי לתקן לפני שהמלכה תגזור עונש.</span></div>` : ''
  ].join('');
  return `
    <div class="stats" style="grid-template-columns:repeat(2,minmax(0,1fr))">
      <div class="stat gold"><b>${points.total}</b><span>נקודות צייתנות</span></div>
      <div class="stat${overdue.length ? ' red' : ''}"><b>${open.length}</b><span>לביצוע</span></div>
    </div>
    ${reviewBanner()}
    ${slaveStatus()}
    ${hero}${banners}${checkinPrompts()}${redeemRequests(false)}
    <div class="row2" style="grid-template-columns:2fr 1fr">
      <button class="btn" data-act="offer" style="display:flex;align-items:center;justify-content:center;gap:8px">${icon.crown}הצעת שירות למלכה</button>
      <button class="btn quiet" data-act="ideas">✨ רעיונות</button>
    </div>
    ${offerRequests(false)}
    <div class="sec"><h2>מה עליך לבצע</h2><span>אין לך הרשאה לערוך צווים</span></div>
    ${open.length ? open.map((d) => card(d, false, now)).join('') : '<p class="empty">אין צווים פתוחים. כרגע.</p>'}
    ${rest.map((d) => card(d, false, now)).join('')}
    ${done.length ? `<div class="sec"><h2>בוצעו לאחרונה</h2><span>30 יום</span></div>${done.map((d) => card(d, false, now)).join('')}` : ''}`;
}

function redeemShop() {
  const items = S.data.redeemItems || {};
  const pending = (S.data.redeems || []).filter((r) => r.status === 'pending').reduce((a, r) => a + r.cost, 0);
  const avail = S.data.points.total - pending;
  return `<div class="sec"><h2>בקשת המרה</h2><span>זמין לך: ${avail}</span></div>
    ${Object.entries(items).map(([k, it]) => `<button class="cardrow" data-act="redeem" data-item="${k}" ${avail >= it.cost ? '' : 'disabled style="opacity:.45"'}>
      <span class="t" style="font-size:16px">${esc(it.label)}</span><span class="d">${it.cost} ♦</span></button>`).join('')}`;
}

function redeemHistory() {
  const done = (S.data.redeems || []).filter((r) => r.status !== 'pending');
  if (!done.length) return '';
  return `<div class="sec"><h2>המרות אחרונות</h2><span>30 יום</span></div><div class="ledger">${done.map((r) => `
    <div><span>${esc(r.label)}<small>${fmtWhen(r.decided)}</small></span><b class="${r.status === 'approved' ? 'plus' : 'minus'}">${r.status === 'approved' ? 'אושר' : 'סורב'}</b></div>`).join('')}</div>`;
}

function pointsView(q) {
  const { points } = S.data;
  const ledger = points.recent.length ? points.recent.map((p) => `
    <div><span>${esc(p.reason)}<small>${fmtWhen(p.created)}</small></span><b class="${p.delta >= 0 ? 'plus' : 'minus'}">${p.delta > 0 ? '+' : ''}${p.delta}</b></div>`).join('') : '<p class="empty">עוד אין תנועות.</p>';
  const quick = q ? `
    <div class="sec"><h2>שינוי מהיר</h2><span>מיד ביומן</span></div>
    <div class="row2">
      <button class="btn gold" data-act="pts" data-d="5" data-r="בונוס מהמלכה">5+ בונוס</button>
      <button class="btn gold" data-act="pts" data-d="10" data-r="מעבר לנדרש">10+ מעבר לנדרש</button>
      <button class="btn red" data-act="pts" data-d="-5" data-r="פנייה בלי &quot;המלכה&quot;">5− פנייה שגויה</button>
      <button class="btn red" data-act="pts" data-d="-15" data-r="ויכוח או אנחה">15− ויכוח</button>
    </div>
    <button class="btn quiet" data-act="ptsCustom">שינוי אחר…</button>` : '';
  return `
    <section class="hero" style="align-items:center;text-align:center">
      <span class="k">נקודות צייתנות</span>
      <span class="cd" style="font-size:52px">${points.total}</span>
      <span class="when">${q ? 'העבד מבקש להמיר — את מחליטה' : 'אפשר לבקש מהמלכה להמיר. היא רשאית לסרב.'}</span>
    </section>
    ${redeemRequests(q)}
    ${quick}
    ${q ? '' : redeemShop()}
    ${redeemHistory()}
    <div class="sec"><h2>יומן הנקודות</h2><span>20 האחרונות</span></div>
    <div class="ledger">${ledger}</div>`;
}

// ---------- cards (queen) ----------

async function loadCards() {
  const r = await api('/cards');
  if (r.cards) { S.cards = r; if (S.data) S.data.settings = r.settings; render(); }
}

function chipRow(items, current, act, attr) {
  return `<div class="chiprow">${items.map(([k, label, extra = '']) =>
    `<button class="chip${String(current) === String(k) ? ' on' : ''}${extra}" data-act="${act}" data-${attr}="${k}">${label}</button>`).join('')}</div>`;
}

function cardsView() {
  if (!S.cards) return '<p class="empty">פותחת את החפיסה…</p>';
  const st = S.data.settings;
  const decks = S.cards.decks;
  const inDeck = S.cards.cards.filter((c) => c.deck === S.deck);
  const usable = inDeck.filter((c) => c.enabled);
  const blocked = inDeck.length - usable.length;
  const pool = usable.filter((c) => !S.level || c.lvl === S.level);
  const locked = decks[S.deck].gated && !st.homeFree;
  const drawn = S.drawn ? S.cards.cards.find((c) => c.id === S.drawn) : null;
  const deckChips = chipRow(DECK_ORDER.map((k) => [k, DECK_LABEL[k], decks[k].gated ? ' gated' : '']), S.deck, 'deck', 'deck');
  const lvlChips = chipRow([[0, 'הכול'], [1, '◆'], [2, '◆◆'], [3, '◆◆◆']], S.level, 'level', 'level');
  let stage;
  if (locked) {
    stage = `<div class="bigcard red"><div class="mid">${icon.lock}<h2>החפיסה נעולה</h2><p>נפתחת רק כשמסומן "הבית פנוי".</p></div></div>`;
  } else if (drawn) {
    const home = drawn.needsHome && !st.homeFree;
    stage = `<div class="bigcard${decks[drawn.deck].gated ? ' red' : ''}">
      <div class="top2"><span>${DECK_LABEL[drawn.deck]} · ${dots(drawn.lvl)}</span><span class="glyph">R</span></div>
      <div class="mid"><h2>${esc(drawn.title)}</h2><p>${esc(drawn.text)}</p></div>
      ${drawn.deck === 'pain' ? '<p class="fine">ישבן וירכיים בלבד · סולם 1–10 · אפטרקר בסיום</p>' : ''}
      ${home ? '<p class="fine">הקלף הזה רק כשהבית פנוי</p>' : ''}
    </div>`;
  } else {
    stage = `<div class="bigcard"><div class="mid"><div class="mono big"><span>R</span></div><p>${pool.length} קלפים בחפיסת ${DECK_LABEL[S.deck]}</p></div></div>`;
  }
  const list = locked ? '' : pool.map((c) => `
    <button class="cardrow${c.id === S.drawn ? ' on' : ''}" data-act="pick" data-card="${c.id}">
      <span class="t">${esc(c.title)}${c.custom ? ' <em>שלך</em>' : ''}${c.needsHome && !decks[c.deck].gated ? ' <em>בית פנוי</em>' : ''}</span>
      <span class="d">${dots(c.lvl)}</span>
      <span class="x2">${esc(c.text)}</span>
    </button>`).join('');
  return `
    <div class="homebar">
      <button class="btn ${st.homeFree ? 'gold' : 'quiet'}" data-act="home" aria-pressed="${st.homeFree}">${icon.home} ${st.homeFree ? 'הבית פנוי' : 'הבית לא פנוי'}</button>
      <button class="btn quiet" data-act="ideas">✨ רעיונות</button>
      <button class="btn quiet" data-act="newCard">+ קלף</button>
    </div>
    ${deckChips}
    <div style="display:flex;align-items:center;gap:8px"><span class="when" style="flex:none">עוצמה</span>${lvlChips}</div>
    ${stage}
    ${locked ? '' : `<div class="row2">
      <button class="btn blood" data-act="draw" ${pool.length ? '' : 'disabled'}>שלפי קלף</button>
      <button class="btn" data-act="sendCard" ${drawn && !st.paused ? '' : 'disabled'}>הענקי לעבד</button>
    </div>`}
    <div class="sec"><h2>כל הקלפים בחפיסה</h2><span>${blocked ? `${blocked} פסולים או ממתינים — ב"חוקים"` : 'כולם מאושרים'}</span></div>
    ${list || (locked ? '' : '<p class="empty">אין קלפים בעוצמה הזאת.</p>')}`;
}

// ---------- rules, limits, notifications (both) ----------

const GUIDE = [
  ['קודם כול: זה כלי, לא אנחנו', ['האפליקציה היא כלי עזר. הקשר קורה בינינו — במבט, במגע, בשיחה — לא על המסך.', 'מותר לכבות אותה לימים. אם היא מרגישה כמו חובה או מקור לריב — מניחים אותה בצד ומדברים.']],
  ['העיקרון', ['המלכה גוזרת. העבד מבצע ומגיש. רק המלכה מאשרת.', 'לעבד אין הרשאה לערוך, לדחות או למחוק צו.']],
  ['פרוטוקול', ['כשהפרוטוקול פעיל — פונים אליה רק "המלכה".', 'בכניסתה הביתה: לכרוע, להוריד נעליים, לנשק את כפות רגליה ולשאול "מה רצונך, המלכה?"', 'כל ערב: דיווח בכתב — מה בוצע, איפה נכשלת, איזה עונש מגיע לך.', 'שום החלטה קטנה בלי רשותה. הסמל שאתה עונד יורד רק בידיה.']],
  ['נקודות צייתנות', ['בקשה 5+, פקודה 10+, צו מלכותי 20+. באיחור — חצי. מעבר לנדרש — בונוס.', 'פנייה בלי "המלכה" 5−. ויכוח, אנחה או גלגול עיניים 15−.', 'עונשים ופרסים לא שווים נקודות.', 'המרה בבקשה בלבד, והמלכה רשאית לסרב: 30 — לשבת לידה, 50 — לבחור מה תלבש מחר, 80 — ערב בלי פרוטוקול, 150 — ערב פינוק בתנאיה.']],
  ['קלפים', ['עונש: על איחור, "לא מספיק טוב", או שלוש הפרות ביום. פרס: שבוע בלי איחור, או כשהמלכה רוצה.', 'השפלה, ריסון וחושים, כאב ומים — ועוד כמה קלפים מסומנים — רק כשהבית פנוי.', 'עונש מבוצע עד סוף הערב או במועד שהמלכה קובעת, ואחרי שבוצע — נמחק. לא סוחבים חובות.']],
  ['גבולות', ['כל אחד מכם יכול לפסול כל קלף, בכל רגע, בלי להסביר. קלף פסול לא נשלף.', 'קלפים מסומנים "ירוק" — וכל חפיסת המים — נעולים עד ששניכם מאשרים.']],
  ['כאב', ['מכות: ישבן, ירכיים וכפות ידיים בלבד. לעולם לא כליות, עמוד שדרה, מפרקים או ראש.', 'מתחילים חלש. סולם 1–10: המלכה שואלת, העבד עונה, המלכה מחליטה.', 'שעווה רק מנר עיסוי מסויה. אטבים עד 20 דקות. פנים וצוואר — אף פעם לא חוסמים נשימה.', 'אחרי כל ◆◆◆: אפטרקר — 15 דקות של קרבה, מים ומילים טובות.']],
  ['מים ויריקות', ['רק במקלחת. לא בפנים, לא בעיניים, לא שותים. שוטפים מיד.', 'פצע קור, הצטננות או דלקת — החפיסה סגורה.']],
  ['מילת ביטחון', ['"צהוב" — להאט. "אדום" — עוצרים הכול, מיד.', 'כפתור ההפוגה למעלה עוצר את הכול באפליקציה — לכל אחד מכם, בכל רגע. מי שעוצר לא נענש.']],
  ['דיסקרטיות', ['שום פרוטוקול ליד הילדים או לעיני אחרים. ההתראות בטלפון תמיד ניטרליות: "יש עדכון חדש".']]
];

function voteLabel(v, green) {
  if (v === 1) return '<b class="ok">מאשר</b>';
  if (v === 0) return '<b class="no">פוסל</b>';
  return green ? '<b class="wait">עוד לא אישר</b>' : '<b class="ok">לא פסל</b>';
}

function limitsView(q) {
  const me = S.me.role, them = q ? 'slave' : 'queen';
  const themName = q ? 'העבד' : 'המלכה';
  const pushTxt = S.pushState === 'on' ? 'התראות פעילות במכשיר הזה.'
    : S.pushState === 'denied' ? 'ההתראות חסומות בהגדרות הטלפון. צריך לאפשר אותן שם.'
    : S.pushState === 'ios' ? 'באייפון, התראות עובדות רק אחרי "הוספה למסך הבית" ופתיחה משם.'
    : S.pushState === 'unsupported' ? 'הדפדפן הזה לא תומך בהתראות.'
    : 'קבלו התראה ניטרלית ("יש עדכון חדש") על צו חדש, הגשה, אישור, תזכורת ומועד שמתקרב.';
  const guide = GUIDE.map(([t, items], i) => `<details class="guide"${i === 0 ? ' open' : ''}><summary>${t}</summary>${items.map((x) => `<p>${esc(x)}</p>`).join('')}</details>`).join('');
  let limits = '<p class="empty">טוען…</p>';
  if (S.cards) {
    const rows = S.cards.cards.filter((c) => c.deck === S.limDeck).map((c) => {
      const mine = c.votes[me], theirs = c.votes[them];
      return `<div class="limrow${c.enabled ? '' : ' off'}">
        <div class="lt"><span class="t">${esc(c.title)}</span><span class="d">${dots(c.lvl)}${c.green ? ' · ירוק נדרש' : ''}${c.custom ? ' · של המלכה' : ''}</span></div>
        <p>${esc(c.text)}</p>
        <div class="lv">
          <div class="mine">
            <button class="vote${mine === 1 ? ' yes' : ''}" data-act="vote" data-card="${c.id}" data-v="1" aria-pressed="${mine === 1}">✓ מאשר</button>
            <button class="vote${mine === 0 ? ' no' : ''}" data-act="vote" data-card="${c.id}" data-v="0" aria-pressed="${mine === 0}">✗ פוסל</button>
          </div>
          <span class="them">${themName}: ${c.theirsHidden ? '<b class="wait">יוצג כששניכם תסיימו</b>' : voteLabel(theirs, c.green)}</span>
        </div>
        ${q && c.custom ? `<button class="link" data-act="delCard" data-card="${c.id}">מחיקת הקלף</button>` : ''}
      </div>`;
    }).join('');
    limits = chipRow(DECK_ORDER.map((k) => [k, DECK_LABEL[k]]), S.limDeck, 'limDeck', 'deck') + rows;
  }
  return `
    <section class="hero">
      <span class="k">התראות</span>
      <span class="when">${pushTxt}</span>
      ${S.pushState === 'on' ? '<button class="btn quiet" data-act="pushTest">שליחת התראת בדיקה</button>' : S.pushState === 'denied' || S.pushState === 'unsupported' ? '' : '<button class="btn gold" data-act="pushOn">הפעלת התראות</button>'}
    </section>
    ${reviewResults()}
    <button class="btn" data-act="tour">איך האפליקציה עובדת?</button>
    <button class="btn quiet" data-act="checkIdeas" ${S.keyCheck === '…' ? 'disabled' : ''}>בדיקת חיבור לרעיונות</button>
    ${S.keyCheck && S.keyCheck !== '…' ? `<div class="banner${S.keyCheck.startsWith('✓') ? ' gold' : ''}"><span>${esc(S.keyCheck)}</span></div>` : ''}
    <div class="sec"><h2>צ'ק־אינים</h2><span>אחרי כל ◆◆◆</span></div>
    ${checkinResults()}
    <div class="sec"><h2>ספר החוקים</h2><span>לשניכם</span></div>
    ${guide}
    <div class="sec"><h2>הגבולות שלי</h2><span>קלף שאחד מכם פוסל — לא נשלף</span></div>
    ${limits}`;
}

// ---------- push ----------

function pushSupport() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    return ios && !navigator.standalone ? 'ios' : 'unsupported';
  }
  if (Notification.permission === 'denied') return 'denied';
  return 'ok';
}

async function checkPush() {
  const s = pushSupport();
  if (s !== 'ok') { S.pushState = s; return; }
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    S.pushState = sub && Notification.permission === 'granted' ? 'on' : '';
    if (sub && S.token) api('/push/subscribe', { method: 'POST', body: { endpoint: sub.endpoint } });
  } catch { S.pushState = ''; }
}

function keyBytes(b64) {
  const s = b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4);
  return Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
}

async function enablePush() {
  const s = pushSupport();
  if (s !== 'ok') { S.pushState = s; return render(); }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { S.pushState = perm === 'denied' ? 'denied' : ''; return render(); }
  const k = await api('/push/key');
  if (!k.key) return toast('לא הצלחתי להפעיל. נסו שוב.');
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(k.key) });
    const r = await api('/push/subscribe', { method: 'POST', body: { endpoint: sub.endpoint } });
    if (r.error) return toast('לא הצלחתי להפעיל. נסו שוב.');
    S.pushState = 'on'; toast('ההתראות הופעלו');
  } catch {
    toast('לא הצלחתי להפעיל. נסו שוב.');
  }
}

// ---------- sheets ----------

function deadlineFrom(when) {
  const n = new Date();
  if (when === 'now') return Date.now() + 3600 * 1000;
  if (when === 'tonight') { n.setHours(23, 30, 0, 0); return Math.max(n.getTime(), Date.now() + 3600 * 1000); }
  if (when === 'tomorrow') { n.setDate(n.getDate() + 1); n.setHours(20, 0, 0, 0); return n.getTime(); }
  return null;
}

function defaultDeadline() {
  const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(20, 0, 0, 0);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T20:00`;
}

function sheetView() {
  const s = S.sheet;
  const close = `<button class="x" data-act="close" aria-label="סגירה">${icon.x}</button>`;
  if (s.type === 'pts') return customPointsSheet();
  if (s.type === 'tour') return tourSheet();
  if (s.type === 'ideas') return ideasSheet(close);
  if (s.type === 'offer') {
    return `<div class="sheetwrap" data-act="backdrop"><section class="sheet" role="dialog" aria-modal="true" aria-label="הצעת שירות">
      <div class="hd"><h2>הצעת שירות</h2>${close}</div>
      <p class="when">מה תרצה לעשות בשביל המלכה? היא תחליט אם זה הופך לצו.</p>
      <div class="field"><label for="o-title">השירות</label><input id="o-title" maxlength="200" placeholder="למשל: אמבט רגליים הערב"></div>
      <div class="field"><label for="o-note">פרטים (לא חובה)</label><textarea id="o-note" maxlength="1000" placeholder="מתי, איך…"></textarea></div>
      <button class="btn blood" data-act="doOffer">הגש למלכה</button>
      <button class="link" data-act="ideas" style="text-align:center">אין רעיון? ✨ רעיונות לשירות</button>
    </section></div>`;
  }
  if (s.type === 'offerYes') {
    const o = (S.data.offers || []).find((x) => x.id === s.id);
    if (!o) return '';
    const sev = Object.keys(SEV).map((k) => `<button class="chip${s.severity === k ? ' on' : ''}" data-act="oSev" data-sev="${k}">${SEV[k]}</button>`).join('');
    const opts = [['none', 'בלי מועד'], ['now', 'תוך שעה'], ['tonight', 'עד הלילה'], ['tomorrow', 'עד מחר בערב']];
    return `<div class="sheetwrap" data-act="backdrop"><section class="sheet" role="dialog" aria-modal="true" aria-label="הפיכה לצו">
      <div class="hd"><h2>הפכי לצו</h2>${close}</div>
      <p class="quote">${esc(o.title)}${o.note ? ` — ${esc(o.note)}` : ''}</p>
      <div class="field"><span class="lbl">חומרה</span><div class="chips">${sev}</div></div>
      <div class="field"><span class="lbl">עד מתי</span><div class="chips" style="grid-template-columns:repeat(2,minmax(0,1fr))">${opts.map(([k, l]) => `<button class="chip${s.when === k ? ' on' : ''}" data-act="oWhen" data-w="${k}">${l}</button>`).join('')}</div></div>
      <button class="btn blood" data-act="doOfferYes">חתמי וגזרי</button>
    </section></div>`;
  }
  if (s.type === 'checkin') {
    const c = (S.data.checkins || []).find((x) => x.id === s.id);
    if (!c) return '';
    return `<div class="sheetwrap" data-act="backdrop"><section class="sheet" role="dialog" aria-modal="true" aria-label="צ'ק־אין">
      <div class="hd"><h2>צ'ק־אין</h2>${close}</div>
      <p class="quote">${esc(c.title)}</p>
      <div class="field"><span class="lbl">איך היה בשבילך?</span><div class="chips" style="grid-template-columns:repeat(5,minmax(0,1fr))">${[1, 2, 3, 4, 5].map((n) => `<button class="chip${s.score === n ? ' on' : ''}" data-act="ciScore" data-n="${n}" aria-label="${n} מתוך 5">${n}</button>`).join('')}</div>
        <span class="when">1 — לא טוב לי · 5 — מושלם</span></div>
      <div class="field"><label for="ci-note">מה לשמור, מה לשנות (לא חובה)</label><textarea id="ci-note" maxlength="500" placeholder="יותר חזק, פחות זמן, לא את זה שוב…"></textarea></div>
      <button class="btn blood" data-act="doCheckin" ${s.score ? '' : 'disabled'}>שליחה</button>
    </section></div>`;
  }
  if (s.type === 'send') {
    const c = S.cards?.cards.find((x) => x.id === s.card);
    if (!c) return '';
    const opts = [['none', 'בלי מועד'], ['now', 'תוך שעה'], ['tonight', 'עד הלילה'], ['tomorrow', 'עד מחר בערב']];
    return `<div class="sheetwrap" data-act="backdrop"><section class="sheet" role="dialog" aria-modal="true" aria-label="הענקת קלף">
      <div class="hd"><h2>${c.deck === 'reward' ? 'הענקת פרס' : 'גזירת קלף'}</h2>${close}</div>
      <p class="quote">${esc(c.title)} — ${esc(c.text)}</p>
      <div class="field"><span class="lbl">עד מתי</span><div class="chips" style="grid-template-columns:repeat(2,minmax(0,1fr))">${opts.map(([k, l]) => `<button class="chip${s.when === k ? ' on' : ''}" data-act="sendWhen" data-w="${k}">${l}</button>`).join('')}</div></div>
      <button class="btn blood" data-act="doSend">${c.deck === 'reward' ? 'הענקי' : 'חתמי וגזרי'}</button>
    </section></div>`;
  }
  if (s.type === 'newcard') {
    const dc = S.cardDraft;
    return `<div class="sheetwrap" data-act="backdrop"><section class="sheet" role="dialog" aria-modal="true" aria-label="קלף חדש">
      <div class="hd"><h2>קלף חדש מהמלכה</h2>${close}</div>
      <div class="field"><label for="c-title">שם הקלף</label><input id="c-title" maxlength="80" value="${esc(dc.title)}" placeholder="למשל: כריעת הבוקר"></div>
      <div class="field"><label for="c-text">מה העבד צריך לעשות</label><textarea id="c-text" maxlength="500" placeholder="בדיוק, כולל כמה זמן ואיך…">${esc(dc.text)}</textarea></div>
      <div class="field"><span class="lbl">חפיסה</span><div class="chips">${DECK_ORDER.map((k) => `<button class="chip${dc.deck === k ? ' on' : ''}" data-act="cdDeck" data-deck="${k}">${DECK_LABEL[k]}</button>`).join('')}</div></div>
      <div class="field"><span class="lbl">עוצמה</span><div class="chips">${[1, 2, 3].map((n) => `<button class="chip${dc.lvl === n ? ' on' : ''}" data-act="cdLvl" data-lvl="${n}">${['קל', 'בינוני', 'חזק'][n - 1]}</button>`).join('')}</div></div>
      <p class="when">העבד יכול לפסול כל קלף במסך "חוקים".</p>
      <button class="btn blood" data-act="saveCard">הוסיפי לחפיסה</button>
    </section></div>`;
  }
  if (s.type === 'new') {
    const chips = Object.keys(SEV).map((k) => `<button class="chip${S.draft.severity === k ? ' on' : ''}" data-act="sev" data-sev="${k}">${SEV[k]}</button>`).join('');
    return `<div class="sheetwrap" data-act="backdrop"><section class="sheet" role="dialog" aria-modal="true" aria-label="גזירה חדשה">
      <div class="hd"><h2>גזירה חדשה</h2>${close}</div>
      <div class="field"><label for="f-title">המשימה</label><input id="f-title" maxlength="200" value="${esc(S.draft.title)}" placeholder="מה ירצה הכתר?"></div>
      <div class="field"><span class="lbl">כמה פעמים</span><div class="chips">${[['once', 'פעם אחת'], ['daily', 'כל יום'], ['weekly', 'כל שבוע']].map(([k, l]) => `<button class="chip${S.draft.freq === k ? ' on' : ''}" data-act="freq" data-f="${k}">${l}</button>`).join('')}</div></div>
      ${S.draft.freq === 'once'
        ? `<div class="field"><label for="f-dl">עד מתי</label><input id="f-dl" type="datetime-local" value="${esc(S.draft.deadline)}"></div>`
        : `${S.draft.freq === 'weekly' ? `<div class="field"><span class="lbl">באיזה יום</span><div class="chips" style="grid-template-columns:repeat(7,minmax(0,1fr))">${WD_SHORT.map((w, i) => `<button class="chip${S.draft.weekday === i ? ' on' : ''}" data-act="wd" data-wd="${i}" aria-label="יום ${WEEKDAYS[i]}">${w}</button>`).join('')}</div></div>` : ''}
           <div class="field"><label for="f-time">עד איזו שעה</label><input id="f-time" type="time" value="${esc(S.draft.time)}"></div>
           <div class="field"><span class="lbl">טקסים מוצעים</span><div class="chiprow">${RITUAL_PRESETS.map((x, i) => `<button class="chip" data-act="preset" data-i="${i}">${esc(x.title)}</button>`).join('')}</div></div>
           <p class="when">הצו ייווצר לבד בכל ${S.draft.freq === 'daily' ? 'יום' : 'שבוע'}, והעבד יקבל התראה.</p>`}
      <div class="field"><span class="lbl">חומרת הצו</span><div class="chips">${chips}</div></div>
      <div class="field"><label for="f-note">הוראות לעבד (לא חובה)</label><textarea id="f-note" maxlength="1000" placeholder="איך בדיוק זה ייעשה…">${esc(S.draft.note)}</textarea></div>
      <button class="btn blood" data-act="create">חתמי וגזרי</button>
      <button class="link" data-act="ideas" style="text-align:center">אין רעיון? ✨ רעיונות</button>
    </section></div>`;
  }
  const d = S.data.decrees.find((x) => x.id === s.id);
  if (!d) return '';
  if (s.type === 'submit') {
    return `<div class="sheetwrap" data-act="backdrop"><section class="sheet" role="dialog" aria-modal="true" aria-label="הגשה">
      <div class="hd"><h2>הגשה למלכה</h2>${close}</div>
      <p class="quote">${esc(d.title)}</p>
      <div class="field"><label for="f-rep">דיווח (לא חובה)</label><textarea id="f-rep" maxlength="1000" placeholder="מה בדיוק עשית…"></textarea></div>
      <button class="btn blood" data-act="doSubmit" data-id="${d.id}">הגש לאישורה</button>
    </section></div>`;
  }
  if (s.type === 'approve') {
    const b = s.bonus || 0;
    const chips = [0, 5, 10].map((n) => `<button class="chip${b === n ? ' on' : ''}" data-act="bonus" data-b="${n}">${n ? n + '+ בונוס' : 'בלי בונוס'}</button>`).join('');
    return `<div class="sheetwrap" data-act="backdrop"><section class="sheet" role="dialog" aria-modal="true" aria-label="אישור">
      <div class="hd"><h2>אישור ביצוע</h2>${close}</div>
      <p class="quote">${esc(d.title)}</p>
      ${d.report ? `<p class="quote">דיווח העבד: ${esc(d.report)}</p>` : ''}
      <div class="field"><span class="lbl">מעבר לנדרש?</span><div class="chips">${chips}</div></div>
      <button class="btn gold" style="min-height:52px;font-size:18px" data-act="doApprove" data-id="${d.id}">אשרי ביצוע</button>
    </section></div>`;
  }
  if (s.type === 'reject') {
    return `<div class="sheetwrap" data-act="backdrop"><section class="sheet" role="dialog" aria-modal="true" aria-label="דחייה">
      <div class="hd"><h2>לא מספיק טוב</h2>${close}</div>
      <p class="quote">${esc(d.title)}</p>
      <div class="field"><label for="f-why">מה לא היה טוב?</label><textarea id="f-why" maxlength="500" placeholder="הצו חוזר לביצוע…"></textarea></div>
      <div class="row2"><button class="btn" data-act="doReject" data-id="${d.id}">החזירי לביצוע</button>
        <button class="btn blood" style="font-size:16px" data-act="doReject" data-punish="1" data-id="${d.id}">החזירי + עונש</button></div>
    </section></div>`;
  }
  return '';
}

function customPointsSheet() {
  return `<div class="sheetwrap" data-act="backdrop"><section class="sheet" role="dialog" aria-modal="true" aria-label="שינוי נקודות">
    <div class="hd"><h2>שינוי נקודות</h2><button class="x" data-act="close" aria-label="סגירה">${icon.x}</button></div>
    <div class="field"><label for="f-delta">כמה (מספר שלילי מוריד)</label><input id="f-delta" type="number" inputmode="numeric" placeholder="למשל 20 או -10"></div>
    <div class="field"><label for="f-reason">סיבה</label><input id="f-reason" maxlength="200" placeholder="על מה?"></div>
    <button class="btn blood" data-act="doPts">רשמי ביומן</button>
  </section></div>`;
}

function toast(msg) {
  S.toast = msg; render();
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { S.toast = ''; render(); }, 2200);
}

// Keep what the queen typed when the sheet re-renders.
function keepDraft() {
  if (S.sheet && S.sheet.type === 'newcard') {
    const t = document.getElementById('c-title'), x = document.getElementById('c-text');
    if (t) S.cardDraft.title = t.value;
    if (x) S.cardDraft.text = x.value;
    return;
  }
  if (!S.sheet || S.sheet.type !== 'new') return;
  const t = document.getElementById('f-title'), dl = document.getElementById('f-dl'), n = document.getElementById('f-note');
  if (t) S.draft.title = t.value;
  if (dl) S.draft.deadline = dl.value;
  if (n) S.draft.note = n.value;
  const tm = document.getElementById('f-time');
  if (tm) S.draft.time = tm.value;
}

const RITUAL_PRESETS = [
  { title: 'בוקר טוב, המלכה', note: 'בהודעה או בנשיקה.', freq: 'daily', time: '08:00', severity: 'request' },
  { title: 'קפה למיטה', note: 'כמו שהיא אוהבת.', freq: 'daily', time: '07:30', severity: 'command' },
  { title: 'מים ליד המיטה', note: '', freq: 'daily', time: '22:30', severity: 'request' },
  { title: 'דיווח ערב', note: 'מה בוצע, איפה נכשלת, איזה עונש מגיע לך.', freq: 'daily', time: '22:00', severity: 'command' },
  { title: 'עיסוי רגליים', note: '20 דקות.', freq: 'weekly', weekday: 2, time: '21:00', severity: 'command' },
  { title: 'פרחים או הפתעה קטנה', note: 'עד 20 ש"ח.', freq: 'weekly', weekday: 4, time: '20:00', severity: 'command' },
  { title: 'הבית מסודר לשבת', note: '', freq: 'weekly', weekday: 5, time: '14:00', severity: 'royal' },
  { title: 'קניות לשבוע', note: 'לפי הרשימה שהמלכה אישרה.', freq: 'weekly', weekday: 0, time: '20:00', severity: 'command' }
];

async function act(r, okMsg) {
  if (r.error) { toast(r.error === 'network' ? 'אין חיבור. נסו שוב.' : 'הפעולה לא הצליחה.'); return false; }
  S.data = r; S.sheet = null; if (okMsg) toast(okMsg); else render();
  return true;
}

// ---------- events ----------

app.addEventListener('click', async (e) => {
  const k = e.target.closest('[data-k]');
  if (k && !S.token) return pinKey(k.dataset.k);

  const el = e.target.closest('[data-act]');
  if (!el) return;
  const a = el.dataset.act;
  if (a === 'backdrop' && e.target !== el) return;
  const id = el.dataset.id ? Number(el.dataset.id) : null;

  switch (a) {
    case 'lock': return lock();
    case 'tab':
      S.tab = el.dataset.tab; window.scrollTo(0, 0); render();
      if (S.tab === 'cards' || S.tab === 'limits') loadCards();
      if (S.tab === 'limits') { await checkPush(); render(); }
      return;
    case 'pause': case 'unpause': {
      const r = await api('/settings', { method: 'POST', body: { paused: a === 'pause' } });
      if (r.error) return toast('לא הצליח. נסו שוב.');
      S.data = r; return toast(a === 'pause' ? 'הפוגה. הכול מוקפא.' : 'חוזרים');
    }
    case 'home': {
      const r = await api('/settings', { method: 'POST', body: { homeFree: !S.data.settings.homeFree } });
      if (r.error) return toast('לא הצליח.');
      S.data = r; S.drawn = null; return render();
    }
    case 'deck': S.deck = el.dataset.deck; S.drawn = null; return render();
    case 'level': S.level = Number(el.dataset.level); S.drawn = null; return render();
    case 'pick': S.drawn = el.dataset.card; render(); return window.scrollTo({ top: 0, behavior: 'smooth' });
    case 'draw': {
      const pool = S.cards.cards.filter((c) => c.deck === S.deck && c.enabled && (!S.level || c.lvl === S.level));
      if (!pool.length) return;
      let c = pool[Math.floor(Math.random() * pool.length)];
      if (pool.length > 1 && c.id === S.drawn) c = pool[(pool.indexOf(c) + 1) % pool.length];
      S.drawn = c.id; return render();
    }
    case 'sendCard': if (!S.drawn) return; S.sheet = { type: 'send', card: S.drawn, when: S.deck === 'reward' ? 'none' : 'tonight' }; return render();
    case 'sendWhen': S.sheet.when = el.dataset.w; return render();
    case 'doSend': {
      const dl = deadlineFrom(S.sheet.when);
      el.disabled = true;
      const r = await api(`/cards/${S.sheet.card}/send`, { method: 'POST', body: { deadline: dl } });
      if (r.error) {
        S.sheet = null;
        return toast(r.error === 'paused' ? 'הפוגה פעילה.' : r.error === 'house not free' ? 'הקלף הזה רק כשהבית פנוי.' : r.error === 'card not allowed' ? 'הקלף נפסל.' : 'לא הצליח. נסו שוב.');
      }
      S.drawn = null; S.tab = 'decrees';
      return act(r, 'נגזר. העבד יקבל התראה.');
    }
    case 'newCard': S.cardDraft = { title: '', text: '', deck: S.deck, lvl: 2 }; S.sheet = { type: 'newcard' }; render(); return document.getElementById('c-title')?.focus();
    case 'cdDeck': keepDraft(); S.cardDraft.deck = el.dataset.deck; return render();
    case 'cdLvl': keepDraft(); S.cardDraft.lvl = Number(el.dataset.lvl); return render();
    case 'saveCard': {
      keepDraft();
      if (!S.cardDraft.title.trim()) return document.getElementById('c-title')?.focus();
      el.disabled = true;
      const r = await api('/cards', { method: 'POST', body: S.cardDraft });
      if (r.error) return toast('לא הצליח. נסו שוב.');
      S.cards = r; S.sheet = null; S.deck = S.cardDraft.deck; S.level = 0;
      const mine = r.cards.filter((c) => c.custom).pop(); S.drawn = mine ? mine.id : null;
      return toast('הקלף נוסף לחפיסה');
    }
    case 'delCard': {
      if (!confirm('למחוק את הקלף?')) return;
      const r = await api(`/cards/${el.dataset.card}`, { method: 'DELETE' });
      if (r.cards) { S.cards = r; render(); }
      return;
    }
    case 'limDeck': S.limDeck = el.dataset.deck; return render();
    case 'vote': {
      const c = S.cards.cards.find((x) => x.id === el.dataset.card);
      const v = Number(el.dataset.v);
      const ok = c.votes[S.me.role] === v ? null : v === 1;
      const r = await api(`/cards/${c.id}/vote`, { method: 'POST', body: { ok } });
      if (r.cards) { S.cards = r; render(); } else toast('לא נשמר. נסו שוב.');
      return;
    }
    case 'pushOn': return enablePush().then(render);
    case 'mood': { const r = await api('/settings', { method: 'POST', body: { mood: el.dataset.m } }); return act(r, el.dataset.m === 'waiting' ? 'העבד קיבל התראה' : null); }
    case 'protocol': {
      const r = await api('/settings', { method: 'POST', body: { protocol: !S.data.settings.protocol } });
      if (r.error === 'paused') return toast('הפוגה פעילה.');
      return act(r, S.data.settings.protocol ? 'הפרוטוקול כבוי' : 'הפרוטוקול פעיל. העבד קיבל התראה.');
    }
    case 'plevel': { const r = await api('/settings', { method: 'POST', body: { protocolLevel: Number(el.dataset.l) } }); return act(r); }
    case 'dismissSummary': { const r = await api('/settings', { method: 'POST', body: { dismissSummary: true } }); return act(r); }
    case 'offer': S.sheet = { type: 'offer' }; render(); return document.getElementById('o-title')?.focus();
    case 'doOffer': {
      const title = document.getElementById('o-title')?.value.trim();
      if (!title) return document.getElementById('o-title')?.focus();
      el.disabled = true;
      const r = await api('/offers', { method: 'POST', body: { title, note: document.getElementById('o-note')?.value || '' } });
      return act(r, 'ההצעה נשלחה למלכה');
    }
    case 'offerYes': S.sheet = { type: 'offerYes', id, severity: 'command', when: 'tonight' }; return render();
    case 'oSev': S.sheet.severity = el.dataset.sev; return render();
    case 'oWhen': S.sheet.when = el.dataset.w; return render();
    case 'doOfferYes': {
      el.disabled = true;
      const r = await api(`/offers/${S.sheet.id}/accept`, { method: 'POST', body: { severity: S.sheet.severity, deadline: deadlineFrom(S.sheet.when) } });
      if (r.error === 'paused') { S.sheet = null; return toast('הפוגה פעילה.'); }
      return act(r, 'נגזר');
    }
    case 'offerNo': { const r = await api(`/offers/${id}/decline`, { method: 'POST' }); return act(r); }
    case 'punish': {
      const d = S.data.decrees.find((x) => x.id === id);
      el.disabled = true;
      const r = await api('/punish', { method: 'POST', body: { because: d ? d.title : '', deadline: deadlineFrom('tonight') } });
      if (r.error) return toast(r.error === 'paused' ? 'הפוגה פעילה.' : r.error === 'no cards' ? 'אין קלפי עונש מאושרים.' : 'לא הצליח.');
      return act(r, `נשלף: ${r.punished.title}`);
    }
    case 'checkin': S.sheet = { type: 'checkin', id, score: 0 }; return render();
    case 'ciScore': { const note = document.getElementById('ci-note')?.value || ''; S.sheet.score = Number(el.dataset.n); render(); const t = document.getElementById('ci-note'); if (t) t.value = note; return; }
    case 'doCheckin': {
      el.disabled = true;
      const r = await api(`/checkins/${S.sheet.id}`, { method: 'POST', body: { score: S.sheet.score, note: document.getElementById('ci-note')?.value || '' } });
      return act(r, 'תודה. נשמר.');
    }
    case 'tour': S.sheet = { type: 'tour', i: 0 }; return render();
    case 'tourNext': S.sheet.i++; return render();
    case 'tourBack': S.sheet.i = Math.max(0, S.sheet.i - 1); return render();
    case 'tourDone': try { localStorage.setItem('lulu_tour_' + S.me.role, '1'); } catch {} S.sheet = null; return render();
    case 'ideas': {
      keepDraft();
      S.ideas = S.ideas || { vibe: 'playful', deck: '', lvl: 2, wish: '', list: null, loading: false, error: '' };
      S.sheet = { type: 'ideas' }; return render();
    }
    case 'ideaVibe': case 'ideaDeck': case 'ideaLvl': {
      const w = document.getElementById('i-wish'); if (w) S.ideas.wish = w.value;
      if (a === 'ideaVibe') S.ideas.vibe = el.dataset.v;
      if (a === 'ideaDeck') S.ideas.deck = el.dataset.v;
      if (a === 'ideaLvl') S.ideas.lvl = Number(el.dataset.v);
      return render();
    }
    case 'ideaGo': return askIdeas();
    case 'ideaOffer': {
      const x = S.ideas.list[Number(el.dataset.i)];
      S.sheet = { type: 'offer' }; render();
      const t = document.getElementById('o-title'), n = document.getElementById('o-note');
      if (t) t.value = x.title;
      if (n) n.value = x.text;
      return;
    }
    case 'checkIdeas': {
      S.keyCheck = '…'; render();
      const r = await api('/ideas/check', { method: 'POST' });
      const why = {
        missing: 'המפתח לא נמצא. צריך להוסיף ב־Cloudflare משתנה מסוג Secret בשם ANTHROPIC_API_KEY ולעשות Deploy.',
        'bad key': 'Anthropic דחו את המפתח (401). כנראה הוא לא מפתח API תקין — צריך מפתח שמתחיל ב־sk-ant-api.',
        forbidden: 'למפתח אין הרשאה (403). כדאי לבדוק את הגדרות החשבון ב־console.anthropic.com.',
        model: 'המודל לא זמין לחשבון הזה (404).',
        rate: 'יותר מדי בקשות כרגע (429). נסו שוב בעוד דקה.',
        credit: 'אין יתרה בחשבון. צריך להטעין ב־console.anthropic.com ← Billing.',
        network: 'לא הצלחתי להגיע ל־Anthropic. נסו שוב.'
      };
      S.keyCheck = r.ok ? '✓ החיבור עובד. הרעיונות מוכנים.' : r.error ? 'הבדיקה לא הצליחה. נסו שוב.' : (why[r.reason] || `שגיאה ${r.status || ''}: ${r.message || ''}`);
      return render();
    }
    case 'ideaUse': {
      const x = S.ideas.list[Number(el.dataset.i)];
      S.draft = { title: x.title, deadline: defaultDeadline(), note: x.text, severity: x.severity, freq: 'once', time: '20:00', weekday: new Date().getDay() };
      S.sheet = { type: 'new' }; return render();
    }
    case 'ideaCard': {
      const x = S.ideas.list[Number(el.dataset.i)];
      const lvl = x.severity === 'royal' ? 3 : x.severity === 'command' ? 2 : 1;
      const r = await api('/cards', { method: 'POST', body: { title: x.title, text: x.text, deck: S.ideas.deck || 'service', lvl } });
      if (r.cards) { S.cards = r; toast('נוסף לחפיסה'); } else toast('לא נשמר.');
      return;
    }
    case 'reviewStart': return startReview(false);
    case 'reviewAll': return startReview(true);
    case 'rvYes': case 'rvNo': return reviewVote(a === 'rvYes');
    case 'rvBack': S.review.i = Math.max(0, S.review.i - 1); return render();
    case 'rvExit': S.review = null; window.scrollTo(0, 0); return render();
    case 'rvFinish': return finishReview();
    case 'pushTest': await api('/push/test', { method: 'POST' }); return toast('נשלחה התראת בדיקה');
    case 'backdrop': case 'close': S.sheet = null; return render();
    case 'new':
      if (S.data.settings?.paused) return toast('הפוגה פעילה. אין גזירות עד החזרה.');
      S.draft = { title: '', deadline: defaultDeadline(), note: '', severity: 'command', freq: 'once', time: '20:00', weekday: new Date().getDay() }; S.sheet = { type: 'new' }; render(); return document.getElementById('f-title')?.focus();
    case 'sev': keepDraft(); S.draft.severity = el.dataset.sev; return render();
    case 'freq': keepDraft(); S.draft.freq = el.dataset.f; return render();
    case 'wd': keepDraft(); S.draft.weekday = Number(el.dataset.wd); return render();
    case 'preset': {
      keepDraft();
      const x = RITUAL_PRESETS[Number(el.dataset.i)];
      Object.assign(S.draft, { title: x.title, note: x.note, freq: x.freq, time: x.time, severity: x.severity, weekday: x.weekday ?? S.draft.weekday });
      return render();
    }
    case 'ritToggle': { const r = await api(`/rituals/${id}/toggle`, { method: 'POST' }); return act(r); }
    case 'ritDel': { if (!confirm('למחוק את הצו הקבוע?')) return; const r = await api(`/rituals/${id}`, { method: 'DELETE' }); return act(r, 'נמחק'); }
    case 'redeem': {
      const it = S.data.redeemItems[el.dataset.item];
      if (!confirm(`לבקש מהמלכה להמיר ${it.cost} נקודות?`)) return;
      const r = await api('/redeem', { method: 'POST', body: { item: el.dataset.item } });
      if (r.error === 'not enough points') return toast('אין מספיק נקודות.');
      return act(r, 'הבקשה נשלחה למלכה');
    }
    case 'redeemOk': { const r = await api(`/redeem/${id}/approve`, { method: 'POST' }); return act(r, 'אושר'); }
    case 'redeemNo': { const r = await api(`/redeem/${id}/deny`, { method: 'POST' }); return act(r, 'סורב'); }
    case 'create': {
      keepDraft();
      const title = S.draft.title.trim();
      if (!title) { document.getElementById('f-title')?.focus(); return; }
      el.disabled = true;
      if (S.draft.freq !== 'once') {
        const r = await api('/rituals', { method: 'POST', body: { title, note: S.draft.note, severity: S.draft.severity, freq: S.draft.freq, weekday: S.draft.weekday, time: S.draft.time } });
        return act(r, 'הצו הקבוע נחתם');
      }
      const dl = S.draft.deadline ? new Date(S.draft.deadline).getTime() : null;
      const r = await api('/decrees', { method: 'POST', body: { title, note: S.draft.note, severity: S.draft.severity, deadline: Number.isFinite(dl) ? dl : null } });
      return act(r, 'הצו נחתם');
    }
    case 'submit': S.sheet = { type: 'submit', id }; return render();
    case 'doSubmit': { el.disabled = true; const r = await api(`/decrees/${id}/submit`, { method: 'POST', body: { report: document.getElementById('f-rep')?.value || '' } }); return act(r, 'הוגש לאישור המלכה'); }
    case 'approve': S.sheet = { type: 'approve', id, bonus: 0 }; return render();
    case 'bonus': S.sheet.bonus = Number(el.dataset.b); return render();
    case 'doApprove': { el.disabled = true; const r = await api(`/decrees/${id}/approve`, { method: 'POST', body: { bonus: S.sheet.bonus || 0 } }); return act(r, 'אושר'); }
    case 'reject': S.sheet = { type: 'reject', id }; return render();
    case 'doReject': {
      el.disabled = true;
      const d = S.data.decrees.find((x) => x.id === id);
      const r = await api(`/decrees/${id}/reject`, { method: 'POST', body: { reason: document.getElementById('f-why')?.value || '' } });
      if (r.error || !el.dataset.punish) return act(r, 'הצו חזר לביצוע');
      const p2 = await api('/punish', { method: 'POST', body: { because: d ? d.title : '', deadline: deadlineFrom('tonight') } });
      if (p2.error) return act(r, 'הצו חזר לביצוע. לא נמצא קלף עונש מאושר.');
      return act(p2, `הצו חזר, ונשלף: ${p2.punished.title}`);
    }
    case 'remind': { el.disabled = true; const r = await api(`/decrees/${id}/remind`, { method: 'POST' }); return act(r, 'התזכורת נשלחה'); }
    case 'del': {
      if (!confirm('לבטל את הצו?')) return;
      const r = await api(`/decrees/${id}`, { method: 'DELETE' }); return act(r, 'הצו בוטל');
    }
    case 'pts': { el.disabled = true; const r = await api('/points', { method: 'POST', body: { delta: Number(el.dataset.d), reason: el.dataset.r } }); return act(r, 'נרשם ביומן'); }
    case 'ptsCustom': S.sheet = { type: 'pts' }; render(); return document.getElementById('f-delta')?.focus();
    case 'doPts': {
      const delta = Number(document.getElementById('f-delta')?.value);
      if (!Number.isFinite(delta) || delta === 0) return document.getElementById('f-delta')?.focus();
      el.disabled = true;
      const r = await api('/points', { method: 'POST', body: { delta, reason: document.getElementById('f-reason')?.value || '' } });
      return act(r, 'נרשם ביומן');
    }
  }
});

document.addEventListener('keydown', (e) => {
  if (S.token) { if (e.key === 'Escape' && S.sheet) { S.sheet = null; render(); } return; }
  if (/^\d$/.test(e.key)) pinKey(e.key);
  else if (e.key === 'Backspace') pinKey('del');
  else if (e.key === 'Enter') pinKey('ok');
});

// Hide everything the moment the app goes to the background (app switcher
// snapshots), and ask for the PIN again after 5 minutes away.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    S.hiddenAt = Date.now();
    if (S.token) { keepDraft(); app.style.visibility = 'hidden'; setNeutral(); }
  } else {
    app.style.visibility = '';
    if (S.token && Date.now() - S.hiddenAt > LOCK_AFTER_MS) return lock();
    if (S.token) { setCourt(); refresh(); }
  }
});

setInterval(() => { if (S.token && !document.hidden && !S.sheet) refresh(); }, POLL_MS);

// ---------- start ----------

(async function start() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  renderLock();
  const me = await api('/me');
  if (!me.role) { S.pinMsg = 'אין חיבור.'; S.pinBad = true; return renderLock(); }
  S.me = me;
  S.pinMode = me.hasPin ? 'unlock' : 'create';
  renderLock();
})();
