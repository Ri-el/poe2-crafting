(function () { "use strict";
// ============================================================
//  Item Category Selection Screen
//
//  Icons auto-load from /assets/icons/<icon>.png. Until a PNG
//  exists, a glyph fallback is shown. Just drop files named
//  exactly as the `icon` fields below and they appear.
//
//  Naming pattern for attribute variants: <base>_<attr>.png
//  e.g. gloves_str.png, gloves_str_dex.png, body_armours_str_dex_int.png
//
//  ALL BASES RELEASED: every category is playable. Clicking a simple
//  category loads that base's mod pool directly; an armour category
//  with attribute variants opens its variant grid, and each variant
//  loads its own base (e.g. gloves_str). Jewels are special -- they
//  enter the jewel crafter and use the in-craft Ruby/Sapphire/Emerald
//  header selector to swap sub-bases.
// ============================================================

const ATTR_LABELS = {
  str: 'Str',
  dex: 'Dex',
  int: 'Int',
  str_dex: 'Str / Dex',
  str_int: 'Str / Int',
  dex_int: 'Dex / Int',
  str_dex_int: 'Str / Dex / Int',
};

const ARMOUR_ATTRS = ['str', 'dex', 'int', 'str_dex', 'str_int', 'dex_int'];
const BODY_ATTRS = ['str', 'dex', 'int', 'str_dex', 'str_int', 'dex_int', 'str_dex_int'];
const SHIELD_ATTRS = ['str', 'str_dex', 'str_int'];

// Build attribute variants for a base item. Each variant id matches a compiled
// base file in data/bases (e.g. gloves_str.json -> id 'gloves_str').
function variants(base, attrs) {
  return attrs.map((a) => ({
    id: base + '_' + a,
    name: ATTR_LABELS[a],
    icon: base + '_' + a,
    bestBase: '',
  }));
}

const CATEGORIES = [
  {
    group: 'Jewels',
    items: [
      { id: 'jewels', name: 'Jewels', icon: 'jewels', status: 'active' },
    ],
  },
  {
    group: 'Jewellery',
    items: [
      { id: 'amulets', name: 'Amulets', icon: 'amulets', status: 'active' },
      { id: 'rings', name: 'Rings', icon: 'rings', status: 'active' },
      { id: 'belts', name: 'Belts', icon: 'belts', status: 'active' },
    ],
  },
  {
    group: 'Armour',
    items: [
      { id: 'gloves', name: 'Gloves', icon: 'gloves', status: 'active', variants: variants('gloves', ARMOUR_ATTRS) },
      { id: 'boots', name: 'Boots', icon: 'boots', status: 'active', variants: variants('boots', ARMOUR_ATTRS) },
      { id: 'body_armours', name: 'Body Armours', icon: 'body_armours', status: 'active', variants: variants('body_armours', BODY_ATTRS) },
      { id: 'helmets', name: 'Helmets', icon: 'helmets', status: 'active', variants: variants('helmets', ARMOUR_ATTRS) },
    ],
  },
  {
    group: 'Off-hand',
    items: [
      { id: 'quivers', name: 'Quivers', icon: 'quivers', status: 'active' },
      { id: 'shields', name: 'Shields', icon: 'shields', status: 'active', variants: variants('shields', SHIELD_ATTRS) },
      { id: 'bucklers', name: 'Bucklers', icon: 'bucklers', status: 'active' },
      { id: 'foci', name: 'Foci', icon: 'foci', status: 'active' },
    ],
  },
  {
    group: 'One-Handed Weapons',
    items: [
      { id: 'claws', name: 'Claws', icon: 'claws', status: 'active' },
      { id: 'daggers', name: 'Daggers', icon: 'daggers', status: 'active' },
      { id: 'wands', name: 'Wands', icon: 'wands', status: 'active' },
      { id: 'one_hand_swords', name: 'One Hand Swords', icon: 'one_hand_swords', status: 'active' },
      { id: 'one_hand_axes', name: 'One Hand Axes', icon: 'one_hand_axes', status: 'active' },
      { id: 'one_hand_maces', name: 'One Hand Maces', icon: 'one_hand_maces', status: 'active' },
      { id: 'sceptres', name: 'Sceptres', icon: 'sceptres', status: 'active' },
      { id: 'spears', name: 'Spears', icon: 'spears', status: 'active' },
      { id: 'flails', name: 'Flails', icon: 'flails', status: 'active' },
    ],
  },
  {
    group: 'Two-Handed Weapons',
    items: [
      { id: 'bows', name: 'Bows', icon: 'bows', status: 'active' },
      { id: 'staves', name: 'Staves', icon: 'staves', status: 'active' },
      { id: 'two_hand_swords', name: 'Two Hand Swords', icon: 'two_hand_swords', status: 'active' },
      { id: 'two_hand_axes', name: 'Two Hand Axes', icon: 'two_hand_axes', status: 'active' },
      { id: 'two_hand_maces', name: 'Two Hand Maces', icon: 'two_hand_maces', status: 'active' },
      { id: 'quarterstaves', name: 'Quarterstaves', icon: 'quarterstaves', status: 'active' },
      { id: 'crossbows', name: 'Crossbows', icon: 'crossbows', status: 'active' },
    ],
  },
  {
    group: 'Flasks & Charms',
    items: [
      { id: 'life_flasks', name: 'Life Flasks', icon: 'life_flasks', status: 'active' },
      { id: 'mana_flasks', name: 'Mana Flasks', icon: 'mana_flasks', status: 'active' },
      { id: 'charms', name: 'Charms', icon: 'charms', status: 'active' },
    ],
  },
];

let selectView;
let craftView;
let root;
let selectHeading;
let selectSub;

// Auto-loading icon with graceful glyph fallback.
function iconEl(name) {
  const wrap = document.createElement('span');
  wrap.className = 'cat-ico';
  const img = document.createElement('img');
  img.src = 'assets/icons/' + name + '.png';
  img.alt = '';
  img.loading = 'lazy';
  img.addEventListener('error', () => {
    img.remove();
    const glyph = document.createElement('span');
    glyph.className = 'cat-ico-glyph';
    glyph.textContent = '\u25C6';
    wrap.appendChild(glyph);
  });
  wrap.appendChild(img);
  return wrap;
}

function buildCard(item) {
  const hasVariants = Array.isArray(item.variants) && item.variants.length > 0;
  const active = item.status === 'active';

  const card = document.createElement('button');
  card.type = 'button';
  // Every released category is clickable. Variant categories open their
  // attribute grid; everything else jumps straight into the crafter.
  card.className = 'cat-card' + (active ? ' is-active' : '');

  card.appendChild(iconEl(item.icon));

  const label = document.createElement('span');
  label.className = 'cat-card-label';
  label.textContent = item.name;
  card.appendChild(label);

  // Now that every base is released, every card wears the green "Playable" tag.
  if (active) {
    const badge = document.createElement('span');
    badge.className = 'cat-badge badge-ready';
    badge.textContent = 'Playable';
    card.appendChild(badge);
  }

  card.addEventListener('click', () => {
    if (hasVariants) renderVariants(item);
    else enterCraft(item.id, item.name);
  });

  return card;
}

// All categories render into ONE continuous grid so every row fills
// edge-to-edge (no empty space at the end of each section).
function renderCategories() {
  if (selectHeading) selectHeading.textContent = 'Choose what to craft';
  if (selectSub) selectSub.textContent = 'Pick an item category to begin.';
  root.innerHTML = '';

  const grid = document.createElement('div');
  grid.className = 'cat-grid';
  for (const group of CATEGORIES) {
    for (const item of group.items) {
      grid.appendChild(buildCard(item));
    }
  }
  root.appendChild(grid);
  window.scrollTo(0, 0);
}

function renderVariants(item) {
  if (selectHeading) selectHeading.textContent = item.name;
  if (selectSub) selectSub.textContent = 'Pick an attribute base to craft.';
  root.innerHTML = '';

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'variant-back';
  back.textContent = '\u2190 All categories';
  back.addEventListener('click', renderCategories);
  root.appendChild(back);

  const grid = document.createElement('div');
  grid.className = 'cat-grid variant-grid';
  for (const v of item.variants) {
    const card = document.createElement('button');
    card.type = 'button';
    // Variant cards are now live: each loads its own base (gloves_str, ...).
    card.className = 'cat-card variant-card is-active';

    card.appendChild(iconEl(v.icon));

    const label = document.createElement('span');
    label.className = 'cat-card-label';
    label.textContent = item.name + ' (' + v.name + ')';
    card.appendChild(label);

    const base = document.createElement('span');
    base.className = 'variant-base';
    base.textContent = v.bestBase ? 'Best base: ' + v.bestBase : v.name;
    card.appendChild(base);

    card.addEventListener('click', () => enterCraft(v.id, item.name));

    grid.appendChild(card);
  }
  root.appendChild(grid);
  window.scrollTo(0, 0);
}

// Hand the chosen base to the crafter (app.js). If its data isn't available the
// bridge returns false and we stay on the select screen rather than opening an
// empty crafter.
function enterCraft(baseId, classLabel) {
  if (window.CraftForge && typeof window.CraftForge.loadBase === 'function') {
    const ok = window.CraftForge.loadBase(baseId, classLabel);
    if (ok === false) return;
  }
  craftView.hidden = false;
  selectView.hidden = true;
  window.scrollTo(0, 0);
}

function exitCraft() {
  selectView.hidden = false;
  craftView.hidden = true;
  window.scrollTo(0, 0);
}

function init() {
  selectView = document.getElementById('select-view');
  craftView = document.getElementById('craft-view');
  root = document.getElementById('select-grid');
  selectHeading = document.getElementById('select-heading');
  selectSub = document.getElementById('select-sub');

  if (!selectView || !craftView || !root) return;

  const backBtn = document.getElementById('back-to-select');
  if (backBtn) backBtn.addEventListener('click', exitCraft);

  renderCategories();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
})();
