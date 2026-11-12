// State lives on the phone first. Everything here is shaped so it can sync
// to a database later without changing the screens.
import { seed } from './engine.js';

const KEY = 'plate.v1';
const subs = new Set();

export function dkey(d = new Date()) {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
}
export const today = () => dkey();
export function addDays(key, n) {
  const d = new Date(key + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return dkey(d);
}
// Monday-first week containing the given day.
export function weekOf(key = today()) {
  const d = new Date(key + 'T12:00:00');
  const back = (d.getDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, i) => addDays(key, i - back));
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...seed(), ...JSON.parse(raw) };
  } catch (e) { /* storage blocked or corrupt: start clean */ }
  return seed();
}

export let S = load();

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* full or blocked */ }
}

// Change state, save it, and tell the screen to redraw. The time of the
// last change is kept so sync can tell which copy is newer. It only ever
// goes up, so a change made here always counts as newer than the copy it
// was made on, even if another device's clock runs ahead of this one.
const stampChange = was => { S.touched = Math.max(Date.now(), (was || 0) + 1); };

export function commit(fn) {
  const was = S.touched;
  fn(S);
  stampChange(was);
  save();
  subs.forEach(f => f());
}

export const snapshot = () => JSON.stringify(S);
export function restore(snap) {
  const was = S.touched;
  S = JSON.parse(snap);
  stampChange(was);
  save();
  subs.forEach(f => f());
}

// Take a copy that came from the database as it is, without marking it changed.
export function adopt(data) {
  S = { ...seed(), ...data };
  save();
  subs.forEach(f => f());
}

export const subscribe = f => subs.add(f);
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
