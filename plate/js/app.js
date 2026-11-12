import { S, commit, save, today, weekOf, snapshot, restore, subscribe, uid } from './store.js';
import * as E from './engine.js';
import { read } from './parse.js';
import { rig, plateRing, icon } from './draw.js';

const $ = (s, r = document) => r.querySelector(s);
const view = $('#view');
const sheet = $('#sheet');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap = s => s[0].toUpperCase() + s.slice(1);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const route = () => location.hash.replace(/^#/, '') || '/';

const fmtH = h => {
  const whole = Math.floor(h), m = Math.round((h - whole) * 60);
  return !whole && m ? `${m}m` : m ? `${whole}h ${m}m` : `${whole}h`;
};
const num = n => n.toLocaleString('en-US');
const mmss = ms => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

let lastRig = '';    // the bar only loads itself when the lift or weight changes

/* ---------- Home ---------- */

function homeView() {
  const t = today();
  const V = E.project(S);
  const done = E.sessionOn(V, t);
  const d = V.draft;
  const day = d?.day ?? V.rotation[V.pointer];
  const ids = S.order[day];
  const date = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

  let title = day, sub, actions;
  if (done) {
    title = done.day;
    sub = `Done. ${cap(V.rotation[V.pointer])} is next.`;
    actions = `<a class="link" href="#/lift">See where each lift stands</a>`;
  } else if (!ids.length) {
    sub = 'No lifts on this day yet.';
    actions = `<a class="btn" href="#/lift">Add lifts</a>`;
  } else {
    const going = E.draftActive(d);
    const at = going ? E.cursor(S) : null;
    const first = S.lifts[at?.id ?? ids[0]];
    sub = going
      ? (at ? `${first.name} is next.` : 'Every set is in.')
      : `${plural(ids.length, 'lift')}. ${first.name}${first.weight != null ? ' at ' + E.fmtW(first.weight) : ''} first.`;
    actions = `<a class="btn" href="#/go">${going ? (at ? 'Keep lifting' : 'Finish up') : 'Start lifting'}${icon.go}</a>` +
      (E.canAssume(S, day) ? `<button class="link" data-act="as-written">Did it as written</button>` : '');
  }

  const week = weekOf(t);
  const lifted = V.sessions.filter(s => week.includes(s.date)).length;
  const goalDays = S.profile.days;
  const p = E.proteinOn(S, t), pGoal = S.profile.protein;
  const slept = S.sleep[t], sGoal = S.profile.sleep;

  const meter = (key, label, big, small, frac, note, attrs) => `
    <${attrs.tag} class="meter" ${attrs.at}>
      <span class="cap" ${attrs.vt ? `style="view-transition-name:${attrs.vt}"` : ''}>${label}</span>
      <span class="note">${note}${icon.go}</span>
      <span class="num"><b data-roll="${key}">${big}</b><i>${small}</i></span>
      <span class="bar"><i data-bar="${key}" style="--p:${Math.min(1, frac)}"></i></span>
    </${attrs.tag}>`;

  const leftDays = Math.max(0, goalDays - lifted);
  const meters =
    meter('lift', 'Lift', lifted, ` of ${goalDays} this week`, lifted / goalDays,
      leftDays ? `${leftDays} to go` : 'Week done', { tag: 'a', at: 'href="#/lift"', vt: 't-lift' }) +
    meter('food', 'Food', p, ` of ${pGoal} g protein`, p / pGoal,
      p >= pGoal ? 'Goal met' : `${pGoal - p} g to go`, { tag: 'a', at: 'href="#/food"', vt: 't-food' }) +
    meter('sleep', 'Sleep', slept != null ? fmtH(slept) : '–', ` of ${fmtH(sGoal)}`, (slept || 0) / sGoal,
      slept != null ? (slept >= sGoal ? 'Goal met' : `${fmtH(sGoal - slept)} short`) : 'Log last night',
      { tag: 'button', at: 'data-act="sleep" type="button"' });

  const cell = (state, label) => `<i class="cell ${state}" role="img" aria-label="${label}"></i>`;
  const rows = [
    ['Lift', k => (V.sessions.some(s => s.date === k) ? 'hit' : '')],
    ['Food', k => { const v = E.proteinOn(S, k); return v >= pGoal ? 'hit' : v > 0 ? 'some' : ''; }],
    ['Sleep', k => { const v = S.sleep[k]; return v == null ? '' : v >= sGoal ? 'hit' : 'some'; }],
  ];
  const names = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const grid = `
    <div class="wk-head"><span></span>${week.map((k, i) => `<span class="cap ${k === t ? 'now' : ''}">${names[i]}</span>`).join('')}</div>
    ${rows.map(([name, f]) => `<div class="wk-row"><span class="cap">${name}</span>${week.map(k => {
      const st = k > t ? 'later' : f(k);
      const word = st === 'hit' ? 'goal met' : st === 'some' ? 'logged, under goal' : st === 'later' ? 'not yet' : 'nothing logged';
      return cell(st, `${name} ${k}: ${word}`);
    }).join('')}</div>`).join('')}`;

  return `
    <header class="top">
      <p class="cap">${date}</p>
      <button class="link quiet" data-act="goals" type="button">Goals</button>
    </header>
    <section class="hero">
      <h1 class="day" style="view-transition-name:t-day">${title}</h1>
      <p class="sub">${sub}</p>
      <div class="acts">${actions}</div>
    </section>
    <section class="meters">${meters}</section>
    <section class="week" aria-label="This week">
      ${grid}
      <p class="key"><i class="cell hit"></i>Goal met<i class="cell some"></i>Logged, under goal</p>
    </section>`;
}

/* ---------- Lift ---------- */

function liftView() {
  const V = E.project(S);
  const next = V.draft?.day ?? V.rotation[V.pointer];
  const active = Object.values(V.order).flat().map(id => V.lifts[id]);
  const count = k => active.filter(l => E.status(l).k === k).length;
  const short = count('short') + count('drop');
  const tally = [[count('up'), 'Climbing', ''], [count('flat'), 'Stalled', ''], [short, 'Short', short ? 'bad' : ''], [count('learning') + count('new'), 'Learning', '']]
    .map(([n, w, c]) => `<div class="${n ? c : 'none'}"><b>${n}</b><span class="cap">${w}</span></div>`).join('');
  const started = active.some(l => l.weight != null);

  const row = l => {
    const s = E.status(l);
    const plan = l.weight == null ? '<i>no weight yet</i>'
      : l.targets ? `${E.fmtW(l.weight)}<i> × </i>${E.fmtReps(l.targets)}`
      : `${E.fmtW(l.weight)}<i> × ${l.lo}–${l.hi}</i>`;
    const say = s.k === 'up' ? '' : E.advice(l);
    return `<button class="lift" type="button" data-act="lift" data-id="${l.id}">
      <span class="ln">${esc(l.name)}</span>
      <span class="lw">${plan}</span>
      <span class="ls cap k-${s.k}">${s.label}</span>
      ${say ? `<span class="la">${say}</span>` : ''}
    </button>`;
  };

  const days = S.rotation.map(day => `
    <section class="daygroup">
      <h2 class="dayname">${day}${day === next ? '<span class="cap">Next up</span>' : ''}</h2>
      ${V.order[day].map(id => row(V.lifts[id])).join('') || '<p class="empty">No lifts here yet.</p>'}
      <button class="link quiet" type="button" data-act="add-lift" data-day="${day}">Add a lift</button>
    </section>`).join('');

  return `
    <header class="top">
      <a class="iconbtn" href="#/" aria-label="Back to home">${icon.back}</a>
      <p class="cap" style="view-transition-name:t-lift">Lift</p>
      <span></span>
    </header>
    <section class="lede">
      <div class="tally">${tally}</div>
      ${started ? '' : '<p class="sub">Your first two sessions on each lift set its plan. After that you only log what falls short.</p>'}
    </section>
    ${days}`;
}

/* ---------- Lifting mode ---------- */

function goTop(d, l) {
  const ids = S.order[d.day];
  const where = l ? `${d.day} · lift ${ids.indexOf(l.id) + 1} of ${ids.length}` : d.day;
  return `<header class="top">
      <a class="iconbtn" href="#/" aria-label="Leave lifting mode">${icon.close}</a>
      <p class="cap">${where}</p>
      ${l ? `<button class="link quiet" type="button" data-act="skip-lift" data-id="${l.id}">Skip</button>` : '<span></span>'}
    </header>`;
}

function setMarks(l, g, at) {
  return Array.from({ length: l.sets }, (_, i) => {
    const v = g?.reps[i], plan = l.targets?.[i];
    if (v != null) return plan != null && v < plan ? `<span class="mk short"><s>${plan}</s>${v}</span>` : `<span class="mk">${v}</span>`;
    return `<span class="mk ${i === at ? 'now' : 'todo'}">${plan ?? '·'}</span>`;
  }).join('');
}

function goView() {
  const d = S.draft;
  if (!d) return homeView();
  if (d.done) return summaryView();
  const c = E.cursor(S);
  if (!c) return closeView(d);
  const l = S.lifts[c.id], g = d.log[c.id];
  const w = g?.w ?? l.weight;

  if (d.rest && d.rest.until > Date.now()) {
    const target = l.targets?.[c.set];
    const nextLine = w == null ? esc(l.name)
      : `${esc(l.name)}, set ${c.set + 1} of ${l.sets}. ${E.fmtW(w)} × ${target ?? `${l.lo}–${l.hi}`}`;
    return `${goTop(d, l)}
      <section class="go rest">
        <p class="cap">Rest</p>
        <p class="clock" id="clock" style="--n:${mmss(d.rest.until - Date.now()).length}">${mmss(d.rest.until - Date.now())}</p>
        <span class="bar"><i id="restbar" style="--p:${(d.rest.until - Date.now()) / (d.rest.total * 1000)}"></i></span>
        <p class="sub">Next: ${nextLine}</p>
      </section>
      <footer class="ctl two">
        <button class="btn line" type="button" data-act="rest-add">+15 s</button>
        <button class="btn" type="button" data-act="rest-skip">Go now</button>
      </footer>`;
  }

  if (w == null) {
    const ask = { barbell: 'What is on the bar, plates and bar together?', dumbbell: 'How heavy is each dumbbell?', stack: 'Where is the pin?' }[l.kind] || 'What weight?';
    const start = { barbell: 135, dumbbell: 25, stack: 50 }[l.kind] || 50;
    return `${goTop(d, l)}
      <section class="go">
        <h1 class="liftname">${esc(l.name)}</h1>
        <p class="sub">${ask}</p>
        <form class="ask" data-form="first-weight" data-id="${l.id}">
          ${stepper('w', start, l.jump, 0, 1000, 'Weight in pounds')}
          <button class="btn big">Set weight</button>
        </form>
      </section>`;
  }

  const target = l.targets?.[c.set];
  const repText = target ?? `${l.lo}–${l.hi}`;
  const rigKey = l.id + ':' + w;
  const fresh = rigKey !== lastRig;
  lastRig = rigKey;
  const glyphs = E.fmtW(w).length + String(repText).length + 1.4;
  const last = l.history[l.history.length - 1];
  let ctl;
  if (target != null) {
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

  return `${goTop(d, l)}
    <section class="go">
      <h1 class="liftname">${esc(l.name)}</h1>
      <button class="load" type="button" data-act="weight" data-id="${l.id}" style="--n:${glyphs}" aria-label="${E.fmtW(w)} pounds for ${repText} reps. Change the weight.">
        <span class="row"><span>${E.fmtW(w)}</span><i>×</i><span>${repText}</span></span>
      </button>
      ${rig(l, w, fresh)}
      <p class="marks" aria-label="Set ${c.set + 1} of ${l.sets}"><span class="cap">Set ${c.set + 1} of ${l.sets}</span>${setMarks(l, g, c.set)}</p>
      ${last ? `<p class="last">Last time ${E.fmtW(last.w)}: ${last.reps.join(' · ')}</p>` : ''}
    </section>
    <footer class="ctl">${ctl}</footer>`;
}

function closeView(d) {
  const ids = S.order[d.day];
  let sets = 0, short = 0, skipped = 0;
  for (const id of ids) {
    const l = S.lifts[id], g = d.log[id];
    if (g?.skip) { skipped++; continue; }
    for (let i = 0; i < l.sets; i++) {
      sets++;
      if (l.targets && g?.reps[i] != null && g.reps[i] < l.targets[i]) short++;
    }
  }
  const line = [plural(sets, 'set'), short ? `${short} short` : 'none short', skipped ? `${plural(skipped, 'lift')} skipped` : ''].filter(Boolean).join(', ');
  return `${goTop(d, null)}
    <section class="go">
      <h1 class="headline">Every set is in.</h1>
      <p class="sub">${line}.</p>
    </section>
    <footer class="ctl"><button class="btn big" type="button" data-act="finish">Finish ${d.day}</button></footer>`;
}

const KIND = { jump: 'Weight goes up', hit: 'One more rep', short: 'Same again', ahead: 'New weight', learned: 'Plan set', learning: 'Learning', skipped: 'Skipped' };

function summaryView() {
  const V = E.project(S);
  const summary = V.sessions[V.sessions.length - 1];
  const rows = summary.notes.map(n => {
    const next = n.next ? `${E.fmtW(n.next.w)}<i> × </i>${E.fmtReps(n.next.reps)}` : '';
    const did = n.reps ? n.reps.map((r, i) => (n.plan && r < n.plan[i] ? `<span class="mk short"><s>${n.plan[i]}</s>${r}</span>` : `<span class="mk">${r}</span>`)).join('') : '';
    return `<div class="lift flat">
      <span class="ln">${esc(n.name)}</span>
      <span class="lw">${next}</span>
      <span class="ls cap k-${n.kind}">${KIND[n.kind]}</span>
      ${did ? `<span class="la marks">${did}</span>` : ''}
    </div>`;
  }).join('');
  return `<header class="top"><span></span><p class="cap">${summary.day} logged</p><span></span></header>
    <section class="lede">
      <h1 class="headline">Next time.</h1>
      <p class="sub">${cap(V.rotation[V.pointer])} is up next. If a set went differently, type it on the home screen any time today.</p>
    </section>
    <section class="daygroup">${rows || '<p class="empty">Nothing was logged.</p>'}</section>
    <footer class="ctl"><button class="btn big" type="button" data-act="summary-done">Done</button></footer>`;
}

/* ---------- Food ---------- */

function foodView() {
  const t = today();
  const p = E.proteinOn(S, t), goal = S.profile.protein;
  const cals = E.caloriesOn(S, t), cGoal = S.profile.calories;
  const list = S.foodLog.filter(f => f.date === t).reverse();
  const us = E.usuals(S, new Date().getHours()).slice(0, 12);
  return `
    <header class="top">
      <a class="iconbtn" href="#/" aria-label="Back to home">${icon.back}</a>
      <p class="cap" style="view-transition-name:t-food">Food</p>
      <span></span>
    </header>
    <figure class="plate">
      ${plateRing(p / goal, `${goal} g protein`)}
      <figcaption>
        <b class="big" data-roll="food-big">${p}</b>
        <span class="cap">${p >= goal ? 'Goal met' : `${goal - p} g to go`}</span>
      </figcaption>
    </figure>
    ${cGoal ? `<p class="cals"><b>${num(cals)}</b> of ${num(cGoal)} calories</p>` : ''}
    <section class="block">
      <h2 class="cap">Usuals</h2>
      <div class="chips">
        ${us.map(f => `<button class="chip food" type="button" data-act="usual" data-id="${f.id}">${esc(f.name)}<b>${f.protein}</b></button>`).join('')}
        <button class="chip add" type="button" data-act="add-food">Add food</button>
      </div>
      ${us.length ? '' : '<p class="empty">Add what you eat most. After that each one is a single tap.</p>'}
    </section>
    <section class="block">
      <h2 class="cap">Today</h2>
      ${list.length ? `<ul class="eaten">${list.map(f => `<li>
          <span class="when">${esc(f.time)}</span>
          <span class="what">${esc(f.name || 'Protein')}</span>
          <b>${f.protein} g</b>
          <button class="iconbtn sm" type="button" data-act="del-food" data-id="${f.id}" aria-label="Remove ${esc(f.name || 'entry')}">${icon.close}</button>
        </li>`).join('')}</ul>` : '<p class="empty">Nothing eaten yet today.</p>'}
    </section>`;
}

/* ---------- Sheets ---------- */

function stepper(name, value, step, min, max, label) {
  return `<div class="stepper">
    <button type="button" data-step="-${step}" aria-label="Less">−</button>
    <input name="${name}" type="number" inputmode="decimal" value="${value}" step="any" min="${min}" max="${max}" aria-label="${label}" required>
    <button type="button" data-step="${step}" aria-label="More">+</button>
  </div>`;
}

let onSheet = null;
function openSheet(title, body, submit, handler) {
  onSheet = handler;
  sheet.innerHTML = `<form method="dialog" class="sheetform">
      <header><h2 class="headline sm">${title}</h2>
        <button class="iconbtn" type="button" data-act="close-sheet" aria-label="Close">${icon.close}</button></header>
      ${body}
      <button class="btn big" value="save">${submit}</button>
    </form>`;
  sheet.showModal();
}

const field = (label, inner, hint = '') => `<label class="field"><span class="cap">${label}</span>${inner}${hint ? `<small>${hint}</small>` : ''}</label>`;

function goalsSheet(first) {
  const p = S.profile;
  openSheet(first ? 'Three numbers to start' : 'Goals',
    (first ? '<p class="sub">You can change these any time from the home screen.</p>' : '') +
    field('Protein per day, grams', stepper('protein', p.protein, 5, 20, 400, 'Protein goal in grams')) +
    field('Lifting days per week', stepper('days', p.days, 1, 1, 7, 'Lifting days per week')) +
    field('Sleep per night, hours', stepper('sleep', p.sleep, 0.25, 4, 12, 'Sleep goal in hours')) +
    field('Calories per day', `<input name="calories" type="number" inputmode="numeric" min="0" max="9000" value="${p.calories || ''}" placeholder="Leave empty to skip">`),
    first ? 'Start' : 'Save',
    f => commit(S => {
      S.profile = { protein: +f.protein || 180, days: Math.min(7, Math.max(1, +f.days || 5)), sleep: +f.sleep || 8, calories: +f.calories || 0 };
      S.setup = true;
    }));
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

function liftSheet(id) {
  const l = S.lifts[id], s = E.status(l);
  const hist = l.history.slice(-5).reverse().map(e => `<li><span class="when">${new Date(e.d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
      <span class="what">${E.fmtW(e.w)}</span>
      <span class="marks">${e.reps.map((r, i) => (e.plan && r < e.plan[i] ? `<span class="mk short"><s>${e.plan[i]}</s>${r}</span>` : `<span class="mk">${r}</span>`)).join('')}</span></li>`).join('');
  const kinds = [['barbell', 'Barbell'], ['dumbbell', 'Dumbbells'], ['stack', 'Cable or machine stack'], ['other', 'Something else']];
  openSheet(esc(l.name),
    `<p class="sub">${E.advice(l)}</p>` +
    (s.k === 'drop' ? `<button class="btn line" name="do" value="drop">${E.easeOff(l).button}</button>` : '') +
    field('Weight, pounds', stepper('weight', l.weight ?? '', l.jump, 0, 1000, 'Weight in pounds').replace(' required', '')) +
    `<div class="pair">${field('Sets', stepper('sets', l.sets, 1, 1, 8, 'Sets'))}${field('Add when earned', stepper('jump', l.jump, 2.5, 1, 50, 'Pounds to add'))}</div>` +
    `<div class="pair">${field('Reps from', stepper('lo', l.lo, 1, 1, 50, 'Lowest reps'))}${field('Reps to', stepper('hi', l.hi, 1, 1, 50, 'Highest reps'))}</div>` +
    field('Rest between sets, seconds', stepper('rest', l.rest, 15, 15, 600, 'Rest in seconds')) +
    field('Equipment', `<select name="kind">${kinds.map(([v, n]) => `<option value="${v}" ${l.kind === v ? 'selected' : ''}>${n}</option>`).join('')}</select>`) +
    (hist ? `<h3 class="cap">Last sessions</h3><ul class="eaten hist">${hist}</ul>` : '') +
    `<button class="link quiet danger" name="do" value="retire">Take this lift out of the program</button>`,
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

function logSet(n) {
  const c = E.cursor(S);
  if (!c) return;
  commit(S => {
    const l = S.lifts[c.id];
    E.entry(S.draft, c.id).reps[c.set] = n;
    S.draft.rest = E.cursor(S) ? { until: Date.now() + l.rest * 1000, total: l.rest } : null;
  });
}

function finish() {
  commit(S => { S.draft.done = true; S.draft.rest = null; });
  scrollTo(0, 0);
}

// Editing the program closes out a finished session first, so the edit
// lands on next time's plan and not on today's record.
const settle = S => { if (S.draft?.done) E.finalize(S); };

const acts = {
  goals: () => goalsSheet(false),
  sleep: sleepSheet,
  'add-food': foodSheet,
  'close-sheet': () => sheet.close(),
  lift: el => liftSheet(el.dataset.id),
  'add-lift': el => addLiftSheet(el.dataset.day),
  weight: el => weightSheet(el.dataset.id),
  'other-reps': repsSheet,
  reps: el => logSet(+el.dataset.n),
  'skip-lift': el => commit(S => { E.entry(S.draft, el.dataset.id).skip = true; S.draft.rest = null; }),
  'rest-add': () => commit(S => { S.draft.rest.until += 15000; S.draft.rest.total += 15; }),
  'rest-skip': () => commit(S => { S.draft.rest = null; }),
  finish,
  'summary-done': () => { location.hash = '#/'; },
  'as-written': () => {
    const snap = snapshot();
    const day = S.draft?.day ?? S.rotation[S.pointer];
    commit(S => { E.ensureDraft(S, today()).done = true; });
    say(`${cap(day)} logged as written.`, snap);
  },
  usual: el => {
    const f = S.foods.find(x => x.id === el.dataset.id);
    if (f) addFood({ name: f.name, protein: f.protein, calories: f.calories || 0, source: 'usual' });
  },
  'del-food': el => {
    const snap = snapshot();
    commit(S => { S.foodLog = S.foodLog.filter(x => x.id !== el.dataset.id); });
    say('Removed.', snap);
  },
  undo: () => { if (undoSnap) { restore(undoSnap); hideSay(); } },
};

document.addEventListener('click', e => {
  const st = e.target.closest('[data-step]');
  if (st) {
    const inp = st.parentElement.querySelector('input');
    const v = (parseFloat(inp.value) || 0) + parseFloat(st.dataset.step);
    inp.value = +Math.min(+inp.max, Math.max(+inp.min, v)).toFixed(2);
    return;
  }
  const el = e.target.closest('[data-act]');
  if (el && acts[el.dataset.act]) { acts[el.dataset.act](el); return; }
  if (e.target === sheet) sheet.close();
});

document.addEventListener('submit', e => {
  const form = e.target;
  if (form.classList.contains('sheetform')) {
    const data = Object.fromEntries(new FormData(form));
    const h = onSheet;
    onSheet = null;
    if (h) h(data, e.submitter?.value);
    return; // method="dialog" closes the sheet
  }
  e.preventDefault();
  if (form.dataset.form === 'first-weight') {
    const w = +new FormData(form).get('w');
    commit(S => { S.lifts[form.dataset.id].weight = w; });
  } else if (form.id === 'dock') {
    const q = $('#q');
    const text = q.value.trim();
    q.value = '';
    dock.classList.remove('typing');
    if (text) handleText(text);
  }
});

/* ---------- The text box ---------- */

const dock = $('#dock');
let undoSnap = null, sayTimer = 0;

function say(text, snap) {
  const el = $('#say');
  undoSnap = snap || null;
  el.innerHTML = `<span>${esc(text)}</span>${snap ? '<button class="link" type="button" data-act="undo">Undo</button>' : ''}`;
  el.hidden = false;
  clearTimeout(sayTimer);
  sayTimer = setTimeout(hideSay, snap ? 7000 : 9000);
}
function hideSay() { $('#say').hidden = true; undoSnap = null; }

function handleText(raw) {
  const t = today();
  const day = S.draft?.day ?? S.rotation[S.pointer];
  const r = read(S, raw, S.order[day]);
  const snap = snapshot();
  const closed = !S.draft && E.sessionOn(S, t);
  let msg, undo = true;

  if (r.type === 'sleep') {
    commit(S => { S.sleep[t] = r.hours; });
    msg = `Sleep: ${fmtH(r.hours)}.`;
  } else if (r.type === 'food') {
    commit(S => E.logFood(S, { name: r.name, protein: r.protein, calories: r.calories, source: r.source, keep: false, ...now(), id: uid() }));
    msg = `${r.n === 0.5 ? 'Half a ' + r.name.toLowerCase() : (r.n !== 1 ? r.n + ' × ' : '') + (r.name || 'Protein')}, ${r.protein} g.`;
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
  commit(S => { S.messages.push({ at: Date.now(), text: raw, type: r.type }); if (S.messages.length > 300) S.messages.shift(); });
  say(msg, undo ? snap : null);
}

$('#q').addEventListener('input', e => dock.classList.toggle('typing', !!e.target.value.trim()));

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const homeScreen = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const iOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
let rec = null;
$('#mic').addEventListener('click', () => {
  const q = $('#q');
  if (dock.classList.contains('typing')) { dock.requestSubmit(); return; }
  // iPhone home-screen apps cannot use the browser's speech reader, so the
  // keyboard's own dictation key does the listening there.
  if (!SR || (iOS && homeScreen)) { q.focus(); return; }
  if (rec) { rec.stop(); return; }
  rec = new SR();
  rec.lang = 'en-US';
  rec.interimResults = true;
  rec.onresult = ev => { q.value = [...ev.results].map(r => r[0].transcript).join(''); };
  rec.onerror = () => { q.focus(); };
  rec.onend = () => { rec = null; dock.classList.remove('hearing'); if (q.value.trim()) dock.requestSubmit(); };
  dock.classList.add('hearing');
  q.placeholder = 'Listening';
  rec.start();
});

if (window.visualViewport) {
  const vv = visualViewport;
  const lift = () => {
    const kb = Math.max(0, innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty('--kb', kb + 'px');
    document.documentElement.classList.toggle('kb', kb > 80);
  };
  vv.addEventListener('resize', lift);
  vv.addEventListener('scroll', lift);
}

/* ---------- Drawing the screen ---------- */

const was = new Map();

// Size the big lifting numbers so they span the screen, whatever the digits.
function fitLoad() {
  const el = view.querySelector('.load');
  if (!el) return;
  el.style.fontSize = '100px';
  const w = el.firstElementChild.getBoundingClientRect().width;
  el.style.fontSize = Math.min(150, Math.floor(100 * el.clientWidth / w)) + 'px';
}
document.fonts?.ready.then(fitLoad);
addEventListener('resize', fitLoad);

function hydrate() {
  // Numbers roll from their last value. Only digits that change move.
  view.querySelectorAll('[data-roll]').forEach(el => {
    const key = el.dataset.roll, to = el.textContent.trim();
    const from = (was.get(key) ?? to).padStart(to.length, ' ').slice(-to.length);
    was.set(key, to);
    el.setAttribute('aria-label', to);
    el.innerHTML = [...to].map((ch, i) => {
      if (!/\d/.test(ch)) return `<span aria-hidden="true">${esc(ch)}</span>`;
      const f = /\d/.test(from[i]) ? from[i] : 0;
      return `<span class="dg" aria-hidden="true" style="--d:${f}" data-to="${ch}"><em>${ch}</em><span>0<br>1<br>2<br>3<br>4<br>5<br>6<br>7<br>8<br>9</span></span>`;
    }).join('');
  });
  const fills = [...view.querySelectorAll('[data-bar],[data-ring]')].map(el => {
    const key = el.dataset.bar || el.dataset.ring, to = el.style.getPropertyValue('--p');
    const from = was.get('p:' + key) ?? to;
    was.set('p:' + key, to);
    el.style.setProperty('--p', from);
    return [el, to];
  });
  requestAnimationFrame(() => requestAnimationFrame(() => {
    view.querySelectorAll('.dg').forEach(d => d.style.setProperty('--d', d.dataset.to));
    fills.forEach(([el, to]) => el.style.setProperty('--p', to));
  }));
}

let lock = null;
async function keepAwake(on) {
  try {
    if (on && !lock && navigator.wakeLock) { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => { lock = null; }); }
    if (!on && lock) { await lock.release(); lock = null; }
  } catch (e) { /* not allowed right now */ }
}

function render() {
  const r = route();
  if (r === '/go' && !S.draft && !E.sessionOn(S, today())) { E.ensureDraft(S, today()); save(); }
  const lifting = r === '/go' && !!S.draft;
  document.body.dataset.route = lifting ? 'go' : r === '/lift' ? 'lift' : r === '/food' ? 'food' : 'home';
  view.innerHTML = r === '/lift' ? liftView() : r === '/food' ? foodView() : r === '/go' ? goView() : homeView();
  hydrate();
  fitLoad();
  keepAwake(lifting && !S.draft.done);
}

const depth = r => (r === '/' ? 0 : 1);
let lastRoute = route();
addEventListener('hashchange', () => {
  const to = route();
  if (to !== '/go') lastRig = '';
  document.documentElement.dataset.dir = depth(to) < depth(lastRoute) ? 'back' : 'fwd';
  lastRoute = to;
  const draw = () => { render(); scrollTo(0, 0); };
  if (document.startViewTransition && !reduced) {
    const vt = document.startViewTransition(draw);
    vt.ready.catch(() => {});
    vt.finished.catch(() => {});
  } else draw();
});

subscribe(render);

setInterval(() => {
  const d = S.draft;
  if (document.body.dataset.route !== 'go' || !d?.rest) return;
  const left = d.rest.until - Date.now();
  if (left <= 0) { commit(S => { S.draft.rest = null; }); return; }
  const c = $('#clock'), b = $('#restbar');
  if (c) { c.textContent = mmss(left); c.style.setProperty('--n', c.textContent.length); }
  if (b) b.style.setProperty('--p', left / (d.rest.total * 1000));
}, 250);

function wake() {
  const before = snapshot();
  E.rollOver(S, today());
  if (snapshot() !== before) save();
  render();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });

wake();
if (!S.setup) goalsSheet(true);

if ('serviceWorker' in navigator && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
  navigator.serviceWorker.register('sw.js');
}
