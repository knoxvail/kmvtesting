// Plate: the weekly review. Once a week the app sends a compact summary of the
// last few weeks and gets back a plan for the week ahead.
//   POST /api/plate/week  <- { summary }
//                         -> { headline, focus, lifts: [{ name, call, why }], nutrition, recovery, watch }
// This is the one place the strongest model is used, because it is one call a
// week and the job is judging patterns across lifting, food, sleep and weight.
// The summary holds only numbers from the app. Nothing here is stored.
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { allow, aiKey } from './_shared.mjs';

export const config = { maxDuration: 120 };

const MODEL = 'claude-fable-5-2';

const Review = z.object({
  headline: z.string(),   // one sentence on how the last week went
  focus: z.string(),      // the single most important thing to do this week
  lifts: z.array(z.object({
    name: z.string(),
    call: z.enum(['push', 'hold', 'ease off']),
    why: z.string(),      // one sentence, using his numbers
  })),
  nutrition: z.string(), // calories, protein and weight trend against the goal to gain
  recovery: z.string(),  // sleep and anything that looks like under-recovery
  watch: z.string(),     // patterns that may be holding him back, or an empty string
});

const SYSTEM = `You are the weekly coach inside a personal lifting and nutrition log. One person uses it. He lifts push, pull and legs, he is trying to gain weight, and he cares most about his bench and overhead press. Each week you get a JSON summary of his last few weeks and you write the plan for the week ahead.

The summary holds: his goals; his lifts, each with the working weight and reps now, whether it is climbing, stalled or short, and recent history; his food by day (protein, calories); his sleep by day; his bodyweight by day; and the app's own calorie target with how it was worked out.

How to write it:
- Use his actual numbers. Name the lift and the weight. Never make up a number that is not in the summary, and say so plainly where the data is thin, for example only two weigh-ins.
- Plain, short sentences. No em dashes. No filler, no pep talk, no "great job". Say what happened and what to do.
- headline: one sentence on the last week.
- focus: the one thing that matters most this week. Pick it from the data.
- lifts: one entry per lift that needs a call. "push" means go for more reps or weight, "hold" means keep the plan, "ease off" means back the weight off or restart the reps. Put bench and overhead press first. Lifts that are simply climbing can be left out or marked hold with a short reason.
- nutrition: how intake and bodyweight compare with gaining weight. If he is gaining too slowly or too fast, say by how much and what the app's target means in practice. If few days are logged, say the numbers are not reliable yet.
- recovery: sleep against his goal, and whether short sleep lines up with weaker lifts. Only claim a link if the numbers show it.
- watch: patterns that might be holding him back, such as skipped days, protein only hit on some days, stalled lifts all coming after short sleep, or weight not moving. If nothing stands out, leave it as an empty string.
Do not give medical advice. Do not tell him to change his program beyond weights, reps and food amounts.`;

const textOf = msg => msg.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();

export default async function handler(req, res) {
  if (!allow(req, res)) return;
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); res.status(405).json({ error: 'method_not_allowed' }); return; }
  if (!aiKey()) { res.status(503).json({ error: 'not_set_up' }); return; }

  const { summary } = req.body || {};
  const brief = JSON.stringify(summary ?? null);
  if (!summary || typeof summary !== 'object' || brief.length > 40_000) { res.status(400).json({ error: 'bad_request' }); return; }

  const client = new Anthropic({ apiKey: aiKey() });
  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: zodOutputFormat(Review) },
      system: SYSTEM,
      messages: [{ role: 'user', content: `Summary of the last few weeks:\n${brief}` }],
    });
    if (response.stop_reason === 'refusal') { res.status(200).json({ error: 'declined' }); return; }
    let parsed = null;
    try { parsed = Review.safeParse(JSON.parse(textOf(response))); } catch (e) { parsed = null; }
    if (!parsed || !parsed.success) { res.status(200).json({ error: 'unreadable' }); return; }
    const r = parsed.data;
    res.status(200).json({
      headline: r.headline.slice(0, 300),
      focus: r.focus.slice(0, 500),
      lifts: r.lifts.slice(0, 10).map(l => ({ name: l.name.slice(0, 60), call: l.call, why: l.why.slice(0, 300) })),
      nutrition: r.nutrition.slice(0, 600),
      recovery: r.recovery.slice(0, 600),
      watch: r.watch.slice(0, 600),
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) res.status(503).json({ error: 'bad_ai_key' });
    else if (error instanceof Anthropic.RateLimitError) res.status(429).json({ error: 'busy' });
    else if (error instanceof Anthropic.APIError) res.status(502).json({ error: 'ai_unreachable' });
    else res.status(500).json({ error: 'failed' });
  }
}
