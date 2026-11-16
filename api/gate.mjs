// Checks the code typed on the lock screen and, if it is right, gives the
// browser the cookie that middleware.ts looks for. The cookie lasts a year, so
// a device only has to be unlocked once.
//
// POST /api/gate  { "code": "...." }   -> 200 and the cookie, or 401
// GET  /api/gate?lock=1                -> forgets this device and goes home
//
// The code is never written here in the clear: the fallback below is a salted
// hash, and GATE_CODE in Vercel's environment replaces it. See middleware.ts
// for what this lock does and does not protect.
import { createHash, timingSafeEqual } from 'node:crypto';

const COOKIE = 'kmv_gate';
const DEFAULT_TOKEN = '89f236b1c8175549abbfb0d928d46a8c9628cc0ad58533b5'; // same value in middleware.ts
const SALT = 'kmv-gate-v1:';
const DEFAULT_CODE_HASH = '62703ced3b1b18f8fa1656f4df528b3ef86eb4c9b5a9ca91f0757979dbfc5e6c';
const YEAR = 60 * 60 * 24 * 365;

const hash = (text) => createHash('sha256').update(SALT + text).digest();

function rightCode(code) {
  const want = process.env.GATE_CODE ? hash(process.env.GATE_CODE) : Buffer.from(DEFAULT_CODE_HASH, 'hex');
  return timingSafeEqual(hash(code), want);
}

const cookie = (value, age) => `${COOKIE}=${value}; Path=/; Max-Age=${age}; HttpOnly; Secure; SameSite=Lax`;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    if (req.query && req.query.lock === '1') {
      res.setHeader('Set-Cookie', cookie('', 0));
      res.statusCode = 303;
      res.setHeader('Location', '/');
      return res.end();
    }
    return res.status(405).json({ error: 'post_only' });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'post_only' });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const code = String((body && body.code) || '');

  if (!/^\d{1,12}$/.test(code) || !rightCode(code)) {
    await new Promise((done) => setTimeout(done, 600)); // makes guessing slow
    return res.status(401).json({ ok: false });
  }

  res.setHeader('Set-Cookie', cookie(process.env.GATE_TOKEN || DEFAULT_TOKEN, YEAR));
  return res.status(200).json({ ok: true });
}
