// Small drawings of the thing you are about to pick up, with the load on it.
import { platesFor, fmtW } from './engine.js';

// Width and height of each plate, seen from the side.
const SIZE = { 45: [18, 94], 35: [15, 82], 25: [12, 68], 10: [9, 50], 5: [7, 38], 2.5: [5, 28] };
const cls = p => 'p' + String(p).replace('.', '_');

// A loaded barbell. Plates slide on from the ends when it first appears.
export function barbell(w, fresh) {
  const { plates, exact } = platesFor(w);
  const W = 340, H = 100, mid = H / 2, gap = 2, collar = 58;
  let left = '', right = '', x = collar;
  plates.forEach((p, i) => {
    const [pw, ph] = SIZE[p];
    const y = mid - ph / 2;
    left += `<rect class="pl ${cls(p)}" style="--i:${i};--from:-1" x="${x - pw}" y="${y}" width="${pw}" height="${ph}" rx="2.5"/>`;
    right += `<rect class="pl ${cls(p)}" style="--i:${i};--from:1" x="${W - x}" y="${y}" width="${pw}" height="${ph}" rx="2.5"/>`;
    x -= pw + gap;
  });
  const per = plates.length ? plates.map(fmtW).join(' · ') : 'empty bar';
  const label = exact ? `Each side ${per}` : `Closest load, each side ${per}`;
  return `<figure class="rig${fresh ? ' fresh' : ''}">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">
      <rect class="shaft" x="0" y="${mid - 3}" width="${W}" height="6" rx="3"/>
      <rect class="sleeve" x="0" y="${mid - 5}" width="${collar}" height="10" rx="2"/>
      <rect class="sleeve" x="${W - collar}" y="${mid - 5}" width="${collar}" height="10" rx="2"/>
      <rect class="collar" x="${collar}" y="${mid - 11}" width="7" height="22" rx="1.5"/>
      <rect class="collar" x="${W - collar - 7}" y="${mid - 11}" width="7" height="22" rx="1.5"/>
      ${left}${right}
    </svg>
    <figcaption class="cap">${label}</figcaption>
  </figure>`;
}

// A pair of hex dumbbells.
export function dumbbells(w) {
  const one = x => `<g transform="translate(${x} 0)">
      <rect class="shaft" x="30" y="24" width="60" height="8" rx="3"/>
      <path class="head" d="M8 12 L24 6 L34 12 L34 44 L24 50 L8 44 Z"/>
      <path class="head" d="M112 12 L96 6 L86 12 L86 44 L96 50 L112 44 Z"/>
    </g>`;
  return `<figure class="rig small">
    <svg viewBox="0 0 280 56" role="img" aria-label="${fmtW(w)} pound dumbbell in each hand">${one(-8)}${one(132)}</svg>
    <figcaption class="cap">${fmtW(w)} in each hand</figcaption>
  </figure>`;
}

// A weight stack with the pin in.
export function stack(w) {
  const rows = 9;
  const at = Math.max(1, Math.min(rows, Math.round(w / 20)));
  let r = '';
  for (let i = 0; i < rows; i++) {
    r += `<rect class="${i < at ? 'slab on' : 'slab'}" x="0" y="${4 + i * 8}" width="96" height="6" rx="1"/>`;
  }
  const py = 4 + (at - 1) * 8 + 3;
  return `<figure class="rig small">
    <svg viewBox="0 0 280 80" role="img" aria-label="Pin at ${fmtW(w)} on the stack">${r}
      <rect class="pin" x="90" y="${py - 2}" width="36" height="4" rx="2"/>
      <circle class="pin" cx="128" cy="${py}" r="5"/>
    </svg>
    <figcaption class="cap">Pin at ${fmtW(w)}</figcaption>
  </figure>`;
}

export function rig(l, w, fresh) {
  if (w == null) return '';
  if (l.kind === 'barbell') return barbell(w, fresh);
  if (l.kind === 'dumbbell') return dumbbells(w);
  if (l.kind === 'stack') return stack(w);
  return '';
}

// The protein ring, drawn as a weight plate seen face on.
export function plateRing(p, lettering) {
  const full = Math.min(p, 1);
  return `<svg viewBox="0 0 300 300" class="ring" aria-hidden="true">
    <defs><path id="arc" d="M 62 150 A 88 88 0 0 1 238 150"/></defs>
    <circle class="track" cx="150" cy="150" r="128" pathLength="100"/>
    <circle class="arcfill" data-ring="protein" style="--p:${full}" cx="150" cy="150" r="128" pathLength="100" transform="rotate(-90 150 150)"/>
    <text class="stamp"><textPath href="#arc" startOffset="50%" text-anchor="middle">${lettering}</textPath></text>
  </svg>`;
}

export const icon = {
  mic: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  back: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  go: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
  send: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
};
