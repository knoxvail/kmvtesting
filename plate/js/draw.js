// Small drawings of the thing you are about to pick up, with the load on it.
import { platesFor, fmtW } from './engine.js';

const cls = p => 'p' + String(p).replace('.', '_');

// A loaded barbell, built from plain boxes so the phone can slide the
// plates on smoothly. Plates are told apart by size; the caption names them.
export function barbell(w) {
  const { plates, exact } = platesFor(w);
  // On each sleeve the biggest plate sits against the collar.
  const plate = (p, i) => `<i class="pl ${cls(p)}" style="--i:${i}"></i>`;
  const right = plates.map(plate).join('');
  const left = plates.map(plate).reverse().join('');
  const per = plates.length ? plates.map(fmtW).join(' · ') : 'empty bar';
  const label = exact ? `Each side ${per}` : `Closest load, each side ${per}`;
  return `<figure class="rig">
    <div class="bb" role="img" aria-label="${label}">
      <span class="sleeve l">${left}</span><span class="collar"></span>
      <span class="shaft"></span>
      <span class="collar"></span><span class="sleeve r">${right}</span>
    </div>
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

export function rig(l, w) {
  if (w == null) return '';
  if (l.kind === 'barbell') return barbell(w);
  if (l.kind === 'dumbbell') return dumbbells(w);
  if (l.kind === 'stack') return stack(w);
  return '';
}

const svg = (d, size = 24) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const icon = {
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  down: svg('<path d="M5 9l7 7 7-7"/>'),
  prev: svg('<path d="M15 5l-7 7 7 7"/>'),
  next: svg('<path d="M9 5l7 7-7 7"/>'),
  go: svg('<path d="M9 5l7 7-7 7"/>', 20),
  list: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
};
