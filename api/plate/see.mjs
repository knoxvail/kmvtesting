// Plate: read a photo of food, a nutrition label, or a receipt.
//   POST /api/plate/see  <- { image (base64 JPEG), note?, usuals? }
//                        -> { name, protein, calories, carbs, fat, source, where, detail }
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
import { allow, aiKey } from './_shared.mjs';
import { lookup, guess } from './_food.mjs';

export const config = { maxDuration: 60 };

// Judging portions from a photo and reading nutrition pages both need a strong model.
const MODEL = 'claude-sonnet-5-5';

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

const LOOK = `You look at one photo from a lifter logging what he ate, plus an optional note from him. Say what kind of photo it is and list what was eaten.

kind "label": the photo shows a printed nutrition facts label. Fill label with the numbers for the amount he ate (one serving unless the note says otherwise) and list the product as the one item.
kind "ordered": there is something to look up: a receipt, a menu item, packaging with a restaurant or brand name, or a note that names where it came from or what was ordered. Set place and list each item the way that restaurant or brand names it, with any changes like "double chicken".
kind "plain": a photo of food with nothing that names it. List each food you can see, and judge how much of it there is in grams from the plate, utensils and anything else that gives scale.

Use the note whenever it adds something. Do not guess a restaurant that is not shown or stated.`;

const n = (v, hi) => Math.round(Math.min(hi, Math.max(0, Number.isFinite(v) ? v : 0)));

export default async function handler(req, res) {
  if (!allow(req, res)) return;
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); res.status(405).json({ error: 'method_not_allowed' }); return; }
  if (!aiKey()) { res.status(503).json({ error: 'not_set_up' }); return; }

  const { image, note } = req.body || {};
  if (typeof image !== 'string' || image.length < 100 || image.length > 4_000_000) { res.status(400).json({ error: 'bad_request' }); return; }
  const words = typeof note === 'string' ? note.trim().slice(0, 300) : '';

  const client = new Anthropic({ apiKey: aiKey() });
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

    // 2. Look the items up online, the same way typed food is looked up.
    const items = look.items.slice(0, 6).map(i => ({
      name: String(i.name).slice(0, 80), place: look.place ? String(look.place).slice(0, 80) : '',
      amount: `${i.amount}${i.grams ? `, about ${Math.round(i.grams)} g judged from the photo` : ''}`.slice(0, 240),
      home: look.kind === 'plain',
    }));
    let found = await lookup(client, items, words, 44000);
    // 3. Nothing came back in time: a plain guess, labelled as one.
    if (!found || found.some(f => !f)) found = await guess(client, items);
    if (!found || found.some(f => !f)) { res.status(200).json({ error: 'unreadable' }); return; }

    const sum = k => found.reduce((t, f) => t + f[k], 0);
    const source = found.some(f => f.source === 'estimate') ? 'estimate' : found.some(f => f.source === 'matched') ? 'matched' : 'published';
    res.status(200).json({
      name: title,
      protein: n(sum('protein'), 400), calories: n(sum('calories'), 6000), carbs: n(sum('carbs'), 1000), fat: n(sum('fat'), 500),
      source, where: found.find(f => f.where)?.where || '',
      detail: found.map(f => f.detail).filter(Boolean).join(' ').slice(0, 240),
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) res.status(503).json({ error: 'bad_ai_key' });
    else if (error instanceof Anthropic.RateLimitError) res.status(429).json({ error: 'busy' });
    else if (error instanceof Anthropic.APIError) res.status(502).json({ error: 'ai_unreachable' });
    else res.status(500).json({ error: 'failed' });
  }
}
