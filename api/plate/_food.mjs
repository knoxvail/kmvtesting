// Plate: finding real nutrition numbers online. Shared by the typed and spoken
// path (find.mjs) and the photo path (see.mjs), so both look things up the same way.
// The rule is: search first, read the page, and only guess when nothing is found.
// A guess is always labelled as a guess.
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

export const MODEL = 'claude-sonnet-5-5';

const FIND = `You find real nutrition numbers for food one person ate, so his food log is accurate. He lifts, is eating to gain weight, and tracks calories, protein, carbs and fat. Most of what he eats is ordered from restaurants through DoorDash or cooked at home. Numbers guessed from memory have been badly wrong for him before, so a guess is the last resort and must be labelled as one.

Search the web and read the pages before you answer. For each item, work down this list and stop at the first step that gives you numbers.

1. Ordered from a restaurant, chain, or packaged brand. Find that company's own published nutrition for the exact item and size: its nutrition page, PDF, or calculator. A database page that quotes the company (Nutritionix, FatSecret, CalorieKing, MyFitnessPal) is fine when the company's own page cannot be read. Then apply what he changed: double or extra protein, something left off, added sauces, sides, a drink. Build-your-own places publish numbers per ingredient, so add up the ingredients he had. If he gave no size, use the standard size and say which one.

2. A local place that publishes nothing, like an independent bagel shop, deli, or taqueria. First look for what is known about that place's portions from its menu, its delivery listing, or reviews. Then take published numbers for the closest equivalent, either the same kind of item at a comparable chain or database values scaled to a realistic portion for that kind of shop. Independent shops serve bigger portions than packaged versions: a bagel-shop bagel is usually 110 to 140 g where a supermarket bagel is 85 g, and the spread on it is usually 50 g or more. Say what you matched it to and the portion you used.

3. Cooked at home, or plain food with no source. Add up the ingredients. A branded packaged ingredient uses its label values. Plain ingredients use USDA FoodData Central values per 100 g times the amount, with cooked values for cooked amounts. Count the cooking fat and sauces he mentions, or that the dish clearly needs. When he gives no amounts, use the portion a large man eating to gain weight would actually serve himself.

Do not shade numbers up or down. Use the amount he said. Check that calories roughly equal 4 x protein + 4 x carbs + 9 x fat, and look again if they are far apart.

For each item report:
- protein, carbs and fat in grams and calories, as whole numbers, for the whole amount he ate
- source: "published" when the numbers are that company's own figures for this item; "matched" when they come from a page you read for the closest equivalent, or are added up from database values; "estimate" only when you found nothing usable and are going from memory
- where: the domain of the page the numbers came from, like "chipotle.com". Empty for an estimate.
- detail: one short plain sentence he will read on his phone, saying what the numbers are for. For example "Chipotle's calculator: chicken bowl with white rice, black beans, cheese and double chicken." or "No published numbers for this shop. Matched to a 130 g plain bagel with 2 oz of cream cheese."

Write a line or two of working if you need it, then end your answer with the results as a JSON array inside a \`\`\`json code block, one object per item in the order given, with exactly these keys: protein, calories, carbs, fat, source, where, detail.`;

const Found = z.object({
  items: z.array(z.object({
    protein: z.number(), calories: z.number(), carbs: z.number(), fat: z.number(),
    source: z.enum(['published', 'matched', 'estimate']),
    where: z.string(), detail: z.string(),
  })),
});

const n = (v, hi) => Math.round(Math.min(hi, Math.max(0, Number.isFinite(+v) ? +v : 0)));
const textOf = msg => msg.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();

// The model's answer is data from outside, so every field is checked before it is used.
function tidy(x, searched) {
  if (!x || typeof x !== 'object' || !Number.isFinite(+x.protein) || !Number.isFinite(+x.calories)) return null;
  let source = ['published', 'matched', 'estimate'].includes(x.source) ? x.source : 'estimate';
  if (!searched) source = 'estimate';            // nothing was looked up, so it cannot claim a source
  const where = source !== 'estimate' && /^[a-z0-9][a-z0-9.-]{2,60}$/i.test(String(x.where || '').trim()) ? String(x.where).trim().toLowerCase().replace(/^www\./, '') : '';
  return { protein: n(x.protein, 400), calories: n(x.calories, 6000), carbs: n(x.carbs, 1000), fat: n(x.fat, 500), source, where, detail: String(x.detail || '').slice(0, 200) };
}

const describe = items => items.map((i, k) =>
  `${k + 1}. ${i.name}${i.place ? `, from ${i.place}` : i.home ? ' (cooked at home or plain food)' : ''}${i.amount ? `. What he had: ${i.amount}` : ''}`).join('\n');

// Look the items up. Returns one result per item in order, with null where an item
// could not be read, or null for the whole list if the lookup did not finish.
// items: [{ name, place?, amount?, home? }]
export async function lookup(client, items, said = '', budgetMs = 48000) {
  const deadline = Date.now() + budgetMs;
  const messages = [{ role: 'user', content: `${said ? `His own words: "${said}"\n\n` : ''}Items:\n${describe(items)}` }];
  let found, searched = false;
  try {
    // A search can pause the turn partway. Pick it up again while there is time.
    for (let turn = 0; turn < 4; turn++) {
      const left = deadline - Date.now();
      if (left < 6000) return null;
      found = await client.messages.create({
        model: MODEL,
        max_tokens: 8000,
        output_config: { effort: 'medium' },
        system: FIND,
        tools: [
          { type: 'web_search_20260209', name: 'web_search', max_uses: 5 },
          { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 3, max_content_tokens: 20000 },
        ],
        messages,
      }, { timeout: left, maxRetries: 0 });
      if (found.content.some(b => b.type === 'web_search_tool_result' || b.type === 'web_fetch_tool_result')) searched = true;
      if (found.stop_reason !== 'pause_turn') break;
      messages.push({ role: 'assistant', content: found.content });
    }
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.RateLimitError) throw e;
    return null;
  }
  if (!found || found.stop_reason === 'refusal' || found.stop_reason === 'pause_turn') return null;

  const text = textOf(found);
  let rows = null;
  const blocks = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
  if (blocks.length) { try { rows = JSON.parse(blocks[blocks.length - 1][1]); } catch (e) { rows = null; } }
  if (rows && !Array.isArray(rows)) rows = Array.isArray(rows.items) ? rows.items : null;

  // The answer came back without a readable list. Have it put into shape, if there is time.
  if (!rows && text && deadline - Date.now() > 8000) {
    try {
      const shaped = await client.messages.parse({
        model: MODEL, max_tokens: 2048,
        output_config: { effort: 'low', format: zodOutputFormat(Found) },
        system: 'Copy the nutrition findings below into the list, one entry per item in the order given. Do not change any number.',
        messages: [{ role: 'user', content: `Items:\n${describe(items)}\n\nFindings:\n${text.slice(0, 12000)}` }],
      }, { timeout: deadline - Date.now(), maxRetries: 0 });
      rows = shaped.parsed_output?.items || null;
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.RateLimitError) throw e;
    }
  }
  if (!rows || rows.length !== items.length) return null;
  return rows.map(r => tidy(r, searched));
}

// With no lookup to go on: a plain guess, labelled as one.
export async function guess(client, items) {
  const out = await client.messages.parse({
    model: MODEL, max_tokens: 2048,
    output_config: { effort: 'low', format: zodOutputFormat(Found) },
    system: 'Estimate calories, protein, carbs and fat for each item from typical values for that food and amount. Give one entry per item in the order given. source is always "estimate", where is empty, and detail says in one short sentence what portion you assumed.',
    messages: [{ role: 'user', content: `Items:\n${describe(items)}` }],
  });
  const rows = out.parsed_output?.items;
  if (!rows || rows.length !== items.length) return null;
  return rows.map(r => tidy(r, false));
}
