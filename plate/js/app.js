import { S, commit, save, today, weekOf, addDays, snapshot, restore, subscribe, uid, adopt } from './store.js';
import * as E from './engine.js';
import { read, parts } from './parse.js';
import { rig, icon } from './draw.js';
import * as Sync from './sync.js';

// The app is one fixed screen. Nothing on it scrolls. Lift, Food and lifting
// mode are panels that slide up over it, and small forms come up as sheets.
// Each part of the screen is redrawn only when what it shows has changed.

const el = id => document.getElementById(id);
const sheet = el('sheet');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap = s => s[0].toUpperCase() + s.slice(1);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const num = n => n.toLocaleString('en-US');
const fmtH = h => {
  const whole = Math.floor(h), m = Math.round((h - whole) * 60);
  return !whole && m ? `${m}m` : m ? `${whole}h ${m}m` : `${whole}h`;
};
const mmss = ms => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const ui = { panel: null, tab: null, go: null, date: null };

// The calorie goal everywhere: the live target from his weigh-ins, unless he
// switched that off and typed his own number.
const live = () => E.coach(S, today());
const calGoal = () => (S.profile.calAuto === false ? S.profile.calories : (live().target || S.profile.calories || 0));

/* ---------- Changing only what changed ---------- */

function patch(node, html) {
  if (node.__h === html) return false;
  node.__h = html;
  node.innerHTML = html;
  return true;
}
function text(node, s) {
  s = String(s);
  if (node.__t !== s) { node.__t = s; node.textContent = s; }
}
const fill = (node, p) => node.style.setProperty('--p', Math.max(0, Math.min(1, p || 0)));

// A number whose digits roll to their new value. Each digit keeps its own width.
const STRIP = '0<br>1<br>2<br>3<br>4<br>5<br>6<br>7<br>8<br>9';
const isDigit = ch => ch >= '0' && ch <= '9';
function roll(node, value) {
  const s = String(value);
  if (node.__t === s) return;
  const prev = node.__t;
  node.__t = s;
  node.setAttribute('aria-label', s);
  if (prev != null && prev.length === s.length && [...s].every((ch, i) => isDigit(ch) === isDigit(prev[i]))) {
    [...node.children].forEach((c, i) => {
      if (isDigit(s[i])) { c.style.setProperty('--d', s[i]); c.firstElementChild.textContent = s[i]; }
      else c.textContent = s[i];
    });
    return;
  }
  node.innerHTML = [...s].map(ch => (isDigit(ch)
    ? `<span class="dg" aria-hidden="true" style="--d:${ch}"><em>${ch}</em><span>${STRIP}</span></span>`
    : `<span aria-hidden="true">${esc(ch)}</span>`)).join('');
}

/* ---------- Home ---------- */

function drawHome() {
  const t = today();
  const V = E.project(S);
  const done = E.sessionOn(V, t);
  const d = V.draft;
  const day = d?.day ?? E.dayFor(V, t);
  const ids = E.idsOf(S, day, d?.log).filter(id => !S.lifts[id].opt || d?.log?.[id]);
  text(el('h-date'), new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }));

  // The top of the screen is today's session: its name, one button, and the
  // lifts themselves with what is planned for each.
  const planOf = l => (l.weight == null ? 'new' : `${E.fmtW(l.weight)} × ${l.targets ? E.fmtReps(l.targets) : `${l.lo}–${l.hi}`}`);
  const listFor = (dayName, log) => E.idsOf(S, dayName, log).filter(id => !S.lifts[id].opt || log?.[id]).map(id => {
    const l = V.lifts[id], g = log?.[id];
    const n = (g?.reps || []).filter(x => x != null).length;
    const state = g?.skip ? 'skipped' : n >= l.sets || g?.did ? 'done' : n ? `${n} of ${l.sets}` : planOf(l);
    return `<li><button type="button" data-act="go-lift" data-id="${id}"><span>${esc(l.name)}</span><b>${state}</b></button></li>`;
  }).join('');

  let title = day, sub = '', button = '', list = '', under = '';
  if (S.free) {
    // No written workout. The screen shows what he has said he did today, with the numbers.
    title = 'today';
    const log = d?.date === t ? d.log : null;
    const rows = log ? E.idsOf(S, d.day, log).filter(id => log[id] && !log[id].skip).map(id => {
      const l = S.lifts[id], g = log[id], m = E.remembered(l), w = g.w ?? m.w;
      const said = g.reps.filter(x => x != null);
      const reps = said.length ? (said.length === l.sets ? said : g.reps.map((x, i) => x ?? m.reps?.[i]).filter(x => x != null)) : m.reps;
      const state = w != null && reps?.length ? `${E.fmtW(w)} × ${E.fmtReps(reps.slice(0, l.sets))}` : 'no numbers yet';
      return `<li><button type="button" data-act="lift" data-id="${id}"><span>${esc(l.name)}</span><b>${state}</b></button></li>`;
    }).join('') : '';
    const past = done ? done.notes.filter(n => n.kind !== 'skipped').map(n => `<li><button type="button" data-act="lift" data-id="${n.id}"><span>${esc(n.name)}</span><b>${n.reps ? `${E.fmtW(n.w)} × ${E.fmtReps(n.reps)}` : 'no numbers yet'}</b></button></li>`).join('') : '';
    list = past + rows;
    if (!list) sub = S.off?.[t] ? 'Marked as a day you did not lift.' : 'Nothing logged yet. Say what you lifted and it goes here.';
  } else if (done) {
    const nextDay = E.dayFor(V, addDays(t, 1));
    title = done.day;
    sub = `Done today. ${cap(nextDay)} is next:`;
    list = listFor(nextDay, null);
    under = S.draft ? `<button class="link quiet" type="button" data-act="go">See what changed</button>` : '';
  } else if (!ids.length) {
    sub = 'No lifts on this day yet.';
    button = `<button class="btn" type="button" data-act="open" data-panel="lift">Add lifts</button>`;
  } else {
    const going = E.draftActive(d);
    const at = going ? E.cursor(S) : null;
    button = `<button class="btn" type="button" data-act="go">${going ? (at ? 'Keep going' : 'Finish') : 'Start'}${icon.go}</button>`;
    if (E.isRest(S, t) && !going) sub = 'Rest day. This is the next session.';
    if (S.off?.[t] && !going) sub = 'Marked as a day you did not lift.';
    list = listFor(day, S.draft?.log);
    under = E.canAssume(S, day) ? `<button class="link quiet" type="button" data-act="as-written">Did it all as written</button>` : '';
  }
  patch(el('h-hero'), `<div class="headrow"><h1 class="day">${title}</h1>${button}</div>
    ${sub ? `<p class="sub">${sub}</p>` : ''}${list ? `<ul class="plan">${list}</ul>` : ''}${under}`);

  const week = weekOf(t);
  const lifted = V.sessions.filter(s => week.includes(s.date)).length;
  const goalDays = S.profile.days, leftDays = Math.max(0, goalDays - lifted);
  roll(el('m-lift'), lifted);
  text(el('m-lift-of'), `of ${goalDays}`);
  text(el('m-lift-note'), leftDays ? `${leftDays} to go this week` : 'Week done');
  fill(el('m-lift-bar'), lifted / goalDays);

  const p = E.proteinOn(S, t), pGoal = S.profile.protein;
  roll(el('m-food'), p);
  text(el('m-food-of'), `of ${pGoal} g`);
  text(el('m-food-note'), p >= pGoal ? 'Protein goal met' : `${pGoal - p} g of protein to go`);
  fill(el('m-food-bar'), p / pGoal);

  const slept = S.sleep[t], sGoal = S.profile.sleep;
  roll(el('m-sleep'), slept != null ? fmtH(slept) : '–');
  text(el('m-sleep-of'), `of ${fmtH(sGoal)}`);
  text(el('m-sleep-note'), slept != null ? (slept >= sGoal ? 'Goal met' : `${fmtH(sGoal - slept)} short`) : 'Tap to log last night');
  fill(el('m-sleep-bar'), (slept || 0) / sGoal);

  const rows = [
    ['Lift', k => (V.sessions.some(s => s.date === k) ? 'hit' : '')],
    ['Food', k => { const v = E.proteinOn(S, k); return v >= pGoal ? 'hit' : v > 0 ? 'some' : ''; }],
    ['Sleep', k => { const v = S.sleep[k]; return v == null ? '' : v >= sGoal ? 'hit' : 'some'; }],
  ];
  const names = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  patch(el('h-week'), `
    <div class="wk-head"><span></span>${week.map((k, i) => `<span class="cap ${k === t ? 'now' : ''}">${names[i]}</span>`).join('')}</div>
    ${rows.map(([name, f]) => `<div class="wk-row"><span class="cap">${name}</span>${week.map(k => {
      const st = k > t ? 'later' : f(k);
      const word = st === 'hit' ? 'goal met' : st === 'some' ? 'logged, under goal' : st === 'later' ? 'not yet' : 'nothing logged';
      return `<i class="cell ${st}" role="img" aria-label="${name} ${k}: ${word}"></i>`;
    }).join('')}</div>`).join('')}
    <p class="key"><i class="cell hit"></i>Goal met<i class="cell some"></i>Logged, under goal</p>`);
}

/* ---------- Panels ---------- */

const panels = { lift: el('p-lift'), food: el('p-food'), go: el('p-go'), days: el('p-days'), day: el('p-day'), week: el('p-week') };
const draw = { lift: drawLift, food: drawFood, go: drawGo, days: drawDays, day: drawDay, week: drawWeek };

function openPanel(name) {
  if (name === 'go' && !S.draft && !E.sessionOn(S, today())) { E.ensureDraft(S, today()); if (S.off) delete S.off[today()]; save(); }
  if (name === 'go' && !S.draft) name = 'lift';
  if (name === 'lift') ui.tab = null;
  if (name === 'go') ui.go = null;
  for (const [k, p] of Object.entries(panels)) if (k !== name) p.classList.remove('open');
  ui.panel = name;
  hideSay();
  draw[name]();
  panels[name].classList.add('open');
  shell();
}

function closePanel() {
  if (!ui.panel) return;
  panels[ui.panel].classList.remove('open');
  ui.panel = null;
  shell();
}

// Things that follow from which panel is up.
function shell() {
  document.body.dataset.panel = ui.panel || '';
  el('home').inert = !!ui.panel;
  keepAwake(ui.panel === 'go' && !S.draft?.done);
}

// Pull a panel down by its top bar to close it.
for (const panel of Object.values(panels)) {
  const head = panel.querySelector('.top');
  let y0 = null, dy = 0, t0 = 0;
  head.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    y0 = e.clientY; dy = 0; t0 = e.timeStamp;
    head.setPointerCapture(e.pointerId);
    panel.style.transition = 'none';
  });
  head.addEventListener('pointermove', e => {
    if (y0 == null) return;
    dy = Math.max(0, e.clientY - y0);
    panel.style.transform = `translate3d(0, ${dy}px, 0)`;
  });
  const end = e => {
    if (y0 == null) return;
    const fast = dy / Math.max(1, e.timeStamp - t0) > 0.5;
    y0 = null;
    panel.style.transition = '';
    panel.style.transform = '';
    if (dy > 110 || (fast && dy > 30)) closePanel();
  };
  head.addEventListener('pointerup', end);
  head.addEventListener('pointercancel', end);
}

/* ---------- Lift ---------- */

function liftRow(l, tag = 'button') {
  const s = E.status(l);
  const plan = l.weight == null ? '<i>no weight yet</i>'
    : l.targets ? `${E.fmtW(l.weight)}<i> × </i>${E.fmtReps(l.targets)}`
    : `${E.fmtW(l.weight)}<i> × ${l.lo}–${l.hi}</i>`;
  return `<button class="lift" type="button" data-act="lift" data-id="${l.id}">
      <span class="ln">${esc(l.name)}</span>
      <span class="lw">${plan}</span>
      <span class="ls cap k-${s.k}">${s.label}${l.opt ? ' · extra' : ''}</span>
    </button>`;
}

function drawLift() {
  const V = E.project(S);
  if (!ui.tab || !V.rotation.includes(ui.tab)) ui.tab = V.draft?.day ?? E.dayFor(V, today());
  const all = Object.values(V.order).flat().map(id => V.lifts[id]).filter(l => !l.opt);   // the tally counts the lifts you do every time
  const count = k => all.filter(l => E.status(l).k === k).length;
  const short = count('short') + count('drop');
  patch(el('l-tally'), [[count('up'), 'Climbing', ''], [count('flat'), 'Stalled', ''], [short, 'Short', short ? 'bad' : ''], [count('learning') + count('new'), 'Learning', '']]
    .map(([n, w, c]) => `<div class="${n ? c : 'none'}"><b>${n}</b><span class="cap">${w}</span></div>`).join(''));
  patch(el('l-tabs'), V.rotation.map(day =>
    `<button class="tab${day === ui.tab ? ' on' : ''}" type="button" data-act="tab" data-day="${day}" aria-pressed="${day === ui.tab}">${day}</button>`).join(''));
  patch(el('l-rows'), V.order[ui.tab].map(id => liftRow(V.lifts[id])).join('') || '<p class="empty">No lifts on this day yet.</p>');
  patch(el('l-foot'), `<button class="link quiet" type="button" data-act="add-lift" data-day="${ui.tab}">Add a lift to ${ui.tab} day</button>`);
}

/* ---------- Food ---------- */

const usualChip = f => `<button class="chip food" type="button" data-act="usual" data-id="${f.id}">${esc(f.name)}<b>${f.protein}</b></button>`;

function drawFood() {
  const t = today();
  const p = E.proteinOn(S, t), goal = S.profile.protein;
  const T = E.totalsOn(S, t), P = S.profile;
  roll(el('f-big'), p);
  text(el('f-of'), `of ${goal} g protein`);
  fill(el('f-arc'), p / goal);
  // Calories, carbs and fat sit under the ring. A bar shows only where a goal is set.
  const w = S.weights?.[t];
  const C = live();
  patch(el('f-macros'), [['Calories', T.calories, calGoal(), ''], ['Carbs', T.carbs, P.carbs, ' g'], ['Fat', T.fat, P.fat, ' g']]
    .map(([name, v, g, u]) => `<div class="mac"><span class="cap">${name}</span><b>${num(Math.round(v))}${u}</b>
      <i>${g ? `of ${num(g)}${u}` : 'no goal'}</i><span class="bar"><i style="--p:${g ? Math.min(1, v / g) : 0}"></i></span></div>`).join('') +
    `<button class="link quiet" type="button" data-act="weigh">${w ? `Bodyweight ${w} lb` : 'Log bodyweight'}</button>` +
    (P.calAuto === false || !C.target ? '' : `<p class="coachline">${C.basis === 'data'
      ? `Your real maintenance is about ${num(C.tdee)} calories, worked out from ${C.weighIns} weigh-ins and ${C.foodDays} days of food. The target adds ${Math.round(((P.goalRate ?? 0.5) / 7) * 3500)} for gaining ${P.goalRate ?? 0.5} lb a week.${C.rate != null ? ` You are gaining ${C.rate} lb a week now.` : ''}`
      : `Starting estimate. It becomes exact after about a week of weigh-ins and logged food${C.weighIns < 3 ? ` (${C.weighIns} weigh-in${C.weighIns === 1 ? '' : 's'} so far)` : ''}.`}</p>`));
  const us = E.usuals(S, new Date().getHours()).slice(0, 7);
  patch(el('f-usuals'), `<button class="chip add" type="button" data-act="add-food">Add food</button>${us.map(usualChip).join('')}`);
  const list = S.foodLog.filter(f => f.date === t).reverse();
  patch(el('f-list'), list.length ? `<ul class="eaten">${list.map(f => `<li>
      <span class="when">${esc(f.time)}</span>
      <button class="what" type="button" data-act="edit-food" data-id="${f.id}">${esc(f.name || 'Protein')}</button>
      <b>${f.protein} g${f.calories ? `<i>${num(f.calories)} cal</i>` : ''}</b>
      <button class="iconbtn sm" type="button" data-act="del-food" data-id="${f.id}" aria-label="Remove ${esc(f.name || 'entry')}">${icon.close}</button>
    </li>`).join('')}</ul>` : '<p class="empty">Nothing eaten yet today.</p>');
}

/* ---------- The weekly review ---------- */

// The Monday of the week a date is in.
const mondayOf = d => weekOf(d)[0];

// A compact, numbers-only picture of the last three weeks for the review.
function weekSummary() {
  const t = today(), V = E.project(S), from = addDays(t, -20), C = live();
  const days = [];
  for (let i = -20; i <= 0; i++) days.push(addDays(t, i));
  const lifts = Object.values(V.order).flat().map(id => {
    const l = V.lifts[id], s = E.status(l);
    return { name: l.name, style: l.style || 'straight', weight: l.weight, plan: l.targets, range: [l.lo, l.hi], goal: l.goal || null, status: s.label,
      recent: l.history.slice(-6).map(e => ({ d: e.d, w: e.w, reps: e.reps, plan: e.plan })) };
  });
  return {
    today: t,
    weekday: new Date(t + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' }),
    goals: { proteinG: S.profile.protein, sleepHours: S.profile.sleep, liftDaysPerWeek: S.profile.days, gainLbPerWeek: S.profile.goalRate ?? 0.5, calories: calGoal() || null },
    calorieTarget: { target: C.target, maintenance: C.tdee, basis: C.basis, trendWeight: C.weight, lbPerWeek: C.rate, weighIns: C.weighIns, foodDays: C.foodDays },
    lifts,
    workouts: V.sessions.filter(s => s.date >= from).map(s => ({ d: s.date, day: s.day, lifts: s.notes.map(n => n.reps ? `${n.name} ${n.w} x ${n.reps.join('/')}${n.plan ? ` (plan ${n.plan.join('/')})` : ''}` : `${n.name} skipped`) })),
    food: days.map(d => { const T = E.totalsOn(V, d); return T.calories || T.protein ? { d, protein: T.protein, calories: Math.round(T.calories) } : null; }).filter(Boolean),
    sleep: days.filter(d => V.sleep[d] != null).map(d => ({ d, hours: V.sleep[d] })),
    bodyweight: days.filter(d => (V.weights || {})[d]).map(d => ({ d, lb: V.weights[d] })),
  };
}

let weekBusy = false, weekTried = 0;

// On the first open of each week, ask for the review. It never blocks the app.
async function maybeWeekly() {
  const key = mondayOf(today());
  if (weekBusy || !Sync.connected() || S.reviews?.[key] || Date.now() - weekTried < 3600000) return;
  const sum = weekSummary();
  if (!sum.workouts.length && !sum.food.length) return;          // nothing to review yet
  weekBusy = true; weekTried = Date.now();
  say("Building this week's plan.");
  try {
    const data = await Sync.week(sum);
    commit(S => { (S.reviews ||= {})[key] = { at: Date.now(), data }; for (const k of Object.keys(S.reviews).sort().slice(0, -12)) delete S.reviews[k]; });
    hideSay();
    openPanel('week');
  } catch (e) {
    const why = e instanceof TypeError || e?.name === 'TimeoutError' ? 'offline' : e.message;
    say(`${problem(why)} Your plan for the week will try again next time you open the app.`);
  } finally { weekBusy = false; }
}

function drawWeek() {
  const key = mondayOf(today()), r = S.reviews?.[key];
  const label = new Date(key + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  text(el('w-title'), `Week of ${label}`);
  if (!r) {
    patch(el('w-body'), `<div class="wk"><p class="sub">${weekBusy ? 'Building this week\'s plan. It takes a little while.' : Sync.connected() ? 'The plan for this week has not been built yet. It builds the first time you open the app each week.' : 'The weekly plan needs the connection. Open Goals, then Sync and AI reader.'}</p>
      ${Sync.connected() && !weekBusy ? '<button class="btn big" type="button" data-act="week-now">Build it now</button>' : ''}</div>`);
    return;
  }
  const d = r.data, C = live();
  patch(el('w-body'), `<div class="wk">
    <h1>${esc(d.headline)}</h1>
    <h2 class="cap">Focus this week</h2><p class="focus">${esc(d.focus)}</p>
    ${d.lifts.length ? `<h2 class="cap">Lifts</h2>${d.lifts.map(l => `<div class="call"><b>${esc(l.name)}</b><span class="tag ${l.call === 'push' ? 'push' : ''}">${esc(l.call)}</span><p>${esc(l.why)}</p></div>`).join('')}` : ''}
    <h2 class="cap">Nutrition</h2><p>${esc(d.nutrition)}</p>
    ${C.target ? `<p class="muted">Calorie target now: ${num(C.target)}</p>` : ''}
    <h2 class="cap">Recovery</h2><p>${esc(d.recovery)}</p>
    ${d.watch ? `<h2 class="cap">Worth watching</h2><p>${esc(d.watch)}</p>` : ''}
    <p class="muted" style="margin-top:22px">Written ${new Date(r.at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} from your last three weeks of logs.</p>
  </div>`);
}

/* ---------- Days ---------- */

const dayLabel = d => {
  const t = today();
  if (d === t) return 'Today';
  if (d === addDays(t, -1)) return 'Yesterday';
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};

function allDays(V) {
  const set = new Set([...V.foodLog.map(f => f.date), ...Object.keys(V.sleep), ...Object.keys(V.weights || {}), ...V.sessions.map(x => x.date)]);
  return [...set].sort().reverse().slice(0, 120);
}

function drawDays() {
  const t = today(), V = E.project(S), P = S.profile;
  const days = allDays(V);
  const wk = days.filter(d => d >= addDays(t, -6) && d <= t);
  const avg = (vals) => (vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null);
  const pr = avg(wk.map(d => E.proteinOn(V, d)).filter(v => v > 0));
  const cal = avg(wk.map(d => E.caloriesOn(V, d)).filter(v => v > 0));
  const sl = wk.map(d => V.sleep[d]).filter(v => v != null);
  const slAvg = sl.length ? fmtH(Math.round((sl.reduce((a, b) => a + b, 0) / sl.length) * 4) / 4) : '–';
  const lifts = V.sessions.filter(s => s.date >= addDays(t, -6)).length;
  patch(el('d-sum'), [[lifts, 'Workouts'], [pr ?? '–', 'Protein'], [cal != null ? num(cal) : '–', 'Calories'], [slAvg, 'Sleep']]
    .map(([n, w]) => `<div class="${n === '–' ? 'none' : ''}"><b>${n}</b><span class="cap">${w}</span></div>`).join(''));
  text(el('d-cap'), 'Last 7 days, average per logged day');
  patch(el('d-rows'), days.length ? days.map(d => {
    const T = E.totalsOn(V, d), s = V.sessions.find(x => x.date === d), sl2 = V.sleep[d];
    const met = P.protein && T.protein >= P.protein;
    const work = s ? `${cap(s.day)}, ${plural(s.notes.length, 'lift')}` : 'No workout';
    const food = T.protein || T.calories ? `${T.protein} g protein${T.calories ? ' · ' + num(Math.round(T.calories)) + ' cal' : ''}` : 'Nothing eaten';
    return `<button class="dayrow" type="button" data-act="open-day" data-date="${d}">
        <span class="dn">${dayLabel(d)}</span><span class="dm">${met ? 'Protein met' : ''}</span>
        <span class="ds">${esc(work)} · ${sl2 != null ? fmtH(sl2) + ' sleep' : 'no sleep logged'}</span><span class="ds r">${food}</span>
      </button>`;
  }).join('') : '<p class="empty">Nothing logged yet. Days show up here as you log.</p>');
}

function drawDay() {
  const d = ui.date || today(), V = E.project(S), T = E.totalsOn(V, d), P = S.profile;
  patch(el('dd-top'), `<button class="iconbtn" type="button" data-act="days" aria-label="Back to all days">${icon.down}</button>
    <p class="cap">${dayLabel(d)}</p>
    <span class="pair"><button class="iconbtn" type="button" data-act="day-step" data-dir="-1" aria-label="Earlier day">${icon.prev}</button>
    <button class="iconbtn" type="button" data-act="day-step" data-dir="1" aria-label="Later day" ${d >= today() ? 'disabled' : ''}>${icon.next}</button></span>`);
  const goal = g => (g ? `of ${num(g)}` : '');
  const list = V.foodLog.filter(f => f.date === d);
  const sess = V.sessions.find(s => s.date === d);
  const sleepV = V.sleep[d], bw = (V.weights || {})[d];
  patch(el('dd-body'), `
    <div class="ddsum">
      <div><b>${T.protein}</b><span class="cap">Protein g</span><i>${goal(P.protein)}</i></div>
      <div><b>${num(Math.round(T.calories))}</b><span class="cap">Calories</span><i>${goal(calGoal())}</i></div>
      <div><b>${Math.round(T.carbs)}</b><span class="cap">Carbs g</span><i>${goal(P.carbs)}</i></div>
      <div><b>${Math.round(T.fat)}</b><span class="cap">Fat g</span><i>${goal(P.fat)}</i></div>
    </div>
    <h2 class="cap">Food</h2>
    ${list.length ? `<ul class="eaten">${list.map(f => `<li>
        <span class="when">${esc(f.time || '')}</span>
        <button class="what" type="button" data-act="edit-food" data-id="${f.id}">${esc(f.name || 'Protein')}</button>
        <b>${f.protein} g${f.calories ? `<i>${num(f.calories)} cal</i>` : ''}</b>
        <button class="iconbtn sm" type="button" data-act="del-food" data-id="${f.id}" aria-label="Remove ${esc(f.name || 'entry')}">${icon.close}</button>
      </li>`).join('')}</ul>` : '<p class="empty">Nothing eaten that day.</p>'}
    <button class="link quiet" type="button" data-act="add-food-on" data-date="${d}">Add food to this day</button>
    <h2 class="cap">Sleep and body</h2>
    <button class="lift" type="button" data-act="sleep-on" data-date="${d}"><span class="ln">Sleep</span><span class="lw">${sleepV != null ? fmtH(sleepV) : '<i>add</i>'}</span></button>
    <button class="lift" type="button" data-act="weigh-on" data-date="${d}"><span class="ln">Bodyweight</span><span class="lw">${bw ? bw + ' lb' : '<i>add</i>'}</span></button>
    <h2 class="cap">Workout</h2>
    ${sess ? sess.notes.map(n => `<button class="lift" type="button" data-act="edit-session" data-date="${d}" data-id="${n.id}">
        <span class="ln">${esc(n.name)}</span>
        <span class="lw">${n.reps ? `${E.fmtW(n.w)}<i> × </i>${n.reps.join(' · ')}` : '<i>skipped</i>'}</span>
      </button>`).join('') + `<button class="link quiet" type="button" data-act="del-session" data-date="${d}">Remove this workout</button>`
      : (S.draft && S.draft.date === d ? '<p class="empty">Today\'s workout is still open. Finish it in lifting mode.</p>' : `<p class="empty">${S.off?.[d] ? 'Marked as a day you did not lift.' : E.plannedOn(S, d) ? 'No workout logged that day.' : 'Rest day.'}</p>${d < today() && E.plannedOn(S, d) ? `<button class="link quiet" type="button" data-act="log-day" data-date="${d}">Log this day's workout as written</button>` : ''}`)}`);
}

/* ---------- Lifting mode ---------- */

const firstOpen = id => {
  const l = S.lifts[id], g = S.draft.log[id];
  for (let i = 0; i < l.sets; i++) if (g?.reps[i] == null) return i;
  return null;
};

// The lift and set the buttons act on. Follows the next unlogged set unless
// you picked something yourself.
function selected() {
  const d = S.draft, ids = E.liveIds(S, d);
  const g = ui.go;
  if (g && ids.includes(g.id)) return g;
  const c = E.cursor(S);
  if (c) return (ui.go = { id: c.id, set: c.set });
  return (ui.go = { id: ids[0] ?? S.order[d.day][0], set: null });
}

function closeLine(d) {
  let sets = 0, short = 0, skipped = 0;
  for (const id of E.idsOf(S, d.day, d.log)) {
    const l = S.lifts[id], g = d.log[id];
    if (g?.skip) { skipped++; continue; }
    for (let i = 0; i < l.sets; i++) {
      sets++;
      if (l.targets && g?.reps[i] != null && g.reps[i] < l.targets[i]) short++;
    }
  }
  return [plural(sets, 'set'), short ? `${short} short` : 'none short', skipped ? `${plural(skipped, 'lift')} skipped` : ''].filter(Boolean).join(', ') + '.';
}

const REST = `<span class="cap">Rest</span><b id="clock"></b><span class="bar"><i id="restbar"></i></span>
  <button class="chip" type="button" data-act="rest-add">+15 s</button><button class="chip" type="button" data-act="rest-skip">Skip</button>`;

function drawRest() {
  const r = S.draft?.rest;
  const on = !!r && r.until > Date.now();
  patch(el('g-rest'), on ? REST : '');
  if (on) { text(el('clock'), mmss(r.until - Date.now())); fill(el('restbar'), (r.until - Date.now()) / (r.total * 1000)); }
}

function drawGo() {
  const d = S.draft;
  if (!d) { closePanel(); return; }
  const run = el('g-run'), sum = el('g-sum');
  run.hidden = !!d.done;
  sum.hidden = !d.done;
  if (d.done) { drawSummary(); return; }

  const g = selected();
  const ids = E.liveIds(S, d);
  const l = S.lifts[g.id], log = d.log[g.id], w = log?.w ?? l.weight;

  patch(el('g-top'), `
    <button class="iconbtn" type="button" data-act="close" aria-label="Leave lifting mode">${icon.down}</button>
    <button class="where cap" type="button" data-act="go-pick">${d.day} · ${ids.indexOf(g.id) + 1} of ${ids.length}</button>
    <span class="pair">
      <button class="iconbtn" type="button" data-act="go-step" data-dir="-1" aria-label="Previous lift">${icon.prev}</button>
      <button class="iconbtn" type="button" data-act="go-step" data-dir="1" aria-label="Next lift">${icon.next}</button>
    </span>`);
  text(el('g-name'), l.name);
  text(el('g-note'), [
    l.warm ? `Warm-up ${E.fmtW(l.warm.w)}${l.warm.reps ? ' × ' + l.warm.reps : ''}, counted` : '',
    l.goal ? `Goal ${E.fmtW(l.goal.w)} × ${l.goal.reps}` : '',
    l.drop ? 'Drop set after, assumed' : '',
  ].filter(Boolean).join(' · '));

  // A lift nobody has done yet needs its weight first.
  if (w == null) {
    const ask = { barbell: 'What is on the bar, plates and bar together?', dumbbell: 'How heavy is each dumbbell?', stack: 'Where is the pin?' }[l.kind] || 'What weight?';
    const start = { barbell: 135, dumbbell: 25, stack: 50 }[l.kind] || 50;
    patch(el('g-load'), `<form class="ask" data-form="first-weight" data-id="${l.id}">
        <p class="sub">${ask}</p>
        ${stepper('w', start, l.jump, 0, 1000, 'Weight in pounds')}
        <button class="btn big">Set weight</button>
      </form>`);
    for (const id of ['g-rig', 'g-sets', 'g-rest', 'g-ctl']) patch(el(id), '');
    text(el('g-last'), '');
    return;
  }

  const shown = g.set ?? l.sets - 1;
  const target = l.targets?.[shown];
  const repText = target ?? `${l.lo}–${l.hi}`;
  if (patch(el('g-load'), `<button class="load" type="button" data-act="weight" data-id="${l.id}" aria-label="${E.fmtW(w)} pounds for ${repText} reps. Change the weight.">
      <span class="row"><span>${E.fmtW(w)}</span><i>×</i><span>${repText}</span></span>
    </button>`)) fitLoad();
  patch(el('g-rig'), rig(l, w));

  // Every set of this lift, all at once. Tap one to log it or change it.
  patch(el('g-sets'), `<span class="cap">Sets</span>` + Array.from({ length: l.sets }, (_, i) => {
    const v = log?.reps[i], plan = l.targets?.[i];
    const short = v != null && plan != null && v < plan;
    const cls = ['set', v != null ? 'in' : 'todo', short ? 'short' : '', i === g.set ? 'on' : ''].filter(Boolean).join(' ');
    const inner = v != null ? (short ? `<s>${plan}</s>${v}` : v) : (plan ?? '·');
    return `<button class="${cls}" type="button" data-act="pick-set" data-i="${i}" aria-pressed="${i === g.set}" aria-label="Set ${i + 1}${v != null ? ', got ' + v : ''}">${inner}</button>`;
  }).join(''));

  const last = l.history[l.history.length - 1];
  text(el('g-last'), last ? `Last time ${E.fmtW(last.w)}: ${last.reps.join(' · ')}` : '');
  drawRest();

  const c = E.cursor(S);
  let ctl;
  if (g.set == null) {
    ctl = c
      ? `<p class="sub">This lift is in. Tap a set to change it.</p>
         <button class="btn big" type="button" data-act="go-next">Next: ${esc(S.lifts[c.id].name)}</button>`
      : `<p class="sub">Every set is in. ${closeLine(d)}</p>
         <button class="btn big" type="button" data-act="finish">Finish ${d.day}</button>`;
  } else if (target != null) {
    const lows = [1, 2, 3, 4].map(n => target - n).filter(n => n >= 0);
    ctl = `<div class="shorts">
        <span class="cap">Fell short? Tap what you got</span>
        <div class="nums">
          ${lows.map(n => `<button class="chip n" type="button" data-act="reps" data-n="${n}" aria-label="${n} reps">${n}</button>`).join('')}
          <button class="chip" type="button" data-act="other-reps">Other</button>
        </div>
      </div>
      <button class="btn big" type="button" data-act="reps" data-n="${target}">Hit ${target}</button>`;
  } else {
    const from = l.hi + 1, to = Math.max(1, l.lo - 3);
    const nums = Array.from({ length: from - to + 1 }, (_, i) => from - i);
    ctl = `<p class="cap">Learning this lift. Reps you got?</p>
      <div class="pad">
        ${nums.map(n => `<button class="chip n ${n >= l.lo && n <= l.hi ? 'in' : ''}" type="button" data-act="reps" data-n="${n}" aria-label="${n} reps">${n}</button>`).join('')}
        <button class="chip" type="button" data-act="other-reps">Other</button>
      </div>`;
  }
  patch(el('g-ctl'), ctl);
}

const KIND = { jump: 'Weight goes up', hit: 'One more rep', short: 'Same again', ahead: 'New weight', learned: 'Plan set', learning: 'Learning', skipped: 'Skipped', noted: 'Logged' };

function drawSummary() {
  const V = E.project(S);
  const done = V.sessions[V.sessions.length - 1];
  patch(el('g-top'), `<span></span><p class="cap">${done.day} logged</p><span></span>`);
  const rows = done.notes.map(n => {
    const next = n.next ? `${E.fmtW(n.next.w)}<i> × </i>${E.fmtReps(n.next.reps)}` : '';
    return `<div class="lift flat">
      <span class="ln">${esc(n.name)}</span>
      <span class="lw">${next}</span>
      <span class="ls cap k-${n.kind}">${KIND[n.kind]}</span>
    </div>`;
  }).join('');
  patch(el('g-sum'), `
    <div class="lede">
      <h1 class="headline">Next time.</h1>
      <p class="sub">${cap(E.dayFor(V, addDays(today(), 1)))} is up next. If a set went differently, say so any time today.</p>
    </div>
    <div class="rows">${rows || '<p class="empty">Nothing was logged.</p>'}</div>
    <footer class="ctl"><button class="btn big" type="button" data-act="close">Done</button></footer>`);
}

// Size the big lifting numbers so they span the screen, whatever the digits.
function fitLoad() {
  const b = el('g-load').querySelector('.load');
  if (!b) return;
  b.style.fontSize = '100px';
  const w = b.firstElementChild.getBoundingClientRect().width;
  if (w) b.style.fontSize = Math.min(150, Math.floor(100 * b.clientWidth / w)) + 'px';
}
document.fonts?.ready.then(fitLoad);
addEventListener('resize', fitLoad);

function logSet(n) {
  const g = ui.go;
  if (!g || g.set == null || !S.draft) return;
  const fixing = S.draft.log[g.id]?.reps[g.set] != null;
  commit(S => {
    const l = S.lifts[g.id];
    E.entry(S.draft, g.id).reps[g.set] = n;
    const here = firstOpen(g.id), c = E.cursor(S);
    ui.go = here != null ? { id: g.id, set: here } : c ? { id: c.id, set: c.set } : { id: g.id, set: null };
    // A fresh set starts the rest clock. Correcting an old one does not.
    if (!fixing) S.draft.rest = c ? { until: Date.now() + l.rest * 1000, total: l.rest } : null;
  });
}

function stepLift(dir) {
  const d = S.draft, live = E.liveIds(S, d);
  if (!live.length) return;
  const at = live.indexOf(ui.go?.id);
  const id = live[(at + dir + live.length) % live.length];
  ui.go = { id, set: firstOpen(id) };
  drawGo();
}

function pickSheet() {
  const d = S.draft;
  const rows = E.idsOf(S, d.day, d.log).map(id => {
    const l = S.lifts[id], g = d.log[id];
    const n = (g?.reps || []).filter(x => x != null).length;
    return `<div class="pick">
        <button class="lift" name="do" value="jump:${id}" ${g?.skip ? 'disabled' : ''}>
          <span class="ln">${esc(l.name)}</span>
          <span class="lw"><i>${g?.skip ? 'Skipped' : l.opt && !g ? 'Extra, tap to add' : `${n} of ${l.sets} sets`}</i></span>
        </button>
        ${l.opt && !g ? '<span></span>' : `<button class="link quiet" name="do" value="skip:${id}">${g?.skip ? 'Bring back' : 'Skip'}</button>`}
      </div>`;
  }).join('');
  openSheet(`${cap(d.day)} day`, `<p class="sub">Do them in any order. Tap one to go to it.</p>${rows}`, 'Close', (f, act) => {
    const [what, id] = String(act || '').split(':');
    if (what === 'jump') { if (!E.isLive(S.lifts[id], S.draft.log[id])) commit(S => { E.entry(S.draft, id).skip = false; }); ui.go = { id, set: firstOpen(id) }; drawGo(); }
    if (what === 'skip') commit(S => { const g = E.entry(S.draft, id); g.skip = !g.skip; if (ui.go?.id === id) ui.go = null; });
  });
}

/* ---------- Sheets ---------- */

function stepper(name, value, step, min, max, label) {
  return `<div class="stepper">
    <button type="button" data-step="-${step}" aria-label="Less">−</button>
    <input name="${name}" type="number" inputmode="decimal" value="${value}" step="any" min="${min}" max="${max}" aria-label="${label}" required>
    <button type="button" data-step="${step}" aria-label="More">+</button>
  </div>`;
}

let onSheet = null, onClose = null;

// Close the sheet without saving, and run anything waiting on that.
function closeSheet() {
  sheet.close();
  const f = onClose;
  onClose = null;
  if (f) f();
}

function openSheet(title, body, submit, handler) {
  onSheet = handler;
  onClose = null;
  sheet.innerHTML = `<form method="dialog" class="sheetform">
      <header><h2 class="headline sm">${title}</h2>
        <button class="iconbtn" type="button" data-act="close-sheet" aria-label="Close">${icon.close}</button></header>
      ${body}
      <button class="btn big" value="save">${submit}</button>
    </form>`;
  if (!sheet.open) sheet.showModal();
  sheet.scrollTop = 0;
}

const field = (label, inner, hint = '') => `<label class="field"><span class="cap">${label}</span>${inner}${hint ? `<small>${hint}</small>` : ''}</label>`;

function goalsSheet(first) {
  const p = S.profile;
  openSheet(first ? 'Three numbers to start' : 'Goals',
    (first ? '<p class="sub">You can change these any time from the home screen.</p>' : '') +
    field('Protein per day, grams', stepper('protein', p.protein, 5, 20, 400, 'Protein goal in grams')) +
    field('Lifting days per week', stepper('days', p.days, 1, 1, 7, 'Lifting days per week')) +
    field('Sleep per night, hours', stepper('sleep', p.sleep, 0.25, 4, 12, 'Sleep goal in hours')) +
    `<label class="check"><input type="checkbox" name="auto" ${S.auto === false ? '' : 'checked'}><span>Assume I lift every planned day and hit everything</span></label>` +
    `<label class="check"><input type="checkbox" name="calAuto" ${p.calAuto === false ? '' : 'checked'}><span>Set my calories from my weigh-ins</span></label>` +
    field('Pounds to gain per week', stepper('goalRate', p.goalRate ?? 0.5, 0.25, 0, 2, 'Pounds to gain per week')) +
    field('Calories per day, only if the box above is off', `<input name="calories" type="number" inputmode="numeric" min="0" max="9000" value="${p.calories || ''}" placeholder="Skip">`) +
    `<div class="pair">${field('Carbs, grams', `<input name="carbs" type="number" inputmode="numeric" min="0" max="1500" value="${p.carbs || ''}" placeholder="Skip">`)}${field('Fat, grams', `<input name="fat" type="number" inputmode="numeric" min="0" max="600" value="${p.fat || ''}" placeholder="Skip">`)}</div>` +
    (first ? '' : `<button class="link quiet" type="button" data-act="sync">${Sync.connected() ? 'Sync is on' : 'Sync and AI reader'}</button>
      <div class="pair"><button class="link quiet" type="button" data-act="backup">Export a backup</button><button class="link quiet" type="button" data-act="restore">Restore a backup</button></div>`),
    first ? 'Start' : 'Save',
    f => commit(S => {
      S.profile = { protein: +f.protein || 180, days: Math.min(7, Math.max(1, +f.days || 5)), sleep: +f.sleep || 8, calories: +f.calories || 0, carbs: +f.carbs || 0, fat: +f.fat || 0, calAuto: !!f.calAuto, goalRate: f.goalRate === '' ? 0.5 : Math.max(0, Math.min(2, +f.goalRate)) };
      S.setup = true;
      S.auto = !!f.auto;
    }));
  // Closing the first-run sheet any other way keeps the defaults. Either
  // way it is done, so it never comes back on the next open.
  if (first) {
    onClose = () => { if (!S.setup) commit(S => { S.setup = true; }); };
    sheet.addEventListener('close', () => { const f = onClose; onClose = null; if (f) f(); }, { once: true });
  }
}

const PROBLEM = {
  wrong_key: 'That passphrase is not right.',
  not_set_up: 'The server is not set up yet.',
  offline: 'No connection right now.',
  bad_ai_key: 'The AI key on the server is not working.',
  busy: 'The AI is busy. Try again in a minute.',
  too_big: 'There is too much data to save in one go.',
  no_speech_key: 'Voice needs its own key on the server, and that is not set up yet.',
  bad_speech_key: 'The voice key on the server is not working.',
  speech_unreachable: 'Could not reach the voice service.',
};
const problem = code => PROBLEM[code] || 'Could not reach the server.';
const stamp = t => new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function syncSheet() {
  const i = Sync.info();
  if (!i.on) {
    openSheet('Sync and AI reader',
      '<p class="sub">Keeps a copy of everything in your database, and lets the AI read messages this phone cannot. Enter the passphrase you set on the server.</p>' +
      field('Passphrase', '<input name="key" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" required>'),
      'Connect',
      f => connectWith(f.key));
    return;
  }
  openSheet('Sync is on',
    `<p class="sub">${i.error ? problem(i.error) : i.at ? `Last saved ${stamp(i.at)}.` : 'Saving now.'}</p>
     <button class="link quiet" name="do" value="off">Turn sync off on this phone</button>`,
    'Save now',
    async (f, act) => {
      if (act === 'off') { Sync.disconnect(); say('Sync is off on this phone. Nothing was deleted.'); return; }
      const r = await Sync.sync();
      say(r === 'ok' ? 'Saved.' : problem(r));
    });
}

async function connectWith(key, prefer) {
  say('Connecting.');
  const r = await Sync.connect(key, prefer);
  if (r.ask) {
    // Both places hold entries. Nothing has changed yet: ask which to keep.
    openSheet('Two copies',
      `<p class="sub">Your database already holds a copy saved ${stamp(r.savedAt)}. This phone has entries too. Only one can be kept.</p>
       <button class="btn line" name="do" value="saved">Use the saved copy</button>`,
      'Keep what is on this phone',
      (f, act) => connectWith(key, act === 'saved' ? 'saved' : 'phone'));
    hideSay();
    return;
  }
  say(r.ok ? (r.took === 'saved' ? 'Connected. Your saved copy is on this phone now.' : r.took === 'ai' ? 'Connected. The AI can read your messages now.' : 'Connected. This phone is saved.') : problem(r.error));
}

function sleepSheet(date = today()) {
  openSheet(date === today() ? 'Last night' : `Sleep, ${dayLabel(date)}`, field('Hours slept', stepper('hours', S.sleep[date] ?? S.profile.sleep, 0.25, 0, 16, 'Hours slept')), 'Save',
    f => { const snap = snapshot(); commit(S => { S.sleep[date] = +f.hours; }); say(`Sleep: ${fmtH(+f.hours)}.`, snap); });
}

// The fields for one food: a name and its four numbers.
const box = (name, v, ph) => `<input name="${name}" type="number" inputmode="numeric" min="0" max="6000" value="${v || ''}" placeholder="${ph}">`;
const foodFields = (v = {}) =>
  field('What was it', `<input name="name" type="text" autocomplete="off" autocapitalize="sentences" maxlength="40" value="${esc(v.name || '')}" placeholder="Protein shake">`) +
  field('Protein, grams', stepper('protein', v.protein ?? 30, 5, 0, 400, 'Protein in grams')) +
  field('Calories', box('calories', v.calories, 'Leave empty to skip')) +
  `<div class="pair">${field('Carbs, grams', box('carbs', v.carbs, 'Skip'))}${field('Fat, grams', box('fat', v.fat, 'Skip'))}</div>` +
  '<label class="check"><input type="checkbox" name="keep" checked><span>Keep as a usual</span></label>';
const foodFrom = (f, source) => ({ name: (f.name || '').trim(), protein: Math.round(+f.protein || 0), calories: Math.round(+f.calories || 0), carbs: Math.round(+f.carbs || 0), fat: Math.round(+f.fat || 0), keep: !!f.keep, source });

function foodSheet() {
  openSheet('Add food', foodFields(), 'Log it', f => addFood(foodFrom(f, 'form')));
}

// Change what was recorded for one lift on a past day. The plan for next time
// is left as it was, because it was already worked out from the original numbers.
function sessionSheet(date, id) {
  const sess = S.sessions.find(s => s.date === date), note = sess?.notes.find(n => n.id === id);
  if (!note || !note.reps) { say('There is nothing to edit for that one.'); return; }
  const l = S.lifts[id];
  openSheet(esc(note.name),
    `<p class="sub">This changes the record. Next time's plan stays as it was.</p>` +
    field('Weight, pounds', stepper('w', note.w, l?.jump || 5, 0, 1000, 'Weight in pounds')) +
    note.reps.map((r, i) => field(`Set ${i + 1} reps`, stepper('r' + i, r, 1, 0, 100, `Set ${i + 1} reps`))).join('') +
    `<button class="link quiet" name="do" value="del">Remove this lift from the workout</button>`,
    'Save',
    (f, act) => commit(S => {
      const sess = S.sessions.find(s => s.date === date), note = sess?.notes.find(n => n.id === id);
      if (!note) return;
      const l = S.lifts[id], hi = l ? l.history.findIndex(e => e.d === date) : -1;
      if (act === 'del') {
        sess.notes = sess.notes.filter(n => n !== note);
        if (hi >= 0) { l.history.splice(hi, 1); l.sessions = Math.max(0, l.sessions - 1); }
        return;
      }
      note.w = +f.w;
      note.reps = note.reps.map((_, i) => Math.max(0, Math.round(+f['r' + i] || 0)));
      if (hi >= 0) { l.history[hi].w = note.w; l.history[hi].reps = [...note.reps]; }
    }));
}

function weighSheet(date = today()) {
  const days = Object.keys(S.weights || {}).sort();
  const last = (S.weights || {})[date] ?? (days.length ? S.weights[days[days.length - 1]] : 180);
  openSheet(date === today() ? 'Bodyweight' : `Bodyweight, ${dayLabel(date)}`, field('Pounds', stepper('w', last, 0.5, 60, 500, 'Bodyweight in pounds')), 'Save',
    f => { const snap = snapshot(); commit(S => { (S.weights ||= {})[date] = +f.w; }); say(`Bodyweight: ${+f.w} lb.`, snap); });
}

// Editing the program closes out a finished session first, so the edit
// lands on next time's plan and not on today's record.
const settle = S => { if (S.draft?.done) E.finalize(S); };

// What he did on one lift: today's sets, editable, and every time before.
function liftLog(id) {
  const l = S.lifts[id], t = today();
  const g = S.draft?.date === t ? S.draft.log[id] : null;
  const note = g ? null : E.sessionOn(S, t)?.notes.find(n => n.id === id && n.kind !== 'skipped');
  const m = E.remembered(l);
  const now = g && !g.skip ? { w: g.w ?? m.w, reps: (g.w ?? m.w) == null ? g.reps.filter(x => x != null) : E.repsFor(l, g) }
    : note ? { w: note.w ?? null, reps: note.reps || [] } : null;
  const date = d => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const lb = n => Math.round(n).toLocaleString('en-US');
  const past = l.history.map((e, i) => [e, i]).filter(([e]) => !(now && e.d === t)).sort((a, b) => (a[0].d < b[0].d ? 1 : a[0].d > b[0].d ? -1 : b[1] - a[1]));
  const best = l.history.reduce((b, e) => (!b || e.w > b.w || (e.w === b.w && Math.max(...e.reps) > Math.max(...b.reps)) ? e : b), null);
  // One empty box past the last set, so another set can be added.
  const n = Math.min(8, Math.max(l.sets, now?.reps.length || 0) + 1);
  const total = now?.reps.length ? now.reps.reduce((a, b) => a + b, 0) : 0;
  const kinds = [['barbell', 'Barbell'], ['dumbbell', 'Dumbbells'], ['stack', 'Cable or machine stack'], ['other', 'Something else']];
  openSheet(esc(l.name),
    (best ? `<p class="sub">Best: ${E.fmtW(best.w)} × ${Math.max(...best.reps)}, ${date(best.d)}. Logged ${l.history.length} ${l.history.length === 1 ? 'time' : 'times'}.</p>` : '<p class="sub">No numbers saved for this one yet.</p>') +
    (now
      ? `<h3 class="cap">Today</h3>` +
        (total ? `<p class="didline"><b>${now.w != null ? E.fmtW(now.w) : '?'}</b><span>lb ×</span><b>${now.reps.join(' · ')}</b><span>${now.reps.length} ${now.reps.length === 1 ? 'set' : 'sets'}, ${total} reps${now.w ? `, ${lb(now.w * total)} lb moved` : ''}</span></p>` : '<p class="sub">Counted, with no numbers. Put them in below.</p>') +
        field('Weight, pounds', stepper('w', now.w ?? '', l.jump, 0, 1000, 'Weight in pounds').replace(' required', '')) +
        `<div class="setrow">${Array.from({ length: n }, (_, i) => `<label class="field"><span class="cap">Set ${i + 1}</span><input name="r${i}" type="number" inputmode="numeric" min="0" max="100" value="${now.reps[i] ?? ''}" aria-label="Set ${i + 1} reps"></label>`).join('')}</div>` +
        `<button class="link quiet" name="do" value="undo">Take it off today</button>`
      : `<h3 class="cap">Last time</h3>` +
        (m.w != null && m.reps ? `<p class="didline"><b>${E.fmtW(m.w)}</b><span>lb ×</span><b>${m.reps.slice(0, l.sets).join(' · ')}</b><span>${date(l.history[l.history.length - 1]?.d || t)}</span></p>` : '') +
        `<button class="btn line" name="do" value="count">I did it today</button>`) +
    (past.length ? `<h3 class="cap">Before</h3><ul class="eaten hist">${past.slice(0, 30).map(([e, i]) => `<li><span class="when">${date(e.d)}</span>
      <span class="what">${E.fmtW(e.w)}</span>
      <span class="marks">${e.reps.map(r => `<span class="mk">${r}</span>`).join('')}</span>
      <button class="iconbtn sm" name="do" value="rm:${i}" aria-label="Remove ${date(e.d)}">${icon.close}</button></li>`).join('')}</ul>` : '') +
    `<details class="more"><summary>Lift settings</summary>
      <div class="pair">${field('Sets', stepper('sets', l.sets, 1, 1, 8, 'Sets'))}${field('Step, pounds', stepper('jump', l.jump, 2.5, 1, 50, 'Pounds per tap'))}</div>
      ${field('Equipment', `<select name="kind">${kinds.map(([v, k]) => `<option value="${v}" ${l.kind === v ? 'selected' : ''}>${k}</option>`).join('')}</select>`)}
      <button class="link quiet" name="do" value="retire">Remove this lift from my lifts</button></details>`,
    'Save',
    (f, do_) => {
      if (do_ === 'count') { const snap = snapshot(); const [msg] = act({ type: 'lift', id, w: null, reps: {} }, t, S.draft?.day ?? E.dayFor(S, t)); say(msg, snap); return; }
      const snap = snapshot();
      commit(S => {
        const l = S.lifts[id];
        const sess = E.sessionOn(S, t), hi = l.history.findIndex(e => e.d === t);
        if (do_ === 'retire') { for (const k of Object.keys(S.order)) S.order[k] = S.order[k].filter(x => x !== id); if (S.draft) delete S.draft.log[id]; return; }
        if (do_ && do_.startsWith('rm:')) { l.history.splice(+do_.slice(3), 1); l.sessions = Math.max(0, l.sessions - 1); return; }
        if (do_ === 'undo') {
          if (S.draft?.date === t) delete S.draft.log[id];
          else if (sess) { sess.notes = sess.notes.filter(x => x.id !== id); if (hi >= 0) { l.history.splice(hi, 1); l.sessions = Math.max(0, l.sessions - 1); } }
          return;
        }
        l.sets = Math.max(1, Math.min(8, Math.round(+f.sets || l.sets)));
        l.jump = +f.jump || l.jump;
        l.kind = f.kind;
        if (!now) return;
        const w = f.w === '' || f.w == null ? null : +f.w;
        const reps = [];
        for (let i = 0; i < n; i++) { if (f['r' + i] === '' || f['r' + i] == null) break; reps.push(Math.max(0, Math.round(+f['r' + i]))); }
        if (reps.length > l.sets) l.sets = reps.length;
        const g = S.draft?.date === t ? S.draft.log[id] : null;
        if (g) {
          delete g.skip;
          if (w != null) g.w = w; else delete g.w;
          g.reps = reps;
          if (reps.length) delete g.did; else g.did = true;
        } else if (sess) {
          const note = sess.notes.find(x => x.id === id);
          if (!note || w == null || !reps.length) return;
          Object.assign(note, { w, reps: [...reps], kind: 'noted' });
          if (hi >= 0) Object.assign(l.history[hi], { w, reps: [...reps] });
          else { l.history.push({ d: t, w, reps: [...reps], plan: null, planW: null }); l.sessions++; }
          l.weight = w; l.targets = [...reps];
        }
      });
      if (do_ === 'undo') say(`${l.name} is off today.`, snap);
    });
}

function liftSheet(id) {
  if (S.free) { liftLog(id); return; }
  const l = S.lifts[id], s = E.status(l);
  const hist = l.history.map((e, i) => [e, i]).slice(-5).reverse().map(([e, i]) => `<li><span class="when">${new Date(e.d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
      <span class="what">${E.fmtW(e.w)}</span>
      <span class="marks">${e.reps.map((r, k) => (e.plan && r < e.plan[k] ? `<span class="mk short"><s>${e.plan[k]}</s>${r}</span>` : `<span class="mk">${r}</span>`)).join('')}</span>
      <button class="iconbtn sm" name="do" value="rm:${i}" aria-label="Remove this entry">${icon.close}</button></li>`).join('');
  const kinds = [['barbell', 'Barbell'], ['dumbbell', 'Dumbbells'], ['stack', 'Cable or machine stack'], ['other', 'Something else']];
  openSheet(esc(l.name),
    `<p class="sub">${E.advice(l)}</p>` +
    (s.k === 'drop' ? `<button class="btn line" name="do" value="drop">${E.easeOff(l).button}</button>` : '') +
    (hist ? `<h3 class="cap">Last sessions</h3><ul class="eaten hist">${hist}</ul>` : '') +
    field('Weight, pounds', stepper('weight', l.weight ?? '', l.jump, 0, 1000, 'Weight in pounds').replace(' required', '')) +
    `<div class="pair">${field('Sets', stepper('sets', l.sets, 1, 1, 8, 'Sets'))}${field('Add when earned', stepper('jump', l.jump, 2.5, 1, 50, 'Pounds to add'))}</div>` +
    `<div class="pair">${field('Reps from', stepper('lo', l.lo, 1, 1, 50, 'Lowest reps'))}${field('Reps to', stepper('hi', l.hi, 1, 1, 50, 'Highest reps'))}</div>` +
    field('Rest between sets, seconds', stepper('rest', l.rest, 15, 15, 600, 'Rest in seconds')) +
    field('Equipment', `<select name="kind">${kinds.map(([v, n]) => `<option value="${v}" ${l.kind === v ? 'selected' : ''}>${n}</option>`).join('')}</select>`) +
    field('How you do it', `<select name="style"><option value="straight" ${l.style !== 'top' ? 'selected' : ''}>Straight sets, every set logged or assumed</option><option value="top" ${l.style === 'top' ? 'selected' : ''}>Warm up, then a working set (warm-ups assumed)</option></select>`) +
    `<div class="pair">${field('Goal weight', box('gw', l.goal?.w, 'Skip'))}${field('Goal reps', box('gr', l.goal?.reps, 'Skip'))}</div>` +
    `<div class="pair">${field('Last warm-up weight', box('ww', l.warm?.w, 'Skip'))}${field('Its reps', box('wr', l.warm?.reps, 'Skip'))}</div>` +
    `<label class="check"><input type="checkbox" name="drop" ${l.drop ? 'checked' : ''}><span>A drop set follows (assumed done)</span></label>` +
    `<label class="check"><input type="checkbox" name="opt" ${l.opt ? 'checked' : ''}><span>Extra: counts only when I say I did it</span></label>` +
    `<button class="link quiet" name="do" value="retire">Take this lift out of the program</button>`,
    'Save',
    (f, act) => commit(S => {
      settle(S);
      const l = S.lifts[id];
      if (act === 'retire') { for (const k of Object.keys(S.order)) S.order[k] = S.order[k].filter(x => x !== id); return; }
      if (act && act.startsWith('rm:')) { l.history.splice(+act.slice(3), 1); l.sessions = Math.max(0, l.sessions - 1); return; }
      if (act === 'drop') { const e = E.easeOff(l); l.weight = e.w; l.targets = [...e.reps]; l.missStreak = 0; return; }
      l.weight = f.weight === '' ? null : +f.weight;
      l.sets = Math.max(1, Math.round(+f.sets || l.sets));
      l.lo = Math.max(1, Math.round(+f.lo || l.lo));
      l.hi = Math.max(l.lo, Math.round(+f.hi || l.hi));
      l.jump = +f.jump || l.jump;
      l.rest = Math.round(+f.rest || l.rest);
      l.kind = f.kind;
      l.style = f.style === 'top' ? 'top' : 'straight';
      l.drop = !!f.drop;
      l.opt = !!f.opt;
      l.goal = +f.gw ? { w: +f.gw, reps: Math.round(+f.gr) || 0 } : null;
      l.warm = +f.ww ? { w: +f.ww, reps: Math.round(+f.wr) || null } : null;
      if (l.targets) {
        const t = l.targets.slice(0, l.sets);
        while (t.length < l.sets) t.push(t[t.length - 1]);
        l.targets = t.map(r => Math.min(l.hi, Math.max(1, r)));
      }
    }));
}

function addLiftSheet(day) {
  openSheet(`Add to ${day} day`,
    field('Name', '<input name="name" type="text" autocomplete="off" autocapitalize="words" maxlength="40" required placeholder="Barbell row">') +
    field('Equipment', '<select name="kind"><option value="barbell">Barbell</option><option value="dumbbell">Dumbbells</option><option value="stack">Cable or machine stack</option><option value="other">Something else</option></select>') +
    `<div class="pair">${field('Reps from', stepper('lo', 8, 1, 1, 50, 'Lowest reps'))}${field('Reps to', stepper('hi', 12, 1, 1, 50, 'Highest reps'))}</div>` +
    field('Sets', stepper('sets', 3, 1, 1, 8, 'Sets')) +
    '<label class="check"><input type="checkbox" name="extra"><span>Extra: counts only when I say I did it</span></label>',
    'Add lift',
    f => commit(S => {
      settle(S);
      const name = f.name.trim();
      const old = Object.values(S.lifts).find(l => l.name.toLowerCase() === name.toLowerCase());
      const id = old?.id ?? 'l' + uid();
      if (!old) {
        const lo = Math.max(1, Math.round(+f.lo || 8)), hi = Math.max(lo, Math.round(+f.hi || 12));
        S.lifts[id] = { id, name, kind: f.kind, sets: Math.max(1, Math.round(+f.sets || 3)), lo, hi, jump: 5, rest: f.kind === 'barbell' ? 150 : 90, weight: null, targets: null, sessions: 0, missStreak: 0, history: [], opt: !!f.extra, style: 'straight', warm: null, goal: null, drop: false };
      }
      if (!Object.values(S.order).flat().includes(id)) S.order[day].push(id);
    }));
}

function weightSheet(id) {
  const l = S.lifts[id], g = S.draft?.log[id];
  openSheet('Different weight today', field('Pounds', stepper('w', g?.w ?? l.weight, l.jump, 0, 1000, 'Weight in pounds')), 'Use it',
    f => commit(S => { E.entry(S.draft, id).w = +f.w; }));
}

function repsSheet() {
  openSheet('How many reps', field('Reps', stepper('n', 0, 1, 0, 60, 'Reps')), 'Log set', f => logSet(Math.max(0, Math.round(+f.n || 0))));
}

/* ---------- Actions ---------- */

function now() {
  const d = new Date();
  return { date: today(), hour: d.getHours(), time: d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) };
}

function addFood(f) {
  const snap = snapshot();
  commit(S => E.logFood(S, { ...f, ...now(), id: uid() }));
  say(`${f.name || 'Protein'}, ${f.protein} g.`, snap);
}

const acts = {
  open: n => openPanel(n.dataset.panel),
  close: closePanel,
  go: () => openPanel('go'),
  goals: () => goalsSheet(false),
  sync: syncSheet,
  sleep: () => sleepSheet(),
  'sleep-on': n => sleepSheet(n.dataset.date),
  'weigh-on': n => weighSheet(n.dataset.date),
  days: () => openPanel('days'),
  'log-day': n => commit(S => { delete (S.off ||= {})[n.dataset.date]; E.assumeDay(S, n.dataset.date); }),
  'week-now': () => { weekTried = 0; maybeWeekly(); drawWeek(); },
  'open-day': n => { ui.date = n.dataset.date; openPanel('day'); },
  'day-step': n => { const next = addDays(ui.date, +n.dataset.dir); ui.date = next > today() ? today() : next; drawDay(); },
  'add-food-on': n => {
    const date = n.dataset.date;
    openSheet('Add food', foodFields(), 'Log it', f => { const snap = snapshot(); const x = foodFrom(f, 'form'); commit(S => E.logFood(S, { ...x, ...now(), date, time: date === today() ? now().time : '', id: uid() })); say(`${x.name || 'Protein'}, ${x.protein} g.`, snap); });
  },
  'edit-session': n => sessionSheet(n.dataset.date, n.dataset.id),
  'del-session': n => {
    const date = n.dataset.date;
    openSheet('Remove this workout', '<p class="sub">Removes this day\'s workout and its entries in each lift\'s history. Food and sleep stay. Next time\'s plans stay as they are.</p>', 'Remove the workout',
      () => commit(S => {
        const sess = S.sessions.find(s => s.date === date);
        if (!sess) return;
        for (const note of sess.notes) {
          const l = S.lifts[note.id], i = l ? l.history.findIndex(e => e.d === date) : -1;
          if (i >= 0) { l.history.splice(i, 1); l.sessions = Math.max(0, l.sessions - 1); }
        }
        (S.off ||= {})[date] = true;       // so it is not logged as written again
        const last = S.sessions[S.sessions.length - 1] === sess;
        S.sessions = S.sessions.filter(s => s !== sess);
        if (last) S.pointer = (S.pointer - 1 + S.rotation.length) % S.rotation.length;
      }));
  },
  'add-food': foodSheet,
  weigh: weighSheet,
  'edit-food': n => {
    const x0 = S.foodLog.find(x => x.id === n.dataset.id);
    if (!x0) return;
    openSheet('Edit food', foodFields(x0).replace(/<label class="check">[\s\S]*?<\/label>/, '') + '<button class="link quiet" name="do" value="del">Remove this entry</button>', 'Save',
      (f, act) => commit(S => {
        if (act === 'del') { S.foodLog = S.foodLog.filter(x => x.id !== x0.id); return; }
        const x = S.foodLog.find(y => y.id === x0.id);
        if (!x) return;
        Object.assign(x, { name: (f.name || '').trim(), protein: Math.round(+f.protein || 0), calories: Math.round(+f.calories || 0), carbs: Math.round(+f.carbs || 0), fat: Math.round(+f.fat || 0) });
      }));
  },
  backup: async () => {
    const file = new File([JSON.stringify(S)], `plate-backup-${today()}.json`, { type: 'application/json' });
    try { if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); return; } } catch (e) { if (e.name === 'AbortError') return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file); a.download = file.name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  },
  restore: () => el('restore').click(),
  'close-sheet': closeSheet,
  tab: n => { ui.tab = n.dataset.day; drawLift(); },
  lift: n => liftSheet(n.dataset.id),
  'add-lift': n => addLiftSheet(n.dataset.day),
  weight: n => weightSheet(n.dataset.id),
  'other-reps': repsSheet,
  reps: n => logSet(+n.dataset.n),
  'pick-set': n => { ui.go = { id: ui.go.id, set: +n.dataset.i }; drawGo(); },
  'go-step': n => stepLift(+n.dataset.dir),
  'go-next': () => { ui.go = null; drawGo(); },
  'go-pick': pickSheet,
  'rest-add': () => commit(S => { S.draft.rest.until += 15000; S.draft.rest.total += 15; }),
  'rest-skip': () => commit(S => { S.draft.rest = null; }),
  finish: () => commit(S => { S.draft.done = true; S.draft.rest = null; }),
  'as-written': () => {
    const snap = snapshot();
    const day = S.draft?.day ?? E.dayFor(S, today());
    commit(S => { delete (S.off ||= {})[today()]; E.ensureDraft(S, today()).done = true; });
    say(`${cap(day)} logged as written.`, snap);
  },
  usual: n => {
    const f = S.foods.find(x => x.id === n.dataset.id);
    closeCompose();
    if (f) addFood({ name: f.name, protein: f.protein, calories: f.calories || 0, carbs: f.carbs || 0, fat: f.fat || 0, source: 'usual' });
  },
  'del-food': n => {
    const snap = snapshot();
    commit(S => { S.foodLog = S.foodLog.filter(x => x.id !== n.dataset.id); });
    say('Removed.', snap);
  },
  undo: () => { if (undoSnap) { restore(undoSnap); hideSay(); } },
  compose: () => openCompose(false),
  'compose-close': closeCompose,
  photo: () => el('cam').click(),
  'go-lift': n => {
    if (E.sessionOn(E.project(S), today())) { openPanel(S.draft ? 'go' : 'lift'); return; }
    openPanel('go');
    const id = n.dataset.id;
    if (S.draft && E.idsOf(S, S.draft.day, S.draft.log).includes(id) && !S.draft.log[id]?.skip) { ui.go = { id, set: firstOpen(id) }; drawGo(); }
  },
};

// The camera opens straight away. The photo is shrunk, shown once, and sent to
// be read if the AI is connected. It is never saved on the phone.
const SOURCE = { label: 'From the label', published: 'Published numbers', matched: 'Matched online', saved: 'Saved from last time', standard: 'Standard values', estimate: 'Estimate' };

function shrink(file) {
  return new Promise((done, fail) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1280 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      done(c.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = fail;
    img.src = URL.createObjectURL(file);
  });
}

// The sheet where a photo's numbers are checked before they are logged.
function shotSheet(shot, v, line) {
  openSheet(v ? 'Check it' : 'What was it',
    `<img class="shot" src="${shot}" alt="The photo you just took"><p class="sub">${line}</p>` + foodFields(v || {}),
    'Log it', f => addFood(foodFrom(f, v ? 'photo' : 'form')));
}

el('cam').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let shot;
  try { shot = await shrink(file); } catch (err) { say('Could not open that photo.'); return; }
  if (!Sync.connected()) { shotSheet(shot, null, 'The AI will fill this in from the photo once it is connected. For now, enter it here.'); return; }

  // One optional line of context, then the lookup.
  openSheet('Anything to add',
    `<img class="shot" src="${shot}" alt="The photo you just took">` +
    field('Where it is from or what you ordered', '<input name="note" type="text" autocomplete="off" autocapitalize="sentences" maxlength="120" placeholder="Chipotle, double chicken">', 'Leave it empty and the photo is read on its own.'),
    'Read it',
    async f => {
      say('Reading the photo and looking it up.');
      try {
        const m = await Sync.see(shot.split(',')[1], (f.note || '').trim());
        hideSay();
        shotSheet(shot, m, `${SOURCE[m.source] || 'Estimate'}${m.where ? ', ' + esc(m.where) : ''}. ${esc(m.detail || '')}`);
      } catch (err) {
        const why = err instanceof TypeError || err?.name === 'TimeoutError' ? 'offline' : err.message;
        hideSay();
        shotSheet(shot, null, why === 'unreadable' ? 'Could not make that out. Enter it here.' : `${problem(why)} Enter it here for now.`);
      }
    });
});

// After the keyboard goes away an iPhone can leave the screen shifted up.
// Put it back.
document.addEventListener('focusout', () => setTimeout(() => scrollTo(0, 0), 60));

document.addEventListener('click', e => {
  const st = e.target.closest('[data-step]');
  if (st) {
    const inp = st.parentElement.querySelector('input');
    const v = (parseFloat(inp.value) || 0) + parseFloat(st.dataset.step);
    inp.value = +Math.min(+inp.max, Math.max(+inp.min, v)).toFixed(2);
    return;
  }
  const n = e.target.closest('[data-act]');
  if (n && acts[n.dataset.act]) { acts[n.dataset.act](n); return; }
  if (e.target === sheet) closeSheet();
  if (e.target === el('compose')) closeCompose();   // a tap outside the box puts it away
});

document.addEventListener('submit', e => {
  const form = e.target;
  if (form.classList.contains('sheetform')) {
    const data = Object.fromEntries(new FormData(form));
    const h = onSheet;
    onSheet = null;
    onClose = null;
    if (h) h(data, e.submitter?.value);
    return; // method="dialog" closes the sheet
  }
  e.preventDefault();
  if (form.dataset.form === 'first-weight') {
    const w = +new FormData(form).get('w');
    commit(S => { S.lifts[form.dataset.id].weight = w; });
  } else if (form.id === 'dock') {
    const words = el('q').value.trim();
    closeCompose();
    if (words) handleText(words);
  }
});

// iPhones only show a pressed state when something is listening for touches.
document.addEventListener('touchstart', () => {}, { passive: true });
// No pinch zoom: this is an app screen, not a page.
document.addEventListener('gesturestart', e => e.preventDefault());

/* ---------- Typing and talking ---------- */

let undoSnap = null, sayTimer = 0;

function say(words, snap) {
  const node = el('say');
  undoSnap = snap || null;
  node.innerHTML = `<span>${esc(words)}</span>${snap ? '<button class="link" type="button" data-act="undo">Undo</button>' : ''}`;
  node.hidden = false;
  clearTimeout(sayTimer);
  sayTimer = setTimeout(hideSay, snap ? 7000 : 9000);
}
function hideSay() { el('say').hidden = true; undoSnap = null; }

function openCompose(spoken) {
  const us = E.usuals(S, new Date().getHours()).slice(0, 8);
  patch(el('c-hints'),
    (spoken ? '<p class="sub">Tap the mic on your keyboard and talk. Hold-to-talk on the big button comes with the AI connection.</p>' : '') +
    (us.length ? `<p class="cap">One tap</p><div class="chips">${us.map(usualChip).join('')}</div>`
      : spoken ? '' : '<p class="sub">Like "40g chicken", "slept 7.5" or "bench last set 6".</p>'));
  el('compose').hidden = false;
  const q = el('q');
  q.value = '';
  q.focus();
}

function closeCompose() {
  if (el('compose').hidden) return;
  if (rec) rec.stop();
  el('q').blur();
  el('compose').hidden = true;
}

// Where the browser can listen by itself it does. An iPhone home-screen app
// cannot, so there the keyboard's own dictation key does the listening.
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const homeScreen = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const iOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
let rec = null;

function talk() {
  if (!SR || (iOS && homeScreen)) { openCompose(true); return; }
  openCompose(false);
  const q = el('q');
  q.placeholder = 'Listening';
  rec = new SR();
  rec.lang = 'en-US';
  rec.interimResults = true;
  rec.onresult = ev => { q.value = [...ev.results].map(r => r[0].transcript).join(''); };
  rec.onend = () => {
    rec = null;
    q.placeholder = 'What did you do?';
    if (!el('compose').hidden && q.value.trim()) el('dock').requestSubmit();
  };
  rec.onerror = () => {};
  rec.start();
}

/* ---------- Hold to talk ---------- */

// Hold the big button, speak, let go. The recording goes to be turned into
// words and is then read like anything typed. It is never saved on the phone.
// Without the AI connection the button falls back to the typing box.
const mic = el('mic');
let stream = null, recorder = null, chunks = [], heldAt = 0, holding = false;

async function startTalking() {
  holding = true;
  heldAt = Date.now();
  mic.classList.add('live');
  try {
    if (!stream || !stream.active) stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true } });
  } catch (e) {
    holding = false;
    mic.classList.remove('live');
    say('The microphone is blocked. Allow it for this app in Settings, or type instead.');
    return;
  }
  if (!holding) return;                    // let go before the mic was ready
  chunks = [];
  const type = ['audio/mp4', 'audio/webm'].find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t));
  recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  recorder.onstop = sendTalk;
  recorder.start();
}

function stopTalking() {
  if (!holding) return;
  holding = false;
  mic.classList.remove('live');
  if (recorder && recorder.state !== 'inactive') recorder.stop();
  else if (Date.now() - heldAt < 400) say('Hold the button while you talk.');
}

async function sendTalk() {
  const held = Date.now() - heldAt;
  const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/mp4' });
  recorder = null;
  if (held < 400 || blob.size < 800) { say('Hold the button while you talk.'); return; }
  say('Listening back.');
  try {
    const data = await new Promise((done, fail) => { const r = new FileReader(); r.onload = () => done(String(r.result).split(',')[1]); r.onerror = fail; r.readAsDataURL(blob); });
    const words = await Sync.hear(data, blob.type);
    if (!words) { say('Did not catch anything. Try again.'); return; }
    handleText(words);
  } catch (e) {
    const why = e instanceof TypeError || e?.name === 'TimeoutError' ? 'offline' : e.message;
    say(problem(why));
  }
}

mic.addEventListener('pointerdown', e => {
  e.preventDefault();
  // Say plainly why voice is not available, so it is never a silent fallback.
  if (!Sync.connected()) { say('Voice needs the connection first. Open Goals, then Sync and AI reader, and enter your passphrase.'); return; }
  if (!navigator.mediaDevices || !window.MediaRecorder) { say('This phone is not letting the app record. Use the keyboard button instead.'); return; }
  mic.setPointerCapture(e.pointerId);
  startTalking();
});
mic.addEventListener('pointerup', stopTalking);
mic.addEventListener('pointercancel', stopTalking);
mic.addEventListener('contextmenu', e => e.preventDefault());
// Let go of the microphone when the app is put away.
document.addEventListener('visibilitychange', () => { if (document.hidden && stream) { stream.getTracks().forEach(t => t.stop()); stream = null; } });

// Put one reading into the log. Returns the line to show and whether it can be undone.
function act(r, t, day) {
  const closed = !S.draft && E.sessionOn(S, t);
  let msg, undo = true, tag = '';

  if (r.type === 'sleep') {
    commit(S => { S.sleep[t] = r.hours; });
    msg = `Sleep: ${fmtH(r.hours)}.`; tag = 'sleep';
  } else if (r.type === 'food') {
    commit(S => {
      E.logFood(S, { name: r.name, protein: r.protein, calories: r.calories, carbs: r.carbs || 0, fat: r.fat || 0, source: r.source, where: r.where, keep: false, ...now(), id: uid() });
      // Looked up once, kept for next time.
      if (r.lookup && r.source !== 'estimate') E.keepKnown(S, r);
    });
    tag = r.name || 'protein';
    const what = r.n === 0.5 ? 'Half a ' + r.name.toLowerCase() : (r.n !== 1 ? r.n + ' × ' : '') + (r.name || 'Protein');
    const from = ['published', 'matched', 'saved', 'standard'].includes(r.source) ? SOURCE[r.source] : '';
    msg = from ? `${what}, ${r.protein} g protein, ${r.calories} cal. ${from}${r.where ? ', ' + r.where : ''}.` : `${what}, ${r.source === 'estimate' ? 'about ' : ''}${r.protein} g.`;
  } else if (r.type === 'done') {
    if (closed || S.draft?.done) { msg = 'Today is already logged.'; undo = false; }
    else if (S.free && !E.draftActive(S.draft)) { msg = 'Nothing is logged for today yet. Tell me what you lifted.'; undo = false; }
    else if (S.free) { msg = 'Today is saved. Anything you add later still goes in.'; undo = false; }
    else if (!E.canAssume(S, day) && !E.draftActive(S.draft)) { msg = `${cap(day)} is still learning your numbers. Log the sets in lifting mode.`; undo = false; }
    else { commit(S => { E.ensureDraft(S, t).done = true; }); msg = `${cap(day)} logged as written.`; }
  } else if (r.type === 'off') {
    if (S.draft?.date === t && E.draftActive(S.draft)) { msg = 'You already logged sets today. Tell me which lift you missed instead.'; undo = false; }
    else { commit(S => { (S.off ||= {})[t] = true; if (S.draft?.date === t) S.draft = null; }); msg = 'Okay. Today is marked as a day you did not lift.'; }
  } else if (r.type === 'weight') {
    commit(S => { (S.weights ||= {})[t] = r.lb; });
    msg = `Bodyweight: ${r.lb} lb.`;
  } else if (r.type === 'remove_food') {
    const last = [...S.foodLog].reverse().find(x => x.date === t);
    if (!last) { msg = 'Nothing logged today to remove.'; undo = false; }
    else { commit(S => { S.foodLog = S.foodLog.filter(x => x.id !== last.id); }); msg = `Removed ${last.name || 'the last entry'}.`; }
  } else if (r.type === 'demote') {
    // He does not do this one as a rule. It stays in the memory and stops being assumed.
    const l = S.lifts[r.id];
    commit(S => {
      S.lifts[r.id].opt = true; S.lifts[r.id].skips = 0;
      const g = S.draft?.log[r.id];
      if (g && (g.skip || (!g.did && g.w == null && !g.reps.some(x => x != null)))) delete S.draft.log[r.id];
    });
    msg = `Okay. ${l.name} is no longer assumed. It only counts when you say you did it.`;
  } else if (r.type === 'skip') {
    const l = S.lifts[r.id];
    if (closed) { msg = 'Today is already closed out, so there is nothing to skip.'; undo = false; }
    else if (l.opt && !S.draft?.log[r.id]) { msg = `${l.name} only counts when you say you did it, so nothing was assumed.`; undo = false; }
    else {
      commit(S => { const g = E.entry(E.ensureDraft(S, t), r.id); g.skip = true; delete g.did; });
      msg = `No ${l.name.toLowerCase()} today.${!l.opt && (l.skips || 0) >= 1 ? ' That is twice running, so I will stop assuming it.' : ''}`;
    }
  } else if (r.type === 'lift') {
    // Any lift he names is logged: one from today, one from another day, or one the
    // app has never seen. A new one goes into the memory on the spot.
    const fresh = !S.lifts[r.id];
    const id = fresh ? 'l' + uid() : r.id;
    if (fresh && !r.name) { msg = 'Could not tell which lift that was. Say its name again.'; undo = false; }
    else {
      const before = fresh ? { w: null, reps: null } : E.remembered(S.lifts[id]);
      const plan = fresh || S.free ? null : S.lifts[id].targets;
      commit(S => {
        if (fresh) E.addLift(S, { id, name: r.name, kind: r.kind, sets: r.sets || (Object.keys(r.reps).length > 1 ? Object.keys(r.reps).length : 0), day });
        const l = S.lifts[id];
        if (S.off?.[t]) delete S.off[t];
        if (closed) { E.addToSession(S, t, id, r.w, r.reps); return; }
        const g = E.entry(E.ensureDraft(S, t), id);
        delete g.skip;
        if (r.w != null) g.w = r.w;
        for (const [i, n] of Object.entries(r.reps)) if (+i < l.sets) g.reps[+i] = n;
        if (!g.reps.some(x => x != null)) g.did = true;
      });
      const l = S.lifts[id], n = Object.keys(r.reps).length;
      tag = l.name;
      const same = n > 1 && new Set(Object.values(r.reps)).size === 1 && n === l.sets;
      const bits = same ? [`${n} × ${Object.values(r.reps)[0]}`] : Object.entries(r.reps).map(([i, x]) => `set ${+i + 1}, ${x}${plan ? ` (plan ${plan[+i]})` : ''}`);
      if (same && r.w != null) bits[0] = `${E.fmtW(r.w)} × ${Object.values(r.reps)[0]}, ${n} sets`;
      else if (r.w != null) bits.unshift(`at ${E.fmtW(r.w)}`);
      const w = r.w ?? before.w;
      if (fresh) msg = bits.length ? `New lift, ${l.name}: ${bits.join('; ')}. I will remember it.` : `${l.name} is in your lifts now and counted for today. Tell me the weight and reps once and I will remember them.`;
      else if (n) msg = `${l.name}: ${bits.join('; ')}.`;
      else if (w != null && before.reps) msg = `${l.name}: ${E.fmtW(w)} × ${E.fmtReps(before.reps.slice(0, l.sets))}, as remembered.`;
      else msg = `${l.name} is counted for today. Tell me the weight and reps once and I will remember them.`;
    }
  } else {
    msg = 'Could not read that. Try "shake", "40g chicken", "slept 7.5" or "bench last set 6".';
    undo = false;
  }
  return [msg, undo, tag];
}

// One line for everything a message logged. More than two things are named, not spelled out:
// the numbers are on the home screen.
const sum = done => (done.length > 2 ? `Logged ${done.length}: ${done.map(d => d[2] || d[0].replace(/\.$/, '')).join(', ')}.` : done.map(d => d[0]).join(' '));

// A message with several things in it, read on the phone one piece at a time.
function applyParts(raw, bits, t, day) {
  const snap = snapshot(), done = [], missed = [];
  for (const b of bits) {
    const x = read(S, b, S.order[day]);
    const use = x.type === 'unread' ? x.maybe : x;
    if (!use || use.type === 'empty') { missed.push(b); continue; }
    done.push(act(use, t, day));
  }
  const msg = [sum(done), missed.length ? `Could not read: ${missed.join('; ')}.` : ''].filter(Boolean).join(' ');
  remember(raw, 'many', msg);
  say(msg, done.some(d => d[1]) ? snap : null);
}

// What the AI reader sends back, put into the shape the phone's own reader uses.
function fromReader(a) {
  if (a.type === 'food') return { type: 'food', name: a.name, protein: a.protein, calories: a.calories, carbs: a.carbs, fat: a.fat, detail: a.detail || '', n: 1, place: a.place || '', amount: a.amount || '', home: !!a.home, lookup: a.kind === 'lookup', source: a.source || (a.estimated ? 'estimate' : 'typed') };
  if (a.type === 'sleep') return { type: 'sleep', hours: a.hours };
  if (a.type === 'session_done') return { type: 'done' };
  if (a.type === 'remove_last_food') return { type: 'remove_food' };
  if (a.type === 'skip_lift' && S.lifts[a.lift_id]) return { type: 'skip', id: a.lift_id };
  if (a.type === 'drop_lift' && S.lifts[a.lift_id]) return { type: 'demote', id: a.lift_id };
  if (a.type === 'lift') {
    const reps = Object.fromEntries((a.reps || []).map(x => [x.set - 1, x.reps]));
    if (S.lifts[a.lift_id]) return { type: 'lift', id: a.lift_id, w: a.weight, reps };
    // A lift the app has never seen. If the name is one it does know, use that one.
    const name = String(a.name || '').trim();
    const old = Object.values(S.lifts).find(l => l.name.toLowerCase() === name.toLowerCase());
    if (old) return { type: 'lift', id: old.id, w: a.weight, reps };
    if (name) return { type: 'lift', name, kind: a.equipment, sets: a.sets, w: a.weight, reps };
  }
  return null;
}

// What the AI reader needs to know to read a message: every lift he has, with what is
// remembered for each, and the usual foods.
function readerContext(day) {
  return {
    day,
    lifts: Object.entries(S.order).flatMap(([d, ids]) => ids.map(id => { const l = S.lifts[id], m = E.remembered(l); return { id, name: l.name, usual_day: d, assumed_today: d === day && !l.opt, sets: l.sets, reps: m.reps, weight: m.w }; })),
    usuals: E.usuals(S, new Date().getHours()).slice(0, 40).map(f => ({ name: f.name, protein: f.protein, calories: f.calories || 0, carbs: f.carbs || 0, fat: f.fat || 0 })),
    known: (S.known || []).slice(-60).map(f => ({ name: f.name, place: f.place, amount: f.amount, protein: f.protein, calories: f.calories, carbs: f.carbs, fat: f.fat })),
    recent: S.messages.slice(-6).map(m => ({ said: m.text, did: m.did || '' })),
  };
}

const remember = (words, type, did = '') => commit(S => { S.messages.push({ at: Date.now(), text: String(words).slice(0, 600), type, did: String(did).slice(0, 300) }); if (S.messages.length > 300) S.messages.shift(); });

// Show estimated foods one at a time with the numbers editable. Saving one as a
// usual means the next time it is exact, not guessed.
function reviewFoods(list) {
  const f = list.shift();
  if (!f) return;
  openSheet(`Check the estimate${list.length ? ` (${list.length} more after)` : ''}`,
    `<p class="sub">${f.lookup ? 'Nothing was found online for this, so it is a guess.' : 'This is a guess, so check it before it counts.'}${f.detail ? ' ' + esc(f.detail) : ''} Change any number you know is different. What you log here is remembered for next time.</p>` +
    foodFields({ name: f.name, protein: f.protein, calories: f.calories, carbs: f.carbs, fat: f.fat }),
    'Log it',
    form => { const x = foodFrom(form, 'estimate'); addFood(x); if (f.lookup) commit(S => E.keepKnown(S, { ...x, place: f.place, amount: f.amount, source: 'yours' })); setTimeout(() => reviewFoods(list), 80); });
}

async function handleText(raw) {
  const t = today();
  const day = S.draft?.day ?? E.dayFor(S, today());
  const r = read(S, raw, S.order[day]);

  // The phone reads the common messages itself, with no wait. With no connection it
  // also takes its own best reading of a lift it has never seen.
  // A message that names several things is read whole by the AI reader, so none of it
  // is dropped. With no connection the phone takes it one piece at a time.
  const bits = parts(raw), many = bits.length > 1;
  if (many && !Sync.connected()) { applyParts(raw, bits, t, day); return; }
  if (!many && (r.type !== 'unread' || !Sync.connected())) {
    const snap = snapshot();
    const use = r.type === 'unread' && r.maybe ? r.maybe : r;
    const [msg, undo] = act(use, t, day);
    remember(raw, use.type, msg);
    say(msg, undo ? snap : null);
    return;
  }

  // Anything else goes to the AI reader.
  say('Reading.');
  try {
    const out = await Sync.ask(raw, readerContext(day));
    const read_ = (out.actions || []).map(fromReader).filter(Boolean);
    // Anything ordered or cooked is looked up online before it is logged.
    const look = read_.filter(a => a.type === 'food' && a.lookup);
    if (look.length) {
      say(`Looking up ${look.map(a => (a.place ? `${a.name} from ${a.place}` : a.name)).join(' and ')} online.`);
      let got = null;
      try { got = await Sync.find(look.map(a => ({ name: a.name, place: a.place, amount: a.amount, home: a.home })), raw); } catch (e) { got = null; }
      look.forEach((a, i) => {
        const g = got?.items?.[i];
        if (g) Object.assign(a, { protein: g.protein, calories: g.calories, carbs: g.carbs, fat: g.fat, source: g.source, where: g.where || '', detail: g.detail || '' });
        else { a.source = 'estimate'; a.detail = got ? '' : 'The lookup did not go through.'; }
      });
    }
    const snap = snapshot();
    // A food that is still a guess is shown for checking, not logged straight away.
    const est = read_.filter(a => a.type === 'food' && a.source === 'estimate');
    const done = read_.filter(a => !est.includes(a)).map(a => act(a, t, day));
    remember(raw, 'ai', done.map(d => d[0]).join(' ') || out.note || '');
    if (est.length) { say(done.length ? sum(done) + ' Check the estimate next.' : 'Check the estimate before it is logged.'); setTimeout(() => reviewFoods(est), 60); return; }
    if (!done.length) { say(out.note || 'Nothing in that to log.'); return; }
    say(sum(done) + (out.note ? ' ' + out.note : ''), done.some(d => d[1]) ? snap : null);
  } catch (e) {
    // The reader could not be reached. A lift is still logged from the phone's own reading.
    if (many) { applyParts(raw, bits, t, day); return; }
    if (r.type !== 'unread' || r.maybe) { const snap = snapshot(); const [msg, undo] = act(r.maybe || r, t, day); remember(raw, 'lift', msg); say(msg, undo ? snap : null); return; }
    remember(raw, 'unread');
    const why = e instanceof TypeError || e?.name === 'TimeoutError' ? 'offline' : e.message;
    say(`${problem(why)} For now, type a usual, grams, or a lift and reps.`);
  }
}

/* ---------- Keeping the screen current ---------- */

let lock = null;
async function keepAwake(on) {
  try {
    if (on && !lock && navigator.wakeLock) { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => { lock = null; }); }
    if (!on && lock) { await lock.release(); lock = null; }
  } catch (e) { /* not allowed right now */ }
}

function refresh() {
  drawHome();
  if (ui.panel) draw[ui.panel]();
}
subscribe(refresh);

// The rest clock ticks by changing two things, not by redrawing the screen.
setInterval(() => {
  const r = S.draft?.rest;
  if (ui.panel !== 'go' || !r) return;
  const left = r.until - Date.now();
  if (left <= 0) { commit(S => { S.draft.rest = null; }); return; }
  const c = el('clock');
  if (c) { text(c, mmss(left)); fill(el('restbar'), left / (r.total * 1000)); }
}, 250);

function wake() {
  // A session left open from an earlier day closes itself, and every planned day that
  // passed with nothing logged counts as done as written. Both are real changes, so
  // they go through commit and get saved like any other.
  const t = today();
  if ((S.draft && S.draft.date !== t) || E.autoPending(S, t).length) commit(S => { E.rollOver(S, t); E.autoLog(S, t); });
  else refresh();
  maybeWeekly();
  if (ui.panel === 'go') keepAwake(!S.draft?.done);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });

el('restore').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch (err) { data = null; }
  if (!data || !data.lifts || !data.order || !data.profile) { say('That file is not a Plate backup.'); return; }
  openSheet('Restore a backup', '<p class="sub">This replaces everything on this phone with the backup. It cannot be undone.</p>', 'Replace what is on this phone',
    () => { adopt(data); commit(() => {}); say('Backup restored.'); });
});

// Your push-day starting numbers go in once, and only for lifts with nothing logged.
if (!S.baseline1) commit(S => E.applyBaseline(S, today()));
// Then his real program (all three days, the weekly schedule, and Monday's push) goes in once.
if (!S.baseline2) commit(S => E.applyBaseline2(S));
if (!S.baseline3) commit(S => E.applyBaseline3(S));
// He does not do rows as a rule, so they stop being assumed.
if (!S.baseline4) commit(S => E.applyBaseline4(S));
// No written workout: nothing is assumed, he says what he did.
if (!S.baseline5) commit(S => E.applyBaseline5(S));

shell();
wake();
Sync.start();
if (!S.setup) goalsSheet(true);

if ('serviceWorker' in navigator && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
  navigator.serviceWorker.register('sw.js');
}
