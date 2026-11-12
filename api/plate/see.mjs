// Plate: read a photo of food, a nutrition label, or a receipt.
//   POST /api/plate/see  <- { image (base64 JPEG), note?, usuals? }
//                        -> { name, protein, calories, carbs, fat, source, detail }
// The order of trust:
//   1. A nutrition label in the photo: its printed numbers are used as they are.
//   2. Something ordered (a receipt, a named restaurant or brand, or what the
//      note says): the published numbers for that exact item are looked up online.
//   3. A plain photo with nothing to go on: what is on the plate is sized up
//      first, then the closest match for each food is looked up online.
// If the lookup finds nothing, the answer is an estimate and says so.
// The photo is used for this one request and is not stored.
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { allow } from './_shared.mjs';

export const config = { maxDuration: 60 };

const MODEL = 'claude-haiku-5-5';

const Look = z.object({
  kind: z.enum(['label', 'ordered', 'plain']),
  place: z.string().nullable(),          // restaurant or brand, if known
  items: z.array(z.object({
    name: z.string(),                    // the food, as specific as the photo or note allows
    amount: z.string(),                  // how much, in plain words: "1 bowl", "about 180 g", "2 slices"
    grams: z.number().nullable(),        // your estimate of the weight eaten, if it can be judged
  })),
  label: z.object({ protein: z.number(), calories: z.number(), carbs: z.number(), fat: z.number() }).nullable(),
});

const Meal = z.object({
  name: z.string(),                      // short name for the log
  protein: z.number(),
  calories: z.number(),
  carbs: z.number(),
  fat: z.number(),
  source: z.enum(['label', 'published', 'matched', 'estimate']),
  detail: z.string(),                    // one short sentence: where the numbers came from
});

const LOOK = `You look at one photo from a lifter logging what he ate, plus an optional note from him. Say what kind of photo it is and list what was eaten.

kind "label": the photo shows a printed nutrition facts label. Fill label with the numbers for the amount he ate (one serving unless the note says otherwise) and list the product as the one item.
kind "ordered": there is something to look up: a receipt, a menu item, packaging with a restaurant or brand name, or a note that names where it came from or what was ordered. Set place and list each item the way that restaurant or brand names it, with any changes like "double chicken".
kind "plain": a photo of food with nothing that names it. List each food you can see, and judge how much of it there is in grams from the plate, utensils and anything else that gives scale.

Use the note whenever it adds something. Do not guess a restaurant that is not shown or stated.`;

const FIND = `Find nutrition numbers for what a person ate, using web search. For each item, find calories, protein, carbs and fat.

If a restaurant or brand is given, find that restaurant's or brand's own published numbers for the exact item and any changes to it. Prefer the company's own nutrition page, then a nutrition database that quotes it.
If no restaurant or brand is given, find the closest standard match for each food in a nutrition database such as USDA FoodData Central, as values per 100 grams, and work out the numbers for the amount given.

Report each item with its numbers and where they came from. If you cannot find an item, say so plainly and give your best estimate, marked as an estimate.`;

const SUM = `Turn the findings into one log entry for the whole meal: add the items together. Round to whole numbers. name is short, in plain words, with a capital first letter.
source is "published" if the numbers came from the restaurant's or brand's own figures, "matched" if they came from a nutrition database match for the foods seen, and "estimate" if any main item had to be estimated. detail is one short plain sentence saying where the numbers came from.`;

const textOf = msg => msg.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
const n = (v, hi) => Math.round(Math.min(hi, Math.max(0, Number.isFinite(v) ? v : 0)));

export default async function handler(req, res) {
  if (!allow(req, res)) return;
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); res.status(405).json({ error: 'method_not_allowed' }); return; }
  if (!process.env.ANTHROPIC_API_KEY) { res.status(503).json({ error: 'not_set_up' }); return; }

  const { image, note } = req.body || {};
  if (typeof image !== 'string' || image.length < 100 || image.length > 4_000_000) { res.status(400).json({ error: 'bad_request' }); return; }
  const words = typeof note === 'string' ? note.trim().slice(0, 300) : '';

  const client = new Anthropic();
  try {
    // 1. What is in the photo.
    const seen = await client.messages.parse({
      model: MODEL,
      max_tokens: 2048,
      output_config: { effort: 'low', format: zodOutputFormat(Look) },
      system: LOOK,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } },
        { type: 'text', text: words ? `His note: ${words}` : 'No note.' },
      ] }],
    });
    const look = seen.parsed_output;
    if (seen.stop_reason === 'refusal' || !look || !look.items.length) { res.status(200).json({ error: 'unreadable' }); return; }

    const title = look.items.map(i => i.name).join(', ').slice(0, 40);

    // A printed label is already the best source there is.
    if (look.kind === 'label' && look.label) {
      const l = look.label;
      res.status(200).json({ name: title, protein: n(l.protein, 400), calories: n(l.calories, 6000), carbs: n(l.carbs, 1000), fat: n(l.fat, 500), source: 'label', detail: 'Read from the nutrition label.' });
      return;
    }

    // 2. Look the items up online.
    const list = look.items.map(i => `- ${i.name}: ${i.amount}${i.grams ? ` (about ${Math.round(i.grams)} g)` : ''}`).join('\n');
    const ask = `${look.place ? `Restaurant or brand: ${look.place}\n` : 'No restaurant or brand is known.\n'}Items eaten:\n${list}`;
    let findings = '';
    try {
      const found = await client.messages.create({
        model: MODEL,
        max_tokens: 4096,
        output_config: { effort: 'low' },
        system: FIND,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }],
        messages: [{ role: 'user', content: ask }],
      });
      findings = textOf(found);
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.RateLimitError) throw e;
      findings = ''; // the lookup failed: fall back to an estimate below
    }

    // 3. One entry for the meal.
    const summed = await client.messages.parse({
      model: MODEL,
      max_tokens: 1024,
      output_config: { effort: 'low', format: zodOutputFormat(Meal) },
      system: SUM,
      messages: [{ role: 'user', content: `${ask}\n\nFindings:\n${findings || 'The lookup found nothing. Estimate from typical values for these foods and amounts, and mark it as an estimate.'}` }],
    });
    const m = summed.parsed_output;
    if (!m) { res.status(200).json({ error: 'unreadable' }); return; }
    res.status(200).json({
      name: String(m.name || title).slice(0, 40),
      protein: n(m.protein, 400), calories: n(m.calories, 6000), carbs: n(m.carbs, 1000), fat: n(m.fat, 500),
      source: findings ? m.source : 'estimate',
      detail: String(m.detail || '').slice(0, 160),
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) res.status(503).json({ error: 'bad_ai_key' });
    else if (error instanceof Anthropic.RateLimitError) res.status(429).json({ error: 'busy' });
    else if (error instanceof Anthropic.APIError) res.status(502).json({ error: 'ai_unreachable' });
    else res.status(500).json({ error: 'failed' });
  }
}
