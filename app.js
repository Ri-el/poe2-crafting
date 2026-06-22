// app.js - PoE2 Jewel Crafting UI Controller
import CraftingEngine from './crafting.js';

const CURRENCIES = {
  transmutation: { color: '#6888c8' },
  augmentation: { color: '#88aaff' },
  alchemy: { color: '#c8a848' },
  regal: { color: '#6888c8' },
  exalted: { color: '#c8a848' },
  chaos: { color: '#c8a848' },
  annulment: { color: '#aaaaaa' },
  divine: { color: '#e8d898' },
  vaal: { color: '#c02040' },
  fracturing: { color: '#6fb0a8' },
  hinekora: { color: '#b061d6' }
};

let engine = null;
let currentJewelType = 'ruby';
let modData = null;
let armedCurrency = null;
let showDetails = false;
let stash = [];
let undoStack = [];

// DOM Elements
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
  hinekoraMark: document.getElementById('hinekora-mark')
};

// ── Initialization ──────────────────────────────────────────────────────

async function init() {
  try {
    const res = await fetch('data/jewel-mods.v2.json');
    if (!res.ok) throw new Error('Failed to load mod data');
    const text = await res.text();
    const cleanText = text.replace(/^\uFEFF/, '');
    modData = JSON.parse(cleanText);
    
    loadStash();
    preloadSounds();
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

// ── Real currency icons (assets/icons/<currency>.png) with CSS fallback ──

function setupCurrencyIcons() {
  elements.currencyBtns.forEach(btn => {
    const type = btn.dataset.currency;
    const iconEl = btn.querySelector('.currency-icon');
    if (!type || !iconEl) return;
    const img = new Image();
    img.className = 'currency-img';
    img.alt = '';
    img.addEventListener('load', () => iconEl.classList.add('has-real-icon'));
    img.addEventListener('error', () => img.remove());
    img.src = `assets/icons/${type}.png`;
    iconEl.appendChild(img);
  });

  // Purple "Hinekora's Lock applied" item mark (assets/icons/hinekora-mark.png, falls back to a glyph)
  loadIconInto(elements.hinekoraMark, 'hinekora-mark');
}

// Load a real icon image (assets/icons/<name>.png) into an element, adding
// `has-real-icon` on success so the CSS fallback glyph is hidden.
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

// ── Audio System (Web Audio API) ────────────────────────────────────────

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

// Real PoE audio (assets/sounds/<type>.mp3) with procedural fallback.
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
  if (soundReady[type] && soundFiles[type]) {
    try {
      const a = soundFiles[type];
      a.currentTime = 0;
      a.volume = 0.6;
      a.play().catch(() => playProceduralSound(type));
      return;
    } catch (e) { /* fall through to procedural */ }
  }
  playProceduralSound(type);
}

function playProceduralSound(type) {
  if (audioCtx.state === 'suspended') audioCtx.resume();
  
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  
  const now = audioCtx.currentTime;
  
  if (type === 'vaal') {
    // Deep corrupted rumble
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(80, now);
    osc.frequency.exponentialRampToValueAtTime(20, now + 0.3);
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
    osc.start(now);
    osc.stop(now + 0.3);
    
    // High overtone
    const osc2 = audioCtx.createOscillator();
    const gain2 = audioCtx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(800, now);
    osc2.frequency.linearRampToValueAtTime(400, now + 0.3);
    gain2.gain.setValueAtTime(0.1, now);
    gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
    osc2.connect(gain2);
    gain2.connect(audioCtx.destination);
    osc2.start(now);
    osc2.stop(now + 0.3);
    return;
  }

  // Standard orbs
  let freq = 400;
  let sweep = 800;
  let dur = 0.15;
  let oscType = 'sine';
  
  switch(type) {
    case 'transmutation': freq = 300; sweep = 600; break;
    case 'augmentation': freq = 400; sweep = 700; dur = 0.1; break;
    case 'alchemy': freq = 200; sweep = 800; oscType = 'triangle'; break;
    case 'regal': freq = 350; sweep = 750; oscType = 'triangle'; break;
    case 'exalted': freq = 600; sweep = 1200; dur = 0.25; break;
    case 'chaos': freq = 150; sweep = 300; oscType = 'sawtooth'; dur = 0.2; break;
    case 'annulment': freq = 800; sweep = 200; dur = 0.2; break;
    case 'divine': freq = 500; sweep = 1000; oscType = 'square'; dur = 0.2; break;
    case 'fracturing': freq = 520; sweep = 110; oscType = 'square'; dur = 0.18; break;
    case 'undo': freq = 300; sweep = 620; dur = 0.12; break;
    case 'reset': freq = 200; sweep = 100; dur = 0.1; break;
    case 'error': freq = 150; sweep = 120; oscType = 'sawtooth'; dur = 0.15; break;
  }
  
  osc.type = oscType;
  osc.frequency.setValueAtTime(freq, now);
  osc.frequency.exponentialRampToValueAtTime(sweep, now + dur);
  
  gain.gain.setValueAtTime(0.3, now);
  gain.gain.exponentialRampToValueAtTime(0.01, now + dur);
  
  osc.start(now);
  osc.stop(now + dur);
}

// ── Event Listeners ─────────────────────────────────────────────────────

function setupEventListeners() {
  // Disable default context menu
  document.addEventListener('contextmenu', e => e.preventDefault());

  // Jewel Type Selection
  elements.jewelBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      elements.jewelBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentJewelType = btn.dataset.type;
      disarmCurrency();
      createEngine(currentJewelType);
    });
  });

  // Currency Interaction
  elements.currencyBtns.forEach(btn => {
    // Desktop: Right-click
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      toggleCurrency(btn.dataset.currency);
    });
    // Mobile/Click fallback
    btn.addEventListener('click', (e) => {
      // If clicking already armed, disarm. Else arm.
      if (armedCurrency === btn.dataset.currency) {
        disarmCurrency();
      } else {
        toggleCurrency(btn.dataset.currency);
      }
    });
  });

  // Apply Currency to Item
  elements.tooltip.addEventListener('click', (e) => {
    if (!armedCurrency) return;
    
    // Prevent default to avoid double-firing on some devices
    e.preventDefault();
    
    // Hinekora's Lock: apply the mark to the item (no mod change).
    // The mark is consumed the next time any currency is used.
    if (armedCurrency === 'hinekora') {
      applyHinekoraLock();
      return;
    }
    
    const before = engine.getItem();
    const result = applyCurrencyToEngine(armedCurrency);
    
    if (result.success) {
      undoStack.push(before);
      if (undoStack.length > 50) undoStack.shift();
      engine.recordCurrencyUse(armedCurrency);
      // Using any currency consumes Hinekora's Lock — the mark disappears
      engine._item.hinekoraLocked = false;
      playSound(armedCurrency);
      triggerCraftAnimation(armedCurrency);
      renderItem(result);
      
      // If item became corrupted, disarm immediately
      if (result.item.corrupted) {
        disarmCurrency();
      }
    } else {
      playSound('error');
      triggerErrorAnimation();
      showError(result.error);
    }
  });

  // Reset Item
  elements.resetBtn.addEventListener('click', () => {
    undoStack.push(engine.getItem());
    if (undoStack.length > 50) undoStack.shift();
    engine.resetItem();
    disarmCurrency();
    playSound('reset');
    renderItem();
  });

  // Undo last action
  if (elements.undoBtn) {
    elements.undoBtn.addEventListener('click', undoLastAction);
  }

  // Save to Stash
  elements.saveBtn.addEventListener('click', () => {
    saveToStash();
  });

  // Alt key for details
  document.addEventListener('keydown', e => {
    if (e.key === 'Alt' && !showDetails) {
      showDetails = true;
      renderItem();
    }
    // Escape to disarm
    if (e.key === 'Escape') {
      disarmCurrency();
    }
  });
  
  document.addEventListener('keyup', e => {
    if (e.key === 'Alt') {
      showDetails = false;
      renderItem();
    }
  });

  // Mouse move for cursor orb
  document.addEventListener('mousemove', e => {
    if (armedCurrency) {
      elements.cursorOrb.style.left = e.clientX + 'px';
      elements.cursorOrb.style.top = e.clientY + 'px';
    }
  });

  // Hide the cursor orb when the pointer leaves the window (prevents a stray clipped orb)
  document.addEventListener('mouseleave', () => {
    elements.cursorOrb.style.opacity = '0';
  });
  document.addEventListener('mouseenter', () => {
    if (armedCurrency) elements.cursorOrb.style.opacity = '1';
  });
}

function applyCurrencyToEngine(currency, eng = engine) {
  switch(currency) {
    case 'transmutation': return eng.applyTransmutation();
    case 'augmentation': return eng.applyAugmentation();
    case 'alchemy': return eng.applyAlchemy();
    case 'regal': return eng.applyRegal();
    case 'exalted': return eng.applyExalted();
    case 'chaos': return eng.applyChaos();
    case 'annulment': return eng.applyAnnulment();
    case 'divine': return eng.applyDivine();
    case 'vaal': return eng.applyVaal();
    case 'fracturing': return eng.applyFracturing();
    default: return { success: false, error: 'Unknown currency' };
  }
}

// ── State Management ────────────────────────────────────────────────────

function toggleCurrency(currency) {
  if (engine.getItem().corrupted) {
    showError("Item is corrupted and cannot be modified.");
    return;
  }
  
  if (armedCurrency === currency) {
    disarmCurrency();
  } else {
    armCurrency(currency);
  }
}

function armCurrency(currency) {
  armedCurrency = currency;
  elements.currencyBtns.forEach(b => {
    if (b.dataset.currency === currency) {
      b.classList.add('armed');
    } else {
      b.classList.remove('armed');
    }
  });
  
  const color = CURRENCIES[currency].color;
  elements.cursorOrb.style.background = `radial-gradient(circle, ${color} 0%, transparent 70%)`;
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
  if (undoStack.length === 0) {
    showError('Nothing to undo.');
    return;
  }
  const prev = undoStack.pop();
  engine._item = structuredClone(prev);
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

// ── Hinekora's Lock — apply a mark that is consumed by the next currency ───────

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
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
  engine._item.hinekoraLocked = true;
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
    .map(([k, n]) => `<span class="cc-item">${capitalize(k)} <b>${n}</b></span>`)
    .join('');
  elements.craftCounter.style.display = 'block';
  elements.craftCounter.innerHTML =
    `<div class="cc-total">${total} currenc${total === 1 ? 'y' : 'ies'} used</div>` +
    `<div class="cc-breakdown">${breakdown}</div>`;
}

// ── Rendering ───────────────────────────────────────────────────────────

function renderItem(actionResult = null, overrideItem = null) {
  const item = overrideItem || engine.getItem();
  
  // Rarity classes
  elements.tooltip.className = `tooltip rarity-${item.rarity} ${item.corrupted ? 'corrupted' : ''}`;
  
  // Base name (includes jewel type)
  let fullName = item.baseName;
  
  // Rare naming logic (simplified placeholder names for rare jewels)
  if (item.rarity === 'rare') {
    // Rare items get a persistent two-word rare name (assigned by the engine)
    fullName = item.name || item.baseName;
  } else if (item.rarity === 'magic' && (item.prefixes.length > 0 || item.suffixes.length > 0)) {
    // Magic format: "{PrefixWord} {Base} {of SuffixWord}" using real affix words
    const p = item.prefixes.length > 0 ? (item.prefixes[0].tierName || '') : '';
    const s = item.suffixes.length > 0 ? (item.suffixes[0].tierName || '') : '';
    fullName = `${p} ${item.baseName} ${s}`.replace(/\s+/g, ' ').trim();
  }
  
  elements.itemName.textContent = fullName;
  
  // Render Mods
  elements.modList.innerHTML = '';
  
  const allMods = [
    ...item.prefixes.map(m => ({...m, type: 'prefix'})),
    ...item.suffixes.map(m => ({...m, type: 'suffix'}))
  ];
  
  if (allMods.length === 0) {
    elements.modList.innerHTML = '<div class="mod-line" style="opacity:0.3;">No modifiers</div>';
  } else {
    allMods.forEach(mod => {
      const line = document.createElement('div');
      line.className = 'mod-line';
      if (mod.fractured) line.classList.add('fractured-mod');
      
      // Animation class if newly added
      if (actionResult && actionResult.addedMods && actionResult.addedMods.some(m => m.modGroup === mod.modGroup)) {
        line.classList.add('new-mod');
      }
      
      if (showDetails) {
        line.innerHTML = `
          <div class="mod-detail">
            <span class="mod-tier">T${mod.tier} ${mod.type} (${mod.modGroup})</span>
            <span class="mod-range">[${mod.min} - ${mod.max}]</span>
          </div>
          <div class="mod-text">${mod.displayText}</div>
        `;
      } else {
        line.textContent = mod.displayText;
        
        // Hover details
        const hover = document.createElement('div');
        hover.className = 'mod-detail hover-detail';
        hover.innerHTML = `<span class="mod-tier">T${mod.tier} ${mod.type}</span> [${mod.min}-${mod.max}]`;
        line.appendChild(hover);
      }
      
      elements.modList.appendChild(line);
    });
  }

  // Render Enchantments (Vaal)
  elements.enchantList.innerHTML = '';
  if (item.enchantments.length > 0) {
    item.enchantments.forEach(enc => {
      const line = document.createElement('div');
      line.className = 'enchant-line';
      line.textContent = enc;
      elements.enchantList.appendChild(line);
    });
  }

  // Corrupted Label
  elements.corruptedLabel.style.display = item.corrupted ? 'block' : 'none';

  // Currency Buttons state (always based on the real item, not a foreseen preview)
  const realCorrupted = engine.getItem().corrupted;
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

  // Rarity transition animation
  if (actionResult && actionResult.previousRarity && actionResult.previousRarity !== item.rarity) {
    elements.tooltip.style.animation = 'none';
    elements.tooltip.offsetHeight; /* trigger reflow */
    elements.tooltip.style.animation = 'rarityShift 0.5s ease';
  }

  // Hinekora's Lock mark (purple emblem on items crafted via the Lock)
  if (elements.hinekoraMark) {
    elements.hinekoraMark.style.display = item.hinekoraLocked ? 'flex' : 'none';
  }

  // Currency-used counter (travels with the jewel)
  renderCraftCounter(item);

  updateUndoButton();
}

// ── Animations & Toast ──────────────────────────────────────────────────

function triggerCraftAnimation(currency) {
  const color = CURRENCIES[currency].color;
  elements.craftGlow.style.background = `radial-gradient(circle, ${color} 0%, transparent 60%)`;
  
  elements.craftGlow.classList.remove('active');
  void elements.craftGlow.offsetWidth; // reflow
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
  toastTimeout = setTimeout(() => {
    elements.errorToast.classList.remove('visible');
  }, 3000);
}

// ── Stash System ────────────────────────────────────────────────────────

function loadStash() {
  try {
    const saved = localStorage.getItem('poe2_stash');
    if (saved) {
      stash = JSON.parse(saved);
      renderStash();
    }
  } catch (e) {
    console.error("Failed to load stash", e);
  }
}

function saveToStash() {
  const item = engine.getItem();
  if (stash.length >= 24) {
    showError("Stash is full (24 limit). Right-click a jewel to remove it.");
    return;
  }
  
  // Clone current state
  stash.push(structuredClone(item));
  
  // Save
  localStorage.setItem('poe2_stash', JSON.stringify(stash));
  renderStash();
  playSound('transmutation'); // happy ding
}

function loadFromStash(index) {
  const item = stash[index];
  if (!item) return;
  
  // Update UI selector
  elements.jewelBtns.forEach(b => {
    if (b.dataset.type === item.jewelType) {
      b.classList.add('active');
      currentJewelType = item.jewelType;
    } else {
      b.classList.remove('active');
    }
  });
  
  // Create engine and overwrite item
  engine = new CraftingEngine(modData, item.jewelType);
  engine._item = structuredClone(item); // direct override for loading state
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
  elements.stashGrid.innerHTML = '';
  
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
        const countBadge = document.createElement('span');
        countBadge.style.position = 'absolute';
        countBadge.style.bottom = '2px';
        countBadge.style.right = '4px';
        countBadge.style.fontSize = '0.6rem';
        countBadge.style.color = '#fff';
        countBadge.textContent = modCount;
        slot.appendChild(countBadge);
      }
      
      slot.title = `${item.baseName} (${item.rarity})\n${modCount} mods\nLeft-click to load\nRight-click to delete`;
      
      slot.addEventListener('click', () => loadFromStash(i));
      slot.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        removeFromStash(i);
      });
    }
    
    elements.stashGrid.appendChild(slot);
  }
}

// ── Boot ────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
