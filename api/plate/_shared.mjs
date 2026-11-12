// Shared by the Plate functions. The leading underscore keeps Vercel from
// turning this file into an endpoint of its own.
import { timingSafeEqual } from 'node:crypto';

// Every request carries the passphrase. Without it nothing is read, saved,
// or sent to the AI. PLATE_KEY is set in Vercel's environment settings.
export function allow(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const want = process.env.PLATE_KEY;
  if (!want) { res.status(503).json({ error: 'not_set_up' }); return false; }
  let got = '';
  try { got = decodeURIComponent(String(req.headers['x-plate-key'] || '')); } catch (e) { got = ''; }
  const a = Buffer.from(got), b = Buffer.from(want);
  if (a.length !== b.length || !timingSafeEqual(a, b)) { res.status(401).json({ error: 'wrong_key' }); return false; }
  return true;
}

// Talk to the database over Supabase's REST interface with the server-only key.
export function db(path, init = {}) {
  const key = process.env.SUPABASE_SECRET_KEY;
  return fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
}

// Finds a setting by name without caring about capitals, so ANTHROPIC_API_KEY
// and Anthropic_API_Key are the same thing. The first name that is set wins.
export function setting(...names) {
  for (const want of names) {
    const hit = Object.keys(process.env).find(k => k.toUpperCase() === want);
    if (hit && process.env[hit]) return process.env[hit];
  }
  return '';
}
export const aiKey = () => setting('ANTHROPIC_API_KEY', 'ANTHROPIC_KEY');
export const speechKey = () => setting('GROQ_API_KEY', 'GROQ_KEY');

export const dbReady = () => !!(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
