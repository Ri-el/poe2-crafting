// fuzz.mjs - engine fuzz harness for the PoE2 jewel crafting engine.
// Run: node fuzz.mjs [iterations]
// Exercises every public CraftingEngine method across random crafting
// sequences and reports "Exceptions: 0". Any thrown error is captured with a
// short stack sample so regressions surface immediately.
import { readFileSync } from 'node:fs';
import CraftingEngine from './crafting.js';

const here = new URL('.', import.meta.url);

// Build the engine's mod data straight from the per-base source files in
// data/bases/ (the same files build_data.ps1 compiles into mods.data.js).
// Previously this loaded the legacy aggregated data/jewel-mods.v2.json, which
// has been removed now that each base owns its own JSON.
const BASES = ['ruby', 'emerald', 'sapphire'];
const modData = Object.fromEntries(
  BASES.map((id) => [id, JSON.parse(readFileSync(new URL(`data/bases/${id}.json`, here)))])
);
const desecData = JSON.parse(readFileSync(new URL('data/desecrated-mods.json', here)));

// Cranium is the only jewel bone in PoE2, and only the Preserved quality exists
// for Craniums (Gnawed/Ancient are Jawbone/Rib/Collarbone bones that don't apply
// to jewels). So the jewel fuzzer only ever uses preserved_cranium.
const BONES = ['preserved_cranium'];
const OMEN_SETS = [
  [], ['sinistral_necromancy'], ['dextral_necromancy'],
  ['abyssal_echoes'], ['sinistral_necromancy', 'abyssal_echoes'],
  ['dextral_necromancy', 'abyssal_echoes'],
];
const CHAOS_OMENS  = [null, 'whittling', 'sinistral_erasure', 'dextral_erasure'];
const DIVINE_OMENS = [null, 'sanctification'];

const rint = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rint(a.length)];

const ACTIONS = [
  (e) => e.applyTransmutation(Math.random()),
  (e) => e.applyAugmentation(Math.random()),
  (e) => e.applyRegal(Math.random()),
  (e) => e.applyExalted(Math.random()),
  (e) => e.applyChaos(pick(CHAOS_OMENS), Math.random()),
  (e) => e.applyAlchemy(),
  (e) => e.applyAnnulment({ mode: pick(['random', 'lowest']) }),
  (e) => e.applyDivine(pick(DIVINE_OMENS)),
  (e) => { e.vaalOutcomeOptions(); e.applyVaal(); },
  (e) => e.applyFracturing(),
  (e) => e.applyEssenceOfAbyss(),
  (e) => e.applyEssenceOfBreach(),
  (e) => e.setHinekoraLock(),
  (e) => e.clearHinekoraLock(),
  (e) => e.setItemLevel(1 + rint(100)),
  (e) => {
    e.startDesecration({ bone: pick(BONES), omens: pick(OMEN_SETS) });
    const pd = e.getPendingDesecration();
    if (pd) {
      const r = rint(3);
      if (r === 0) e.rerollDesecration();
      else if (r === 1) { const n = (pd.options || []).length || 1; e.chooseDesecratedMod(rint(n)); }
      else e.cancelDesecration();
    }
  },
];

const N = Number(process.argv[2] || 20000);
let exceptions = 0, ops = 0;
const samples = [];

for (let i = 0; i < N; i++) {
  try {
    const e = new CraftingEngine(modData, pick(BASES), desecData);
    e.setItemLevel(1 + rint(100));
    const steps = 1 + rint(14);
    for (let s = 0; s < steps; s++) { ops++; pick(ACTIONS)(e); }
  } catch (err) {
    exceptions++;
    if (samples.length < 8) samples.push(String((err && err.stack) || err));
  }
}

console.log(`Iterations: ${N}`);
console.log(`Operations: ${ops}`);
console.log(`Exceptions: ${exceptions}`);
if (samples.length) {
  console.log('--- sample errors ---');
  samples.forEach((s, i) => console.log(`[${i}] ${s.split('\n').slice(0, 3).join('\n')}`));
}
