// The rules: what today's workout is, what counts as short, and how each
// lift moves forward. Plain code on purpose, so it always behaves the same.

export const BAR = 45;
export const PLATES = [45, 35, 25, 10, 5, 2.5];
export const DAYS = ['push', 'pull', 'legs'];

const lift = (id, name, kind, sets, lo, hi, jump, rest) => ({
  id, name, kind, sets, lo, hi, jump, rest,
  weight: null,      // unknown until the first session
  targets: null,     // reps planned per set, learned from the first two sessions
  sessions: 0,
  missStreak: 0,
  history: [],       // { d, w, reps, plan, planW, warm }
  opt: false,        // an extra: only counts when you say you did it, never assumed
  style: 'straight', // 'top' = a warm-up ramp that is assumed, then the working set(s) you log
  warm: null,        // { w, reps }: the last warm-up set before the working set, counted but assumed
  goal: null,        // { w, reps }: where you are heading
  drop: false,       // a drop set follows the working set, assumed done
});

export function seed() {
  const L = [
    lift('bench', 'Bench press', 'barbell', 3, 5, 8, 5, 150),
    lift('ohp', 'Overhead press', 'barbell', 3, 5, 8, 5, 150),
    lift('fly', 'Chest fly', 'stack', 3, 10, 15, 5, 90),
    lift('latraise', 'Lateral raise', 'dumbbell', 3, 12, 20, 5, 60),
    lift('pushdown', 'Tricep pushdown', 'stack', 3, 10, 15, 5, 75),
    lift('curl', 'Seated incline curl', 'dumbbell', 3, 8, 12, 5, 75),
    lift('squat', 'Squat', 'barbell', 3, 5, 8, 5, 180),
    lift('rdl', 'Romanian deadlift', 'barbell', 3, 6, 10, 10, 150),
  ];
  return {
    v: 1,
    setup: false,
    profile: { protein: 180, calories: 0, carbs: 0, fat: 0, sleep: 8, days: 5, calAuto: true, goalRate: 0.5 },
    rotation: [...DAYS],
    pointer: 0,
    lifts: Object.fromEntries(L.map(l => [l.id, l])),
    order: {
      push: ['bench', 'ohp', 'fly', 'latraise', 'pushdown'],
      pull: ['curl'],
      legs: ['squat', 'rdl'],
    },
    draft: null,       // today's session while it is open
    sessions: [],      // { date, day, notes }
    foods: [],         // { id, name, protein, calories, uses, hours }
    foodLog: [],       // { id, date, time, name, protein, calories, source }
    sleep: {},         // date woke up -> hours
    weights: {},       // date -> bodyweight in pounds
    messages: [],      // raw text typed or said
  };
}

// Where Knox started, from memory, on push day (2026-11-12). Applied once, and
// only to lifts nothing has been logged for, so it can never overwrite real data.
const BASE = {
  bench:    { style: 'top', sets: 2, lo: 3, hi: 8, jump: 5, weight: 245, reps: 4 },
  ohp:      { style: 'top', sets: 1, lo: 5, hi: 8, jump: 5, weight: 115, reps: 6, goal: { w: 135, reps: 6 } },
  fly:      { name: 'Pec deck', style: 'top', sets: 1, lo: 6, hi: 10, jump: 5, weight: 145, reps: 6, drop: true },
  latraise: { style: 'straight', sets: 3, lo: 8, hi: 10, jump: 5, weight: 20, reps: 10 },
  pushdown: { style: 'top', sets: 1, lo: 8, hi: 12, jump: 5, weight: 110, reps: 8, drop: true },
};
export function applyBaseline(S, date) {
  if (S.baseline1) return false;
  for (const [id, b] of Object.entries(BASE)) {
    const l = S.lifts[id];
    if (!l || l.history.length || l.sessions) continue;
    const { reps, weight, ...rest } = b;
    Object.assign(l, rest, { weight, targets: Array.from({ length: l.sets = b.sets }, () => reps), sessions: 2, missStreak: 0 });
    l.history = [{ d: date, w: weight, reps: [reps], plan: null, planW: null }];
  }
  S.baseline1 = true;
  return true;
}

// ---------- The live calorie target ----------
// Your calorie target follows your body, not a formula. The trend of your
// weigh-ins says how fast you are really gaining. What you really ate says
// what that took. Together they give your true maintenance, and the target is
// maintenance plus the surplus for the rate you want. It re-works itself as
// each weigh-in and each day of food comes in.
const KCAL_PER_LB = 3500;
const dayNum = d => Math.round(Date.parse(d + 'T12:00:00') / 86400000);

export function coach(S, date) {
  const P = S.profile, goalRate = P.goalRate ?? 0.5;
  const today = dayNum(date);
  const ws = Object.entries(S.weights || {}).map(([d, w]) => [dayNum(d), +w]).filter(([n, w]) => n <= today && n > today - 28 && w > 0).sort((a, b) => a[0] - b[0]);
  const out = { weighIns: ws.length, foodDays: 0, rate: null, weight: null, avgCal: null, tdee: null, target: null, basis: 'none', goalRate };
  if (!ws.length) return out;

  // Where your weight really is: an average that leans on recent days.
  let ema = ws[0][1];
  for (let i = 1; i < ws.length; i++) ema += (ws[i][1] - ema) * (1 - Math.pow(0.8, ws[i][0] - ws[i - 1][0]));
  out.weight = Math.round(ema * 10) / 10;

  // How fast it is moving, in pounds a week, from a straight line through the weigh-ins.
  const span = ws[ws.length - 1][0] - ws[0][0];
  if (ws.length >= 3 && span >= 7) {
    const mx = ws.reduce((a, [n]) => a + n, 0) / ws.length, my = ws.reduce((a, [, w]) => a + w, 0) / ws.length;
    const slope = ws.reduce((a, [n, w]) => a + (n - mx) * (w - my), 0) / ws.reduce((a, [n]) => a + (n - mx) ** 2, 0);
    out.rate = Math.round(slope * 7 * 100) / 100;
  }

  // What you really ate: days with a believable amount logged, in the same window.
  const byDay = {};
  for (const f of S.foodLog) { const n = dayNum(f.date); if (n < today && n >= today - 21) byDay[n] = (byDay[n] || 0) + (f.calories || 0); }
  const full = Object.values(byDay).filter(c => c >= 1500);
  out.foodDays = full.length;
  if (full.length) out.avgCal = Math.round(full.reduce((a, b) => a + b, 0) / full.length);

  const surplus = (goalRate / 7) * KCAL_PER_LB;
  if (out.rate != null && out.avgCal != null && full.length >= 5) {
    out.tdee = Math.round(out.avgCal - (out.rate / 7) * KCAL_PER_LB);
    out.basis = 'data';
  } else {
    out.tdee = Math.round(out.weight * 15.5);   // a starting guess for someone who lifts and is on their feet
    out.basis = 'formula';
  }
  out.tdee = Math.min(5000, Math.max(1800, out.tdee));
  out.target = Math.round((out.tdee + surplus) / 25) * 25;
  return out;
}

// ---------- Knox's real program (from memory, 2026-11-16) ----------
// Core lifts are assumed done as planned. Extras (opt) only count when he says so.
// Reps marked guess were not given and are placeholders to be corrected.
const DEFS = [
  // push
  { id: 'bench', day: 'push', name: 'Bench press', kind: 'barbell', style: 'top', sets: 1, lo: 4, hi: 8, jump: 5, rest: 180, weight: 245, reps: 7, drop: true, today: [7] },
  { id: 'ohp', day: 'push', name: 'Overhead press', kind: 'barbell', style: 'top', sets: 1, lo: 3, hi: 6, jump: 5, rest: 150, weight: 135, reps: 3, goal: { w: 135, reps: 6 }, today: [3] },
  { id: 'pushdown', day: 'push', name: 'Tricep pushdown', kind: 'stack', sets: 3, lo: 8, hi: 12, jump: 5, rest: 75, weight: 120, reps: 8, today: [8, 8, 8] },
  { id: 'fly', day: 'push', name: 'Chest fly', kind: 'dumbbell', sets: 3, lo: 8, hi: 12, jump: 5, rest: 75, weight: 30, reps: 8, today: [8, 8, 8] },
  { id: 'dips', day: 'push', opt: true, name: 'Dips', kind: 'other', sets: 3, lo: 6, hi: 12, jump: 5, rest: 90, weight: null, reps: null },
  { id: 'otext', day: 'push', opt: true, name: 'Overhead tricep extension', kind: 'stack', sets: 3, lo: 8, hi: 12, jump: 5, rest: 75, weight: 90, reps: 10 },
  { id: 'latraise', day: 'push', opt: true, name: 'Lateral raise', kind: 'dumbbell', sets: 3, lo: 8, hi: 12, jump: 5, rest: 60, weight: 25, reps: 10 },
  { id: 'dbbench', day: 'push', opt: true, name: 'Dumbbell bench', kind: 'dumbbell', sets: 3, lo: 6, hi: 10, jump: 5, rest: 120, weight: 80, reps: 8 },
  { id: 'smithbench', day: 'push', opt: true, name: 'Smith machine bench', kind: 'other', sets: 3, lo: 5, hi: 8, jump: 5, rest: 150, weight: 225, reps: 6 },
  { id: 'jampress', day: 'push', opt: true, name: 'Jam press (smith)', kind: 'other', sets: 3, lo: 8, hi: 12, jump: 5, rest: 90, weight: 155, reps: 10 },
  { id: 'incsmith', day: 'push', opt: true, name: 'Incline smith bench', kind: 'other', sets: 3, lo: 6, hi: 10, jump: 5, rest: 120, weight: 185, reps: 8 },
  { id: 'pecdeck', day: 'push', opt: true, name: 'Pec deck', kind: 'stack', sets: 3, lo: 8, hi: 12, jump: 5, rest: 75, weight: 200, reps: 10 },
  // pull
  { id: 'row', day: 'pull', name: 'Barbell row', kind: 'barbell', sets: 3, lo: 8, hi: 12, jump: 5, rest: 120, weight: 135, reps: 8, guess: true },
  { id: 'scurl', day: 'pull', name: 'Standing curl', kind: 'dumbbell', sets: 3, lo: 8, hi: 12, jump: 5, rest: 75, weight: 50, reps: 8, guess: true },
  { id: 'ccurl', day: 'pull', opt: true, name: 'Cable curl', kind: 'stack', sets: 3, lo: 8, hi: 12, jump: 5, rest: 75, weight: 120, reps: 10 },
  { id: 'sarow', day: 'pull', opt: true, name: 'Single-arm row', kind: 'dumbbell', sets: 3, lo: 8, hi: 12, jump: 5, rest: 90, weight: 70, reps: 10 },
  { id: 'wpull', day: 'pull', opt: true, name: 'Weighted pull-up', kind: 'other', sets: 3, lo: 4, hi: 8, jump: 5, rest: 150, weight: null, reps: null },
  { id: 'reardelt', day: 'pull', opt: true, name: 'Rear delt fly', kind: 'dumbbell', sets: 3, lo: 10, hi: 15, jump: 5, rest: 60, weight: null, reps: null },
  { id: 'curl', day: 'pull', opt: true, name: 'Seated incline curl', kind: 'dumbbell', sets: 3, lo: 8, hi: 12, jump: 5, rest: 75 },
  // legs
  { id: 'squat', day: 'legs', name: 'Squat', kind: 'barbell', style: 'top', sets: 1, lo: 3, hi: 8, jump: 5, rest: 180, weight: 225, reps: 5, guess: true },
  { id: 'legext', day: 'legs', name: 'Leg extension', kind: 'stack', sets: 3, lo: 8, hi: 12, jump: 5, rest: 75, weight: 200, reps: 10, guess: true },
  { id: 'legcurl', day: 'legs', name: 'Leg curl', kind: 'stack', sets: 3, lo: 8, hi: 12, jump: 5, rest: 75, weight: 130, reps: 10, guess: true },
  { id: 'rdl', day: 'legs', opt: true, name: 'Romanian deadlift', kind: 'barbell', sets: 3, lo: 6, hi: 10, jump: 10, rest: 150, weight: 185, reps: 8 },
  { id: 'dbrdl', day: 'legs', opt: true, name: 'Dumbbell RDL', kind: 'dumbbell', sets: 3, lo: 8, hi: 12, jump: 5, rest: 120, weight: 60, reps: 10 },
  { id: 'deadlift', day: 'legs', opt: true, name: 'Deadlift', kind: 'barbell', sets: 1, lo: 3, hi: 6, jump: 10, rest: 180, weight: 225, reps: 5, style: 'top' },
];

export function applyBaseline2(S) {
  if (S.baseline2) return false;
  const D = '2026-11-16';
  const keep = Object.fromEntries(DAYS.map(d => [d, S.order[d] ? [...S.order[d]] : []]));
  const by = Object.fromEntries(DAYS.map(d => [d, { core: [], extra: [] }]));
  for (const def of DEFS) {
    const { day, weight, reps, today, guess, ...cfg } = def;
    let l = S.lifts[def.id];
    if (!l) l = S.lifts[def.id] = lift(def.id, def.name, def.kind, def.sets, def.lo, def.hi, def.jump, def.rest);
    Object.assign(l, { opt: false, style: 'straight', drop: false, goal: null }, cfg);
    if (weight !== undefined) {
      l.weight = weight;
      l.targets = weight != null && reps != null ? Array.from({ length: l.sets }, () => reps) : null;
      if (l.targets && l.sessions < 2) l.sessions = 2;
      l.missStreak = 0;
    } else if (l.targets) {
      l.targets = l.targets.slice(0, l.sets); while (l.targets.length < l.sets) l.targets.push(l.targets[l.targets.length - 1] ?? l.lo);
    }
    (l.opt ? by[day].extra : by[day].core).push(def.id);
  }
  // Anything he already had that is not in the list stays, as an extra.
  for (const d of DAYS) {
    const known = new Set([...by[d].core, ...by[d].extra]);
    const left = keep[d].filter(id => S.lifts[id] && !known.has(id) && !Object.values(by).some(b => b.core.includes(id) || b.extra.includes(id)));
    for (const id of left) S.lifts[id].opt = true;
    S.order[d] = [...by[d].core, ...by[d].extra, ...left];
  }
  S.week = ['push', 'pull', 'legs', 'push', 'pull', null, null];
  S.profile.days = 5;

  // Monday's push, as he reported it, goes in as a finished session that is still open
  // for the rest of the day, so anything he adds in his debrief (an extra, a correction)
  // still lands. It closes itself at midnight like any other day.
  if (!S.sessions.some(s => s.date === D) && !S.draft) {
    const log = {};
    for (const def of DEFS) if (def.today) log[def.id] = { reps: [...def.today] };
    S.draft = { date: D, day: 'push', log, rest: null, done: true };
  }
  S.baseline2 = true;
  return true;
}

export const round = (x, step) => Math.round(x / step) * step;
export const fmtW = w => (w == null ? '' : String(+(+w).toFixed(1)));
export const fmtReps = r => (r.every(x => x === r[0]) ? String(r[0]) : r.join(' · '));
const fill = (n, v) => Array.from({ length: n }, () => v);

// Plates for one side of the bar, biggest first.
export function platesFor(w) {
  let side = (w - BAR) / 2;
  const out = [];
  for (const p of PLATES) while (side >= p - 1e-9) { out.push(p); side -= p; }
  return { plates: out, exact: Math.abs(side) < 1e-9 && w >= BAR };
}

export const learning = l => !l.targets;

export function ensureDraft(S, date) {
  if (!S.draft) S.draft = { date, day: dayFor(S, date), log: {}, rest: null };
  return S.draft;
}
export const entry = (d, id) => (d.log[id] ||= { reps: [] });
export const draftActive = d => !!d && Object.values(d.log).some(g => g.skip || g.w != null || g.reps.some(x => x != null));

// Which session a date belongs to. Follows the weekly schedule when there is
// one (Monday push, Tuesday pull ...), and on a rest day shows the next session.
export function dayFor(S, date) {
  if (!S.week) return S.rotation[S.pointer % S.rotation.length];
  const idx = (new Date(date + 'T12:00:00').getDay() + 6) % 7;
  for (let i = 0; i < 7; i++) { const d = S.week[(idx + i) % 7]; if (d) return d; }
  return S.rotation[0];
}
export const isRest = (S, date) => !!S.week && !S.week[(new Date(date + 'T12:00:00').getDay() + 6) % 7];

// A lift is part of today's session if it is not skipped, and, when it is an
// extra, only once you have said you are doing it.
export const isLive = (l, g) => !g?.skip && (!l.opt || !!g);
export const liveIds = (S, d) => S.order[d.day].filter(id => isLive(S.lifts[id], d.log[id]));

// Where lifting mode should be: the first set nobody has logged yet.
export function cursor(S) {
  const d = S.draft;
  if (!d) return null;
  for (const id of S.order[d.day]) {
    const l = S.lifts[id], g = d.log[id];
    if (!isLive(l, g)) continue;
    for (let i = 0; i < l.sets; i++) if (g?.reps[i] == null) return { id, set: i };
  }
  return null; // every set is accounted for
}

export function sessionOn(S, date) { return S.sessions.find(s => s.date === date); }
export function canAssume(S, day) {
  const ids = S.order[day].filter(id => !S.lifts[id].opt);
  return ids.length > 0 && ids.every(id => S.lifts[id].targets && S.lifts[id].weight != null);
}

function nextTargets(l, reps) {
  const c = reps.map(r => Math.max(1, Math.min(r, l.hi)));
  const low = Math.min(...c);
  if (low < l.hi) c[c.indexOf(low)]++;   // the earliest set that is behind gets the extra rep
  return c;
}

// One lift, one session: record it and set the plan for next time.
export function applyResult(l, w, reps, d) {
  const plan = l.targets ? [...l.targets] : null;
  const planW = l.weight;
  const note = { id: l.id, name: l.name, w, reps: [...reps], plan, planW };
  l.history.push({ d, w, reps: [...reps], plan, planW, ...(l.warm ? { warm: { ...l.warm } } : {}) });
  if (l.history.length > 60) l.history.shift();
  l.sessions++;
  l.weight = w;

  if (!plan) {
    if (l.sessions >= 2) { l.targets = nextTargets(l, reps); note.kind = 'learned'; }
    else note.kind = 'learning';
  } else if (w !== planW) {
    // You changed the weight, so the plan follows you.
    l.missStreak = w < planW ? l.missStreak + 1 : 0;
    l.targets = reps.map(r => Math.max(1, Math.min(r, l.hi)));
    note.kind = w < planW ? 'short' : 'ahead';
  } else if (reps.some((r, i) => r < plan[i])) {
    l.missStreak++;
    note.kind = 'short';
  } else {
    l.missStreak = 0;
    if (reps.every(r => r >= l.hi)) {
      l.weight = w + l.jump;
      // A big relative jump (light dumbbells) starts back at the bottom of the range.
      const reset = l.jump / l.weight >= 0.1 ? l.lo : Math.max(l.lo, l.hi - 2);
      l.targets = fill(l.sets, reset);
      note.kind = 'jump';
    } else {
      l.targets = nextTargets(l, reps);
      note.kind = 'hit';
    }
  }
  note.next = l.targets ? { w: l.weight, reps: [...l.targets] } : null;
  return note;
}

// Close out the open session. Any set nobody touched counts as done to plan.
export function finalize(S) {
  const d = S.draft;
  if (!d) return null;
  const notes = [];
  for (const id of S.order[d.day]) {
    const l = S.lifts[id], g = d.log[id] || { reps: [] };
    if (l.opt && !d.log[id]) continue;                       // an extra nobody mentioned
    if (g.skip) { if (!l.opt) notes.push({ id, name: l.name, kind: 'skipped' }); continue; }
    const w = g.w ?? l.weight;
    if (w == null) continue;
    let last = null;
    const reps = [];
    for (let i = 0; i < l.sets; i++) {
      const v = g.reps[i] ?? (l.targets ? l.targets[i] : last);
      if (v == null) break;
      reps.push(v); last = v;
    }
    if (reps.length < l.sets) continue;
    notes.push(applyResult(l, w, reps, d.date));
  }
  S.sessions.push({ date: d.date, day: d.day, notes });
  S.pointer = (S.pointer + 1) % S.rotation.length;
  S.draft = null;
  return notes;
}

// A session from an earlier day closes itself. Until then it can still be
// corrected, which is why finishing only marks it done.
export function rollOver(S, date) {
  const d = S.draft;
  if (!d || d.date === date) return;
  if (d.done || draftActive(d)) finalize(S); else S.draft = null;
}

// What everything looks like once today's finished session is counted.
// The screens read this, so a correction typed later still changes the plan.
export function project(S) {
  if (!S.draft?.done) return S;
  const V = { ...S, lifts: structuredClone(S.lifts), sessions: [...S.sessions], draft: structuredClone(S.draft) };
  finalize(V);
  return V;
}

const strength = e => e.reps.reduce((a, r) => a + e.w * (1 + r / 30), 0) / e.reps.length;

export function status(l) {
  if (l.weight == null) return { k: 'new', label: 'Not started' };
  if (!l.targets) return { k: 'learning', label: `Learning · ${Math.min(l.sessions, 2)} of 2` };
  if (l.missStreak >= 2) return { k: 'drop', label: 'Short twice' };
  if (l.missStreak === 1) return { k: 'short', label: 'Short last time' };
  const h = l.history.slice(-3).map(strength);
  if (h.length >= 3 && h[2] <= h[0] * 1.005) return { k: 'flat', label: 'Stalled' };
  return { k: 'up', label: 'Climbing' };
}

// What to do after two short sessions in a row. Heavy lifts drop about a
// tenth. Light ones, where the next weight down is a big step, keep the
// weight and start again at the bottom of the rep range.
export function easeOff(l) {
  const step = l.kind === 'barbell' ? 5 : l.jump;
  const w = round(l.weight * 0.9, step);
  if (w < l.weight && w > 0 && (l.weight - w) / l.weight <= 0.15) {
    return { w, reps: l.targets, text: `Drop to ${fmtW(w)} and build back up.`, button: `Drop to ${fmtW(w)}` };
  }
  return { w: l.weight, reps: fill(l.sets, l.lo), text: `Stay at ${fmtW(l.weight)} and restart at ${l.lo} reps.`, button: `Restart at ${l.lo} reps` };
}

export function advice(l) {
  const s = status(l);
  if (s.k === 'new') return 'Starts the first time you lift it.';
  if (s.k === 'learning') return 'Log every set for now. The plan sets itself after two sessions.';
  if (s.k === 'drop') return easeOff(l).text;
  if (s.k === 'short') return 'Same plan next time.';
  if (s.k === 'flat') return 'No progress in three sessions. Push for one more rep.';
  return 'Moving up. Nothing to change.';
}

export function proteinOn(S, date) {
  return S.foodLog.filter(f => f.date === date).reduce((a, f) => a + (f.protein || 0), 0);
}
export function caloriesOn(S, date) {
  return S.foodLog.filter(f => f.date === date).reduce((a, f) => a + (f.calories || 0), 0);
}

// Usuals, with the ones you tend to eat around this hour first.
export function usuals(S, hour) {
  const near = f => [hour - 1, hour, hour + 1].reduce((a, h) => a + (f.hours?.[h] || 0), 0);
  return [...S.foods].sort((a, b) => (near(b) * 3 + b.uses) - (near(a) * 3 + a.uses));
}

// Everything eaten on a day, added up.
export function totalsOn(S, date) {
  const t = { protein: 0, calories: 0, carbs: 0, fat: 0 };
  for (const f of S.foodLog) if (f.date === date) for (const k of Object.keys(t)) t[k] += f[k] || 0;
  return t;
}

export function logFood(S, { name, protein, calories = 0, carbs = 0, fat = 0, source, date, time, hour, id, keep }) {
  S.foodLog.push({ id, date, time, name, protein, calories, carbs, fat, source });
  if (!name) return;
  let f = S.foods.find(x => x.name.toLowerCase() === name.toLowerCase());
  if (!f) {
    if (!keep) return;
    f = { id: 'f' + id, name, protein, calories, carbs, fat, uses: 0, hours: {} };
    S.foods.push(f);
  }
  f.uses++;
  f.hours[hour] = (f.hours[hour] || 0) + 1;
}
