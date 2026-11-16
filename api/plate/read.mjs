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

// Every field is always present, with null where it does not apply.
const Action = z.object({
  type: z.enum(['food', 'lift', 'skip_lift', 'sleep', 'session_done', 'remove_last_food']),
  name: z.string().nullable(),          // food: short name, the way he said it
  protein: z.number().nullable(),       // food: grams of protein for the amount eaten
  calories: z.number().nullable(),      // food: calories for the amount eaten
  carbs: z.number().nullable(),         // food: grams of carbohydrate for the amount eaten
  fat: z.number().nullable(),           // food: grams of fat for the amount eaten
  estimated: z.boolean().nullable(),    // food: true when the numbers are your estimate
  kind: z.enum(['usual', 'saved', 'stated', 'standard', 'lookup']).nullable(), // food: where the numbers come from
  place: z.string().nullable(),         // food to look up: restaurant, shop or brand, as he said it
  amount: z.string().nullable(),        // food to look up: size, count and changes, in his words
  home: z.boolean().nullable(),         // food to look up: true when cooked at home or plain food
  detail: z.string().nullable(),        // food: the pieces added up, like "2 eggs 12 g + toast 4 g"
  lift_id: z.string().nullable(),       // lift, skip_lift: an id from today's lifts
  weight: z.number().nullable(),        // lift: only if he used a different weight than planned
  reps: z.array(z.object({ set: z.number(), reps: z.number() })).nullable(), // lift: only the sets he mentions, set is 1-based
  hours: z.number().nullable(),         // sleep: hours as a decimal
});
const Reading = z.object({
  actions: z.array(Action),
  note: z.string(),                     // empty unless something could not be logged
});

const SYSTEM = `You turn one short message from a lifter into entries for his training log. He runs a push, pull, legs plan. The app already assumes he did every set exactly as planned, so a message about lifting only matters when something went differently. Food and sleep are logged as they happen.

You get a JSON context and the message he typed or dictated. Dictation can garble a word, so read for what he meant.

The context also holds recent, his last few messages with what was logged for each. Use it to understand words like "that", "it", "again" and "the other one".

The context holds today's lifts (id, name, number of sets, the reps planned for each set, the planned weight), the names of lifts that belong to other days, his usual foods with their numbers per serving, and known_foods: things looked up for him before, each with the place, the amount the numbers are for, and the numbers.

Entries you can return:

food: one entry per food or dish. Always give all four numbers: protein, calories, carbs and fat, as whole numbers for the amount he ate. Keep the name short, in his words, with a capital first letter. Set kind to say where the numbers come from:

- "usual": it matches one of his usual_foods. Use that usual's name, and its numbers times how many he had.
- "saved": it matches one of known_foods, the same item from the same place. Use its name and its numbers, scaled if he had a different amount than the one listed.
- "stated": he gave the numbers himself, at least the protein. Use his numbers and fill in the rest only if he said them, otherwise 0.
- "standard": one plain staple with a clear amount, where the value is settled: eggs, a scoop of whey, chicken breast by weight, rice by the cup, a glass of milk. Work it out from the reference values below and put the working in detail, for example "3 eggs, 6 g each".
- "lookup": everything else. That means anything from a restaurant, shop, bakery, delivery order or packaged brand, and any cooked dish or meal with more than one part. Guessed numbers have been badly wrong for him, so the app looks these up online after you answer. Your job is to describe the food well enough to search for it. Set place to the restaurant, shop or brand exactly as he said it, or null. Set home to true when he cooked it or it is plain food with no source. Set amount to everything he said about size, count and changes, in his words, for example "2 everything bagels with cream cheese", "bowl, double chicken, no beans" or "about 8 oz chicken, a cup of rice, olive oil". Still fill in the four numbers with your best rough figures. They are only shown if the lookup fails.

Set estimated to true for "lookup" and false for the others. When one message names several things from one order, return one entry per thing, each with the same place.

Reference values for "standard": cooked chicken breast 31 g protein and 165 calories per 100 g; cooked lean ground beef 26 g and 250 per 100 g; cooked steak 27 g and 270 per 100 g; cooked salmon 22 g and 206 per 100 g; egg 6 g protein, 5 g fat, 72 calories each; egg white 3.6 g and 17 each; Greek yogurt 10 g and 60 to 100 per 100 g; whey protein scoop 24 g and 120; whole milk 8 g protein, 12 g carbs, 8 g fat, 150 calories per cup; cooked white rice 4 g protein, 45 g carbs, 205 calories per cup; peanut butter 4 g protein, 8 g fat, 95 calories per tablespoon; banana 1 g protein, 27 g carbs, 105 calories. Meat and fish are cooked weight unless he says raw.

lift: only for a lift in today's list, using its id. Put in reps only the sets he mentions, with what he got. "Last set" means the highest set number. If he gives one number per set, map them in order. Set weight only when he says he used a different weight than planned.

skip_lift: he says he skipped a lift from today's list.

sleep: hours as a decimal number, so 7 hours 30 minutes is 7.5.

remove_last_food: he is correcting or cancelling the food he logged most recently, for example "make that 40 grams", "no, it was chicken" or "take that off". Return this first, then the corrected food entry if there is one. Use it only when the correction clearly refers to the most recent food in recent.

session_done: he says the workout is finished. This can come with lift entries for what fell short.

Log only what the message states. If it names a lift that is not in today's list, asks a question, or is not something to log, return no entry for that part and explain in note with one short plain sentence. Leave note empty when everything was logged. Set every field that does not apply to null.`;

const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null);

// The model's output is data from outside, so it is checked before it goes back to the phone.
function clean(out, context) {
  const lifts = new Map((context.lifts || []).map(l => [String(l.id), l]));
  const actions = [];
  for (const a of out.actions) {
    if (a.type === 'food') {
      const protein = num(a.protein, 0, 400);
      if (protein == null) continue;
      const kind = ['usual', 'saved', 'stated', 'standard', 'lookup'].includes(a.kind) ? a.kind : (a.estimated === false ? 'stated' : 'lookup');
      const source = { usual: 'usual', saved: 'saved', stated: 'typed', standard: 'standard', lookup: 'estimate' }[kind];
      actions.push({ type: 'food', name: String(a.name || '').slice(0, 40), protein: Math.round(protein), calories: Math.round(num(a.calories, 0, 6000) ?? 0), detail: String(a.detail || '').slice(0, 160), carbs: Math.round(num(a.carbs, 0, 1000) ?? 0), fat: Math.round(num(a.fat, 0, 500) ?? 0),
        kind, source, estimated: kind === 'lookup', place: String(a.place || '').slice(0, 80), amount: String(a.amount || '').slice(0, 240), home: a.home === true });
    } else if (a.type === 'lift' || a.type === 'skip_lift') {
      const l = lifts.get(String(a.lift_id));
      if (!l) continue;
      if (a.type === 'skip_lift') { actions.push({ type: 'skip_lift', lift_id: String(l.id) }); continue; }
      const reps = (a.reps || [])
        .map(r => ({ set: Math.round(num(r.set, 1, 20) ?? 0), reps: Math.round(num(r.reps, 0, 100) ?? -1) }))
        .filter(r => r.set >= 1 && r.set <= (l.sets || 20) && r.reps >= 0);
      const weight = num(a.weight, 0, 2000);
      if (!reps.length && weight == null) continue;
      actions.push({ type: 'lift', lift_id: String(l.id), weight, reps });
    } else if (a.type === 'sleep') {
      const hours = num(a.hours, 0, 16);
      if (hours) actions.push({ type: 'sleep', hours: Math.round(hours * 60) / 60 });
    } else if (a.type === 'session_done') {
      actions.push({ type: 'session_done' });
    } else if (a.type === 'remove_last_food') {
      actions.push({ type: 'remove_last_food' });
    }
  }
  return { actions, note: String(out.note || '').slice(0, 200) };
}

export default async function handler(req, res) {
  if (!allow(req, res)) return;
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); res.status(405).json({ error: 'method_not_allowed' }); return; }
  if (!aiKey()) { res.status(503).json({ error: 'not_set_up' }); return; }

  const { text, context } = req.body || {};
  if (typeof text !== 'string' || !text.trim() || text.length > 600 || !context || typeof context !== 'object') {
    res.status(400).json({ error: 'bad_request' });
    return;
  }
  const brief = JSON.stringify({
    today: context.day ?? null,
    lifts: (context.lifts || []).slice(0, 20),
    lifts_on_other_days: (context.other_lifts || []).slice(0, 40),
    usual_foods: (context.usuals || []).slice(0, 40),
    known_foods: (context.known || []).slice(-60),
    recent: (context.recent || []).slice(-8).map(r => ({ said: String(r.said || '').slice(0, 200), did: String(r.did || '').slice(0, 200) })),
  });
  if (brief.length > 12_000) { res.status(413).json({ error: 'too_big' }); return; }

  const client = new Anthropic({ apiKey: aiKey() });
  try {
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 2048,
      output_config: { effort: 'low', format: zodOutputFormat(Reading) },
      system: SYSTEM,
      messages: [{ role: 'user', content: `Context:\n${brief}\n\nMessage:\n${text.trim()}` }],
    });
    if (response.stop_reason === 'refusal' || !response.parsed_output) {
      res.status(200).json({ actions: [], note: 'Could not read that one.' });
      return;
    }
    res.status(200).json(clean(response.parsed_output, context));
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) res.status(503).json({ error: 'bad_ai_key' });
    else if (error instanceof Anthropic.RateLimitError) res.status(429).json({ error: 'busy' });
    else if (error instanceof Anthropic.APIError) res.status(502).json({ error: 'ai_unreachable' });
    else res.status(500).json({ error: 'failed' });
  }
}
