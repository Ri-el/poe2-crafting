// app.js - PoE2 Jewel Crafting UI Controller
import CraftingEngine from './crafting.js';

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
};
const DEFAULT_ORB_COLOR = 'rgba(255,255,255,0.6)';

let engine = null;
let currentJewelType = 'ruby';
let modData = null;
let armedCurrency = null;
let showDetails = false;
let stash = [];
let undoStack = [];

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
  craftCounter: document.getElementById('craft-counter'),
  hinekoraMark: document.getElementById('hinekora-mark'),
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

async function init() {
  try {
    const res = await fetch('data/jewel-mods.v2.json');
    if (!res.ok) throw new Error('Failed to load mod data');
    const text = await res.text();
    modData = JSON.parse(text.replace(/^\uFEFF/, ''));

    loadStash();
    if (USE_SOUND_FILES) preloadSounds();
    setupCurrencyIcons();
    createEngine(currentJewelType);
    setupEventListeners();
  } catch (err) {
    showError('Error initializing simulator: ' + err.message);
  }
}

function createEngine(type) {
  engine = new CraftingEngine(modData, type);
  undoStack = [];
  renderItem();
}

function setupCurrencyIcons() {
  elements.currencyBtns.forEach(btn => {
    const type = btn.dataset.currency;
    const iconEl = btn.querySelector('.currency-icon');
    if (!type || !iconEl) return;
    loadIconInto(iconEl, type);
  });
  loadIconInto(elements.hinekoraMark, 'hinekora-mark');
}

function loadIconInto(iconEl, name) {
  if (!iconEl) return;
  const img = new Image();
  img.className = 'currency-img';
  img.alt = '';
  img.addEventListener('load', () => iconEl.classList.add('has-real-icon'));
  img.addEventListener('error', () => img.remove());
  img.src = `assets/icons/${name}.png`;
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
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      toggleCurrency(btn.dataset.currency);
    });
    btn.addEventListener('click', () => {
      if (armedCurrency === btn.dataset.currency) disarmCurrency();
      else toggleCurrency(btn.dataset.currency);
    });
  });

  elements.tooltip.addEventListener('click', (e) => {
    if (!armedCurrency) return;
    e.preventDefault();

    if (armedCurrency === 'hinekora') { applyHinekoraLock(); return; }

    const before = engine.getItem();
    const result = applyCurrencyToEngine(armedCurrency);

    if (result.success) {
      undoStack.push(before);
      if (undoStack.length > 50) undoStack.shift();
      engine.recordCurrencyUse(armedCurrency);
      engine.clearHinekoraLock();
      playSound(armedCurrency);
      triggerCraftAnimation(armedCurrency);
      renderItem(result);
      if (result.item.corrupted) disarmCurrency();
    } else {
      playSound('error');
      triggerErrorAnimation();
      showError(result.error);
    }
  });

  elements.resetBtn.addEventListener('click', () => {
    undoStack.push(engine.getItem());
    if (undoStack.length > 50) undoStack.shift();
    engine.resetItem();
    disarmCurrency();
    playSound('reset');
    renderItem();
  });

  if (elements.undoBtn) elements.undoBtn.addEventListener('click', undoLastAction);

  elements.saveBtn.addEventListener('click', saveToStash);

  document.addEventListener('keydown', e => {
    if (e.key === 'Alt' && !showDetails) { showDetails = true; renderItem(); }
    if (e.key === 'Escape') disarmCurrency();
  });
  document.addEventListener('keyup', e => {
    if (e.key === 'Alt') { showDetails = false; renderItem(); }
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
  switch (currency) {
    case 'transmutation': return eng.applyTransmutation();
    case 'augmentation':  return eng.applyAugmentation();
    case 'alchemy':       return eng.applyAlchemy();
    case 'regal':         return eng.applyRegal();
    case 'exalted':       return eng.applyExalted();
    case 'chaos':         return eng.applyChaos();
    case 'annulment':     return eng.applyAnnulment();
    case 'divine':        return eng.applyDivine();
    case 'vaal':          return eng.applyVaal();
    case 'fracturing':    return eng.applyFracturing();
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

function positionOrb() {
  elements.cursorOrb.style.transform =
    `translate3d(${lastMouseX}px, ${lastMouseY}px, 0) translate(-50%, -50%)`;
}

function armCurrency(currency) {
  armedCurrency = currency;
  elements.currencyBtns.forEach(b =>
    b.classList.toggle('armed', b.dataset.currency === currency));

  const color = (CURRENCIES[currency] && CURRENCIES[currency].color) || DEFAULT_ORB_COLOR;
  elements.cursorOrb.style.setProperty('--orb-color', color);
  elements.cursorOrb.style.background = `radial-gradient(circle, ${color} 0%, transparent 70%)`;
  positionOrb();
  elements.cursorOrb.style.opacity = '1';
  document.body.style.cursor = 'none';
  elements.tooltip.style.cursor = 'none';
}

function disarmCurrency() {
  armedCurrency = null;
  elements.currencyBtns.forEach(b => b.classList.remove('armed'));
  elements.cursorOrb.style.opacity = '0';
  document.body.style.cursor = 'default';
  elements.tooltip.style.cursor = 'pointer';
}

function undoLastAction() {
  if (undoStack.length === 0) { showError('Nothing to undo.'); return; }
  const prev = undoStack.pop();
  engine.loadItem(prev);
  disarmCurrency();
  playSound('undo');
  renderItem();
}

function updateUndoButton() {
  if (!elements.undoBtn) return;
  const empty = undoStack.length === 0;
  elements.undoBtn.disabled = empty;
  elements.undoBtn.classList.toggle('disabled', empty);
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
  undoStack.push(engine.getItem());
  if (undoStack.length > 50) undoStack.shift();
  engine.setHinekoraLock();
  disarmCurrency();
  playSound('hinekora');
  triggerCraftAnimation('hinekora');
  renderItem();
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
  const breakdown = entries
    .map(([k, n]) => `<span class="cc-item">${escapeHtml(capitalize(k))} ${n}</span>`)
    .join('');
  elements.craftCounter.style.display = 'block';
  elements.craftCounter.innerHTML =
    `<span class="cc-total">${total} currenc${total === 1 ? 'y' : 'ies'} used</span>` +
    `<span class="cc-breakdown">${breakdown}</span>`;
}

function renderItem(actionResult = null, overrideItem = null) {
  const item = overrideItem || engine.getItem();
  const realCorrupted = overrideItem ? engine.getItem().corrupted : item.corrupted;

  elements.tooltip.className = `tooltip rarity-${item.rarity} ${item.corrupted ? 'corrupted' : ''}`;

  let fullName = item.baseName;
  if (item.rarity === 'rare') {
    fullName = item.name || item.baseName;
  } else if (item.rarity === 'magic' && (item.prefixes.length > 0 || item.suffixes.length > 0)) {
    const p = item.prefixes.length > 0 ? (item.prefixes[0].tierName || '') : '';
    const s = item.suffixes.length > 0 ? (item.suffixes[0].tierName || '') : '';
    fullName = `${p} ${item.baseName} ${s}`.replace(/\s+/g, ' ').trim();
  }
  elements.itemName.textContent = fullName;

  const allMods = [
    ...item.prefixes.map(m => ({ ...m, type: 'prefix' })),
    ...item.suffixes.map(m => ({ ...m, type: 'suffix' })),
  ];

  if (allMods.length === 0) {
    elements.modList.innerHTML = '<div class="mod-line mod-empty">No modifiers</div>';
  } else {
    const frag = document.createDocumentFragment();
    allMods.forEach(mod => {
      const line = document.createElement('div');
      line.className = 'mod-line';
      if (mod.fractured) line.classList.add('fractured-mod');

      if (actionResult && actionResult.addedMods &&
          actionResult.addedMods.some(m => m.modGroup && m.modGroup === mod.modGroup)) {
        line.classList.add('mod-enter');
      }

      if (showDetails) {
        line.innerHTML =
          `<span class="mod-meta">T${mod.tier} ${mod.type} (${escapeHtml(mod.modGroup)}) ` +
          `[${mod.min} – ${mod.max}]</span> ` +
          `<span class="mod-text">${escapeHtml(mod.displayText)}</span>`;
      } else {
        line.textContent = mod.displayText;
        const hover = document.createElement('div');
        hover.className = 'mod-detail hover-detail';
        hover.textContent = `T${mod.tier} ${mod.type} [${mod.min}-${mod.max}]`;
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

  elements.corruptedLabel.style.display = item.corrupted ? 'block' : 'none';

  elements.currencyBtns.forEach(btn => {
    if (realCorrupted) {
      btn.classList.add('disabled');
      btn.style.opacity = '0.3';
      btn.style.pointerEvents = 'none';
    } else {
      btn.classList.remove('disabled');
      btn.style.opacity = '1';
      btn.style.pointerEvents = 'auto';
    }
  });

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
      renderStash();
    }
  } catch (e) {
    console.error('Failed to load stash', e);
    stash = [];
  }
}

function saveToStash() {
  const item = engine.getItem();
  if (stash.length >= 24) {
    showError('Stash is full (24 limit). Right-click a jewel to remove it.');
    return;
  }
  stash.push(structuredClone(item));
  localStorage.setItem('poe2_stash', JSON.stringify(stash));
  renderStash();
  playSound('transmutation');
}

function loadFromStash(index) {
  const item = stash[index];
  if (!item) return;

  elements.jewelBtns.forEach(b => {
    const match = b.dataset.type === item.jewelType;
    b.classList.toggle('active', match);
    if (match) currentJewelType = item.jewelType;
  });

  engine = new CraftingEngine(modData, item.jewelType);
  engine.loadItem(item);
  undoStack = [];
  disarmCurrency();
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
      slot.classList.add(`rarity-${item.rarity}`);
      if (item.corrupted) slot.classList.add('corrupted');

      const dot = document.createElement('div');
      dot.className = `jewel-dot ${item.jewelType}`;
      slot.appendChild(dot);

      const modCount = item.prefixes.length + item.suffixes.length;
      if (modCount > 0) {
        const badge = document.createElement('span');
        badge.style.cssText = 'position:absolute;bottom:2px;right:4px;font-size:0.6rem;color:#fff;';
        badge.textContent = modCount;
        slot.appendChild(badge);
      }

      slot.title = `${item.baseName} (${item.rarity})\n${modCount} mods\nLeft-click to load\nRight-click to delete`;
      slot.addEventListener('click', () => loadFromStash(i));
      slot.addEventListener('contextmenu', (e) => { e.preventDefault(); removeFromStash(i); });
    }
    frag.appendChild(slot);
  }
  elements.stashGrid.replaceChildren(frag);
}

document.addEventListener('DOMContentLoaded', init);
