// Plate: turn a few seconds of speech into text.
//   POST /api/plate/hear  <- { audio (base64), mime }
//                         -> { text }
// Claude cannot take audio, so this one call goes to a speech-to-text
// service (Groq's hosted Whisper). The recording is used for this request
// and is not stored here. GROQ_API_KEY is set in Vercel's environment settings.
import { allow, speechKey } from './_shared.mjs';

const URL_ = 'https://api.groq.com/openai/v1/audio/transcriptions';
const MODEL = 'whisper-large-v3-turbo';
const EXT = { 'audio/mp4': 'm4a', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/aac': 'm4a' };

export default async function handler(req, res) {
  if (!allow(req, res)) return;
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); res.status(405).json({ error: 'method_not_allowed' }); return; }
  if (!speechKey()) { res.status(503).json({ error: 'no_speech_key' }); return; }

  const { audio, mime } = req.body || {};
  if (typeof audio !== 'string' || audio.length < 200 || audio.length > 4_000_000) { res.status(400).json({ error: 'bad_request' }); return; }
  const type = String(mime || 'audio/mp4').split(';')[0];

  try {
    const form = new FormData();
    form.append('file', new Blob([Buffer.from(audio, 'base64')], { type }), `speech.${EXT[type] || 'm4a'}`);
    form.append('model', MODEL);
    form.append('language', 'en');
    form.append('response_format', 'json');
    // Words this app hears a lot, so they are spelled the way the reader expects.
    form.append('prompt', 'Gym log. Bench press, overhead press, chest fly, lateral raise, tricep pushdown, incline curl, squat, RDL. Sets, reps, grams of protein, calories, slept hours.');
    const r = await fetch(URL_, { method: 'POST', headers: { Authorization: `Bearer ${speechKey()}` }, body: form });
    if (r.status === 401) { res.status(503).json({ error: 'bad_speech_key' }); return; }
    if (r.status === 429) { res.status(429).json({ error: 'busy' }); return; }
    if (!r.ok) { res.status(502).json({ error: 'speech_unreachable' }); return; }
    const out = await r.json();
    res.status(200).json({ text: String(out.text || '').trim().slice(0, 600) });
  } catch (e) {
    res.status(502).json({ error: 'speech_unreachable' });
  }
}
