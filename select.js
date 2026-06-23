(function () { "use strict";
// ============================================================
//  Item Category Selection Screen  (UI ONLY — no craft logic)
//
//  Icons auto-load from /assets/icons/<icon>.png. Until a PNG
//  exists, a glyph fallback is shown. Just drop files named
//  exactly as the `icon` fields below and they appear.
//
//  Naming pattern for attribute variants: <base>_<attr>.png
//  e.g. gloves_str.png, gloves_str_dex.png, body_armours_str_dex_int.png
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

// Build attribute variants for a base item.
// TODO: fill `bestBase` with the best base item per attribute when known.
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
      { id: 'amulets', name: 'Amulets', icon: 'amulets', status: 'soon' },
      { id: 'rings', name: 'Rings', icon: 'rings', status: 'soon' },
      { id: 'belts', name: 'Belts', icon: 'belts', status: 'soon' },
    ],
  },
  {
    group: 'Armour',
    items: [
      { id: 'gloves', name: 'Gloves', icon: 'gloves', status: 'soon', variants: variants('gloves', ARMOUR_ATTRS) },
      { id: 'boots', name: 'Boots', icon: 'boots', status: 'soon', variants: variants('boots', ARMOUR_ATTRS) },
      { id: 'body_armours', name: 'Body Armours', icon: 'body_armours', status: 'soon', variants: variants('body_armours', BODY_ATTRS) },
      { id: 'helmets', name: 'Helmets', icon: 'helmets', status: 'soon', variants: variants('helmets', ARMOUR_ATTRS) },
    ],
  },
  {
    group: 'Off-hand',
    items: [
      { id: 'quivers', name: 'Quivers', icon: 'quivers', status: 'soon' },
      { id: 'shields', name: 'Shields', icon: 'shields', status: 'soon', variants: variants('shields', SHIELD_ATTRS) },
      { id: 'bucklers', name: 'Bucklers', icon: 'bucklers', status: 'soon' },
      { id: 'foci', name: 'Foci', icon: 'foci', status: 'soon' },
    ],
  },
  {
    group: 'One-Handed Weapons',
    items: [
      { id: 'claws', name: 'Claws', icon: 'claws', status: 'soon' },
      { id: 'daggers', name: 'Daggers', icon: 'daggers', status: 'soon' },
      { id: 'wands', name: 'Wands', icon: 'wands', status: 'soon' },
      { id: 'one_hand_swords', name: 'One Hand Swords', icon: 'one_hand_swords', status: 'soon' },
      { id: 'one_hand_axes', name: 'One Hand Axes', icon: 'one_hand_axes', status: 'soon' },
      { id: 'one_hand_maces', name: 'One Hand Maces', icon: 'one_hand_maces', status: 'soon' },
      { id: 'sceptres', name: 'Sceptres', icon: 'sceptres', status: 'soon' },
      { id: 'spears', name: 'Spears', icon: 'spears', status: 'soon' },
      { id: 'flails', name: 'Flails', icon: 'flails', status: 'soon' },
    ],
  },
  {
    group: 'Two-Handed Weapons',
    items: [
      { id: 'bows', name: 'Bows', icon: 'bows', status: 'soon' },
      { id: 'staves', name: 'Staves', icon: 'staves', status: 'soon' },
      { id: 'two_hand_swords', name: 'Two Hand Swords', icon: 'two_hand_swords', status: 'soon' },
      { id: 'two_hand_axes', name: 'Two Hand Axes', icon: 'two_hand_axes', status: 'soon' },
      { id: 'two_hand_maces', name: 'Two Hand Maces', icon: 'two_hand_maces', status: 'soon' },
      { id: 'quarterstaves', name: 'Quarterstaves', icon: 'quarterstaves', status: 'soon' },
      { id: 'crossbows', name: 'Crossbows', icon: 'crossbows', status: 'soon' },
    ],
  },
  {
    group: 'Flasks & Charms',
    items: [
      { id: 'life_flasks', name: 'Life Flasks', icon: 'life_flasks', status: 'soon' },
      { id: 'mana_flasks', name: 'Mana Flasks', icon: 'mana_flasks', status: 'soon' },
      { id: 'charms', name: 'Charms', icon: 'charms', status: 'soon' },
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
    glyph.textContent = '◆';
    wrap.appendChild(glyph);
  });
  wrap.appendChild(img);
  return wrap;
}

function buildCard(item) {
  const hasVariants = Array.isArray(item.variants) && item.variants.length > 0;
  const active = item.status === 'active';
  const clickable = active || hasVariants;

  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'cat-card' + (active ? ' is-active' : '') + (clickable ? '' : ' is-disabled');
  if (!clickable) card.disabled = true;

  card.appendChild(iconEl(item.icon));

  const label = document.createElement('span');
  label.className = 'cat-card-label';
  label.textContent = item.name;
  card.appendChild(label);

  const badge = document.createElement('span');
  badge.className = 'cat-badge ' + (active ? 'badge-ready' : 'badge-soon');
  badge.textContent = active ? 'Playable' : 'Coming soon';
  card.appendChild(badge);

  card.addEventListener('click', () => {
    if (active) enterCraft();
    else if (hasVariants) renderVariants(item);
  });

  return card;
}

function renderCategories() {
  if (selectHeading) selectHeading.textContent = 'Choose what to craft';
  if (selectSub) selectSub.textContent = 'Pick an item category to begin.';
  root.innerHTML = '';

  for (const group of CATEGORIES) {
    const section = document.createElement('section');
    section.className = 'cat-group';

    const title = document.createElement('h2');
    title.className = 'cat-group-title';
    title.textContent = group.group;
    section.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'cat-grid';
    for (const item of group.items) {
      grid.appendChild(buildCard(item));
    }
    section.appendChild(grid);
    root.appendChild(section);
  }
  window.scrollTo(0, 0);
}

function renderVariants(item) {
  if (selectHeading) selectHeading.textContent = item.name;
  if (selectSub) selectSub.textContent = 'Best base per attribute requirement.';
  root.innerHTML = '';

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'variant-back';
  back.textContent = '← All categories';
  back.addEventListener('click', renderCategories);
  root.appendChild(back);

  const grid = document.createElement('div');
  grid.className = 'cat-grid variant-grid';
  for (const v of item.variants) {
    const card = document.createElement('div');
    card.className = 'cat-card variant-card is-disabled';

    card.appendChild(iconEl(v.icon));

    const label = document.createElement('span');
    label.className = 'cat-card-label';
    label.textContent = item.name + ' (' + v.name + ')';
    card.appendChild(label);

    const base = document.createElement('span');
    base.className = 'variant-base';
    base.textContent = v.bestBase ? 'Best base: ' + v.bestBase : 'Best base — TBD';
    card.appendChild(base);

    const badge = document.createElement('span');
    badge.className = 'cat-badge badge-soon';
    badge.textContent = 'Coming soon';
    card.appendChild(badge);

    grid.appendChild(card);
  }
  root.appendChild(grid);
  window.scrollTo(0, 0);
}

function enterCraft() {
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
