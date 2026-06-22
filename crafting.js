// crafting.js - PoE2 Crafting Engine (base-agnostic)
// ES Module — no external dependencies
//
// The engine is no longer hardcoded to jewels. It reads a generic base data
// object keyed by base type (supports both `bases` and the legacy `jewelTypes`
// key) and per-base affix limits. Jewels remain the default base.

export default class CraftingEngine {
  static LIMITS = {
    magic: { prefixes: 1, suffixes: 1 },
    rare:  { prefixes: 2, suffixes: 2 },
  };

  static RARE_NAME_A = ['Brood','Cataclysm','Dragon','Doom','Vortex','Storm','Blood','Onslaught','Eagle','Empyrean','Phoenix','Grim','Hypnotic','Maelstrom','Pandemonium','Rune','Skull','Sol','Spirit','Tempest','Vengeance','Viper','Wrath','Carrion','Corpse','Demon','Dusk','Gloom','Hate','Morbid'];
  static RARE_NAME_B = ['Husk','Wound','Whorl','Bane','Crest','Glyph','Grasp','Knot','Mark','Pith','Sigil','Song','Star','Thirst','Veil','Ward','Weave','Bauble','Charm','Eye','Heart','Light','Loop','Nexus','Pulse','Shard','Spark','Token','Visage','Core'];

  // `desecratedData` is the parsed contents of data/desecrated-mods.json (or null).
  constructor(modData, baseType = 'ruby', desecratedData = null) {
    this._modData = modData;
    // Keep `jewelType` for backwards-compatibility (stash records, UI), and
    // expose `baseType` as the generic alias.
    this.baseType = baseType;
    this.jewelType = baseType;

    const typeData = modData?.bases?.[baseType] ?? modData?.jewelTypes?.[baseType];
    if (!typeData) throw new Error(`Invalid base type: ${baseType}`);
    this._typeData = typeData;

    this._limits = typeData.limits || CraftingEngine.LIMITS;

    this._prefixPool = typeData.prefixes || [];
    this._suffixPool = typeData.suffixes || [];
    this._vaalCorruptedPool = typeData.vaalCorruptedMods || [];

    // Desecrated (Abyssal) mod pools for this base, if any.
    const desData = desecratedData?.bases?.[baseType] ?? desecratedData?.jewelTypes?.[baseType] ?? null;
    this._desecratedPrefixes = (desData?.prefixes || []).slice();
    this._desecratedSuffixes = (desData?.suffixes || []).slice();
    this._bones = desecratedData?.bones || {};
    this._pendingDesecration = null;

    this._item = this._createBlankItem(typeData.name);

    this._prefixCandidates = this._buildCandidatePool(this._prefixPool, 'prefix');
    this._suffixCandidates = this._buildCandidatePool(this._suffixPool, 'suffix');
  }

  getItem() { return structuredClone(this._item); }

  resetItem() {
    this._item = this._createBlankItem(this._typeData.name);
    this._pendingDesecration = null;
    return this.getItem();
  }

  loadItem(item) {
    this._item = structuredClone(item);
    if (!this._item.currencyUsed) this._item.currencyUsed = {};
    if (!Array.isArray(this._item.enchantments)) this._item.enchantments = [];
    if (!Array.isArray(this._item.prefixes)) this._item.prefixes = [];
    if (!Array.isArray(this._item.suffixes)) this._item.suffixes = [];
    this._pendingDesecration = null;
    return this.getItem();
  }

  setHinekoraLock()   { this._item.hinekoraLocked = true; }
  clearHinekoraLock() { this._item.hinekoraLocked = false; }

  recordCurrencyUse(type) {
    if (!this._item.currencyUsed) this._item.currencyUsed = {};
    this._item.currencyUsed[type] = (this._item.currencyUsed[type] || 0) + 1;
    return this._item.currencyUsed[type];
  }

  _checkCorrupted() {
    if (this._item.corrupted) return this._fail('Item is corrupted and cannot be modified.');
    return null;
  }

  applyTransmutation() {
    const err = this._checkCorrupted(); if (err) return err;
    if (this._item.rarity !== 'normal') return this._fail('Orb of Transmutation can only be used on Normal items.');
    const previousRarity = this._item.rarity;
    this._item.rarity = 'magic';
    const added = this._addRandomMod('magic');
    if (!added) { this._item.rarity = previousRarity; return this._fail('No eligible mods available.'); }
    return this._success({ action: 'transform', addedMods: [added], previousRarity });
  }

  applyAugmentation() {
    const err = this._checkCorrupted(); if (err) return err;
    if (this._item.rarity !== 'magic') return this._fail('Orb of Augmentation can only be used on Magic items.');
    if (this._isAtModLimit('magic')) return this._fail('Item already has max mods for a Magic item (1 prefix + 1 suffix).');
    const added = this._addRandomMod('magic');
    if (!added) return this._fail('No eligible open affix available.');
    return this._success({ action: 'add', addedMods: [added], previousRarity: 'magic' });
  }

  applyRegal() {
    const err = this._checkCorrupted(); if (err) return err;
    if (this._item.rarity !== 'magic') return this._fail('Regal Orb can only be used on Magic items.');
    const previousRarity = this._item.rarity;
    const previousName = this._item.name;
    this._item.rarity = 'rare';
    this._item.name = this._generateRareName();
    const added = this._addRandomMod('rare');
    if (!added) {
      this._item.rarity = previousRarity;
      this._item.name = previousName;
      return this._fail('No eligible mods available.');
    }
    return this._success({ action: 'transform', addedMods: [added], previousRarity });
  }

  applyExalted() {
    const err = this._checkCorrupted(); if (err) return err;
    if (this._item.rarity !== 'rare') return this._fail('Exalted Orb can only be used on Rare items.');
    if (this._isAtModLimit('rare')) return this._fail('Item already has max mods for a Rare jewel (2 prefixes + 2 suffixes).');
    const added = this._addRandomMod('rare');
    if (!added) return this._fail('No eligible open affix available.');
    return this._success({ action: 'add', addedMods: [added], previousRarity: 'rare' });
  }

  applyChaos() {
    const err = this._checkCorrupted(); if (err) return err;
    if (this._item.rarity !== 'rare') return this._fail('Chaos Orb can only be used on Rare items.');
    if (this._allModEntries().length === 0) return this._fail('Item has no mods to modify.');
    const removed = this._removeRandomMod();
    if (!removed) return this._fail('All modifiers are fractured and cannot be changed.');
    const added = this._addRandomMod('rare');
    if (!added) return this._success({ action: 'remove', removedMods: [removed], previousRarity: 'rare' });
    return this._success({ action: 'reroll', addedMods: [added], removedMods: [removed], previousRarity: 'rare' });
  }

  applyAlchemy() {
    const err = this._checkCorrupted(); if (err) return err;
    if (this._item.rarity !== 'normal' && this._item.rarity !== 'magic') {
      return this._fail('Orb of Alchemy can only be used on Normal or Magic items.');
    }

    const snapshot = structuredClone(this._item);
    const previousRarity = this._item.rarity;

    const removedMods = [];
    if (this._item.rarity === 'magic') {
      for (const e of this._allModEntries()) removedMods.push(e.mod);
      this._item.prefixes = [];
      this._item.suffixes = [];
    }

    this._item.rarity = 'rare';
    this._item.name = this._generateRareName();

    const totalMods = this._randomInt(3, 4);
    const addedMods = [];

    const forcedPrefix = this._addRandomModOfType('prefix', 'rare');
    if (forcedPrefix) addedMods.push(forcedPrefix);
    const forcedSuffix = this._addRandomModOfType('suffix', 'rare');
    if (forcedSuffix) addedMods.push(forcedSuffix);

    const remaining = totalMods - addedMods.length;
    for (let i = 0; i < remaining; i++) {
      const mod = this._addRandomMod('rare');
      if (mod) addedMods.push(mod);
    }

    if (addedMods.length === 0) {
      this._item = snapshot;
      return this._fail('No eligible mods available.');
    }
    return this._success({ action: 'transform', addedMods, removedMods, previousRarity });
  }

  applyAnnulment() {
    const err = this._checkCorrupted(); if (err) return err;
    if (this._allModEntries().length === 0) return this._fail('Item has no mods to remove.');
    const previousRarity = this._item.rarity;
    const removed = this._removeRandomMod();
    if (!removed) return this._fail('All modifiers are fractured and cannot be removed.');
    return this._success({ action: 'remove', removedMods: [removed], previousRarity });
  }

  applyDivine() {
    const err = this._checkCorrupted(); if (err) return err;
    if (this._allModEntries().length === 0) return this._fail('Item has no mods to re-roll values on.');
    const rerollable = this._allModEntries().filter(({ mod }) => !mod.fractured);
    const hasRange = rerollable.some(({ mod }) => mod.min != null && mod.max != null && mod.min !== mod.max);
    if (!hasRange) return this._fail('No re-rollable mods (fractured or fixed-value mods are locked).');

    for (const { mod } of rerollable) {
      if (mod.min != null && mod.max != null && mod.min !== mod.max) {
        mod.value = this._randomInt(mod.min, mod.max);
        mod.displayText = mod.modLine.replaceAll('{0}', mod.value);
      }
    }
    return this._success({ action: 'reroll', previousRarity: this._item.rarity });
  }

  applyVaal() {
    const err = this._checkCorrupted(); if (err) return err;

    this._item.corrupted = true;
    const previousRarity = this._item.rarity;
    const hasMods = this._allModEntries().length > 0;

    const affixRarity = this._item.rarity === 'magic' ? 'magic'
                      : this._item.rarity === 'rare' ? 'rare'
                      : null;

    let outcome = this._randomInt(1, 4);
    if (outcome === 2 && (!hasMods || !affixRarity)) outcome = 3;

    let vaalOutcome = 'none';
    const addedMods = [];
    const removedMods = [];

    if (outcome === 1) {
      vaalOutcome = 'none';
    } else if (outcome === 2) {
      vaalOutcome = 'reroll';
      const times = this._randomInt(1, 3);
      for (let i = 0; i < times; i++) {
        if (this._allModEntries().length === 0) break;
        const removed = this._removeRandomMod();
        if (removed) removedMods.push(removed);
        const added = this._addRandomMod(affixRarity);
        if (added) addedMods.push(added);
      }
    } else if (outcome === 3) {
      vaalOutcome = 'enchant';
      const ench = this._rollCorruptedImplicit();
      if (ench) { this._item.enchantments.push(ench.text); addedMods.push(ench.mod); }
    } else {
      vaalOutcome = 'modify';
      const isAdd = this._randomInt(1, 2) === 1;
      if (isAdd || !hasMods) {
        const ench = this._rollCorruptedImplicit();
        if (ench) { this._item.enchantments.push(ench.text); addedMods.push(ench.mod); }
      } else {
        const removed = this._removeRandomMod();
        if (removed) removedMods.push(removed);
      }
    }

    return this._success({ action: 'corrupt', vaalOutcome, addedMods, removedMods, previousRarity });
  }

  applyFracturing() {
    const err = this._checkCorrupted(); if (err) return err;
    if (this._item.rarity !== 'rare') return this._fail('Fracturing Orb can only be used on Rare items.');
    const allMods = this._allModEntries();
    if (allMods.length < 4) return this._fail('Fracturing Orb requires a Rare item with 4 modifiers.');
    if (allMods.some(e => e.mod.fractured)) return this._fail('Item already has a fractured modifier.');
    const pick = allMods[this._randomInt(0, allMods.length - 1)];
    pick.mod.fractured = true;
    return this._success({ action: 'fracture', fracturedMod: { ...pick.mod, type: pick.type }, previousRarity: 'rare' });
  }

  // ===========================================================
  //  DESECRATION (Abyssal mechanic) — Preserved Cranium
  // ===========================================================
  //
  //  Flow: startDesecration() reveals options (a "Well of Souls" set), then the
  //  UI calls chooseDesecratedMod() to commit one, rerollDesecration() to reroll
  //  the set (Omen of Abyssal Echoes), or cancelDesecration() to back out.
  //
  //  Empty-slot rule: desecration needs an open affix on the targeted side. A
  //  Rare jewel caps at 2 prefixes + 2 suffixes (4 total). If the targeted side
  //  still has an open slot, the Desecrated mod fills it; if the side is full,
  //  it replaces a random existing (non-fractured) mod on that side.
  //
  //  Omens (one active at a time):
  //   - 'sinistral_necromancy' -> target a prefix
  //   - 'dextral_necromancy'   -> target a suffix
  //   - 'abyssal_echoes'       -> one reroll of the revealed options (3 x 2 = 6)

  getPendingDesecration() {
    return this._pendingDesecration ? structuredClone(this._pendingDesecration) : null;
  }

  startDesecration({ bone = 'preserved_cranium', omen = null } = {}) {
    const err = this._checkCorrupted(); if (err) return err;
    if (this._item.rarity !== 'rare') {
      return this._fail('Desecration requires a Rare item (use Alchemy or Regal first).');
    }
    if (this._desecratedPrefixes.length === 0 && this._desecratedSuffixes.length === 0) {
      return this._fail('No Desecrated modifiers are available for this base.');
    }

    let targetSide = null;
    if (omen === 'sinistral_necromancy') targetSide = 'prefix';
    else if (omen === 'dextral_necromancy') targetSide = 'suffix';

    const side = this._resolveDesecrationSide(targetSide);
    const sidePool = side === 'prefix' ? this._desecratedPrefixes : this._desecratedSuffixes;
    if (sidePool.length === 0) {
      return this._fail(`No Desecrated ${side} modifiers available for this base.`);
    }

    const cap = this._limits.rare[side === 'prefix' ? 'prefixes' : 'suffixes'];
    const current = (side === 'prefix' ? this._item.prefixes : this._item.suffixes).length;
    const mode = current < cap ? 'add' : 'replace';
    const rerollsLeft = omen === 'abyssal_echoes' ? 1 : 0;

    const options = this._rollDesecratedOptions(side);
    if (options.length === 0) return this._fail('No eligible Desecrated modifiers to reveal.');

    this._pendingDesecration = { bone, omen, side, mode, rerollsLeft, options };
    return {
      success: true,
      action: 'desecrate-reveal',
      bone, side, mode, rerollsLeft, options,
      item: this.getItem(),
    };
  }

  rerollDesecration() {
    const pd = this._pendingDesecration;
    if (!pd) return this._fail('No desecration in progress.');
    if (pd.rerollsLeft <= 0) return this._fail('No rerolls remaining.');
    pd.rerollsLeft -= 1;
    pd.options = this._rollDesecratedOptions(pd.side);
    return {
      success: true,
      action: 'desecrate-reroll',
      side: pd.side, mode: pd.mode, rerollsLeft: pd.rerollsLeft, options: pd.options,
      item: this.getItem(),
    };
  }

  chooseDesecratedMod(index) {
    const pd = this._pendingDesecration;
    if (!pd) return this._fail('No desecration in progress.');
    const chosen = pd.options[index];
    if (!chosen) return this._fail('Invalid Desecrated modifier selected.');

    const side = pd.side;
    const arr = side === 'prefix' ? this._item.prefixes : this._item.suffixes;
    const cap = this._limits.rare[side === 'prefix' ? 'prefixes' : 'suffixes'];
    const previousRarity = this._item.rarity;

    const record = { ...chosen };
    delete record.affix;

    let removedMod = null;
    if (arr.length < cap) {
      arr.push(record);
    } else {
      const candidates = arr.map((m, i) => ({ m, i })).filter(x => !x.m.fractured);
      if (candidates.length === 0) {
        this._pendingDesecration = null;
        return this._fail('All modifiers on that side are fractured and cannot be replaced.');
      }
      const pick = candidates[this._randomInt(0, candidates.length - 1)];
      removedMod = { ...arr[pick.i], type: side };
      arr.splice(pick.i, 1, record);
    }

    this._pendingDesecration = null;
    return this._success({
      action: 'desecrate',
      addedMods: [{ ...record, type: side }],
      removedMods: removedMod ? [removedMod] : [],
      desecratedSide: side,
      previousRarity,
    });
  }

  cancelDesecration() {
    this._pendingDesecration = null;
    return { success: true, action: 'desecrate-cancel', item: this.getItem() };
  }

  _resolveDesecrationSide(targetSide) {
    if (targetSide === 'prefix' || targetSide === 'suffix') return targetSide;
    const pCap = this._limits.rare.prefixes;
    const sCap = this._limits.rare.suffixes;
    const pOpen = this._item.prefixes.length < pCap && this._desecratedPrefixes.length > 0;
    const sOpen = this._item.suffixes.length < sCap && this._desecratedSuffixes.length > 0;
    const open = [];
    if (pOpen) open.push('prefix');
    if (sOpen) open.push('suffix');
    if (open.length > 0) return open[this._randomInt(0, open.length - 1)];
    // Item is full — desecration replaces a random mod; pick any side with a pool.
    const avail = [];
    if (this._desecratedPrefixes.length > 0) avail.push('prefix');
    if (this._desecratedSuffixes.length > 0) avail.push('suffix');
    return avail[this._randomInt(0, avail.length - 1)] || 'prefix';
  }

  _rollDesecratedOptions(side, count = 3) {
    const pool = side === 'prefix' ? this._desecratedPrefixes : this._desecratedSuffixes;
    if (!pool || pool.length === 0) return [];
    const existing = this._existingGroups();
    let work = pool.filter(c => !existing.has(c.modGroup));
    if (work.length === 0) work = pool.slice();
    else work = work.slice();
    const out = [];
    for (let i = 0; i < count && work.length > 0; i++) {
      const idx = this._weightedIndex(work);
      out.push(this._materializeDesecrated(work[idx], side));
      work.splice(idx, 1);
    }
    return out;
  }

  _materializeDesecrated(c, side) {
    const hasRange = c.min != null && c.max != null;
    const value = hasRange ? this._randomInt(c.min, c.max) : null;
    const displayText = c.modLine
      ? (value != null ? c.modLine.replaceAll('{0}', value) : c.modLine)
      : (c.name || 'Desecrated Modifier');
    return {
      modGroup: c.modGroup,
      tier: c.tier || 'D',
      tierName: c.name || 'Desecrated',
      modLine: c.modLine,
      displayText,
      value,
      min: c.min,
      max: c.max,
      fractured: false,
      desecrated: true,
      affix: side,
    };
  }

  _weightedIndex(arr) {
    let total = 0;
    for (const c of arr) total += (c.weight || 1);
    let roll = Math.random() * total;
    for (let i = 0; i < arr.length; i++) {
      roll -= (arr[i].weight || 1);
      if (roll <= 0) return i;
    }
    return arr.length - 1;
  }

  _createBlankItem(baseName) {
    return {
      rarity: 'normal',
      baseName,
      name: baseName,
      baseType: this.baseType,
      jewelType: this.jewelType,
      prefixes: [],
      suffixes: [],
      enchantments: [],
      corrupted: false,
      ilvl: 83,
      currencyUsed: {},
      hinekoraLocked: false,
    };
  }

  _generateRareName() {
    const a = CraftingEngine.RARE_NAME_A;
    const b = CraftingEngine.RARE_NAME_B;
    return `${a[this._randomInt(0, a.length - 1)]} ${b[this._randomInt(0, b.length - 1)]}`;
  }

  _allModEntries() {
    const entries = [];
    this._item.prefixes.forEach((m, i) => entries.push({ type: 'prefix', index: i, mod: m }));
    this._item.suffixes.forEach((m, i) => entries.push({ type: 'suffix', index: i, mod: m }));
    return entries;
  }

  _existingGroups() {
    const groups = new Set();
    for (const m of this._item.prefixes) groups.add(m.modGroup);
    for (const m of this._item.suffixes) groups.add(m.modGroup);
    return groups;
  }

  _isAtModLimit(rarity) {
    const limits = this._limits[rarity];
    return (this._item.prefixes.length >= limits.prefixes && this._item.suffixes.length >= limits.suffixes);
  }

  _buildCandidatePool(pool, type) {
    const out = [];
    if (!pool) return out;
    for (const group of pool) {
      for (const tier of (group.tiers || [])) {
        if (tier.ilvlReq <= this._item.ilvl) out.push({ type, group, tier, weight: tier.weight });
      }
    }
    return out;
  }

  _eligibleCandidates(type, existingGroups) {
    const src = type === 'prefix' ? this._prefixCandidates : this._suffixCandidates;
    return src.filter(c => !existingGroups.has(c.group.modGroup));
  }

  _addRandomMod(rarity) {
    const limits = this._limits[rarity];
    if (!limits) return null;
    const canPrefix = this._item.prefixes.length < limits.prefixes;
    const canSuffix = this._item.suffixes.length < limits.suffixes;
    if (!canPrefix && !canSuffix) return null;

    const existingGroups = this._existingGroups();
    const candidates = [];
    if (canPrefix) candidates.push(...this._eligibleCandidates('prefix', existingGroups));
    if (canSuffix) candidates.push(...this._eligibleCandidates('suffix', existingGroups));
    if (candidates.length === 0) return null;
    return this._selectAndApplyCandidate(candidates);
  }

  _addRandomModOfType(type, rarity) {
    const limits = this._limits[rarity];
    if (!limits) return null;
    const current = type === 'prefix' ? this._item.prefixes : this._item.suffixes;
    const cap = type === 'prefix' ? limits.prefixes : limits.suffixes;
    if (current.length >= cap) return null;
    const candidates = this._eligibleCandidates(type, this._existingGroups());
    if (candidates.length === 0) return null;
    return this._selectAndApplyCandidate(candidates);
  }

  _selectAndApplyCandidate(candidates) {
    const groupMap = new Map();
    for (const c of candidates) {
      const key = `${c.type}:${c.group.modGroup}`;
      groupMap.set(key, (groupMap.get(key) || 0) + c.tier.weight);
    }
    const selectedGroupKey = this._weightedRandom(groupMap);
    const groupCandidates = candidates.filter(c => `${c.type}:${c.group.modGroup}` === selectedGroupKey);
    const tierWeights = groupCandidates.map(c => [c, c.tier.weight]);
    const selected = this._weightedRandomFromPairs(tierWeights);
    return this._applyMod(selected.type, selected.group, selected.tier);
  }

  _applyMod(type, group, tier) {
    const hasRange = tier.min != null && tier.max != null;
    const value = hasRange ? this._randomInt(tier.min, tier.max) : null;
    const displayText = tier.modLine
      ? (value != null ? tier.modLine.replaceAll('{0}', value) : tier.modLine)
      : 'Unknown Mod';
    const modRecord = {
      modGroup: group.modGroup,
      tier: tier.tier,
      tierName: tier.name,
      modLine: tier.modLine,
      displayText,
      value,
      min: tier.min,
      max: tier.max,
      fractured: false,
    };
    if (type === 'prefix') this._item.prefixes.push(modRecord);
    else this._item.suffixes.push(modRecord);
    return { ...modRecord, type };
  }

  _removeRandomMod() {
    const entries = this._allModEntries().filter(e => !e.mod.fractured);
    if (entries.length === 0) return null;
    const pick = entries[this._randomInt(0, entries.length - 1)];
    if (pick.type === 'prefix') this._item.prefixes.splice(pick.index, 1);
    else this._item.suffixes.splice(pick.index, 1);
    return { ...pick.mod, type: pick.type };
  }

  _rollCorruptedImplicit() {
    const pool = this._vaalCorruptedPool;
    if (!pool || pool.length === 0) return null;
    const selected = pool[this._randomInt(0, pool.length - 1)];
    const hasRange = selected.min != null && selected.max != null;
    const value = hasRange ? this._randomInt(selected.min, selected.max) : null;
    const text = value != null ? selected.modLine.replaceAll('{0}', value) : selected.modLine;
    return { text, mod: { type: 'corrupted', modGroup: selected.modGroup, displayText: text } };
  }

  _weightedRandom(weightMap) {
    let total = 0;
    for (const w of weightMap.values()) total += w;
    let roll = Math.random() * total;
    for (const [key, w] of weightMap) {
      roll -= w;
      if (roll <= 0) return key;
    }
    return [...weightMap.keys()].pop();
  }

  _weightedRandomFromPairs(pairs) {
    let total = 0;
    for (const [, w] of pairs) total += w;
    let roll = Math.random() * total;
    for (const [item, w] of pairs) {
      roll -= w;
      if (roll <= 0) return item;
    }
    return pairs[pairs.length - 1][0];
  }

  _randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  _success(payload) { return { success: true, item: this.getItem(), ...payload }; }
  _fail(error) { return { success: false, error, item: this.getItem() }; }
}
