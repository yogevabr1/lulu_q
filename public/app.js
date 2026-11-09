// Lulu — a private two-person app. The first screen is a plain passcode
// pad on purpose; the court only appears after the right PIN.

const app = document.getElementById('app');
const LOCK_AFTER_MS = 5 * 60 * 1000;
const POLL_MS = 30 * 1000;

const S = {
  me: null, token: null, data: null, tab: 'decrees', sheet: null,
  pin: '', pinMode: 'unlock', pinFirst: '', pinMsg: '', pinBad: false, busy: false,
  hiddenAt: 0, toast: '', draft: null
};

// ---------- helpers ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const SEV = { request: 'בקשה', command: 'פקודה', royal: 'צו מלכותי' };
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
}

async function refresh() {
  if (!S.token) return;
  const r = await api('/decrees');
  if (r.decrees) { S.data = r; render(); }
}

function render() {
  if (!S.token) return renderLock();
  if (!S.data) return;
  const q = S.me.role === 'queen';
  const body = S.tab === 'points' ? pointsView(q) : (q ? queenDecrees() : slaveDecrees());
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
        <button class="btn quiet" data-act="lock" aria-label="נעילה" style="min-width:44px;padding:8px 10px">${icon.lock}</button>
      </header>
      <main class="main">${body}<div class="foot">◆ דבר המלכה הוא חוק ◆</div></main>
      ${navView(q)}
    </div>
    ${S.sheet ? sheetView() : ''}
    ${S.toast ? `<div class="toast" role="status">${esc(S.toast)}</div>` : ''}`;
}

function navView(q) {
  const on = (t) => (S.tab === t ? ' on' : '');
  if (q) {
    return `<nav class="nav"><div class="in">
      <button class="${on('decrees')}" data-act="tab" data-tab="decrees">${icon.scroll}צווים</button>
      <div><button class="fab" data-act="new" aria-label="גזירה חדשה">${icon.plus}</button></div>
      <button class="${on('points')}" data-act="tab" data-tab="points">${icon.coin}נקודות</button>
    </div></nav>`;
  }
  return `<nav class="nav"><div class="in" style="grid-template-columns:repeat(2,minmax(0,1fr))">
    <button class="${on('decrees')}" data-act="tab" data-tab="decrees">${icon.scroll}צווים</button>
    <button class="${on('points')}" data-act="tab" data-tab="points">${icon.coin}נקודות</button>
  </div></nav>`;
}

function card(d, q, now) {
  const late = d.status === 'overdue';
  const when = d.status === 'done'
    ? 'אושר ' + fmtWhen(d.doneAt) + (d.pointsAwarded != null ? ` · ${d.pointsAwarded}+` : '')
    : d.status === 'submitted' ? 'הוגש ' + fmtWhen(d.submittedAt)
    : d.deadline != null ? `עד ${fmtWhen(d.deadline)} · ${rel(d.deadline, now)}` : 'ללא מועד';
  const statusTxt = (q ? STATUS_Q : STATUS_S)[d.status];
  let actions = '';
  if (q) {
    if (d.status === 'submitted') actions = `<div class="row2"><button class="btn gold" data-act="approve" data-id="${d.id}">אשרי ביצוע</button><button class="btn red" data-act="reject" data-id="${d.id}">לא מספיק טוב</button></div>`;
    else if (late) {
      const sent = d.remindedAt && now - d.remindedAt < 12 * 3600 * 1000;
      actions = `<button class="btn red" data-act="remind" data-id="${d.id}" ${sent ? 'disabled' : ''}>${sent ? 'התזכורת נשלחה' : 'שלחי תזכורת חמורה'}</button>`;
    }
    if (d.status !== 'done') actions += `<button class="link" data-act="del" data-id="${d.id}">בטלי את הצו</button>`;
  } else {
    if (d.status === 'open' || late) actions = `<button class="btn" data-act="submit" data-id="${d.id}" style="display:flex;align-items:center;justify-content:center;gap:8px">${icon.check}ביצעתי — הגש לאישורה</button>`;
    else if (d.status === 'submitted') actions = `<span class="st submitted">ממתין לחותם המלכה…</span>`;
    else actions = `<span class="st">המלכה מרוצה</span>`;
  }
  const note = d.note ? `<p class="quote">${q ? 'הערתך' : 'הוראות המלכה'}: ${esc(d.note)}</p>` : '';
  const report = d.status === 'submitted' && d.report ? `<p class="quote">דיווח העבד: ${esc(d.report)}</p>` : '';
  const rejected = d.status !== 'done' && d.status !== 'submitted' && d.rejectReason ? `<p class="quote red">${q ? 'דחית' : 'המלכה דחתה'}: ${esc(d.rejectReason)}</p>` : '';
  return `<article class="card ${d.status}">
    <div class="meta"><span class="sev ${d.severity}">${SEV[d.severity]}</span><span class="st ${d.status}">${statusTxt}</span></div>
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
    <div class="sec"><h2>מגילת הצווים</h2><span>נקודות העבד: ${points.total}</span></div>
    ${active.length ? active.map((d) => card(d, true, now)).join('') : '<p class="empty">אין צווים פתוחים. העבד מחכה לגזירה.</p>'}
    ${done.length ? `<div class="sec"><h2>בוצעו לאחרונה</h2><span>30 יום</span></div>${done.map((d) => card(d, true, now)).join('')}` : ''}`;
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
    ${hero}${banners}
    <div class="sec"><h2>מה עליך לבצע</h2><span>אין לך הרשאה לערוך צווים</span></div>
    ${open.length ? open.map((d) => card(d, false, now)).join('') : '<p class="empty">אין צווים פתוחים. כרגע.</p>'}
    ${rest.map((d) => card(d, false, now)).join('')}
    ${done.length ? `<div class="sec"><h2>בוצעו לאחרונה</h2><span>30 יום</span></div>${done.map((d) => card(d, false, now)).join('')}` : ''}`;
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
    ${quick}
    <div class="sec"><h2>יומן הנקודות</h2><span>20 האחרונות</span></div>
    <div class="ledger">${ledger}</div>`;
}

// ---------- sheets ----------

function defaultDeadline() {
  const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(20, 0, 0, 0);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T20:00`;
}

function sheetView() {
  const s = S.sheet;
  const close = `<button class="x" data-act="close" aria-label="סגירה">${icon.x}</button>`;
  if (s.type === 'pts') return customPointsSheet();
  if (s.type === 'new') {
    const chips = Object.keys(SEV).map((k) => `<button class="chip${S.draft.severity === k ? ' on' : ''}" data-act="sev" data-sev="${k}">${SEV[k]}</button>`).join('');
    return `<div class="sheetwrap" data-act="backdrop"><section class="sheet" role="dialog" aria-modal="true" aria-label="גזירה חדשה">
      <div class="hd"><h2>גזירה חדשה</h2>${close}</div>
      <div class="field"><label for="f-title">המשימה</label><input id="f-title" maxlength="200" value="${esc(S.draft.title)}" placeholder="מה ירצה הכתר?"></div>
      <div class="field"><label for="f-dl">עד מתי</label><input id="f-dl" type="datetime-local" value="${esc(S.draft.deadline)}"></div>
      <div class="field"><span class="lbl">חומרת הצו</span><div class="chips">${chips}</div></div>
      <div class="field"><label for="f-note">הוראות לעבד (לא חובה)</label><textarea id="f-note" maxlength="1000" placeholder="איך בדיוק זה ייעשה…">${esc(S.draft.note)}</textarea></div>
      <button class="btn blood" data-act="create">חתמי וגזרי</button>
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
      <button class="btn blood" data-act="doReject" data-id="${d.id}">החזירי לביצוע</button>
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
  if (!S.sheet || S.sheet.type !== 'new') return;
  const t = document.getElementById('f-title'), dl = document.getElementById('f-dl'), n = document.getElementById('f-note');
  if (t) S.draft.title = t.value;
  if (dl) S.draft.deadline = dl.value;
  if (n) S.draft.note = n.value;
}

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
    case 'tab': S.tab = el.dataset.tab; window.scrollTo(0, 0); return render();
    case 'backdrop': case 'close': S.sheet = null; return render();
    case 'new': S.draft = { title: '', deadline: defaultDeadline(), note: '', severity: 'command' }; S.sheet = { type: 'new' }; render(); return document.getElementById('f-title')?.focus();
    case 'sev': keepDraft(); S.draft.severity = el.dataset.sev; return render();
    case 'create': {
      keepDraft();
      const title = S.draft.title.trim();
      if (!title) { document.getElementById('f-title')?.focus(); return; }
      const dl = S.draft.deadline ? new Date(S.draft.deadline).getTime() : null;
      el.disabled = true;
      const r = await api('/decrees', { method: 'POST', body: { title, note: S.draft.note, severity: S.draft.severity, deadline: Number.isFinite(dl) ? dl : null } });
      return act(r, 'הצו נחתם');
    }
    case 'submit': S.sheet = { type: 'submit', id }; return render();
    case 'doSubmit': { el.disabled = true; const r = await api(`/decrees/${id}/submit`, { method: 'POST', body: { report: document.getElementById('f-rep')?.value || '' } }); return act(r, 'הוגש לאישור המלכה'); }
    case 'approve': S.sheet = { type: 'approve', id, bonus: 0 }; return render();
    case 'bonus': S.sheet.bonus = Number(el.dataset.b); return render();
    case 'doApprove': { el.disabled = true; const r = await api(`/decrees/${id}/approve`, { method: 'POST', body: { bonus: S.sheet.bonus || 0 } }); return act(r, 'אושר'); }
    case 'reject': S.sheet = { type: 'reject', id }; return render();
    case 'doReject': { el.disabled = true; const r = await api(`/decrees/${id}/reject`, { method: 'POST', body: { reason: document.getElementById('f-why')?.value || '' } }); return act(r, 'הצו חזר לביצוע'); }
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
