import { next } from '@vercel/functions';

// The lock on the front door. Vercel runs this before it serves any page or
// file. A browser that has typed the code holds a cookie and is let through;
// anything else gets the number pad (for a page) or a plain "Locked." (for a
// file a page was trying to load). The code itself is checked in api/gate.mjs,
// which is what hands out the cookie.
//
// Left open on purpose:
//   /api/*    every function there has its own key
//   /plate/*  a home-screen app that keeps a saved copy of itself; a lock in
//             front of its files would stop it updating
//
// What this is and is not: it keeps out anyone who lands on the address. The
// cookie value and the code's hash below are fallbacks that live in a public
// repository, so someone who reads the source can get past it. Setting
// GATE_TOKEN and GATE_CODE in Vercel's environment (and redeploying) replaces
// both with values that are not written down anywhere public.

const COOKIE = 'kmv_gate';
const DEFAULT_TOKEN = '89f236b1c8175549abbfb0d928d46a8c9628cc0ad58533b5'; // same value in api/gate.mjs
const OPEN = [/^\/api\//, /^\/plate(\/|$)/];

// First rollout: only a test folder is locked, to prove the lock on the live
// site before it goes in front of everything.
export const config = { matcher: ['/gate-check/:path*'] };

export default function middleware(request: Request) {
  try {
    const path = new URL(request.url).pathname;
    if (OPEN.some((re) => re.test(path))) return next();

    const env = ((globalThis as any).process && (globalThis as any).process.env) || {};
    const token: string = env.GATE_TOKEN || DEFAULT_TOKEN;
    const held = (request.headers.get('cookie') || '').split(';').some((c) => c.trim() === COOKIE + '=' + token);
    if (held) return next();

    // a page someone is opening gets the number pad; a stylesheet, script,
    // image or background request just gets told no, with a status that stops
    // browsers and service workers from saving the answer as if it were the file
    const dest = request.headers.get('sec-fetch-dest');
    const isPage = request.method === 'GET' && (dest ? dest === 'document' : (request.headers.get('accept') || '').includes('text/html'));
    if (!isPage) {
      return new Response('Locked.', { status: 401, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
    }
    return new Response(LOCK_PAGE, {
      status: 401,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
    });
  } catch (e) {
    return next(); // a broken lock must not take the site down with it
  }
}

// The number pad. Everything it needs is in this one string: no files to load,
// because every file on the site is behind the lock.
const LOCK_PAGE = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#FAFAFA">
<title>kmvtesting</title>
<style>
  :root { --bg: #FAFAFA; --text: #09090B; --muted: #52525B; --line: #C9C9CF; --key: #FFFFFF; --accent: #2563EB; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    background: var(--bg);
    color: var(--text);
    font: 17px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    min-height: 100vh;
    min-height: 100dvh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: calc(24px + env(safe-area-inset-top)) 20px calc(24px + env(safe-area-inset-bottom));
  }
  main { width: 100%; max-width: 300px; }
  .wordmark { font: 700 2rem/1.1 ui-monospace, "SF Mono", "Cascadia Code", Consolas, monospace; letter-spacing: -0.03em; }
  .wordmark .dot { color: var(--accent); }
  .ask { margin-top: 28px; color: var(--muted); min-height: 1.5em; }
  .slots { display: flex; gap: 10px; margin-top: 10px; }
  .slots i { width: 18px; height: 18px; border: 1.5px solid var(--text); background: transparent; }
  .slots i.on { background: var(--text); }
  .slots.ok i { background: var(--accent); border-color: var(--accent); }
  .slots.no { animation: no 320ms cubic-bezier(0.36, 0.07, 0.19, 0.97); }
  @keyframes no { 20%, 60% { transform: translateX(-7px); } 40%, 80% { transform: translateX(7px); } }

  /* one sheet of keys: the gaps are the lines between them */
  .pad { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; margin-top: 22px; background: var(--line); border: 1px solid var(--line); }
  .pad button {
    height: 72px;
    border: 0;
    background: var(--key);
    color: var(--text);
    font: 600 28px/1 ui-monospace, "SF Mono", "Cascadia Code", Consolas, monospace;
    cursor: pointer;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }
  .pad button.word { font: 500 16px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: var(--muted); }
  .pad button svg { display: block; color: var(--muted); }
  /* the raised bar that marks the 5 on a real keypad */
  .pad button[data-k="5"]::after { content: ""; width: 10px; height: 2px; margin-top: 5px; background: currentColor; opacity: 0.5; }
  .pad button:hover { background: #F4F4F5; }
  .pad button:active, .pad button.hit { background: var(--text); color: var(--bg); }
  .pad button:active svg, .pad button.hit svg { color: var(--bg); }
  .pad button:focus-visible { outline: 3px solid var(--accent); outline-offset: -3px; }
  .pad[aria-busy="true"] button { color: var(--line); cursor: default; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  @media (prefers-reduced-motion: reduce) { .slots.no { animation: none; } }
</style>
</head>
<body>
<main>
  <h1 class="wordmark">kmvtesting<span class="dot">.</span></h1>
  <p class="ask" id="ask">Enter the code</p>
  <div class="slots" id="slots" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
  <p class="sr" id="say" aria-live="assertive"></p>
  <div class="pad" id="pad" role="group" aria-label="Number pad">
    <button type="button" data-k="1">1</button>
    <button type="button" data-k="2">2</button>
    <button type="button" data-k="3">3</button>
    <button type="button" data-k="4">4</button>
    <button type="button" data-k="5">5</button>
    <button type="button" data-k="6">6</button>
    <button type="button" data-k="7">7</button>
    <button type="button" data-k="8">8</button>
    <button type="button" data-k="9">9</button>
    <button type="button" data-k="clear" class="word">Clear</button>
    <button type="button" data-k="0">0</button>
    <button type="button" data-k="back" aria-label="Delete the last digit"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z"/><path d="m17 9-6 6"/><path d="m11 9 6 6"/></svg></button>
  </div>
</main>
<script>
(function () {
  var MAX = 4, code = '', busy = false;
  var box = document.getElementById('slots'), slots = box.children;
  var ask = document.getElementById('ask'), say = document.getElementById('say'), pad = document.getElementById('pad');

  function paint() { for (var i = 0; i < slots.length; i++) slots[i].className = i < code.length ? 'on' : ''; }
  function tell(text, aloud) { ask.textContent = text; if (aloud) say.textContent = text; }
  function rest() { busy = false; pad.removeAttribute('aria-busy'); }

  function wrong(text) {
    code = '';
    paint();
    box.className = 'slots no';
    tell(text, true);
    setTimeout(function () { box.className = 'slots'; }, 400);
    setTimeout(function () { if (!code && !busy && ask.textContent === text) ask.textContent = 'Enter the code'; }, 2200);
  }

  function send() {
    busy = true;
    pad.setAttribute('aria-busy', 'true');
    tell('Checking', false);
    fetch('/api/gate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ code: code }) })
      .then(function (r) {
        if (r.ok) {
          box.className = 'slots ok';
          tell('Opening', true);
          try { sessionStorage.setItem('kmv-gate', String(Date.now())); } catch (e) {}
          location.reload();
          return;
        }
        rest();
        wrong(r.status === 401 ? 'Wrong code' : 'That did not work. Try again.');
      })
      .catch(function () { rest(); wrong('No connection. Try again.'); });
  }

  function press(k) {
    if (busy) return;
    if (k === 'clear') code = '';
    else if (k === 'back') code = code.slice(0, -1);
    else if (code.length < MAX) code += k;
    if (ask.textContent !== 'Enter the code') ask.textContent = 'Enter the code';
    paint();
    if (code.length === MAX) send();
  }

  pad.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (b) press(b.getAttribute('data-k'));
  });

  // a keyboard works too, and lights the matching key
  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var k = /^[0-9]$/.test(e.key) ? e.key : e.key === 'Backspace' ? 'back' : (e.key === 'Escape' || e.key === 'Delete') ? 'clear' : null;
    if (!k) return;
    e.preventDefault();
    var b = pad.querySelector('[data-k="' + k + '"]');
    if (b) { b.classList.add('hit'); setTimeout(function () { b.classList.remove('hit'); }, 130); }
    press(k);
  });

  document.addEventListener('paste', function (e) {
    var t = ((e.clipboardData || window.clipboardData).getData('text') || '').replace(/\D/g, '').slice(0, MAX);
    if (t.length === MAX && !busy) { code = t; paint(); send(); }
  });

  // right code, but the lock is back: the browser threw the cookie away
  try {
    var t = Number(sessionStorage.getItem('kmv-gate') || 0);
    sessionStorage.removeItem('kmv-gate');
    if (t && Date.now() - t < 15000) tell('The code was right, but this browser did not keep it. Allow cookies for this site, then try again.', true);
  } catch (e) {}
})();
</script>
</body>
</html>`;
