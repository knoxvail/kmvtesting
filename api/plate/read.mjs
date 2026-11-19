// Plate: the AI reader. The phone handles the common messages by itself and
// only sends the ones it cannot parse.
//   POST /api/plate/read  <- { text, context }
//                         -> { actions: [...], note }
// The model turns one message into log entries. It never touches the saved
// data. The phone applies the entries and offers an undo.
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { allow, aiKey } from './_shared.mjs';

// Food amounts and nutrition need real knowledge, so this uses a stronger model than the
// photo and speech steps. It still costs a fraction of a cent a message.
const MODEL = 'claude-sonnet-5-5';

// A long message with a whole session in it takes longer to read.
export const config = { maxDuration: 60 };

// The reply format. The service allows at most 16 fields that can be null across the
// whole format, so text that does not apply is an empty string and only four fields
// can be null. Keep it that way when adding to it.
const Food = z.object({
  name: z.string(),                     // short name, the way he said it
  protein: z.number(),                  // grams of protein for the amount eaten
  calories: z.number(),
  carbs: z.number(),
  fat: z.number(),
  kind: z.enum(['usual', 'saved', 'stated', 'standard', 'lookup']), // where the numbers come from
  place: z.string(),                    // to look up: restaurant, shop or brand, as he said it. Empty if none
  amount: z.string(),                   // to look up: size, count and changes, in his words. Empty if none
  home: z.boolean(),                    // to look up: true when cooked at home or plain food
  detail: z.string(),                   // the pieces added up, like "2 eggs 12 g + toast 4 g". Empty if none
});
const Lift = z.object({
  lift_id: z.string(),                  // an id from his lifts, or an empty string for a lift he has never logged
  name: z.string(),                     // new lift: a short standard name. Empty for a lift he already has
  equipment: z.enum(['barbell', 'dumbbell', 'stack', 'other']),
  weight: z.number().nullable(),        // the weight, when one weight covers what he said. Null if he gave none
  set_count: z.number().nullable(),     // how many sets, only if he said
  sets: z.array(z.object({              // only the sets he mentions, set is 1-based
    set: z.number(),
    reps: z.number(),
    weight: z.number().nullable(),      // only when this set was at a different weight from the others
  })),
});
const Reading = z.object({
  remove_last_food: z.boolean(),
  foods: z.array(Food),
  lifts: z.array(Lift),
  skip_lifts: z.array(z.string()),      // lift ids
  drop_lifts: z.array(z.string()),      // lift ids
  sleep_hours: z.number().nullable(),
  session_done: z.boolean(),
  note: z.string(),                     // empty unless something could not be logged
});

const SYSTEM = `You turn one message from a lifter into entries for his training log. The message can be one line or a long run of speech covering a whole session and a meal: go through all of it and return one entry for every lift, food and sleep it mentions, in the order he said them. Do not stop early and do not merge two lifts into one. The app is a memory of his lifts. It does not write his workout or tell him what to do. He decides what he lifts each day, and it changes: he adds lifts partway through a session, drops ones he is not doing, and does lifts on days they do not usually fall on. Your job is to record what he says he did. Food and sleep are logged as they happen.

You get a JSON context and the message he typed or dictated. Dictation can garble a word, so read for what he meant.

The context also holds recent, his last few messages with what was logged for each. Use it to understand words like "that", "it", "again" and "the other one".

The context holds lifts: every lift he has logged before, each with its id, name, the day it usually falls on, its number of sets, and the weight and reps he did last time. Nothing is assumed for today: a lift only counts when he says he did it. It also holds his usual foods with their numbers per serving, and known_foods: things looked up for him before, each with the place, the amount the numbers are for, and the numbers.

What you return:

foods: one entry per food or dish. Always give all four numbers: protein, calories, carbs and fat, as whole numbers for the amount he ate. Keep the name short, in his words, with a capital first letter. Set kind to say where the numbers come from:

- "usual": it matches one of his usual_foods. Use that usual's name, and its numbers times how many he had.
- "saved": it matches one of known_foods, the same item from the same place. Use its name and its numbers, scaled if he had a different amount than the one listed.
- "stated": he gave the numbers himself, at least the protein. Use his numbers and fill in the rest only if he said them, otherwise 0.
- "standard": one plain staple with a clear amount, where the value is settled: eggs, a scoop of whey, chicken breast by weight, rice by the cup, a glass of milk. Work it out from the reference values below and put the working in detail, for example "3 eggs, 6 g each".
- "lookup": everything else. That means anything from a restaurant, shop, bakery, delivery order or packaged brand, and any cooked dish or meal with more than one part. Guessed numbers have been badly wrong for him, so the app looks these up online after you answer. Your job is to describe the food well enough to search for it. Set place to the restaurant, shop or brand exactly as he said it, or an empty string. Set home to true when he cooked it or it is plain food with no source. Set amount to everything he said about size, count and changes, in his words, for example "2 everything bagels with cream cheese", "bowl, double chicken, no beans" or "about 8 oz chicken, a cup of rice, olive oil". Still fill in the four numbers with your best rough figures. They are only shown if the lookup fails.

When one message names several things from one order, return one entry per thing, each with the same place. Use an empty string for place, amount and detail when there is nothing to put there.

Reference values for "standard": cooked chicken breast 31 g protein and 165 calories per 100 g; cooked lean ground beef 26 g and 250 per 100 g; cooked steak 27 g and 270 per 100 g; cooked salmon 22 g and 206 per 100 g; egg 6 g protein, 5 g fat, 72 calories each; egg white 3.6 g and 17 each; Greek yogurt 10 g and 60 to 100 per 100 g; whey protein scoop 24 g and 120; whole milk 8 g protein, 12 g carbs, 8 g fat, 150 calories per cup; cooked white rice 4 g protein, 45 g carbs, 205 calories per cup; peanut butter 4 g protein, 8 g fat, 95 calories per tablespoon; banana 1 g protein, 27 g carbs, 105 calories. Meat and fish are cooked weight unless he says raw.

lifts: one entry for each lift he says he did, or says how it went. Match what he says to his lifts by what the exercise is, not by exact words, and allow for dictation errors: "incline biceps" or "incline bicep curls" is his Seated incline curl, "tricep push downs" is his Tricep pushdown. It does not matter which day the lift usually falls on. Use that lift's id in lift_id and leave name empty. When he only says he did it ("did incline curls", "added pec deck"), set weight to null and leave sets empty: the app fills in what it remembers, and he will say so if it went differently. When he gives numbers, put in sets only the sets he mentions, with the reps he got. "Last set" means the highest set number. If he gives one number per set, map them in order. "3 sets of 10" is three entries of 10. Set weight only when he says a weight.

He often changes the weight between sets, for example on a drop set or working up: "pushdowns 120 for 10 then dropped to 90 for 8", "bench 225 for 8, 245 for 5, 250 for 3". Then give every set its own weight in sets, in the order he did them, and set the lift's weight to the first one. A drop set is extra sets of the same lift, never a second lift. When every set was at the same weight, leave each set's weight null.

If nothing in his lifts is the same exercise, it is a new lift, and it is logged like any other. Set lift_id to an empty string, put a short standard name for the exercise in name with a capital first letter ("Hammer curl", "Cable lateral raise"), set equipment to barbell, dumbbell, stack (a cable or a machine with a weight stack) or other, set set_count if he said how many sets, and give whatever weight and reps he said. Never leave a lift out because it is not in his lifts, and never tell him a lift is not part of today. For a lift he already has, set equipment to other.

skip_lifts: ids of his lifts he says he did not do this time ("no pushdowns today", "skipped curls").

drop_lifts: ids of lifts he says he does not do as a rule, or to stop counting ("I never do rows", "stop assuming rows", "take rows out"). An injury that keeps him off a lift for now goes here too.

sleep_hours: hours as a decimal number, so 7 hours 30 minutes is 7.5. Null when he did not mention sleep.

remove_last_food: true when he is correcting or cancelling the food he logged most recently, for example "make that 40 grams", "no, it was chicken" or "take that off". Put the corrected food in foods if there is one. Use it only when the correction clearly refers to the most recent food in recent.

session_done: true when he says the workout is finished.

Log only what the message states. If part of it asks a question or is not something to log, return no entry for that part and explain in note with one short plain sentence. Leave note empty when everything was logged.`;

const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null);

// The model's output is data from outside, so it is checked before it goes back to the phone.
// The phone gets one flat list of entries, in the order they should be applied.
function clean(out, context) {
  const lifts = new Map((context.lifts || []).map(l => [String(l.id), l]));
  const actions = [];
  if (out.remove_last_food) actions.push({ type: 'remove_last_food' });
  for (const a of out.foods || []) {
    const protein = num(a.protein, 0, 400);
    if (protein == null) continue;
    const kind = ['usual', 'saved', 'stated', 'standard', 'lookup'].includes(a.kind) ? a.kind : 'lookup';
    const source = { usual: 'usual', saved: 'saved', stated: 'typed', standard: 'standard', lookup: 'estimate' }[kind];
    actions.push({ type: 'food', name: String(a.name || '').slice(0, 40), protein: Math.round(protein), calories: Math.round(num(a.calories, 0, 6000) ?? 0), detail: String(a.detail || '').slice(0, 160), carbs: Math.round(num(a.carbs, 0, 1000) ?? 0), fat: Math.round(num(a.fat, 0, 500) ?? 0),
      kind, source, estimated: kind === 'lookup', place: String(a.place || '').slice(0, 80), amount: String(a.amount || '').slice(0, 240), home: a.home === true });
  }
  for (const a of out.lifts || []) {
    const l = lifts.get(String(a.lift_id));
    const reps = (a.sets || [])
      .map(r => ({ set: Math.round(num(r.set, 1, 20) ?? 0), reps: Math.round(num(r.reps, 0, 100) ?? -1), weight: num(r.weight, 0, 2000) }))
      .filter(r => r.set >= 1 && r.set <= 8 && r.reps >= 0)
      .map(r => (r.weight == null ? { set: r.set, reps: r.reps } : r));
    const weight = num(a.weight, 0, 2000) ?? reps.find(r => r.weight != null)?.weight ?? null;
    // A lift he names is always logged. With no numbers it means "did it, as remembered".
    if (l) { actions.push({ type: 'lift', lift_id: String(l.id), weight, reps }); continue; }
    const name = String(a.name || '').replace(/[<>]/g, '').trim().slice(0, 40);
    if (name.length < 2) continue;
    actions.push({ type: 'lift', lift_id: null, name, equipment: ['barbell', 'dumbbell', 'stack', 'other'].includes(a.equipment) ? a.equipment : 'other', sets: Math.round(num(a.set_count, 1, 8) ?? 0) || null, weight, reps });
  }
  for (const id of out.skip_lifts || []) if (lifts.has(String(id))) actions.push({ type: 'skip_lift', lift_id: String(id) });
  for (const id of out.drop_lifts || []) if (lifts.has(String(id))) actions.push({ type: 'drop_lift', lift_id: String(id) });
  const hours = num(out.sleep_hours, 0, 16);
  if (hours) actions.push({ type: 'sleep', hours: Math.round(hours * 60) / 60 });
  if (out.session_done) actions.push({ type: 'session_done' });
  return { actions, note: String(out.note || '').slice(0, 200) };
}

export default async function handler(req, res) {
  if (!allow(req, res)) return;
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); res.status(405).json({ error: 'method_not_allowed' }); return; }
  if (!aiKey()) { res.status(503).json({ error: 'not_set_up' }); return; }

  const { text, context } = req.body || {};
  if (typeof text !== 'string' || !text.trim() || text.length > 4000 || !context || typeof context !== 'object') {
    res.status(400).json({ error: 'bad_request' });
    return;
  }
  const brief = JSON.stringify({
    today: context.day ?? null,
    lifts: (context.lifts || []).slice(0, 60),
    usual_foods: (context.usuals || []).slice(0, 40),
    known_foods: (context.known || []).slice(-60),
    recent: (context.recent || []).slice(-8).map(r => ({ said: String(r.said || '').slice(0, 200), did: String(r.did || '').slice(0, 200) })),
  });
  if (brief.length > 30_000) { res.status(413).json({ error: 'too_big' }); return; }

  const client = new Anthropic({ apiKey: aiKey() });
  try {
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 8192,
      output_config: { effort: 'low', format: zodOutputFormat(Reading) },
      system: SYSTEM,
      messages: [{ role: 'user', content: `Context:\n${brief}\n\nMessage:\n${text.trim()}` }],
    });
    if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens' || !response.parsed_output) {
      res.status(200).json({ actions: [], note: 'Could not read that one.' });
      return;
    }
    res.status(200).json(clean(response.parsed_output, context));
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) res.status(503).json({ error: 'bad_ai_key' });
    else if (error instanceof Anthropic.RateLimitError) res.status(429).json({ error: 'busy' });
    else if (error instanceof Anthropic.BadRequestError) { console.error('plate read: request rejected', error.message); res.status(502).json({ error: 'ai_rejected' }); }
    else if (error instanceof Anthropic.APIError) { console.error('plate read:', error.status, error.message); res.status(502).json({ error: 'ai_unreachable' }); }
    else res.status(500).json({ error: 'failed' });
  }
}
