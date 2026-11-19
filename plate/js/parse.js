// Reads the short things you type or say, on the phone, with no network.
// It only handles the common shapes. Anything else is handed back as unread
// so the AI reader can take it once that is connected.

const ALIASES = {
  bench: ['bench'],
  ohp: ['overhead press', 'shoulder press', 'overhead', 'ohp'],
  fly: ['chest fly', 'flies', 'flys', 'fly'],
  latraise: ['lateral raise', 'lat raise', 'laterals', 'lateral', 'raises'],
  pushdown: ['tricep pushdown', 'pushdowns', 'pushdown', 'push down', 'triceps', 'tricep'],
  curl: ['seated incline curl', 'incline bicep curl', 'incline biceps', 'incline bicep', 'incline curls', 'incline curl', 'curls', 'curl'],
  squat: ['squats', 'squat'],
  rdl: ['romanian deadlift', 'romanian', 'rdls', 'rdl'],
  dbbench: ['dumbbell bench', 'db bench', 'dumbbell press'],
  smithbench: ['smith machine bench', 'smith bench'],
  jampress: ['jam press'],
  incsmith: ['incline smith bench', 'incline smith'],
  pecdeck: ['pec deck', 'pec dec'],
  dips: ['dips', 'dip'],
  otext: ['overhead tricep extension', 'overhead extension', 'tricep extension', 'overhead triceps'],
  scurl: ['standing curl', 'standing curls'],
  ccurl: ['cable curl', 'cable curls'],
  row: ['barbell row', 'bent over row', 'rows', 'row'],
  sarow: ['single arm row', 'single-arm row', 'one arm row'],
  wpull: ['weighted pull up', 'weighted pull-up', 'pull up', 'pullup', 'pull-up', 'pull ups'],
  reardelt: ['rear delt fly', 'rear delt', 'rear delts', 'reverse fly'],
  legext: ['leg extension', 'leg extensions', 'leg ext'],
  legcurl: ['leg curl', 'leg curls', 'hamstring curl'],
  dbrdl: ['dumbbell rdl', 'db rdl', 'dumbbell romanian'],
  deadlift: ['deadlifts', 'deadlift'],
};
const ORDINAL = { first: 0, '1st': 0, second: 1, '2nd': 1, third: 2, '3rd': 2, fourth: 3, '4th': 3, fifth: 4, '5th': 4 };

// Words that can sit in front of a lift's name without changing which lift it is.
const PLAIN = new Set(("i i'm we my the a an some and then also just did do done doing hit added add got finished in on for of at to with too no not never skip skipped skipping missed didn't don't " +
  "stop assuming counting adding take out more any heavy light last first second third final extra few today today's push pull legs leg day set sets reps x").split(' '));

function findLift(S, text) {
  let best = null;
  for (const l of Object.values(S.lifts)) {
    const names = [...(ALIASES[l.id] || []), l.name.toLowerCase()];
    for (const a of names) {
      const at = text.indexOf(a);
      if (at < 0) continue;
      // A one-word name with another word in front is a different lift:
      // "hammer curls" is not his curl, "cable rows" is not his barbell row.
      if (!a.includes(' ')) {
        const prev = text.slice(0, at).trim().split(' ').pop();
        if (prev && /^[a-z'-]+$/.test(prev) && !PLAIN.has(prev)) continue;
      }
      if (!best || a.length > best.alias.length) best = { lift: l, alias: a };
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

// The weight and reps in what is left of a lift message once the name is taken out.
// Returns null when there are numbers it cannot place.
function numbers(rest, sets, top) {
  let w = null, m;
  const reps = {};
  // "3 sets of 10", "3x10" comes out first, so "40 for 3 sets of 10" reads as 40 pounds.
  const sx = rest.match(/\b(\d)\s*(?:sets?\s*(?:of|x|×)?|x|×)\s*(\d{1,2})\b/);
  if (sx) rest = rest.replace(sx[0], ' ');
  const wr = sx ? null : rest.match(/(\d{2,3}(?:\.5)?)s?\s*(?:x|×|for)\s*(\d{1,2})/);
  if (wr) w = +wr[1];
  let body = (wr ? rest.replace(wr[0], ' ') : rest).replace(/(?:at|with|@)\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:lbs?|pounds?)|\b(\d{2,3})s\b/g, (_, a, b, c) => { w = +(a ?? b ?? c); return ' '; });
  if (sx) {
    if (w == null && (m = body.match(/\b\d{2,3}(?:\.5)?\b/))) w = +m[0];
    for (let i = 0; i < Math.min(8, +sx[1]); i++) reps[i] = +sx[2];
    return { w, reps, sets: +sx[1] };
  }
  if (wr) { for (let i = 0; i < (top ? 1 : sets); i++) reps[i] = +wr[2]; return { w, reps }; }
  if ((m = body.match(/(?:last|final)(?:\s+set)?\D{0,10}(\d{1,2})|(\d{1,2})\D{0,12}(?:last|final)/))) reps[sets - 1] = +(m[1] ?? m[2]);
  else if ((m = body.match(/(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th)(?:\s+set)?\D{0,10}(\d{1,2})/))) reps[ORDINAL[m[1]]] = +m[2];
  else if ((m = body.match(/set\s*(\d)\D{1,10}(\d{1,2})/))) reps[+m[1] - 1] = +m[2];
  else {
    const nums = (body.match(/\b\d{1,2}\b/g) || []).map(Number);
    if (nums.length === sets) nums.forEach((n, i) => { reps[i] = n; });
    else if (nums.length === 1) reps[sets - 1] = nums[0];
    else if (nums.length > 1) return null;
  }
  return { w, reps };
}

// A long message is several things said at once. This cuts it where one thing ends
// and the next starts. A piece with no name of its own ("9", "then 245 for 4") stays
// with the piece before it.
const FILL = /\b(?:for|reps?|sets?|and|then|the|last|first|second|third|final|pounds?|lbs?|with|got|did|was|at)\b/gi;
export function parts(raw) {
  const bits = String(raw).split(/\n+|[,;.]+(?=\s|$)|\s+(?:and then|and also|and|then|also|plus)\s+/i).map(s => s.trim()).filter(Boolean);
  const out = [];
  for (const b of bits) {
    if (out.length && !/[a-z]{3,}/i.test(b.replace(FILL, ' '))) out[out.length - 1] += ' ' + b;
    else out.push(b);
  }
  return out;
}

// Returns { type, ... } or { type: 'unread' }.
// An unread message can carry "maybe": the phone's own best reading of a lift it has
// never seen, used when the AI reader cannot be reached.
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

  // Bodyweight: "weighed 195", "bodyweight 194.5", "i weigh 195"
  m = text.match(/^(?:i\s+)?(?:weigh(?:ed)?|bodyweight|body weight|scale)(?:\s+(?:is|at|was))?\s*(\d{2,3}(?:\.\d)?)/);
  if (m && +m[1] >= 80 && +m[1] <= 500) return { type: 'weight', lb: +m[1] };

  // A lift named: shortfall, skip, or a different weight.
  const hit = findLift(S, text);
  if (hit) {
    const l = hit.lift;
    const rest = text.replace(hit.alias, ' ');
    // "I don't do rows", "stop assuming rows": it stops being assumed from now on.
    if (/\b(?:don'?t do|do not do|never do|stop (?:assuming|counting|adding)|take (?:it |that |them )?out|no more)\b/.test(rest)) return { type: 'demote', id: l.id };
    if (/\b(skip|skipped|skipping|no|not doing|didn'?t do|did not do|missed)\b/.test(rest)) return { type: 'skip', id: l.id };
    const got = numbers(rest, l.sets, l.style === 'top');
    if (!got) return { type: 'unread' };
    if (got.w == null && !Object.keys(got.reps).length) {
      // Just the name, or "did incline curls": he did it, at what is remembered.
      const bare = !rest.replace(/\b(i|just|also|did|done|do|hit|added|add|threw in|finished|got|some|a|an|the|my|today|too|and|then|as well|sets?|in)\b/g, ' ').trim();
      return bare ? { type: 'lift', id: l.id, w: null, reps: {}, inDay: dayIds.includes(l.id) } : { type: 'unread' };
    }
    return { type: 'lift', id: l.id, w: got.w, reps: got.reps, inDay: dayIds.includes(l.id) };
  }

  // A day you did not lift. Only when no lift is named, so "skipped curls" still skips curls.
  if (/^(?:i\s+)?(?:skipped|skip|missed|miss)(?:\s+(?:the\s+)?(?:workout|lift|lifting|gym|training|session|today))?$/.test(text) ||
      /^(?:rest day|off day|day off|no (?:workout|lift|lifting|gym|training) today|(?:i\s+)?(?:didn'?t|did not) (?:lift|train|work ?out|go to the gym)(?: today)?|took (?:today|the day) off)$/.test(text)) {
    return { type: 'off' };
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

  // "did hammer curls 35 for 10": a lift the app has never seen. The AI reader gets
  // the first look, since it can tell a new lift from a garbled old one.
  // With a weight and reps after it, the name alone is enough: "face pulls 60 for 12".
  m = text.match(/^(?:i\s+)?(?:also\s+|just\s+|then\s+)?(?:did|added|add|threw in|hit)\s+(?:some\s+|a\s+|an\s+|in\s+)?([a-z][a-z' -]{2,38}?)(?=\s+\d|\s+at\b|\s+for\b|\s+with\b|\s*$)/) ||
      text.match(/^()?([a-z][a-z' -]{2,38}?)(?=\s+\d{2,3}s?\s*(?:x|×|for)\s*\d)/);
  if (m && m[2]) m = Object.assign([m[0], m[2]], { index: 0 });
  if (m && !/\b(protein|calories|cals?|grams?|ate|eaten|slept|sleep|it|that|this|everything|nothing|all|today|workout)\b/.test(m[1])) {
    const got = numbers(text.slice(m[0].length), 3, false);
    if (got) {
      const name = m[1].trim().replace(/s$/, '').replace(/^./, c => c.toUpperCase());
      return { type: 'unread', maybe: { type: 'lift', name, w: got.w, reps: got.reps, sets: got.sets || null } };
    }
  }

  return { type: 'unread' };
}
