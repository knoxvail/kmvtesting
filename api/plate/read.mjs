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

const MODEL = 'claude-haiku-5-5';

// Every field is always present, with null where it does not apply.
const Action = z.object({
  type: z.enum(['food', 'lift', 'skip_lift', 'sleep', 'session_done']),
  name: z.string().nullable(),          // food: short name, the way he said it
  protein: z.number().nullable(),       // food: grams of protein for the amount eaten
  calories: z.number().nullable(),      // food: calories for the amount eaten
  carbs: z.number().nullable(),         // food: grams of carbohydrate for the amount eaten
  fat: z.number().nullable(),           // food: grams of fat for the amount eaten
  estimated: z.boolean().nullable(),    // food: true when the numbers are your estimate
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

The context holds today's lifts (id, name, number of sets, the reps planned for each set, the planned weight), the names of lifts that belong to other days, and his usual foods with their protein and calories per serving.

Entries you can return:

food: one entry per food. Always give all four numbers: protein, calories, carbs and fat. If it matches one of his usuals, use that usual's name and its numbers multiplied by how many he had, and set estimated to false. If he states the protein himself, use his number and set estimated to false. Otherwise estimate protein, carbs and fat in grams and calories for the amount he describes from typical values for that food, round to whole numbers, and set estimated to true. Keep the name short, in his words, with a capital first letter.

lift: only for a lift in today's list, using its id. Put in reps only the sets he mentions, with what he got. "Last set" means the highest set number. If he gives one number per set, map them in order. Set weight only when he says he used a different weight than planned.

skip_lift: he says he skipped a lift from today's list.

sleep: hours as a decimal number, so 7 hours 30 minutes is 7.5.

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
      actions.push({ type: 'food', name: String(a.name || '').slice(0, 40), protein: Math.round(protein), calories: Math.round(num(a.calories, 0, 6000) ?? 0), carbs: Math.round(num(a.carbs, 0, 1000) ?? 0), fat: Math.round(num(a.fat, 0, 500) ?? 0), estimated: a.estimated !== false });
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
