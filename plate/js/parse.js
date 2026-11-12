// Reads the short things you type or say, on the phone, with no network.
// It only handles the common shapes. Anything else is handed back as unread
// so the AI reader can take it once that is connected.

const ALIASES = {
  bench: ['bench'],
  ohp: ['overhead press', 'shoulder press', 'overhead', 'ohp'],
  fly: ['chest fly', 'flies', 'flys', 'fly'],
  latraise: ['lateral raise', 'lat raise', 'laterals', 'lateral', 'raises'],
  pushdown: ['tricep pushdown', 'pushdowns', 'pushdown', 'push down', 'triceps', 'tricep'],
  curl: ['incline curl', 'curls', 'curl'],
  squat: ['squats', 'squat'],
  rdl: ['romanian deadlift', 'romanian', 'rdls', 'rdl'],
};
const ORDINAL = { first: 0, '1st': 0, second: 1, '2nd': 1, third: 2, '3rd': 2, fourth: 3, '4th': 3, fifth: 4, '5th': 4 };

function findLift(S, text) {
  let best = null;
  for (const l of Object.values(S.lifts)) {
    const names = [...(ALIASES[l.id] || []), l.name.toLowerCase()];
    for (const a of names) {
      const at = text.indexOf(a);
      if (at >= 0 && (!best || a.length > best.alias.length)) best = { lift: l, alias: a };
    }
  }
  return best;
}

function findFood(S, text) {
  let best = null;
  for (const f of S.foods) {
    const n = f.name.toLowerCase();
    const hit = text.includes(n) || (n.endsWith('s') ? false : text.includes(n + 's'));
    if (hit && (!best || n.length > best.name.length)) best = f;
  }
  return best;
}

const COUNT = { a: 1, an: 1, one: 1, two: 2, double: 2, three: 3, triple: 3, four: 4, half: 0.5 };

// Returns { type, ... } or { type: 'unread' }.
export function read(S, raw, dayIds) {
  const text = raw.toLowerCase().replace(/[,;!]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return { type: 'empty' };

  // Sleep: "slept 7.5", "slept 7h 20m", "7 hours sleep"
  let m = text.match(/(?:slept|sleep)\D{0,12}(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours?)?(?:\s*(\d{1,2})\s*m)?/) ||
          text.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours?)\s*(?:(\d{1,2})\s*m\w*)?\s*(?:of\s+)?sleep/);
  if (m) {
    const hours = +m[1] + (m[2] ? +m[2] / 60 : 0);
    if (hours > 0 && hours <= 16) return { type: 'sleep', hours: Math.round(hours * 60) / 60 };
  }

  // A lift named: shortfall, skip, or a different weight.
  const hit = findLift(S, text);
  if (hit) {
    const l = hit.lift;
    const rest = text.replace(hit.alias, ' ');
    if (/\b(skip|skipped|skipping|no|didn'?t do)\b/.test(rest)) return { type: 'skip', id: l.id };
    let w = null;
    let body = rest.replace(/(?:at|with|@)\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:lbs?|pounds?)/g, (_, a, b) => { w = +(a ?? b); return ' '; });
    const reps = {};
    m = body.match(/(?:last|final)(?:\s+set)?\D{0,10}(\d{1,2})|(\d{1,2})\D{0,12}(?:last|final)/);
    if (m) reps[l.sets - 1] = +(m[1] ?? m[2]);
    else if ((m = body.match(/(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th)(?:\s+set)?\D{0,10}(\d{1,2})/))) reps[ORDINAL[m[1]]] = +m[2];
    else if ((m = body.match(/set\s*(\d)\D{1,10}(\d{1,2})/))) reps[+m[1] - 1] = +m[2];
    else {
      const nums = (body.match(/\b\d{1,2}\b/g) || []).map(Number);
      if (nums.length === l.sets) nums.forEach((n, i) => { reps[i] = n; });
      else if (nums.length === 1) reps[l.sets - 1] = nums[0];
      else if (nums.length > 1) return { type: 'unread' };
    }
    if (w == null && !Object.keys(reps).length) return { type: 'unread' };
    return { type: 'lift', id: l.id, w, reps, inDay: dayIds.includes(l.id) };
  }

  // The whole session, as planned.
  if (/^(?:(?:push|pull|legs?)\s*(?:day)?\s*)?(?:is\s+)?(?:done|finished|complete|completed)$/.test(text) ||
      /^(?:did|finished|done with)\s+(?:it|push|pull|legs?|the workout|my workout)(?:\s+day)?(?:\s+as written)?$/.test(text)) {
    return { type: 'done' };
  }

  // Food you already keep as a usual: "shake", "2 shakes", "double chicken bowl"
  const food = findFood(S, text);
  const cals = text.match(/(\d{2,4})\s*(?:calories|k?cals?)/);
  let grams = text.match(/(\d{1,3})\s*(?:g|grams?)\b(?:\s*(?:of\s+)?protein)?/);
  if (!grams && !food) grams = text.match(/()(\d{1,3})\s*protein/);
  if (food && !grams) {
    const c = text.replace(food.name.toLowerCase(), ' ').match(/\b(\d(?:\.\d)?|a|an|one|two|double|three|triple|four|half)\b/);
    const n = c ? (COUNT[c[1]] ?? +c[1]) : 1;
    return { type: 'food', name: food.name, protein: Math.round(food.protein * n), calories: Math.round((food.calories || 0) * n), n, source: 'usual' };
  }
  if (grams) {
    const g = +(grams[1] || grams[2]);
    const name = text.replace(grams[0], ' ').replace(cals ? cals[0] : '', ' ')
      .replace(/\b(of|protein|ate|had|i|a|an|the|with|for|and|about|around)\b/g, ' ').replace(/\s+/g, ' ').trim();
    return { type: 'food', name: name ? name[0].toUpperCase() + name.slice(1) : '', protein: g, calories: cals ? +cals[1] : 0, n: 1, source: 'typed' };
  }

  return { type: 'unread' };
}
