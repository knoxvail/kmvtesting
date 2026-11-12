// Keeps a copy of everything in the database, and asks the AI reader about
// messages the phone cannot read by itself. Both need the passphrase, which
// is typed once on this phone and kept here. The app works the same with
// sync off: the phone is always the source of truth.
import { S, save, subscribe, adopt } from './store.js';

const KEY = 'plate.sync';
// key: the passphrase. version: the saved copy this phone last saw.
// pushed: the phone's change time at its last save. at: when that was.
let cfg = { key: '', version: 0, pushed: 0, at: 0 };
try { cfg = { ...cfg, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch (e) { /* storage blocked */ }
const keep = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) { /* storage blocked */ } };

let status = 'ok';
export const connected = () => !!cfg.key;
export const info = () => ({ on: !!cfg.key, at: cfg.at, error: status === 'ok' ? '' : status });

async function call(path, method = 'GET', body, key = cfg.key, wait = 20000) {
  const r = await fetch('/api/plate/' + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Plate-Key': encodeURIComponent(key) },
    body: body ? JSON.stringify(body) : undefined,
    keepalive: document.visibilityState === 'hidden',
    signal: AbortSignal.timeout ? AbortSignal.timeout(wait) : undefined,
  });
  let json = null;
  try { json = await r.json(); } catch (e) { /* not JSON, e.g. a plain 404 page */ }
  return { status: r.status, json };
}

// Turn a failed reply into one short code the screens know how to explain.
const code = r => (r.status === 401 ? 'wrong_key' : r.json?.error || (r.status === 404 ? 'not_set_up' : 'unreachable'));
const failure = e => (e instanceof TypeError || e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'offline' : e.message);

// Changed since the last save or load. Compared for difference, not for
// "later than", so it does not depend on two devices agreeing on the time.
const dirty = () => (S.touched || 0) !== cfg.pushed;
const hasEntries = () => S.sessions.length > 0 || S.foodLog.length > 0 || S.foods.length > 0 ||
  Object.keys(S.sleep).length > 0 || Object.values(S.lifts).some(l => l.weight != null);

let busy = false, again = false, timer = 0;

// Compare with the saved copy, then save this phone's changes if it has any.
export async function sync() {
  if (!cfg.key) return 'off';
  if (busy) { again = true; return 'busy'; }
  busy = true;
  let result = 'ok';
  try {
    const got = await call('state');
    // No database on the server yet: the AI still works, there is just nothing to save to.
    if (got.status === 503 && got.json?.error === 'no_database') return (status = 'ok');
    if (got.status !== 200) throw new Error(code(got));
    const server = got.json;
    const theirs = server.data?.touched || 0;
    // The saved copy changed somewhere else. The newer of the two wins.
    if (server.data && server.version !== cfg.version && (!S.setup || !dirty() || theirs >= (S.touched || 0))) {
      cfg.version = server.version; cfg.pushed = theirs; cfg.at = Date.now(); keep();
      adopt(server.data);
    } else {
      cfg.version = server.version;
      if (S.setup && (dirty() || !server.data)) {
        const stamp = S.touched || 0;
        const put = await call('state', 'PUT', { base: cfg.version, data: S });
        if (put.status === 200) { cfg.version = put.json.version; cfg.pushed = stamp; }
        else if (put.status === 409) again = true;
        else throw new Error(code(put));
      }
      cfg.at = Date.now(); keep();
    }
  } catch (e) {
    result = failure(e);
  } finally {
    busy = false;
    status = result;
    if (again) { again = false; sync(); }
  }
  return result;
}

// First connection on this phone. If the database and the phone both hold
// entries, nothing is changed until the caller says which one to keep.
export async function connect(key, prefer) {
  let got;
  try { got = await call('state', 'GET', undefined, key); } catch (e) { return { error: failure(e) }; }
  if (got.status === 503 && got.json?.error === 'no_database') {
    cfg = { key, version: 0, pushed: 0, at: 0 }; keep();
    status = 'ok';
    return { ok: true, took: 'ai' };
  }
  if (got.status !== 200) return { error: code(got) };
  const server = got.json;
  if (server.data && hasEntries() && !prefer) return { ask: true, savedAt: server.updated_at };

  if (server.data && prefer !== 'phone') {
    cfg = { key, version: server.version, pushed: server.data.touched || 0, at: Date.now() }; keep();
    status = 'ok';
    adopt(server.data);
    return { ok: true, took: 'saved' };
  }
  cfg = { key, version: server.version, pushed: 0, at: 0 }; keep();
  if (!S.touched) { S.touched = Date.now(); save(); }
  const r = await sync();
  return r === 'ok' ? { ok: true, took: 'phone' } : { error: r };
}

export function disconnect() {
  cfg = { key: '', version: 0, pushed: 0, at: 0 }; keep();
  status = 'ok';
}

// Send one message the phone could not read. Throws a short code on failure.
export async function ask(text, context) {
  const r = await call('read', 'POST', { text, context });
  if (r.status !== 200) throw new Error(code(r));
  return r.json;
}

// Send one photo to be read. It takes a few seconds because the numbers are looked up online.
export async function see(image, note) {
  const r = await call('see', 'POST', { image, note }, cfg.key, 60000);
  if (r.status !== 200) throw new Error(code(r));
  if (r.json?.error) throw new Error(r.json.error);
  return r.json;
}

// Send a short recording and get back the words.
export async function hear(audio, mime) {
  const r = await call('hear', 'POST', { audio, mime }, cfg.key, 30000);
  if (r.status !== 200) throw new Error(code(r));
  return r.json.text || '';
}

export function start() {
  // Save a moment after the last change, and whenever the app is opened or put away.
  subscribe(() => { if (cfg.key && dirty()) { clearTimeout(timer); timer = setTimeout(sync, 1500); } });
  document.addEventListener('visibilitychange', () => {
    if (!cfg.key) return;
    clearTimeout(timer);
    if (!document.hidden || dirty()) sync();
  });
  addEventListener('online', () => { if (cfg.key) sync(); });
  if (cfg.key) sync();
}
