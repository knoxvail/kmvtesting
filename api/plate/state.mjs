// Plate: the saved copy of everything on the phone.
//   GET /api/plate/state  -> { version, updated_at, data }   (version 0 and data null if nothing saved yet)
//   PUT /api/plate/state  <- { base, data, force? }
//        base is the version the phone last saw. If the saved copy has moved
//        on since then, nothing is written and the reply is 409 with the
//        saved copy, so the phone can decide which one to keep.
// One row holds the whole state. The phone is the only writer, so there is
// nothing to merge on the server.
import { allow, db, dbReady } from './_shared.mjs';

const ROW = 'main';
const MAX_BYTES = 3_000_000;

async function current() {
  const r = await db(`plate_state?id=eq.${ROW}&select=version,updated_at,data`);
  if (!r.ok) throw new Error('db_' + r.status);
  const rows = await r.json();
  return rows[0] || null;
}

export default async function handler(req, res) {
  if (!allow(req, res)) return;
  if (!dbReady()) { res.status(503).json({ error: 'no_database' }); return; }

  try {
    if (req.method === 'GET') {
      const row = await current();
      res.status(200).json(row
        ? { version: Number(row.version), updated_at: row.updated_at, data: row.data }
        : { version: 0, updated_at: null, data: null });
      return;
    }

    if (req.method === 'PUT') {
      const { base, data, force } = req.body || {};
      if (!data || typeof data !== 'object' || Array.isArray(data) || !Number.isInteger(base) || base < 0) {
        res.status(400).json({ error: 'bad_request' });
        return;
      }
      const body = JSON.stringify(data);
      if (body.length > MAX_BYTES) { res.status(413).json({ error: 'too_big' }); return; }

      const row = await current();
      const have = row ? Number(row.version) : 0;
      const conflict = r => res.status(409).json({ error: 'moved_on', version: Number(r.version), updated_at: r.updated_at, data: r.data });
      if (!force && have !== base) { conflict(row || { version: 0, updated_at: null, data: null }); return; }

      const next = { version: have + 1, data, updated_at: new Date().toISOString() };
      // Insert the first time. After that, update only if the version is
      // still the one just read, so two saves can never both win.
      const w = row
        ? await db(`plate_state?id=eq.${ROW}&version=eq.${have}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(next) })
        : await db('plate_state', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ id: ROW, ...next }) });
      if (w.status === 409) { conflict(await current()); return; }
      if (!w.ok) throw new Error('db_' + w.status);
      const saved = await w.json();
      if (!saved.length) { conflict(await current()); return; }
      res.status(200).json({ version: next.version, updated_at: next.updated_at });
      return;
    }

    res.setHeader('Allow', 'GET, PUT');
    res.status(405).json({ error: 'method_not_allowed' });
  } catch (e) {
    res.status(502).json({ error: 'database_unreachable' });
  }
}
