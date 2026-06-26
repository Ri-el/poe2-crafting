// app.js - PoE2 Jewel Crafting UI Controller
// Runs as a classic <script defer> (not an ES module) so the app also works
// when opened directly from file:// (double-click index.html, no server).
(function () {
'use strict';
const CraftingEngine = window.CraftingEngine;

const USE_SOUND_FILES = false;

const CURRENCIES = {
  transmutation: { color: '#6888c8' },
  augmentation:  { color: '#88aaff' },
  alchemy:       { color: '#c8a848' },
  regal:         { color: '#6888c8' },
  exalted:       { color: '#c8a848' },
  chaos:         { color: '#c8a848' },
  annulment:     { color: '#aaaaaa' },
  divine:        { color: '#e8d898' },
  vaal:          { color: '#c02040' },
  fracturing:    { color: '#6fb0a8' },
  hinekora:      { color: '#b061d6' },
  desecration:   { color: '#b061d6' },
  preserved_cranium: { color: '#5fd38a' },
  essence_abyss:     { color: '#7a3da6' },
  essence_breach:    { color: '#c0506f' },
};
const DEFAULT_ORB_COLOR = 'rgba(255,255,255,0.6)';

// Crafting omens modify the next use of a specific currency. Each omen maps to
// the currency it augments. They are mutually exclusive (only one armed).
const CRAFT_OMENS = {
  whittling:           { currency: 'chaos',     label: 'Omen of Whittling' },
  sinistral_erasure:   { currency: 'chaos',     label: 'Omen of Sinistral Erasure' },
  dextral_erasure:     { currency: 'chaos',     label: 'Omen of Dextral Erasure' },
  sinistral_annulment: { currency: 'annulment', label: 'Omen of Sinistral Annulment' },
  dextral_annulment:   { currency: 'annulment', label: 'Omen of Dextral Annulment' },
  sanctification:      { currency: 'divine',    label: 'Omen of Sanctification' },
};

// Greater / Perfect orb variants. Each behaves exactly like its base orb but
// forces the newly added modifier to roll high within its value range.
// `quality` is 0..1 (the minimum fraction of the range the roll can land in):
// Greater = top 50%, Perfect = top 20%. They deliberately reuse the base orb's
// icon + cursor colour ("same assets"). Tweak the quality numbers to taste.
const ORB_VARIANTS = {
  greater_transmutation: { base: 'transmutation', quality: 0.5, label: 'Greater Orb of Transmutation', abbr: 'G.Trans' },
  perfect_transmutation: { base: 'transmutation', quality: 0.8, label: 'Perfect Orb of Transmutation', abbr: 'P.Trans' },
  greater_augmentation:  { base: 'augmentation',  quality: 0.5, label: 'Greater Orb of Augmentation',  abbr: 'G.Aug'   },
  perfect_augmentation:  { base: 'augmentation',  quality: 0.8, label: 'Perfect Orb of Augmentation',  abbr: 'P.Aug'   },
  greater_regal:         { base: 'regal',         quality: 0.5, label: 'Greater Regal Orb',            abbr: 'G.Regal' },
  perfect_regal:         { base: 'regal',         quality: 0.8, label: 'Perfect Regal Orb',            abbr: 'P.Regal' },
  greater_exalted:       { base: 'exalted',       quality: 0.5, label: 'Greater Exalted Orb',          abbr: 'G.Exalt' },
  perfect_exalted:       { base: 'exalted',       quality: 0.8, label: 'Perfect Exalted Orb',          abbr: 'P.Exalt' },
  greater_chaos:         { base: 'chaos',         quality: 0.5, label: 'Greater Chaos Orb',            abbr: 'G.Chaos' },
  perfect_chaos:         { base: 'chaos',         quality: 0.8, label: 'Perfect Chaos Orb',            abbr: 'P.Chaos' },
};
// Variants reuse the base orb's cursor colour.
for (const [key, v] of Object.entries(ORB_VARIANTS)) {
  if (CURRENCIES[v.base]) CURRENCIES[key] = { color: CURRENCIES[v.base].color };
}

let engine = null;
let currentJewelType = 'ruby';
let modData = null;
let desecData = null;
let armedCurrency = null;
let showDetails = false;
let stash = [];
let dragIndex = null;
let dragCurrency = null;
// Hinekora's Lock: sealed foresight outcomes for the current Lock, keyed by
// currency. Computed lazily on hover and reused so the previewed result equals
// what gets committed. Cleared when the Lock is applied fresh or consumed.
let foreseenSeals = {};
let foreseenHover = null; // currency currently previewed on hover (or null)
let undoStack = [];
let redoStack = [];

// Desecration (Abyssal) UI state.
// A directional Necromancy omen (sinistral/dextral) may be combined with
// Abyssal Echoes, so we track a set of active omens rather than a single one.
let selectedOmens = new Set();
let omenOfLightActive = false;
// Crafting omen currently armed (key in CRAFT_OMENS), or null.
let selectedCraftOmen = null;
let desecState = null;
// Item Level slider state: when locked, the knob can't be dragged.
let ilvlLocked = false;

// Last known pointer position, tracked continuously so the cursor orb can be
// placed correctly the instant a currency is armed — even before the pointer
// moves again. Without this the native cursor is hidden while the orb is still
// parked at its previous spot, making it look like the cursor "disappeared".
let lastMouseX = typeof window !== 'undefined' ? window.innerWidth / 2 : 0;
let lastMouseY = typeof window !== 'undefined' ? window.innerHeight / 2 : 0;
let orbRaf = 0;

const elements = {
  tooltip: document.getElementById('jewel-tooltip'),
  itemName: document.getElementById('item-name'),
  modList: document.getElementById('mod-list'),
  enchantList: document.getElementById('enchant-list'),
  corruptedLabel: document.getElementById('corrupted-label'),
  itemLevel: document.getElementById('item-level'),
  ilvlSlider: document.getElementById('ilvl-slider'),
  ilvlTrack: document.getElementById('ilvl-track'),
  ilvlFill: document.getElementById('ilvl-fill'),
  ilvlKnob: document.getElementById('ilvl-knob'),
  ilvlValue: document.getElementById('ilvl-value'),
  craftGlow: document.getElementById('craft-glow'),
  currencyGrid: document.getElementById('currency-grid'),
  currencyBtns: document.querySelectorAll('.currency-btn'),
  resetBtn: document.getElementById('reset-btn'),
  errorToast: document.getElementById('error-toast'),
  cursorOrb: document.getElementById('cursor-orb'),
  jewelSelector: document.getElementById('jewel-selector'),
  jewelBtns: document.querySelectorAll('.jewel-btn'),
  stashGrid: document.getElementById('stash-grid'),
  saveBtn: document.getElementById('save-btn'),
  undoBtn: document.getElementById('undo-btn'),
  redoBtn: document.getElementById('redo-btn'),
  craftCounter: document.getElementById('craft-counter'),
  hinekoraMark: document.getElementById('hinekora-mark'),
  boneBtns: document.querySelectorAll('.bone-btn'),
  omenBtns: document.querySelectorAll('.omen-btn'),
  craftOmenBtns: document.querySelectorAll('.craft-omen-btn'),
  essenceBtns: document.querySelectorAll('.essence-btn'),
  sanctifiedLabel: document.getElementById('sanctified-label'),
  desecratePanel: document.getElementById('desecrate-panel'),
  revealPanel: document.getElementById('reveal-panel'),
  revealBtn: document.getElementById('reveal-btn'),
  wellModal: document.getElementById('well-modal'),
  wellSub: document.getElementById('well-sub'),
  wellOptions: document.getElementById('well-options'),
  wellReroll: document.getElementById('well-reroll'),
  wellRerolls: document.getElementById('well-rerolls'),
  wellCancel: document.getElementById('well-cancel'),
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// Merge every loaded category mod file (jewels, time-lost, armour, weapons,
// jewellery, off-hand, flasks) into one { bases } pool. A base that lists
// `inherits` gets the named shared prefix/suffix pools merged in at load time,
// so mods common to a category only need to be written once.
function resolveInherits(baseDef, shared) {
  if (!baseDef || !Array.isArray(baseDef.inherits) || !baseDef.inherits.length) return baseDef;
  const pre = [], suf = [];
  for (const key of baseDef.inherits) {
    const s = shared && shared[key];
    if (!s) continue;
    if (Array.isArray(s.prefixes)) pre.push(...s.prefixes);
    if (Array.isArray(s.suffixes)) suf.push(...s.suffixes);
  }
  const out = Object.assign({}, baseDef);
  out.prefixes = pre.concat(baseDef.prefixes || []);
  out.suffixes = suf.concat(baseDef.suffixes || []);
  delete out.inherits;
  return out;
}

function mergeModSources() {
  const srcBases = window.MOD_BASES || {};
  const shared = window.MOD_SHARED || {};
  const bases = {};
  for (const id in srcBases) bases[id] = resolveInherits(srcBases[id], shared);
  return { bases };
}

async function init() {
  try {
    if (!window.MOD_BASES) throw new Error('Mod data not found — run build (build.cmd) to generate data/mods.data.js.');
    modData = mergeModSources();

    // Desecrated (Abyssal) mod pools — optional. Desecration is disabled if absent.
    desecData = window.DESECRATED_MODS_RAW || null;

    loadStash();
    if (USE_SOUND_FILES) preloadSounds();
    setupCurrencyIcons();
    createEngine(currentJewelType);
    setupEventListeners();
  } catch (err) {
    showError('Error initializing simulator: ' + err.message);
  }
}

// Reset all omen-related UI state to a clean slate. Called whenever the active
// item is swapped out from under the UI (new engine, or an item loaded from the
// stash) so leftover armed omens can't leak onto the new item. Both call sites
// (createEngine + loadFromStash) share this so they can't drift apart again.
function resetOmenState() {
  selectedOmens.clear();
  omenOfLightActive = false;
  selectedCraftOmen = null;
  if (elements.omenBtns) elements.omenBtns.forEach(b => b.classList.remove('active'));
  if (elements.craftOmenBtns) elements.craftOmenBtns.forEach(b => b.classList.remove('active'));
}

function createEngine(type) {
  engine = new CraftingEngine(modData, type, desecData);
  undoStack = [];
  redoStack = [];
  resetOmenState();
  clearDesecration();
  renderItem();
}

function setupCurrencyIcons() {
  elements.currencyBtns.forEach(btn => {
    const type = btn.dataset.currency;
    const iconEl = btn.querySelector('.currency-icon');
    if (!type || !iconEl) return;
    loadIconInto(iconEl, type);
  });
  // Abyssal (bone + omen) buttons mirror the currency icons.
  document.querySelectorAll('.abyss-btn').forEach(btn => {
    const name = btn.dataset.bone || btn.dataset.omen || btn.dataset.craftOmen || btn.dataset.currency;
    const iconEl = btn.querySelector('.currency-icon');
    if (name && iconEl) loadIconInto(iconEl, name);
  });
  loadIconInto(elements.hinekoraMark, 'hinekora-mark');
}

// Some buttons use internal keys (with underscores) that differ from the icon
// file names on disk. Map those keys to the actual asset basenames so the
// correct PNG is requested. Anything not listed falls through unchanged.
const ICON_FILE = {
  preserved_cranium: 'cranium',
  sinistral_necromancy: 'sinistral-necromancy',
  dextral_necromancy: 'dextral-necromancy',
  abyssal_echoes: 'abyssal-echoes',
  omen_of_light: 'light',
  // Crafting omens (underscore key -> hyphenated asset basename).
  sinistral_erasure: 'sinistral-erasure',
  dextral_erasure: 'dextral-erasure',
  sinistral_annulment: 'sinistral-annulment',
  dextral_annulment: 'dextral-annulment',
  // Greater / Perfect orbs reuse their base orb's icon asset.
  greater_transmutation: 'transmutation', perfect_transmutation: 'transmutation',
  greater_augmentation: 'augmentation', perfect_augmentation: 'augmentation',
  greater_regal: 'regal', perfect_regal: 'regal',
  greater_exalted: 'exalted', perfect_exalted: 'exalted',
  greater_chaos: 'chaos', perfect_chaos: 'chaos',
  // Abyssal Omens (force the Lich Desecrated group; disabled for jewels for now).
  omen_of_the_sovereign: 'sovereign', omen_of_the_liege: 'liege', omen_of_the_blackblooded: 'blackblooded',
  // Essences.
  essence_abyss: 'abyss-essence', essence_breach: 'breach-essence',
};
function iconFileFor(name) {
  return (ICON_FILE[name] || name);
}

function loadIconInto(iconEl, name) {
  if (!iconEl) return;
  const img = new Image();
  img.className = 'currency-img';
  img.alt = '';
  img.addEventListener('load', () => iconEl.classList.add('has-real-icon'));
  img.addEventListener('error', () => img.remove());
  img.src = `assets/icons/${iconFileFor(name)}.png`;
  iconEl.appendChild(img);
}

let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

const SOUND_TYPES = ['transmutation','augmentation','alchemy','regal','exalted','chaos','annulment','divine','fracturing','vaal','hinekora','undo','reset','error'];
const soundFiles = {};
const soundReady = {};

function preloadSounds() {
  SOUND_TYPES.forEach(type => {
    const audio = new Audio(`assets/sounds/${type}.mp3`);
    audio.preload = 'auto';
    audio.addEventListener('canplaythrough', () => { soundReady[type] = true; }, { once: true });
    audio.addEventListener('error', () => { soundReady[type] = false; });
    soundFiles[type] = audio;
  });
}

function playSound(type) {
  if (USE_SOUND_FILES && soundReady[type] && soundFiles[type]) {
    try {
      const a = soundFiles[type];
      a.currentTime = 0;
      a.volume = 0.6;
      a.play().catch(() => playProceduralSound(type));
      return;
    } catch (e) { /* fall through */ }
  }
  playProceduralSound(type);
}

function playProceduralSound(type) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const now = ctx.currentTime;

  if (type === 'vaal') {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(80, now);
    osc.frequency.exponentialRampToValueAtTime(20, now + 0.3);
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
    osc.start(now); osc.stop(now + 0.3);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(800, now);
    osc2.frequency.linearRampToValueAtTime(400, now + 0.3);
    gain2.gain.setValueAtTime(0.1, now);
    gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
    osc2.connect(gain2); gain2.connect(ctx.destination);
    osc2.start(now); osc2.stop(now + 0.3);
    return;
  }

  let freq = 400, sweep = 800, dur = 0.15, oscType = 'sine';
  switch (type) {
    case 'transmutation': freq = 300; sweep = 600; break;
    case 'augmentation':  freq = 400; sweep = 700; dur = 0.1; break;
    case 'alchemy':       freq = 200; sweep = 800; oscType = 'triangle'; break;
    case 'regal':         freq = 350; sweep = 750; oscType = 'triangle'; break;
    case 'exalted':       freq = 600; sweep = 1200; dur = 0.25; break;
    case 'chaos':         freq = 150; sweep = 300; oscType = 'sawtooth'; dur = 0.2; break;
    case 'annulment':     freq = 800; sweep = 200; dur = 0.2; break;
    case 'divine':        freq = 500; sweep = 1000; oscType = 'square'; dur = 0.2; break;
    case 'fracturing':    freq = 520; sweep = 110; oscType = 'square'; dur = 0.18; break;
    case 'hinekora':      freq = 420; sweep = 900; oscType = 'triangle'; dur = 0.22; break;
    case 'desecration':   freq = 180; sweep = 70; oscType = 'sawtooth'; dur = 0.26; break;
    case 'undo':          freq = 300; sweep = 620; dur = 0.12; break;
    case 'reset':         freq = 200; sweep = 100; dur = 0.1; break;
    case 'error':         freq = 150; sweep = 120; oscType = 'sawtooth'; dur = 0.15; break;
  }

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain); gain.connect(ctx.destination);
  osc.type = oscType;
  osc.frequency.setValueAtTime(freq, now);
  osc.frequency.exponentialRampToValueAtTime(sweep, now + dur);
  gain.gain.setValueAtTime(0.3, now);
  gain.gain.exponentialRampToValueAtTime(0.01, now + dur);
  osc.start(now); osc.stop(now + dur);
}

function setupEventListeners() {
  document.addEventListener('contextmenu', e => e.preventDefault());

  elements.jewelBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      elements.jewelBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentJewelType = btn.dataset.type;
      disarmCurrency();
      createEngine(currentJewelType);
    });
  });

  elements.currencyBtns.forEach(btn => {
    // RIGHT-CLICK activates (arms / disarms) a currency so the orb follows the
    // cursor; then left-click the jewel to use it. LEFT-CLICK no longer arms --
    // the left mouse button is reserved for dragging the currency onto the item.
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      toggleCurrency(btn.dataset.currency);
    });
  });

  // Shared apply path used by BOTH interaction models:
  //  1) arm (right- or left-click a currency) then left-click the item, and
  //  2) left-click drag a currency and release it on the item.
  function useCurrencyOnItem(currency, shiftKey) {
    if (!currency) return;
    // The drag-drop path may not have armed the currency; arm it so the orb /
    // shift-to-keep behaviour stays consistent with the click model.
    if (armedCurrency !== currency) armCurrency(currency);

    if (currency === 'hinekora') { applyHinekoraLock(); return; }

    // Abyssal bones open the Well of Souls (desecration) instead of applying directly.
    if (currency === 'preserved_cranium') {
      startDesecrationFlow(currency); return;
    }

    // Hinekora's Lock: using any currency commits its (sealed) foreseen outcome
    // immediately and removes the Lock. Hovering only previews; there is no
    // accept/cancel step.
    if (engine.getItem().hinekoraLocked && FORESEEABLE.has(currency)) {
      commitForesight(currency);
      return;
    }

    const before = engine.getItem();
    const result = applyCurrencyToEngine(currency);

    if (result.success) {
      pushUndo(before);
      engine.recordCurrencyUse(currency);
      consumeCraftOmen(currency);
      if (currency === 'annulment' && omenOfLightActive) {
        omenOfLightActive = false;
        const lb = Array.from(elements.omenBtns).find(b => b.dataset.omen === 'omen_of_light');
        if (lb) lb.classList.remove('active');
      }
      playSound(currency);
      triggerCraftAnimation(currency);
      renderItem(result);
      // Applying normally consumes the held currency and drops it. Hold SHIFT to
      // keep it on the cursor so you can keep slamming the remaining slots. A
      // corrupted result always drops it (nothing more can be applied).
      if (!shiftKey || result.item.corrupted || result.item.sanctified) disarmCurrency();
    } else {
      playSound('error');
      triggerErrorAnimation();
      showError(result.error);
    }
  }

  const applyArmedToItem = (e) => {
    if (!armedCurrency) return;
    e.preventDefault();
    useCurrencyOnItem(armedCurrency, e.shiftKey);
  };
  // Model 1 (arm + click): right- or left-click a currency to pick it up (its
  // icon rides the cursor), then LEFT-CLICK the jewel to use it.
  elements.tooltip.addEventListener('click', applyArmedToItem);
  // Hinekora's Lock: foresight previews ONLY once a currency is in hand (armed
  // via left- or right-click) and brought over the item -- never on plain hover
  // of a currency button. Moving the cursor off the item clears the preview.
  elements.tooltip.addEventListener('mouseenter', () => { if (armedCurrency) previewForesight(armedCurrency); });
  elements.tooltip.addEventListener('mouseleave', clearForesightPreview);

  // Model 2 (left-click drag): press and hold left mouse on a currency, drag it
  // onto the item, and release to use it. The dragged icon follows the cursor
  // while the button stays put; releasing anywhere other than the item cancels.
  const startCurrencyDrag = (btn, currency) => (e) => {
    if (!currency) return;
    if (engine.getItem().corrupted) { e.preventDefault(); return; }
    // Clear any armed orb so we never show two icons at once.
    disarmCurrency();
    dragCurrency = currency;
    btn.classList.add('dragging-currency');
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'copy';
      try { e.dataTransfer.setData('text/plain', currency); } catch (_) {}
      const iconImg = btn.querySelector('img');
      if (iconImg && iconImg.complete && iconImg.width) {
        try { e.dataTransfer.setDragImage(iconImg, iconImg.width / 2, iconImg.height / 2); } catch (_) {}
      }
    }
  };
  const endCurrencyDrag = (btn) => () => { btn.classList.remove('dragging-currency'); dragCurrency = null; };
  Array.from(elements.currencyBtns).forEach(btn => {
    btn.setAttribute('draggable', 'true');
    btn.addEventListener('dragstart', startCurrencyDrag(btn, btn.dataset.currency));
    btn.addEventListener('dragend', endCurrencyDrag(btn));
  });
  Array.from(elements.boneBtns).forEach(btn => {
    btn.setAttribute('draggable', 'true');
    btn.addEventListener('dragstart', startCurrencyDrag(btn, btn.dataset.bone));
    btn.addEventListener('dragend', endCurrencyDrag(btn));
  });
  elements.tooltip.addEventListener('dragover', (e) => {
    if (!dragCurrency) return; // ignore unrelated drags (e.g. stash reordering)
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    elements.tooltip.classList.add('drag-target');
    // Hinekora's Lock: dragging a currency over the item previews its foreseen
    // outcome, just like carrying an armed currency. Guard so we render once per
    // entry instead of on every dragover tick.
    if (foreseenHover !== dragCurrency) previewForesight(dragCurrency);
  });
  elements.tooltip.addEventListener('dragleave', (e) => {
    // Detect leaving via pointer position, not relatedTarget (which is null mid
    // re-render) -- otherwise the foresight preview re-render flickers the drag.
    const r = elements.tooltip.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right &&
                   e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) {
      elements.tooltip.classList.remove('drag-target');
      clearForesightPreview();
    }
  });
  elements.tooltip.addEventListener('drop', (e) => {
    if (!dragCurrency) return;
    e.preventDefault();
    elements.tooltip.classList.remove('drag-target');
    const currency = dragCurrency;
    dragCurrency = null;
    useCurrencyOnItem(currency, e.shiftKey);
  });

  elements.resetBtn.addEventListener('click', () => {
    pushUndo(engine.getItem());
    engine.resetItem();
    clearCraftOmen();
    clearDesecration();
    foreseenSeals = {};
    foreseenHover = null;
    disarmCurrency();
    playSound('reset');
    renderItem();
  });

  if (elements.undoBtn) elements.undoBtn.addEventListener('click', undoLastAction);
  if (elements.redoBtn) elements.redoBtn.addEventListener('click', redoLastAction);

  elements.saveBtn.addEventListener('click', saveToStash);

  // --- Item Level slider (drag to set 1-100; click the knob to lock/unlock) ---
  setupIlvlSlider();

  // --- Desecration (Abyssal) ---
  elements.omenBtns.forEach(btn => {
    // PoE2 omens are activated by RIGHT-CLICK ("right click to set active").
    btn.addEventListener('contextmenu', (e) => { e.preventDefault(); toggleOmen(btn.dataset.omen); });
    btn.addEventListener('click', () => showError('Right-click an Omen to activate it.'));
  });
  // Crafting omens (Whittling / Erasure / Annulment / Sanctification): right-click
  // to arm one, then use its matching currency (Chaos / Annulment / Divine).
  if (elements.craftOmenBtns) elements.craftOmenBtns.forEach(btn => {
    btn.addEventListener('contextmenu', (e) => { e.preventDefault(); toggleCraftOmen(btn.dataset.craftOmen); });
    btn.addEventListener('click', () => showError('Right-click an Omen to activate it, then use its matching currency.'));
  });
  elements.boneBtns.forEach(btn => {
    // Preserved Cranium behaves like a normal currency: left- or right-click to
    // arm/disarm it (a glowing orb follows the cursor), then click the jewel to
    // desecrate. The button stays put in the menu while the orb is dragged.
    btn.addEventListener('contextmenu', (e) => { e.preventDefault(); toggleCurrency(btn.dataset.bone); });
    btn.addEventListener('click', () => {
      if (armedCurrency === btn.dataset.bone) disarmCurrency();
      else toggleCurrency(btn.dataset.bone);
    });
  });
  // Essences behave like currencies: arm with click (or drag), then click the jewel.
  if (elements.essenceBtns) elements.essenceBtns.forEach(btn => {
    btn.setAttribute('draggable', 'true');
    btn.addEventListener('dragstart', startCurrencyDrag(btn, btn.dataset.currency));
    btn.addEventListener('dragend', endCurrencyDrag(btn));
    btn.addEventListener('contextmenu', (e) => { e.preventDefault(); toggleCurrency(btn.dataset.currency); });
    btn.addEventListener('click', () => {
      if (armedCurrency === btn.dataset.currency) disarmCurrency();
      else toggleCurrency(btn.dataset.currency);
    });
  });
  if (elements.revealBtn) elements.revealBtn.addEventListener('click', openWell);
  if (elements.wellReroll) elements.wellReroll.addEventListener('click', rerollWell);
  if (elements.wellCancel) elements.wellCancel.addEventListener('click', cancelWell);
  if (elements.wellModal) {
    elements.wellModal.addEventListener('click', (e) => {
      if (e.target === elements.wellModal) cancelWell();
    });
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Alt' && !showDetails) { showDetails = true; renderItem(); }
    if (e.key === 'Escape') {
      if (elements.wellModal && !elements.wellModal.hidden) cancelWell();
      else disarmCurrency();
    }
  });
  document.addEventListener('keyup', e => {
    if (e.key === 'Alt') { showDetails = false; renderItem(); }
  });
  // If the window loses focus while Alt is held (e.g. Alt+Tab), the keyup never
  // fires, which would otherwise leave the inspect/detail view stuck on.
  window.addEventListener('blur', () => {
    if (showDetails) { showDetails = false; renderItem(); }
  });

  document.addEventListener('mousemove', e => {
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    if (!armedCurrency) return;
    if (orbRaf) return;
    orbRaf = requestAnimationFrame(() => {
      orbRaf = 0;
      positionOrb();
    });
  });

  document.addEventListener('mouseleave', () => { elements.cursorOrb.style.opacity = '0'; });
  document.addEventListener('mouseenter', () => {
    if (armedCurrency) { positionOrb(); elements.cursorOrb.style.opacity = '1'; }
  });
}

function applyCurrencyToEngine(currency, eng = engine) {
  // Greater/Perfect orbs are a base orb plus a high-roll quality bias.
  const variant = ORB_VARIANTS[currency];
  const baseCurrency = variant ? variant.base : currency;
  const quality = variant ? variant.quality : 0;
  // A crafting omen only applies to its matching (base) currency.
  const omen = (selectedCraftOmen && CRAFT_OMENS[selectedCraftOmen]
    && CRAFT_OMENS[selectedCraftOmen].currency === baseCurrency) ? selectedCraftOmen : null;
  switch (baseCurrency) {
    case 'transmutation': return eng.applyTransmutation(quality);
    case 'augmentation':  return eng.applyAugmentation(quality);
    case 'alchemy':       return eng.applyAlchemy();
    case 'regal':         return eng.applyRegal(quality);
    case 'exalted':       return eng.applyExalted(quality);
    case 'chaos':         return eng.applyChaos(omen, quality);
    case 'annulment':     return eng.applyAnnulment({ desecratedOnly: omenOfLightActive, omen });
    case 'divine':        return eng.applyDivine(omen);
    case 'vaal':          return eng.applyVaal();
    case 'fracturing':    return eng.applyFracturing();
    case 'essence_abyss': return eng.applyEssenceOfAbyss();
    case 'essence_breach':return eng.applyEssenceOfBreach();
    default: return { success: false, error: 'Unknown currency' };
  }
}

function toggleCurrency(currency) {
  if (engine.getItem().corrupted) {
    showError('Item is corrupted and cannot be modified.');
    return;
  }
  if (armedCurrency === currency) disarmCurrency();
  else armCurrency(currency);
}

// Show the picked-up currency's real icon riding along with the cursor orb,
// so dragging feels like carrying the actual currency item.
function setOrbIcon(name) {
  if (!elements.cursorOrb) return;
  let img = elements.cursorOrb.querySelector('.orb-img');
  if (!img) {
    img = document.createElement('img');
    img.className = 'orb-img';
    img.alt = '';
    elements.cursorOrb.appendChild(img);
  }
  img.style.display = 'none';
  img.onload = () => { img.style.display = 'block'; };
  img.onerror = () => { img.remove(); };
  img.src = `assets/icons/${iconFileFor(name)}.png`;
}

function clearOrbIcon() {
  if (!elements.cursorOrb) return;
  const img = elements.cursorOrb.querySelector('.orb-img');
  if (img) img.remove();
}

function positionOrb() {
  elements.cursorOrb.style.transform =
    `translate3d(${lastMouseX}px, ${lastMouseY}px, 0) translate(-50%, -50%)`;
}

function armCurrency(currency) {
  armedCurrency = currency;
  elements.currencyBtns.forEach(b =>
    b.classList.toggle('armed', b.dataset.currency === currency));
  elements.boneBtns.forEach(b =>
    b.classList.toggle('armed', b.dataset.bone === currency));
  if (elements.essenceBtns) elements.essenceBtns.forEach(b =>
    b.classList.toggle('armed', b.dataset.currency === currency));

  const color = (CURRENCIES[currency] && CURRENCIES[currency].color) || DEFAULT_ORB_COLOR;
  elements.cursorOrb.style.setProperty('--orb-color', color);
  elements.cursorOrb.style.background = `radial-gradient(circle, ${color} 0%, transparent 70%)`;
  setOrbIcon(currency);
  positionOrb();
  elements.cursorOrb.style.opacity = '1';
  // Keep the native cursor visible while a currency is armed — the glow orb
  // simply trails it. Previously this set `cursor: none`, which made the
  // pointer appear to vanish the moment you picked up a currency.
  document.body.style.cursor = '';
  elements.tooltip.style.cursor = 'pointer';
}

function disarmCurrency() {
  armedCurrency = null;
  elements.currencyBtns.forEach(b => b.classList.remove('armed'));
  elements.boneBtns.forEach(b => b.classList.remove('armed'));
  if (elements.essenceBtns) elements.essenceBtns.forEach(b => b.classList.remove('armed'));
  clearOrbIcon();
  elements.cursorOrb.style.opacity = '0';
  document.body.style.cursor = 'default';
  elements.tooltip.style.cursor = 'pointer';
}

// ============================================================
// ITEM LEVEL SLIDER -- drag 1..100 (~50 at the middle), lockable knob
// ============================================================

// Map an item level (1..100) to a 0..100% position along the track.
function ilvlToPercent(v) {
  return ((Math.max(1, Math.min(100, v)) - 1) / 99) * 100;
}

// Reflect the engine's current item level in the slider track + label.
function updateIlvlUI(ilvl) {
  const pct = ilvlToPercent(ilvl);
  if (elements.ilvlFill) elements.ilvlFill.style.width = pct + '%';
  if (elements.ilvlKnob) {
    elements.ilvlKnob.style.left = pct + '%';
    elements.ilvlKnob.classList.toggle('locked', ilvlLocked);
  }
  if (elements.ilvlValue) elements.ilvlValue.textContent = ilvl;
  if (elements.ilvlSlider) elements.ilvlSlider.setAttribute('aria-valuenow', String(ilvl));
}

function setupIlvlSlider() {
  const slider = elements.ilvlSlider;
  const track = elements.ilvlTrack;
  const knob = elements.ilvlKnob;
  if (!slider || !track || !knob) return;

  let dragging = false;
  let moved = false;
  let startX = 0;
  let startedOnKnob = false;

  const valueFromClientX = (clientX) => {
    const r = track.getBoundingClientRect();
    if (r.width <= 0) return engine.getItem().ilvl;
    const ratio = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    return Math.round(1 + ratio * 99);
  };

  const applyValue = (v) => updateIlvlUI(engine.setItemLevel(v));

  slider.addEventListener('pointerdown', (e) => {
    // Keep the press off the tooltip so it can't apply an armed currency.
    e.stopPropagation();
    e.preventDefault();
    startedOnKnob = !!(e.target.closest && e.target.closest('.ilvl-knob'));
    startX = e.clientX;
    moved = false;
    dragging = true;
    try { slider.setPointerCapture(e.pointerId); } catch (_) {}
  });

  slider.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    if (Math.abs(e.clientX - startX) > 3) moved = true;
    if (ilvlLocked) return;             // locked: dragging does nothing
    if (!moved && !startedOnKnob) return;
    applyValue(valueFromClientX(e.clientX));
  });

  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    try { slider.releasePointerCapture(e.pointerId); } catch (_) {}
    if (moved) return;
    // A plain click (no drag): clicking the knob toggles the lock; clicking the
    // bare track while unlocked jumps the level to that spot.
    if (startedOnKnob) {
      ilvlLocked = !ilvlLocked;
      updateIlvlUI(engine.getItem().ilvl);
    } else if (!ilvlLocked) {
      applyValue(valueFromClientX(e.clientX));
    }
  };
  slider.addEventListener('pointerup', endDrag);
  slider.addEventListener('pointercancel', endDrag);
  slider.addEventListener('click', (e) => e.stopPropagation());

  if (engine) updateIlvlUI(engine.getItem().ilvl);
}

// ============================================================
// DESECRATION (Abyssal) — Preserved Cranium / Well of Souls
// ============================================================

// The two directional Necromancy omens target opposite affix sides, so they
// are mutually exclusive with each other — but either one may be combined with
// Abyssal Echoes (which only grants a reroll of the revealed set).
const DIRECTIONAL_OMENS = ['sinistral_necromancy', 'dextral_necromancy'];

function toggleOmen(omen) {
  // Omen of Light is an ANNULMENT omen, tracked separately from the
  // desecration-reveal omens: it makes the next Orb of Annulment strip only a
  // Desecrated modifier. The other omens influence the Well of Souls.
  if (omen === 'omen_of_light') {
    omenOfLightActive = !omenOfLightActive;
    const btn = Array.from(elements.omenBtns).find(b => b.dataset.omen === 'omen_of_light');
    if (btn) btn.classList.toggle('active', omenOfLightActive);
    renderItem();
    return;
  }
  if (selectedOmens.has(omen)) {
    selectedOmens.delete(omen);
  } else {
    // Selecting a directional omen clears the other directional omen.
    if (DIRECTIONAL_OMENS.includes(omen)) {
      DIRECTIONAL_OMENS.forEach(o => selectedOmens.delete(o));
    }
    selectedOmens.add(omen);
  }
  elements.omenBtns.forEach(b => {
    if (b.dataset.omen === 'omen_of_light') return;
    b.classList.toggle('active', selectedOmens.has(b.dataset.omen));
  });
}

// ---- Crafting omens (Chaos / Annulment / Divine augments) ----
function updateCraftOmenButtons() {
  if (!elements.craftOmenBtns) return;
  elements.craftOmenBtns.forEach(b =>
    b.classList.toggle('active', b.dataset.craftOmen === selectedCraftOmen));
}

function toggleCraftOmen(omen) {
  if (!CRAFT_OMENS[omen]) return;
  selectedCraftOmen = (selectedCraftOmen === omen) ? null : omen;
  updateCraftOmenButtons();
  renderItem();
}

function clearCraftOmen() {
  selectedCraftOmen = null;
  updateCraftOmenButtons();
}

// Consume the armed crafting omen if it matched the currency just applied.
function consumeCraftOmen(currency) {
  const base = ORB_VARIANTS[currency] ? ORB_VARIANTS[currency].base : currency;
  if (selectedCraftOmen && CRAFT_OMENS[selectedCraftOmen]
      && CRAFT_OMENS[selectedCraftOmen].currency === base) {
    engine.recordCurrencyUse(selectedCraftOmen);
    clearCraftOmen();
  }
}

function startDesecrationFlow(bone = 'preserved_cranium') {
  if (!desecData) { showError('Desecrated modifier data is not available.'); return; }
  disarmCurrency();
  // Committing a bone supersedes any Hinekora foresight preview.
  foreseenSeals = {};
  foreseenHover = null;
  hideForeseenBanner();
  if (engine.getItem().corrupted) {
    playSound('error'); triggerErrorAnimation();
    showError('Item is corrupted and cannot be modified.');
    return;
  }
  const before = engine.getItem();
  const res = engine.startDesecration({
    bone: bone || 'preserved_cranium',
    omens: Array.from(selectedOmens),
  });
  if (!res.success) {
    playSound('error'); triggerErrorAnimation();
    showError(res.error);
    return;
  }
  // The bone (and any omens) are consumed now: the desecration is applied and an
  // unrevealed green modifier is placed on the item. The actual modifier is
  // revealed later via the Reveal panel below the item.
  pushUndo(before);
  engine.recordCurrencyUse(bone || 'preserved_cranium');
  // Abyssal Echoes is activated at reveal time (not now), so don't count it here.
  selectedOmens.forEach((o) => { if (o !== 'abyssal_echoes') engine.recordCurrencyUse(o); });
  engine.clearHinekoraLock();
  selectedOmens.clear();
  elements.omenBtns.forEach(b => b.classList.remove('active'));

  desecState = { side: res.side, mode: res.mode, rerollsLeft: 1, options: res.options, abyssalUsed: false };
  playSound('desecration');
  triggerCraftAnimation('desecration');
  renderItem(res);
  showRevealPanel();
}

function openWell() {
  if (!desecState) { showError('Nothing to reveal.'); return; }
  renderWell();
  if (elements.wellModal) {
    elements.wellModal.hidden = false;
    // Replay the Well of Souls reveal animation every time the modal opens.
    elements.wellModal.classList.remove('well-revealing');
    void elements.wellModal.offsetWidth;
    elements.wellModal.classList.add('well-revealing');
  }
  playSound('desecration');
}

function renderWell() {
  if (!desecState || !elements.wellOptions) return;
  const { side, mode, rerollsLeft, options } = desecState;
  if (elements.wellSub) {
    elements.wellSub.textContent =
      `Targeting ${capitalize(side)} — ` +
      (mode === 'add' ? 'fills the open slot' : `replaces a random ${side}`);
  }
  const frag = document.createDocumentFragment();
  options.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'well-option' + (opt.desecrated ? ' desec-option' : '');
    const lineHtml = (Array.isArray(opt.lines) && opt.lines.length > 0)
      ? opt.lines.map(l => escapeHtml(l.text)).join('<br>')
      : escapeHtml(opt.displayText);
    btn.innerHTML =
      `<span class="wo-name">${escapeHtml(opt.tierName)}</span>` +
      `<span class="wo-line">${lineHtml}</span>`;
    btn.addEventListener('click', () => chooseDesec(i));
    frag.appendChild(btn);
  });
  elements.wellOptions.replaceChildren(frag);
  // The reroll only appears if Omen of Abyssal Echoes has been activated, and
  // only once per reveal (it disappears after it's been used).
  const echoesActive = selectedOmens.has('abyssal_echoes');
  if (elements.wellReroll) elements.wellReroll.hidden = !(echoesActive && !desecState.abyssalUsed);
}

function rerollWell() {
  // Reroll requires Omen of Abyssal Echoes to be activated, and is limited to a
  // single use per reveal (not unlimited). The omen is only consumed/counted in
  // the currency counter once a mod is committed.
  if (!desecState || desecState.abyssalUsed) return;
  if (!selectedOmens.has('abyssal_echoes')) return;
  const res = engine.rerollDesecration();
  if (!res.success) { playSound('error'); showError(res.error); return; }
  desecState = { side: res.side, mode: res.mode, rerollsLeft: 0, options: res.options, abyssalUsed: true };
  playSound('chaos');
  renderWell();
}

function chooseDesec(index) {
  // Whether or not the reroll button was used, if Abyssal Echoes is activated it
  // is consumed/counted on commit.
  const usedEcho = selectedOmens.has('abyssal_echoes');
  const result = engine.chooseDesecratedMod(index);
  if (!result.success) {
    playSound('error'); triggerErrorAnimation();
    showError(result.error);
    closeWell();
    return;
  }
  // The bone was consumed at desecrate time. If Abyssal Echoes was activated to
  // reroll, it is consumed/counted now, on commit, in the currency counter.
  if (usedEcho) engine.recordCurrencyUse('abyssal_echoes');
  clearDesecration();
  playSound('vaal');
  triggerCraftAnimation('desecration');
  renderItem(result);
}

function closeWell() {
  if (elements.wellModal) {
    elements.wellModal.hidden = true;
    elements.wellModal.classList.remove('well-revealing');
  }
}

// Fully clear a pending desecration: hide the modal AND the Reveal panel and
// forget the rolled options. Used after a mod is revealed, or when the item is
// reset / undone / replaced.
function clearDesecration() {
  closeWell();
  hideRevealPanel();
  desecState = null;
  // Abyssal Echoes only applies to an active reveal; drop it when the reveal ends.
  selectedOmens.delete('abyssal_echoes');
  elements.omenBtns.forEach(b => {
    if (b.dataset.omen === 'abyssal_echoes') b.classList.remove('active');
  });
}

function showRevealPanel() {
  if (elements.revealPanel) elements.revealPanel.hidden = false;
}

function hideRevealPanel() {
  if (elements.revealPanel) elements.revealPanel.hidden = true;
}

// The Well's "Cancel" just closes the modal — the unrevealed modifier stays on
// the item and the Reveal panel remains so the player can reveal it later.
// Abyssal Echoes is a one-time "before revealing" effect: the act of revealing
// spends the reroll opportunity. So once the Well has been opened, cancelling
// consumes the echo — re-revealing later will NOT offer the reroll again.
function cancelWell() {
  if (desecState) desecState.abyssalUsed = true;
  closeWell();
}

// Snapshot the full restorable state: the item, the UI reveal state
// (desecState), and the engine's pending desecration so the Reveal step can be
// brought back intact by undo/redo.
function snapshotState(item) {
  return {
    item,
    desec: desecState ? structuredClone(desecState) : null,
    pending: engine.getPendingDesecration(),
  };
}

function pushUndo(beforeItem) {
  undoStack.push(snapshotState(beforeItem));
  if (undoStack.length > 50) undoStack.shift();
  // Any fresh action invalidates the redo history.
  redoStack = [];
}

function restoreSnapshot(snap) {
  engine.loadItem(snap.item, snap.pending);
  clearDesecration();
  // Restore the pending reveal AFTER clearDesecration so the Reveal panel
  // re-appears when an unrevealed modifier is still on the item.
  desecState = snap.desec || null;
  foreseenSeals = {};
  foreseenHover = null;
  disarmCurrency();
  renderItem();
}

function undoLastAction() {
  if (undoStack.length === 0) { showError('Nothing to undo.'); return; }
  redoStack.push(snapshotState(engine.getItem()));
  if (redoStack.length > 50) redoStack.shift();
  const prev = undoStack.pop();
  restoreSnapshot(prev);
  playSound('undo');
}

function redoLastAction() {
  if (redoStack.length === 0) { showError('Nothing to redo.'); return; }
  undoStack.push(snapshotState(engine.getItem()));
  if (undoStack.length > 50) undoStack.shift();
  const next = redoStack.pop();
  restoreSnapshot(next);
  playSound('undo');
}

function updateUndoButton() {
  if (!elements.undoBtn) return;
  const empty = undoStack.length === 0;
  elements.undoBtn.disabled = empty;
  elements.undoBtn.classList.toggle('disabled', empty);
}

function updateRedoButton() {
  if (!elements.redoBtn) return;
  const empty = redoStack.length === 0;
  elements.redoBtn.disabled = empty;
  elements.redoBtn.classList.toggle('disabled', empty);
}

function applyHinekoraLock() {
  if (engine.getItem().corrupted) {
    playSound('error');
    triggerErrorAnimation();
    showError('Item is corrupted and cannot be modified.');
    return;
  }
  if (engine.getItem().hinekoraLocked) {
    showError("Hinekora's Lock is already applied.");
    return;
  }
  pushUndo(engine.getItem());
  engine.setHinekoraLock();
  engine.recordCurrencyUse('hinekora');
  foreseenSeals = {};
  foreseenHover = null;
  disarmCurrency();
  playSound('hinekora');
  triggerCraftAnimation('hinekora');
  renderItem();
}

// --- Hinekora's Lock: the Vaal is consumed, but the player picks the outcome ---
const VAAL_CHOICES = {
  none:    { title: 'Corrupt \u2014 Unchanged', desc: 'Becomes Corrupted with no other change.' },
  reroll:  { title: 'Corrupt \u2014 Reroll', desc: 'Destroy and re-add 1\u20133 random modifiers, then Corrupt.' },
  enchant: { title: 'Sanctify \u2014 Corrupted Implicit', desc: 'Add a corrupted implicit modifier, then Corrupt.' },
  modify:  { title: 'Corrupt \u2014 Modify', desc: 'Add a corrupted implicit OR remove a modifier, then Corrupt.' },
};
const VAAL_OUTCOME_NUM = { none: 1, reroll: 2, enchant: 3, modify: 4 };

// Currencies whose effect Hinekora's Lock can foresee (everything that directly
// modifies the item — not the Lock itself or the Well-of-Souls bone).
const FORESEEABLE = new Set([
  'transmutation', 'augmentation', 'alchemy', 'regal', 'exalted',
  'chaos', 'annulment', 'divine', 'vaal', 'fracturing',
  'greater_transmutation', 'perfect_transmutation',
  'greater_augmentation', 'perfect_augmentation',
  'greater_regal', 'perfect_regal',
  'greater_exalted', 'perfect_exalted',
  'greater_chaos', 'perfect_chaos',
]);
// Abyssal bones are foreseeable too, but their preview is special: it shows the
// item gaining an UNREVEALED "Desecrated Modifier" line (the real mod is only
// chosen later at the Well of Souls). Using the bone consumes the Lock and opens
// the Well.
const FORESEEABLE_BONES = new Set(['preserved_cranium']);
function currencyLabel(currency) {
  if (ORB_VARIANTS[currency]) return ORB_VARIANTS[currency].label;
  const map = {
    transmutation: 'Orb of Transmutation', augmentation: 'Orb of Augmentation',
    alchemy: 'Orb of Alchemy', regal: 'Regal Orb', exalted: 'Exalted Orb',
    chaos: 'Chaos Orb', annulment: 'Orb of Annulment', divine: 'Divine Orb',
    vaal: 'Vaal Orb', fracturing: 'Fracturing Orb',
    preserved_cranium: 'Preserved Cranium',
    essence_abyss: 'Essence of the Abyss', essence_breach: 'Essence of the Breach',
  };
  return map[currency] || currency;
}

function getCorruptionModalEl() {
  let modal = document.getElementById('corruption-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'corruption-modal';
    modal.className = 'corruption-modal';
    modal.innerHTML =
      '<div class="cm-box">' +
      '<div class="cm-title">Hinekora\'s Lock \u2014 Foreseen Outcome</div>' +
      '<div class="cm-sub">Hinekora\'s Lock reveals what the Vaal Orb will do before you commit. The outcome is sealed \u2014 apply it or cancel.</div>' +
      '<div class="cm-options"></div>' +
      '</div>';
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeCorruptionChoice(); });
  }
  return modal;
}

function openCorruptionChoice() {
  if (engine.getItem().corrupted) {
    showError('Item is corrupted and cannot be modified.');
    return;
  }
  const modal = getCorruptionModalEl();
  const wrap = modal.querySelector('.cm-options');
  wrap.innerHTML = '';

  // Hinekora's Lock does NOT let the player pick the result — it foresees it.
  // Roll one valid outcome now, reveal it, and let the player either apply
  // that sealed corruption or cancel (which keeps the Lock intact).
  const opts = engine.vaalOutcomeOptions();
  const foreseen = opts[Math.floor(Math.random() * opts.length)].key;
  const info = VAAL_CHOICES[foreseen] || { title: foreseen, desc: '' };

  const preview = document.createElement('div');
  preview.className = 'cm-foreseen ' + (foreseen === 'enchant' ? 'cm-sanctify' : 'cm-corrupt');
  preview.innerHTML =
    `<span class="cm-opt-title">${escapeHtml(info.title)}</span>` +
    `<span class="cm-opt-desc">${escapeHtml(info.desc)}</span>`;
  wrap.appendChild(preview);

  const apply = document.createElement('button');
  apply.type = 'button';
  apply.className = 'cm-option cm-corrupt cm-apply';
  apply.innerHTML =
    `<span class="cm-opt-title">Apply Corruption</span>` +
    `<span class="cm-opt-desc">Corrupt the jewel with the foreseen outcome.</span>`;
  apply.addEventListener('click', () => applyChosenCorruption(foreseen));
  wrap.appendChild(apply);

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'cm-option cm-cancel';
  cancel.innerHTML =
    `<span class="cm-opt-title">Cancel</span>` +
    `<span class="cm-opt-desc">Keep Hinekora's Lock and do nothing.</span>`;
  cancel.addEventListener('click', () => closeCorruptionChoice());
  wrap.appendChild(cancel);

  modal.style.display = 'flex';
}

function closeCorruptionChoice() {
  const modal = document.getElementById('corruption-modal');
  if (modal) modal.style.display = 'none';
}

// --- Hinekora's Lock: foresee the next currency on HOVER ----------------------
// Hovering a currency while the item is Locked previews that currency's sealed
// outcome directly on the item card (the engine is left untouched). Using
// (applying) any currency commits that exact sealed result and removes the
// Lock. There is no accept/cancel step \u2014 the Lock mark stays until a currency
// is actually used.
function computeForesight(currency) {
  // Apply to the engine, capture the result + resulting item, then roll the
  // engine back so nothing is actually committed. The captured outcome is
  // sealed and reused for both the preview and the eventual commit.
  const snapshot = engine.getItem();
  const result = applyCurrencyToEngine(currency);
  if (!result || !result.success) {
    engine.loadItem(snapshot);
    return { result };
  }
  const afterItem = engine.getItem();
  engine.loadItem(snapshot);
  return { result, afterItem };
}

// Desecration foresight is special: run the engine's desecration on a snapshot
// (which places an UNREVEALED "Desecrated Modifier" on the item), capture that
// item, then roll the engine back. The preview shows the original mods plus the
// hidden Desecrated line; the real roll happens when the bone is actually used.
function computeDesecrationForesight(bone) {
  if (!desecData) {
    return { result: { success: false, error: 'Desecrated modifier data is not available.' } };
  }
  const snapshot = engine.getItem();
  const res = engine.startDesecration({ bone, omens: Array.from(selectedOmens) });
  if (!res || !res.success) { engine.loadItem(snapshot); return { result: res }; }
  const afterItem = engine.getItem();
  engine.loadItem(snapshot); // roll back the placed mod + pending desecration
  return { result: res, afterItem };
}

function previewForesight(currency) {
  if (!currency) return;
  if (!engine.getItem().hinekoraLocked) return;
  const isBone = FORESEEABLE_BONES.has(currency);
  if (!isBone && !FORESEEABLE.has(currency)) return;
  if (!foreseenSeals[currency]) {
    foreseenSeals[currency] = isBone
      ? computeDesecrationForesight(currency)
      : computeForesight(currency);
  }
  const seal = foreseenSeals[currency];
  foreseenHover = currency;
  if (!seal.afterItem) {
    showForeseenBanner(currency, false); // would do nothing
    return;
  }
  renderItem(seal.result, seal.afterItem); // overrideItem keeps the engine untouched
  showForeseenBanner(currency, true);
}

function clearForesightPreview() {
  if (foreseenHover === null) return;
  foreseenHover = null;
  hideForeseenBanner();
  renderItem(); // restore the real, still-Locked item
}

function commitForesight(currency) {
  const seal = foreseenSeals[currency] || computeForesight(currency);
  if (!seal.afterItem) {
    playSound('error');
    triggerErrorAnimation();
    showError((seal.result && seal.result.error) || 'Nothing to foresee.');
    return;
  }
  const before = engine.getItem();
  pushUndo(before);
  engine.loadItem(seal.afterItem);   // commit the exact sealed outcome
  engine.recordCurrencyUse(currency);
  consumeCraftOmen(currency);
  engine.clearHinekoraLock();        // "The Lock is removed when this item is modified."
  if (currency === 'annulment' && omenOfLightActive) {
    omenOfLightActive = false;
    const lb = Array.from(elements.omenBtns).find(b => b.dataset.omen === 'omen_of_light');
    if (lb) lb.classList.remove('active');
  }
  foreseenSeals = {};
  foreseenHover = null;
  hideForeseenBanner();
  playSound(currency);
  triggerCraftAnimation(currency);
  disarmCurrency();
  renderItem();
}

function showForeseenBanner(currency, ok) {
  const content = elements.tooltip.querySelector('.tooltip-content') || elements.tooltip;
  let banner = document.getElementById('foreseen-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'foreseen-banner';
    banner.className = 'foreseen-banner';
    content.insertBefore(banner, content.firstChild);
  }
  banner.textContent = ok
    ? `FORESEEN \u2014 ${currencyLabel(currency)}`
    : `${currencyLabel(currency)} would do nothing`;
  elements.tooltip.classList.toggle('foreseen-empty', !ok);
  elements.tooltip.classList.add('foreseen-preview');
}

function hideForeseenBanner() {
  const banner = document.getElementById('foreseen-banner');
  if (banner) banner.remove();
  elements.tooltip.classList.remove('foreseen-preview');
  elements.tooltip.classList.remove('foreseen-empty');
}

function applyChosenCorruption(key) {
  const before = engine.getItem();
  const result = engine.applyVaal(VAAL_OUTCOME_NUM[key]);
  if (result.success) {
    pushUndo(before);
    engine.recordCurrencyUse('vaal');
    engine.clearHinekoraLock();
    playSound('vaal');
    triggerCraftAnimation('vaal');
    renderItem(result);
    disarmCurrency();
  } else {
    playSound('error');
    triggerErrorAnimation();
    showError(result.error);
  }
  closeCorruptionChoice();
}

function renderCraftCounter(item) {
  if (!elements.craftCounter) return;
  const used = item.currencyUsed || {};
  const entries = Object.entries(used).filter(([, n]) => n > 0);
  const total = entries.reduce((sum, [, n]) => sum + n, 0);
  if (total === 0) {
    elements.craftCounter.style.display = 'none';
    elements.craftCounter.innerHTML = '';
    return;
  }
  const ABBR = {
    transmutation: 'Trans', augmentation: 'Aug', alchemy: 'Alch', regal: 'Regal',
    exalted: 'Exalt', chaos: 'Chaos', annulment: 'Annul', divine: 'Divine',
    fracturing: 'Frac', vaal: 'Vaal', hinekora: 'Lock',
    preserved_cranium: 'Bone', sinistral_necromancy: 'Sin', dextral_necromancy: 'Dex',
    abyssal_echoes: 'Echo', omen_of_light: 'Light',
    essence_abyss: 'EAby', essence_breach: 'EBrc',
    omen_of_the_sovereign: 'Sov', omen_of_the_liege: 'Lige', omen_of_the_blackblooded: 'Blk',
  };
  const NAMES = {
    preserved_cranium: 'Preserved Cranium', sinistral_necromancy: 'Sinistral Necromancy',
    dextral_necromancy: 'Dextral Necromancy', abyssal_echoes: 'Abyssal Echoes',
    omen_of_light: 'Omen of Light',
    essence_abyss: 'Essence of the Abyss', essence_breach: 'Essence of the Breach',
    omen_of_the_sovereign: 'Omen of the Sovereign', omen_of_the_liege: 'Omen of the Liege', omen_of_the_blackblooded: 'Omen of the Blackblooded',
  };
  const chips = entries
    .map(([k, n]) =>
      `<div class="cc-chip" title="${escapeHtml(NAMES[k] || capitalize(k))}: ${n} used">` +
        `<span class="currency-icon ${k}-icon cc-icon">` +
          `<span class="currency-abbr">${escapeHtml(ABBR[k] || capitalize(k))}</span>` +
        `</span>` +
        `<span class="cc-count">${n}\u00d7</span>` +
      `</div>`)
    .join('');
  elements.craftCounter.style.display = 'block';
  elements.craftCounter.innerHTML =
    `<span class="cc-total">${total} currenc${total === 1 ? 'y' : 'ies'} used</span>` +
    `<div class="cc-chips">${chips}</div>`;
  entries.forEach(([k]) => {
    const iconEl = elements.craftCounter.querySelector(`.cc-icon.${k}-icon`);
    if (iconEl) loadIconInto(iconEl, k);
  });
}

// ============================================================
//  MAGIC ITEM NAMING (PoE2-style)
// ============================================================
// PoE2 names a Magic item as: [prefix word] + BaseType + [of suffix phrase],
// e.g. 'Burning Ruby of the Salamander'. Each affix contributes a short flavour
// word chosen from its THEME -- never its raw stat text. This data only stores
// stat-group descriptors (mod.name / mod.modGroup / mod.modLine), so the flavour
// word is derived by matching theme keywords against those. First match wins, so
// list specific themes before generic ones. To retheme, edit word / phrase below;
// to add a theme, add an entry with the lower-case keywords to match.
const MAGIC_PREFIX_WORDS = [
  { keys: ['totem'],                      word: 'Totemic' },
  { keys: ['minion'],                     word: 'Commanding' },
  { keys: ['banner'],                     word: 'Heraldic' },
  { keys: ['warcry'],                     word: 'Bellowing' },
  { keys: ['rage'],                       word: 'Raging' },
  { keys: ['bleed', 'bleeding'],          word: 'Serrated' },
  { keys: ['ignite', 'flammability'],     word: 'Smouldering' },
  { keys: ['fire'],                       word: 'Burning' },
  { keys: ['cold', 'frost'],              word: 'Frosted' },
  { keys: ['lightning', 'shock'],         word: 'Sparking' },
  { keys: ['elemental'],                  word: 'Prismatic' },
  { keys: ['chaos'],                      word: 'Polluted' },
  { keys: ['armour', 'armor'],            word: 'Reinforced' },
  { keys: ['block'],                      word: 'Bastion' },
  { keys: ['shield'],                     word: 'Warding' },
  { keys: ['thorns'],                     word: 'Spiked' },
  { keys: ['area of effect', 'presence'], word: 'Expansive' },
  { keys: ['mace'],                       word: 'Crushing' },
  { keys: ['melee'],                      word: 'Bladed' },
  { keys: ['attack'],                     word: 'Fierce' },
  { keys: ['physical'],                   word: 'Honed' },
  { keys: ['incision'],                   word: 'Lacerating' },
  { keys: ['shapeshift', 'plant', 'damage form'], word: 'Feral' },
  { keys: ['damage'],                     word: 'Vicious' },
];
const MAGIC_SUFFIX_PHRASES = [
  { keys: ['totem'],                      phrase: 'of the Totem' },
  { keys: ['minion'],                     phrase: 'of Servitude' },
  { keys: ['banner', 'glory', 'valour'],  phrase: 'of the Herald' },
  { keys: ['warcry'],                     phrase: 'of Command' },
  { keys: ['rage'],                       phrase: 'of Fury' },
  { keys: ['bleed', 'bleeding'],          phrase: 'of Haemorrhage' },
  { keys: ['ignite', 'flammability'],     phrase: 'of Flames' },
  { keys: ['fire'],                       phrase: 'of the Salamander' },
  { keys: ['cold', 'frost'],              phrase: 'of the Glacier' },
  { keys: ['lightning', 'shock'],         phrase: 'of the Storm' },
  { keys: ['chaos'],                      phrase: 'of the Plague' },
  { keys: ['resist'],                     phrase: 'of Warding' },
  { keys: ['stun'],                       phrase: 'of Stability' },
  { keys: ['knockback'],                  phrase: 'of Repulsion' },
  { keys: ['leech'],                      phrase: 'of the Leech' },
  { keys: ['regeneration', 'regen'],      phrase: 'of Renewal' },
  { keys: ['life'],                       phrase: 'of Vitality' },
  { keys: ['mana'],                       phrase: 'of the Mind' },
  { keys: ['duration'],                   phrase: 'of Lingering' },
  { keys: ['speed', 'cooldown'],          phrase: 'of Haste' },
  { keys: ['mace'],                       phrase: 'of the Brute' },
  { keys: ['shapeshift', 'plant'],        phrase: 'of the Beast' },
  { keys: ['damage'],                     phrase: 'of Ruin' },
];

function magicModHaystack(mod) {
  if (!mod) return '';
  return [mod.modGroup, mod.name, mod.displayText, mod.modLine]
    .filter(Boolean).join(' ').toLowerCase();
}

function pickMagicWord(table, mod, field) {
  const hay = magicModHaystack(mod);
  if (!hay) return '';
  for (const entry of table) {
    if (entry.keys.some(k => hay.includes(k))) return entry[field];
  }
  return '';
}

// Compose a PoE2-style Magic name from the item's (at most one) prefix and
// suffix. Falls back to the bare base name if neither affix yields a word.
function buildMagicName(item) {
  const base = item.baseName;
  const prefixMod = (item.prefixes || []).find(m => !m.unrevealed);
  const suffixMod = (item.suffixes || []).find(m => !m.unrevealed);
  const lead = prefixMod ? pickMagicWord(MAGIC_PREFIX_WORDS, prefixMod, 'word') : '';
  const tail = suffixMod ? pickMagicWord(MAGIC_SUFFIX_PHRASES, suffixMod, 'phrase') : '';
  return [lead, base, tail].filter(Boolean).join(' ') || base;
}

function renderItem(actionResult = null, overrideItem = null) {
  const item = overrideItem || engine.getItem();
  const realCorrupted = overrideItem ? engine.getItem().corrupted : item.corrupted;
  const realSanctified = overrideItem ? engine.getItem().sanctified : item.sanctified;
  const realLocked = realCorrupted || realSanctified;

  elements.tooltip.className = `tooltip rarity-${item.rarity} ${item.corrupted ? 'corrupted' : ''} ${item.sanctified ? 'sanctified' : ''}`;

  // Item display name, following PoE2 conventions:
  //  - Normal: just the base name (e.g. 'Ruby').
  //  - Magic:  [prefix word] + base + [of suffix phrase], e.g.
  //    'Burning Ruby of the Salamander'. The flavour words come from each
  //    affix's THEME via buildMagicName() -- never the raw stat-group text,
  //    which is what produced the old stat-dump titles.
  //  - Rare:   the engine's generated two-word name (e.g. 'Brood Star').
  let fullName = item.baseName;
  if (item.rarity === 'rare') {
    fullName = item.name || item.baseName;
  } else if (item.rarity === 'magic') {
    fullName = buildMagicName(item);
  }
  elements.itemName.textContent = fullName;

  // --- PoE2-style header extras: base type + item class ---
  const tipHeader = elements.itemName.parentNode;
  if (tipHeader) {
    let baseEl = document.getElementById('item-base');
    if (!baseEl) {
      baseEl = document.createElement('span');
      baseEl.id = 'item-base';
      baseEl.className = 'item-base';
      tipHeader.appendChild(baseEl);
    }
    let classEl = document.getElementById('item-class');
    if (!classEl) {
      classEl = document.createElement('span');
      classEl.id = 'item-class';
      classEl.className = 'item-class';
      classEl.textContent = 'Jewel';
      tipHeader.appendChild(classEl);
    }
    const jt = currentJewelType || 'ruby';
    // Show the small base-type subtitle ONLY for Rare items, whose generated
    // name does not contain the base. Magic names already include the base
    // ('Burning Ruby of the Salamander') and Normal items ARE the base, so a
    // subtitle there would just duplicate it (the old 'Ruby / Ruby').
    if (item.rarity === 'rare') {
      baseEl.textContent = jt.charAt(0).toUpperCase() + jt.slice(1);
      baseEl.style.display = 'block';
    } else {
      baseEl.style.display = 'none';
    }
  }

  if (elements.itemLevel) {
    updateIlvlUI(item.ilvl);
  }

  const allMods = [
    ...item.prefixes.map(m => ({ ...m, type: 'prefix' })),
    ...item.suffixes.map(m => ({ ...m, type: 'suffix' })),
  ];

  if (allMods.length === 0) {
    elements.modList.innerHTML = '<div class="mod-line mod-empty">No modifiers</div>';
  } else {
    const frag = document.createDocumentFragment();
    allMods.forEach(mod => {
      const isPrefix = mod.type === 'prefix';
      // PoE2 affix tag = side + modifier TIER (e.g. P1 = a tier-1 prefix).
      // Show just P/S normally; reveal the tier number (and the unrevealed "?")
      // only in the Alt inspect/detail view.
      const affixLabel = (isPrefix ? 'P' : 'S') + (showDetails ? (mod.unrevealed ? '?' : mod.tier) : '');

      const line = document.createElement('div');
      line.className = 'mod-line';
      if (mod.fractured) line.classList.add('fractured-mod');
      if (mod.desecrated) line.classList.add('desecrated-mod');
      if (mod.unrevealed) line.classList.add('unrevealed-mod');

      if (actionResult && actionResult.addedMods &&
          actionResult.addedMods.some(m => m.modGroup && m.modGroup === mod.modGroup)) {
        line.classList.add('mod-enter');
        // Freshly revealed desecrated mod gets a green highlight flash.
        if (mod.desecrated) line.classList.add('desec-reveal');
      }

      // Multi-stat desecrated mods expose a `lines` array; legacy single-stat
      // mods only have displayText + min/max. Support both.
      const multi = Array.isArray(mod.lines) && mod.lines.length > 0;
      const textHtml = multi
        ? mod.lines.map(l => escapeHtml(l.text)).join('<br>')
        : escapeHtml(mod.displayText);
      const rangeText = multi
        ? mod.lines.map(l => (l.min != null && l.max != null ? `[${l.min}-${l.max}]` : '[—]')).join(' ')
        : `[${mod.min}-${mod.max}]`;

      // P#/S# affix tag (blue prefix, red suffix) pinned to the left.
      const affixTag =
        `<span class="affix-tag ${isPrefix ? 'prefix' : 'suffix'}">${affixLabel}</span>`;

      if (showDetails) {
        line.innerHTML =
          affixTag +
          `<span class="mod-body"><span class="mod-meta">${rangeText}</span> ` +
          `<span class="mod-text">${textHtml}</span></span>`;
      } else {
        line.innerHTML = affixTag + `<span class="mod-body">${textHtml}</span>`;
        const hover = document.createElement('div');
        hover.className = 'mod-detail hover-detail';
        hover.textContent = `${isPrefix ? 'P' : 'S'}${mod.unrevealed ? '?' : mod.tier} ${rangeText}`;
        line.appendChild(hover);
      }
      frag.appendChild(line);
    });
    elements.modList.replaceChildren(frag);
  }

  if (item.enchantments.length > 0) {
    const frag = document.createDocumentFragment();
    item.enchantments.forEach(enc => {
      const line = document.createElement('div');
      line.className = 'enchant-line';
      line.textContent = enc;
      frag.appendChild(line);
    });
    elements.enchantList.replaceChildren(frag);
  } else {
    elements.enchantList.replaceChildren();
  }

  // Corrupted layout: the red "Corrupted" label takes the middle slot between
  // the two bottom rules, and the flavour text drops below the second rule.
  // When not corrupted, the flavour text sits in the middle between the rules.
  elements.corruptedLabel.style.display = item.corrupted ? 'block' : 'none';
  if (elements.sanctifiedLabel) elements.sanctifiedLabel.style.display = item.sanctified ? 'block' : 'none';
  const flavorEl = document.getElementById('item-flavor');
  const sepC = document.getElementById('sep-c');
  if (flavorEl && sepC) {
    if (item.corrupted) sepC.after(flavorEl);
    else sepC.before(flavorEl);
  }

  // Keep the Reveal panel in sync with the REAL item: it is visible only while an
  // unrevealed Desecrated modifier is still pending. If a currency (e.g. Orb of
  // Annulment) stripped the pending modifier, drop the stale desecration state
  // too. Skip during foresight previews (overrideItem), which must never mutate
  // real reveal state.
  if (!overrideItem) {
    const hasPendingReveal =
      item.prefixes.some(m => m.unrevealed) || item.suffixes.some(m => m.unrevealed);
    if (hasPendingReveal && desecState) {
      showRevealPanel();
    } else {
      if (!hasPendingReveal) desecState = null;
      hideRevealPanel();
    }
  }

  elements.currencyBtns.forEach(btn => {
    if (realLocked) {
      btn.classList.add('disabled');
      btn.style.opacity = '0.3';
      btn.style.pointerEvents = 'none';
    } else {
      btn.classList.remove('disabled');
      btn.style.opacity = '1';
      btn.style.pointerEvents = 'auto';
    }
  });

  // Omen of Light makes the next Annulment remove ONLY a Desecrated modifier,
  // so when the item has no Desecrated mod, Annulment can't do anything — block it.
  const hasDesecratedMod =
    item.prefixes.some(m => m.desecrated) || item.suffixes.some(m => m.desecrated);
  const annulBtn = Array.from(elements.currencyBtns).find(b => b.dataset.currency === 'annulment');
  if (annulBtn && !realLocked) {
    if (omenOfLightActive && !hasDesecratedMod) {
      annulBtn.classList.add('disabled');
      annulBtn.style.opacity = '0.3';
      annulBtn.style.pointerEvents = 'none';
      annulBtn.title = 'Omen of Light active — no Desecrated modifier to remove';
      if (armedCurrency === 'annulment') disarmCurrency();
    } else {
      annulBtn.title = 'Orb of Annulment — Remove a mod';
    }
  }

  // Once an item carries a Desecrated modifier it cannot be desecrated again,
  // so grey out the bone button (the engine also blocks it defensively).
  // NOTE: the unrevealed Mark of the Abyssal Lord (added by Essence of the
  // Abyss) also carries `desecrated: true`, but it must NOT count as
  // already-desecrated — desecrating is exactly how the Mark gets consumed.
  const alreadyDesecrated =
    item.prefixes.some(m => m.desecrated && !m.mark) || item.suffixes.some(m => m.desecrated && !m.mark);
  const desecDisabled = realLocked || !desecData || alreadyDesecrated || item.rarity !== 'rare';
  elements.boneBtns.forEach(b => {
    b.disabled = desecDisabled;
    b.classList.toggle('disabled', desecDisabled);
  });
  elements.omenBtns.forEach(b => {
    // Omen of Light (Annulment) and Abyssal Echoes (reroll at reveal) stay usable
    // even after the item already carries a Desecrated modifier; the directional
    // reveal omens do not.
    const alwaysUsable = b.dataset.omen === 'omen_of_light' || b.dataset.omen === 'abyssal_echoes';
    // Abyssal Omens (Sovereign / Liege / Blackblooded) force the item type's
    // special Lich Desecrated mod group, which jewels do not have \u2014 disabled
    // until non-jewel bases are added.
    const jewelUnsupported = b.dataset.jewelDisabled === 'true';
    const omenDisabled = realLocked || jewelUnsupported || (!alwaysUsable && (alreadyDesecrated || item.rarity !== 'rare'));
    b.disabled = omenDisabled;
    b.classList.toggle('disabled', omenDisabled);
  });

  // Essences: Essence of the Abyss needs a Rare item with a removable mod and no
  // existing Mark; Essence of the Breach has no jewel effect (disabled for now).
  if (elements.essenceBtns && elements.essenceBtns.length) {
    const hasRemovable = item.prefixes.concat(item.suffixes).some(m => !m.fractured);
    const hasMark = item.prefixes.some(m => m.mark) || item.suffixes.some(m => m.mark);
    elements.essenceBtns.forEach(b => {
      const key = b.dataset.currency;
      let dis = realLocked;
      if (key === 'essence_breach') dis = true;
      else if (key === 'essence_abyss') dis = dis || item.rarity !== 'rare' || !hasRemovable || hasMark;
      b.disabled = dis;
      b.classList.toggle('disabled', dis);
    });
  }

  // Crafting omens require a Rare, unlocked item (their currencies are Chaos /
  // Annulment / Divine, all Rare-only in this sim).
  if (elements.craftOmenBtns && elements.craftOmenBtns.length) {
    const coDisabled = realLocked || item.rarity !== 'rare';
    elements.craftOmenBtns.forEach(b => {
      b.disabled = coDisabled;
      b.classList.toggle('disabled', coDisabled);
    });
    if (coDisabled && selectedCraftOmen) clearCraftOmen();
  }

  if (actionResult && actionResult.previousRarity && actionResult.previousRarity !== item.rarity) {
    elements.tooltip.style.animation = 'none';
    void elements.tooltip.offsetHeight;
    elements.tooltip.style.animation = 'rarityShift 0.5s ease';
  }

  if (elements.hinekoraMark) {
    elements.hinekoraMark.style.display = item.hinekoraLocked ? 'flex' : 'none';
  }

  renderCraftCounter(item);
  updateUndoButton();
  updateRedoButton();
}

function triggerCraftAnimation(currency) {
  const color = (CURRENCIES[currency] && CURRENCIES[currency].color) || DEFAULT_ORB_COLOR;
  elements.craftGlow.style.background = `radial-gradient(circle, ${color} 0%, transparent 60%)`;
  elements.craftGlow.classList.remove('active');
  void elements.craftGlow.offsetWidth;
  elements.craftGlow.classList.add('active');
}

function triggerErrorAnimation() {
  elements.tooltip.classList.remove('error-shake');
  void elements.tooltip.offsetWidth;
  elements.tooltip.classList.add('error-shake');
  setTimeout(() => elements.tooltip.classList.remove('error-shake'), 400);
}

let toastTimeout;
function showError(msg) {
  elements.errorToast.textContent = msg;
  elements.errorToast.classList.add('visible');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => elements.errorToast.classList.remove('visible'), 3000);
}

function loadStash() {
  try {
    const saved = localStorage.getItem('poe2_stash');
    if (saved) {
      stash = JSON.parse(saved);
      if (!Array.isArray(stash)) stash = [];
    }
  } catch (e) {
    console.error('Failed to load stash', e);
    stash = [];
  }
  // Always render so the grid (and its drop targets) exists even when empty.
  renderStash();
}

function saveToStash() {
  if (stash.length >= 24) {
    showError('Stash is full (24 limit). Right-click a jewel to remove it.');
    return;
  }
  const item = engine.getItem();
  // Preserve any in-progress (unrevealed) desecration so a saved item can be
  // resumed after it is loaded back. The unrevealed placeholder lives on the
  // item itself, but the pending reveal options (and the UI reveal state) live
  // outside it -- without saving them the placeholder would be stuck unrevealable.
  const pending = engine.getPendingDesecration();
  if (pending) item._pendingDesecration = pending;
  if (desecState) item._desecState = structuredClone(desecState);
  stash.push(item);
  localStorage.setItem('poe2_stash', JSON.stringify(stash));
  renderStash();
  playSound('transmutation');
}

function loadFromStash(index) {
  const saved = stash[index];
  if (!saved) return;

  elements.jewelBtns.forEach(b => {
    const match = b.dataset.type === saved.jewelType;
    b.classList.toggle('active', match);
    if (match) currentJewelType = saved.jewelType;
  });

  engine = new CraftingEngine(modData, saved.jewelType, desecData);

  // Restore a saved in-progress desecration (the unrevealed placeholder plus its
  // pending reveal options) so a stashed reveal can be resumed. Strip the
  // stash-only bookkeeping fields before handing the item to the engine so they
  // don't leak onto the live item.
  const pending = saved._pendingDesecration || null;
  const savedDesecState = saved._desecState || null;
  const item = structuredClone(saved);
  delete item._pendingDesecration;
  delete item._desecState;

  engine.loadItem(item, pending);
  undoStack = [];
  redoStack = [];
  disarmCurrency();
  resetOmenState();
  clearDesecration();
  // Re-show the Reveal panel (via renderItem) when an unrevealed desecration was
  // restored; set desecState AFTER clearDesecration, mirroring restoreSnapshot.
  desecState = savedDesecState;
  renderItem();
  playSound('regal');
}

function removeFromStash(index) {
  stash.splice(index, 1);
  localStorage.setItem('poe2_stash', JSON.stringify(stash));
  renderStash();
  playSound('annulment');
}

function renderStash() {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < 24; i++) {
    const slot = document.createElement('div');
    slot.className = 'stash-slot';

    if (i < stash.length) {
      const item = stash[i];
      slot.classList.add('filled');
      slot.classList.add(`rarity-${item.rarity}`);
      if (item.corrupted) slot.classList.add('corrupted');
      slot.draggable = true;

      // Jewel icon: use the real PNG (assets/icons/<type>.png) when present,
      // falling back to the coloured dot if the image is missing.
      const dot = document.createElement('div');
      dot.className = `jewel-dot ${item.jewelType}`;
      const img = new Image();
      img.className = 'stash-img';
      img.alt = '';
      img.addEventListener('load', () => slot.classList.add('has-real-icon'));
      img.addEventListener('error', () => img.remove());
      img.src = `assets/icons/${iconFileFor(item.jewelType)}.png`;
      dot.appendChild(img);
      slot.appendChild(dot);

      const modCount = item.prefixes.length + item.suffixes.length;
      if (modCount > 0) {
        const badge = document.createElement('span');
        badge.className = 'stash-badge';
        badge.textContent = modCount;
        slot.appendChild(badge);
      }

      // Visible delete button (in addition to right-click).
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'stash-del';
      del.textContent = '×';
      del.title = 'Delete';
      del.addEventListener('click', (e) => { e.stopPropagation(); removeFromStash(i); });
      slot.appendChild(del);

      slot.title = `${item.baseName} (${item.rarity})\n${modCount} mods\nLeft-click to load \u00b7 Drag to move \u00b7 Right-click to delete`;
      slot.addEventListener('click', () => loadFromStash(i));
      slot.addEventListener('contextmenu', (e) => { e.preventDefault(); removeFromStash(i); });

      slot.addEventListener('dragstart', (e) => {
        dragIndex = i;
        slot.classList.add('dragging');
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      });
      slot.addEventListener('dragend', () => { slot.classList.remove('dragging'); });
    }

    // Any slot is a valid drop target; dropping past the end moves to the end.
    slot.addEventListener('dragover', (e) => {
      if (dragIndex === null) return;
      e.preventDefault();
      slot.classList.add('drag-over');
    });
    slot.addEventListener('dragleave', () => slot.classList.remove('drag-over'));
    slot.addEventListener('drop', (e) => {
      e.preventDefault();
      slot.classList.remove('drag-over');
      if (dragIndex === null) return;
      moveStash(dragIndex, i);
      dragIndex = null;
    });

    frag.appendChild(slot);
  }
  elements.stashGrid.replaceChildren(frag);
}

function moveStash(from, to) {
  if (from === to || from < 0 || from >= stash.length) return;
  const target = Math.min(to, stash.length - 1);
  const [moved] = stash.splice(from, 1);
  stash.splice(target, 0, moved);
  localStorage.setItem('poe2_stash', JSON.stringify(stash));
  renderStash();
  playSound('transmutation');
}

document.addEventListener('DOMContentLoaded', init);
})();