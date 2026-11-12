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
  history: [],       // { d, w, reps, plan, planW }
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
    profile: { protein: 180, calories: 0, carbs: 0, fat: 0, sleep: 8, days: 5 },
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
  if (!S.draft) S.draft = { date, day: S.rotation[S.pointer % S.rotation.length], log: {}, rest: null };
  return S.draft;
}
export const entry = (d, id) => (d.log[id] ||= { reps: [] });
export const draftActive = d => !!d && Object.values(d.log).some(g => g.skip || g.w != null || g.reps.some(x => x != null));

// Where lifting mode should be: the first set nobody has logged yet.
export function cursor(S) {
  const d = S.draft;
  if (!d) return null;
  for (const id of S.order[d.day]) {
    const l = S.lifts[id], g = d.log[id];
    if (g?.skip) continue;
    for (let i = 0; i < l.sets; i++) if (g?.reps[i] == null) return { id, set: i };
  }
  return null; // every set is accounted for
}

export function sessionOn(S, date) { return S.sessions.find(s => s.date === date); }
export function canAssume(S, day) {
  const ids = S.order[day];
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
  l.history.push({ d, w, reps: [...reps], plan, planW });
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
    if (g.skip) { notes.push({ id, name: l.name, kind: 'skipped' }); continue; }
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
