import { S, commit, save, today, weekOf, snapshot, restore, subscribe, uid } from './store.js';
import * as E from './engine.js';
import { read } from './parse.js';
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

const ui = { panel: null, tab: null, go: null };

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
  const day = d?.day ?? V.rotation[V.pointer];
  const ids = S.order[day];
  text(el('h-date'), new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }));

  // The top of the screen is today's session: its name, one button, and the
  // lifts themselves with what is planned for each.
  const planOf = l => (l.weight == null ? 'new' : `${E.fmtW(l.weight)} × ${l.targets ? E.fmtReps(l.targets) : `${l.lo}–${l.hi}`}`);
  const listFor = (dayName, log) => S.order[dayName].map(id => {
    const l = V.lifts[id], g = log?.[id];
    const n = (g?.reps || []).filter(x => x != null).length;
    const state = g?.skip ? 'skipped' : n >= l.sets ? 'done' : n ? `${n} of ${l.sets}` : planOf(l);
    return `<li><button type="button" data-act="go-lift" data-id="${id}"><span>${esc(l.name)}</span><b>${state}</b></button></li>`;
  }).join('');

  let title = day, sub = '', button = '', list = '', under = '';
  if (done) {
    const nextDay = V.rotation[V.pointer];
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

const panels = { lift: el('p-lift'), food: el('p-food'), go: el('p-go') };
const draw = { lift: drawLift, food: drawFood, go: drawGo };

function openPanel(name) {
  if (name === 'go' && !S.draft && !E.sessionOn(S, today())) { E.ensureDraft(S, today()); save(); }
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
      <span class="ls cap k-${s.k}">${s.label}</span>
    </button>`;
}

function drawLift() {
  const V = E.project(S);
  if (!ui.tab || !V.rotation.includes(ui.tab)) ui.tab = V.draft?.day ?? V.rotation[V.pointer];
  const all = Object.values(V.order).flat().map(id => V.lifts[id]);
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
  const cals = E.caloriesOn(S, t), cGoal = S.profile.calories;
  roll(el('f-big'), p);
  text(el('f-of'), `of ${goal} g protein`);
  fill(el('f-arc'), p / goal);
  text(el('f-note'), [p >= goal ? 'Protein goal met' : `${goal - p} g to go`, cGoal ? `${num(cals)} of ${num(cGoal)} calories` : ''].filter(Boolean).join(' · '));
  const us = E.usuals(S, new Date().getHours()).slice(0, 7);
  patch(el('f-usuals'), `<button class="chip add" type="button" data-act="add-food">Add food</button>${us.map(usualChip).join('')}`);
  const list = S.foodLog.filter(f => f.date === t).reverse();
  patch(el('f-list'), list.length ? `<ul class="eaten">${list.map(f => `<li>
      <span class="when">${esc(f.time)}</span>
      <span class="what">${esc(f.name || 'Protein')}</span>
      <b>${f.protein} g</b>
      <button class="iconbtn sm" type="button" data-act="del-food" data-id="${f.id}" aria-label="Remove ${esc(f.name || 'entry')}">${icon.close}</button>
    </li>`).join('')}</ul>` : '<p class="empty">Nothing eaten yet today.</p>');
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
  const d = S.draft, ids = S.order[d.day];
  const g = ui.go;
  if (g && ids.includes(g.id) && !d.log[g.id]?.skip) return g;
  const c = E.cursor(S);
  if (c) return (ui.go = { id: c.id, set: c.set });
  return (ui.go = { id: ids.find(id => !d.log[id]?.skip) ?? ids[0], set: null });
}

function closeLine(d) {
  let sets = 0, short = 0, skipped = 0;
  for (const id of S.order[d.day]) {
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

  const ids = S.order[d.day];
  const g = selected();
  const l = S.lifts[g.id], log = d.log[g.id], w = log?.w ?? l.weight;

  patch(el('g-top'), `
    <button class="iconbtn" type="button" data-act="close" aria-label="Leave lifting mode">${icon.down}</button>
    <button class="where cap" type="button" data-act="go-pick">${d.day} · ${ids.indexOf(g.id) + 1} of ${ids.length}</button>
    <span class="pair">
      <button class="iconbtn" type="button" data-act="go-step" data-dir="-1" aria-label="Previous lift">${icon.prev}</button>
      <button class="iconbtn" type="button" data-act="go-step" data-dir="1" aria-label="Next lift">${icon.next}</button>
    </span>`);
  text(el('g-name'), l.name);

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

const KIND = { jump: 'Weight goes up', hit: 'One more rep', short: 'Same again', ahead: 'New weight', learned: 'Plan set', learning: 'Learning', skipped: 'Skipped' };

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
      <p class="sub">${cap(V.rotation[V.pointer])} is up next. If a set went differently, say so any time today.</p>
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
  const d = S.draft, live = S.order[d.day].filter(id => !d.log[id]?.skip);
  if (!live.length) return;
  const at = live.indexOf(ui.go?.id);
  const id = live[(at + dir + live.length) % live.length];
  ui.go = { id, set: firstOpen(id) };
  drawGo();
}

function pickSheet() {
  const d = S.draft;
  const rows = S.order[d.day].map(id => {
    const l = S.lifts[id], g = d.log[id];
    const n = (g?.reps || []).filter(x => x != null).length;
    return `<div class="pick">
        <button class="lift" name="do" value="jump:${id}" ${g?.skip ? 'disabled' : ''}>
          <span class="ln">${esc(l.name)}</span>
          <span class="lw"><i>${g?.skip ? 'Skipped' : `${n} of ${l.sets} sets`}</i></span>
        </button>
        <button class="link quiet" name="do" value="skip:${id}">${g?.skip ? 'Bring back' : 'Skip'}</button>
      </div>`;
  }).join('');
  openSheet(`${cap(d.day)} day`, `<p class="sub">Do them in any order. Tap one to go to it.</p>${rows}`, 'Close', (f, act) => {
    const [what, id] = String(act || '').split(':');
    if (what === 'jump') { ui.go = { id, set: firstOpen(id) }; drawGo(); }
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
    field('Calories per day', `<input name="calories" type="number" inputmode="numeric" min="0" max="9000" value="${p.calories || ''}" placeholder="Leave empty to skip">`) +
    (first ? '' : `<button class="link quiet" type="button" data-act="sync">${Sync.connected() ? 'Sync is on' : 'Sync and AI reader'}</button>`),
    first ? 'Start' : 'Save',
    f => commit(S => {
      S.profile = { protein: +f.protein || 180, days: Math.min(7, Math.max(1, +f.days || 5)), sleep: +f.sleep || 8, calories: +f.calories || 0 };
      S.setup = true;
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
  say(r.ok ? (r.took === 'saved' ? 'Connected. Your saved copy is on this phone now.' : 'Connected. This phone is saved.') : problem(r.error));
}

function sleepSheet() {
  openSheet('Last night', field('Hours slept', stepper('hours', S.sleep[today()] ?? S.profile.sleep, 0.25, 0, 16, 'Hours slept')), 'Save',
    f => { const snap = snapshot(); commit(S => { S.sleep[today()] = +f.hours; }); say(`Sleep: ${fmtH(+f.hours)}.`, snap); });
}

function foodSheet() {
  openSheet('Add food',
    field('What was it', '<input name="name" type="text" autocomplete="off" autocapitalize="sentences" maxlength="40" placeholder="Protein shake">') +
    field('Protein, grams', stepper('protein', 30, 5, 0, 300, 'Protein in grams')) +
    field('Calories', '<input name="calories" type="number" inputmode="numeric" min="0" max="5000" placeholder="Leave empty to skip">') +
    '<label class="check"><input type="checkbox" name="keep" checked><span>Keep as a usual</span></label>',
    'Log it',
    f => addFood({ name: (f.name || '').trim(), protein: Math.round(+f.protein || 0), calories: +f.calories || 0, keep: !!f.keep, source: 'form' }));
}

// Editing the program closes out a finished session first, so the edit
// lands on next time's plan and not on today's record.
const settle = S => { if (S.draft?.done) E.finalize(S); };

function liftSheet(id) {
  const l = S.lifts[id], s = E.status(l);
  const hist = l.history.slice(-5).reverse().map(e => `<li><span class="when">${new Date(e.d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
      <span class="what">${E.fmtW(e.w)}</span>
      <span class="marks">${e.reps.map((r, i) => (e.plan && r < e.plan[i] ? `<span class="mk short"><s>${e.plan[i]}</s>${r}</span>` : `<span class="mk">${r}</span>`)).join('')}</span></li>`).join('');
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
    `<button class="link quiet" name="do" value="retire">Take this lift out of the program</button>`,
    'Save',
    (f, act) => commit(S => {
      settle(S);
      const l = S.lifts[id];
      if (act === 'retire') { for (const k of Object.keys(S.order)) S.order[k] = S.order[k].filter(x => x !== id); return; }
      if (act === 'drop') { const e = E.easeOff(l); l.weight = e.w; l.targets = [...e.reps]; l.missStreak = 0; return; }
      l.weight = f.weight === '' ? null : +f.weight;
      l.sets = Math.max(1, Math.round(+f.sets || l.sets));
      l.lo = Math.max(1, Math.round(+f.lo || l.lo));
      l.hi = Math.max(l.lo, Math.round(+f.hi || l.hi));
      l.jump = +f.jump || l.jump;
      l.rest = Math.round(+f.rest || l.rest);
      l.kind = f.kind;
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
    field('Sets', stepper('sets', 3, 1, 1, 8, 'Sets')),
    'Add lift',
    f => commit(S => {
      settle(S);
      const name = f.name.trim();
      const old = Object.values(S.lifts).find(l => l.name.toLowerCase() === name.toLowerCase());
      const id = old?.id ?? 'l' + uid();
      if (!old) {
        const lo = Math.max(1, Math.round(+f.lo || 8)), hi = Math.max(lo, Math.round(+f.hi || 12));
        S.lifts[id] = { id, name, kind: f.kind, sets: Math.max(1, Math.round(+f.sets || 3)), lo, hi, jump: 5, rest: f.kind === 'barbell' ? 150 : 90, weight: null, targets: null, sessions: 0, missStreak: 0, history: [] };
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
  sleep: sleepSheet,
  'add-food': foodSheet,
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
    const day = S.draft?.day ?? S.rotation[S.pointer];
    commit(S => { E.ensureDraft(S, today()).done = true; });
    say(`${cap(day)} logged as written.`, snap);
  },
  usual: n => {
    const f = S.foods.find(x => x.id === n.dataset.id);
    closeCompose();
    if (f) addFood({ name: f.name, protein: f.protein, calories: f.calories || 0, source: 'usual' });
  },
  'del-food': n => {
    const snap = snapshot();
    commit(S => { S.foodLog = S.foodLog.filter(x => x.id !== n.dataset.id); });
    say('Removed.', snap);
  },
  undo: () => { if (undoSnap) { restore(undoSnap); hideSay(); } },
  compose: () => openCompose(false),
  'compose-close': closeCompose,
  mic: talk,
  photo: () => el('cam').click(),
  'go-lift': n => {
    if (E.sessionOn(E.project(S), today())) { openPanel(S.draft ? 'go' : 'lift'); return; }
    openPanel('go');
    const id = n.dataset.id;
    if (S.draft && S.order[S.draft.day].includes(id) && !S.draft.log[id]?.skip) { ui.go = { id, set: firstOpen(id) }; drawGo(); }
  },
};

// The camera opens straight away. The photo is shown once so you can say
// what it was, then it is dropped. It is never saved on the phone or sent
// anywhere until the AI is connected.
el('cam').addEventListener('change', e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const url = URL.createObjectURL(file);
  openSheet('What was it',
    `<img class="shot" src="${url}" alt="The photo you just took">
     <p class="sub">The AI will fill this in from the photo once it is connected. For now, enter it here.</p>` +
    field('Name', '<input name="name" type="text" autocomplete="off" autocapitalize="sentences" maxlength="40" placeholder="Chicken bowl">') +
    field('Protein, grams', stepper('protein', 30, 5, 0, 300, 'Protein in grams')) +
    field('Calories', '<input name="calories" type="number" inputmode="numeric" min="0" max="5000" placeholder="Leave empty to skip">') +
    '<label class="check"><input type="checkbox" name="keep" checked><span>Keep as a usual</span></label>',
    'Log it',
    f => addFood({ name: (f.name || '').trim(), protein: Math.round(+f.protein || 0), calories: +f.calories || 0, keep: !!f.keep, source: 'photo' }));
  sheet.addEventListener('close', () => URL.revokeObjectURL(url), { once: true });
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

// Put one reading into the log. Returns the line to show and whether it can be undone.
function act(r, t, day) {
  const closed = !S.draft && E.sessionOn(S, t);
  let msg, undo = true;

  if (r.type === 'sleep') {
    commit(S => { S.sleep[t] = r.hours; });
    msg = `Sleep: ${fmtH(r.hours)}.`;
  } else if (r.type === 'food') {
    commit(S => E.logFood(S, { name: r.name, protein: r.protein, calories: r.calories, source: r.source, keep: false, ...now(), id: uid() }));
    const what = r.n === 0.5 ? 'Half a ' + r.name.toLowerCase() : (r.n !== 1 ? r.n + ' × ' : '') + (r.name || 'Protein');
    msg = `${what}, ${r.source === 'estimate' ? 'about ' : ''}${r.protein} g.`;
  } else if (r.type === 'done') {
    if (closed || S.draft?.done) { msg = 'Today is already logged.'; undo = false; }
    else if (!E.canAssume(S, day) && !E.draftActive(S.draft)) { msg = `${cap(day)} is still learning your numbers. Log the sets in lifting mode.`; undo = false; }
    else { commit(S => { E.ensureDraft(S, t).done = true; }); msg = `${cap(day)} logged as written.`; }
  } else if (r.type === 'skip' || r.type === 'lift') {
    const l = S.lifts[r.id];
    if (closed) { msg = 'Today is already logged.'; undo = false; }
    else if (!S.order[day].includes(r.id)) { msg = `${l.name} is not part of ${day} day.`; undo = false; }
    else if (r.type === 'skip') {
      commit(S => { E.entry(E.ensureDraft(S, t), r.id).skip = true; });
      msg = `Skipping ${l.name.toLowerCase()} today.`;
    } else {
      commit(S => {
        const g = E.entry(E.ensureDraft(S, t), r.id);
        if (r.w != null) g.w = r.w;
        for (const [i, n] of Object.entries(r.reps)) if (+i < l.sets) g.reps[+i] = n;
      });
      const bits = Object.entries(r.reps).map(([i, n]) => `set ${+i + 1}, ${n}${l.targets ? ` (plan ${l.targets[+i]})` : ''}`);
      if (r.w != null) bits.unshift(`at ${E.fmtW(r.w)}`);
      msg = `${l.name}: ${bits.join('; ')}.`;
    }
  } else {
    msg = 'Could not read that. Try "shake", "40g chicken", "slept 7.5" or "bench last set 6".';
    undo = false;
  }
  return [msg, undo];
}

// What the AI reader sends back, put into the shape the phone's own reader uses.
function fromReader(a) {
  if (a.type === 'food') return { type: 'food', name: a.name, protein: a.protein, calories: a.calories, n: 1, source: a.estimated ? 'estimate' : 'typed' };
  if (a.type === 'sleep') return { type: 'sleep', hours: a.hours };
  if (a.type === 'session_done') return { type: 'done' };
  if (a.type === 'skip_lift' && S.lifts[a.lift_id]) return { type: 'skip', id: a.lift_id };
  if (a.type === 'lift' && S.lifts[a.lift_id]) {
    return { type: 'lift', id: a.lift_id, w: a.weight, reps: Object.fromEntries((a.reps || []).map(x => [x.set - 1, x.reps])) };
  }
  return null;
}

// What the AI reader needs to know to read a message: today's lifts and the usual foods.
function readerContext(day) {
  return {
    day,
    lifts: S.order[day].map(id => { const l = S.lifts[id]; return { id, name: l.name, sets: l.sets, planned_reps: l.targets, weight: l.weight }; }),
    other_lifts: Object.entries(S.order).filter(([d]) => d !== day).flatMap(([, ids]) => ids.map(id => S.lifts[id].name)),
    usuals: E.usuals(S, new Date().getHours()).slice(0, 40).map(f => ({ name: f.name, protein: f.protein, calories: f.calories || 0 })),
  };
}

const remember = (words, type) => commit(S => { S.messages.push({ at: Date.now(), text: words, type }); if (S.messages.length > 300) S.messages.shift(); });

async function handleText(raw) {
  const t = today();
  const day = S.draft?.day ?? S.rotation[S.pointer];
  const r = read(S, raw, S.order[day]);

  // The phone reads the common messages itself, with no wait.
  if (r.type !== 'unread' || !Sync.connected()) {
    const snap = snapshot();
    const [msg, undo] = act(r, t, day);
    remember(raw, r.type);
    say(msg, undo ? snap : null);
    return;
  }

  // Anything else goes to the AI reader.
  say('Reading.');
  try {
    const out = await Sync.ask(raw, readerContext(day));
    const snap = snapshot();
    const done = (out.actions || []).map(fromReader).filter(Boolean).map(a => act(a, t, day));
    remember(raw, 'ai');
    if (!done.length) { say(out.note || 'Nothing in that to log.'); return; }
    say(done.map(d => d[0]).join(' ') + (out.note ? ' ' + out.note : ''), done.some(d => d[1]) ? snap : null);
  } catch (e) {
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
  // A session left open from an earlier day closes itself. That is a real
  // change, so it goes through commit and gets saved like any other.
  if (S.draft && S.draft.date !== today()) commit(S => E.rollOver(S, today()));
  else refresh();
  if (ui.panel === 'go') keepAwake(!S.draft?.done);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });

shell();
wake();
Sync.start();
if (!S.setup) goalsSheet(true);

if ('serviceWorker' in navigator && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
  navigator.serviceWorker.register('sw.js');
}
