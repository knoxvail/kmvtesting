// Plate: look up real numbers for food he typed or said.
//   POST /api/plate/find  <- { items: [{ name, place?, amount?, home? }], said? }
//                         -> { items: [{ protein, calories, carbs, fat, source, where, detail } | null] }
// The reader (read.mjs) answers fast and marks which foods need a lookup. The phone
// then calls this, which searches the web and reads the pages. An item comes back
// null when nothing could be found in time, and the phone shows its rough guess to check.
import Anthropic from '@anthropic-ai/sdk';
import { allow, aiKey } from './_shared.mjs';
import { lookup } from './_food.mjs';

export const config = { maxDuration: 60 };

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export default async function handler(req, res) {
  if (!allow(req, res)) return;
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); res.status(405).json({ error: 'method_not_allowed' }); return; }
  if (!aiKey()) { res.status(503).json({ error: 'not_set_up' }); return; }

  const body = req.body || {};
  const items = (Array.isArray(body.items) ? body.items : []).slice(0, 6)
    .map(i => ({ name: str(i?.name, 80), place: str(i?.place, 80), amount: str(i?.amount, 240), home: i?.home === true }))
    .filter(i => i.name);
  if (!items.length) { res.status(400).json({ error: 'bad_request' }); return; }

  const client = new Anthropic({ apiKey: aiKey() });
  try {
    const found = await lookup(client, items, str(body.said, 600));
    res.status(200).json({ items: found || items.map(() => null) });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) res.status(503).json({ error: 'bad_ai_key' });
    else if (error instanceof Anthropic.RateLimitError) res.status(429).json({ error: 'busy' });
    else if (error instanceof Anthropic.APIError) res.status(502).json({ error: 'ai_unreachable' });
    else res.status(500).json({ error: 'failed' });
  }
}
