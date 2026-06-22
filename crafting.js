// crafting.js - PoE2 Jewel Crafting Engine
// ES Module — no external dependencies

export default class CraftingEngine {
  // ── Mod limits by rarity ──────────────────────────────────────────────
  // PoE2 jewel limits: max 4 affixes (2 prefixes, 2 suffixes) for Rare
  static LIMITS = {
    magic: { prefixes: 1, suffixes: 1 },
    rare:  { prefixes: 2, suffixes: 2 },
  };

  // Random rare-name word pools (PoE2-style two-word names)
  static RARE_NAME_A = ['Brood','Cataclysm','Dragon','Doom','Vortex','Storm','Blood','Onslaught','Eagle','Empyrean','Phoenix','Grim','Hypnotic','Maelstrom','Pandemonium','Rune','Skull','Sol','Spirit','Tempest','Vengeance','Viper','Wrath','Carrion','Corpse','Demon','Dusk','Gloom','Hate','Morbid'];
  static RARE_NAME_B = ['Husk','Wound','Whorl','Bane','Crest','Glyph','Grasp','Knot','Mark','Pith','Sigil','Song','Star','Thirst','Veil','Ward','Weave','Bauble','Charm','Eye','Heart','Light','Loop','Nexus','Pulse','Shard','Spark','Token','Visage','Core'];

  /**
   * @param {Object} modData  Parsed jewel-mods.json
   * @param {string} jewelType 'ruby', 'emerald', or 'sapphire'
   */
  constructor(modData, jewelType = 'ruby') {
    this._modData = modData;
    this.jewelType = jewelType;
    
    const typeData = modData.jewelTypes[jewelType];
    if (!typeData) throw new Error(`Invalid jewel type: ${jewelType}`);

    this._prefixPool = typeData.prefixes;
    this._suffixPool = typeData.suffixes;
    this._vaalCorruptedPool = typeData.vaalCorruptedMods;
    
    this._item = this._createBlankItem(typeData.name);
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Public — item accessors
  // ═══════════════════════════════════════════════════════════════════════

  getItem() {
    return structuredClone(this._item);
  }

  resetItem() {
    const typeData = this._modData.jewelTypes[this.jewelType];
    this._item = this._createBlankItem(typeData.name);
    return this.getItem();
  }

  // Increment the per-currency usage tally stored on the item (travels with the jewel)
  recordCurrencyUse(type) {
    if (!this._item.currencyUsed) this._item.currencyUsed = {};
    this._item.currencyUsed[type] = (this._item.currencyUsed[type] || 0) + 1;
    return this._item.currencyUsed[type];
  }

  // Deep copy of the engine + current item, used for Hinekora's Lock foresight
  clone() {
    const copy = new CraftingEngine(this._modData, this.jewelType);
    copy._item = structuredClone(this._item);
    return copy;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Public — currency application
  // ═══════════════════════════════════════════════════════════════════════

  _checkCorrupted() {
    if (this._item.corrupted) {
      return this._fail('Item is corrupted and cannot be modified.');
    }
    return null;
  }

  applyTransmutation() {
    const err = this._checkCorrupted(); if (err) return err;
    if (this._item.rarity !== 'normal') {
      return this._fail('Orb of Transmutation can only be used on Normal items.');
    }
    const previousRarity = this._item.rarity;
    this._item.rarity = 'magic';

    const added = this._addRandomMod('magic');
    if (!added) return this._fail('No eligible mods available.');

    return this._success({ action: 'transform', addedMods: [added], previousRarity });
  }

  applyAugmentation() {
    const err = this._checkCorrupted(); if (err) return err;
    if (this._item.rarity !== 'magic') {
      return this._fail('Orb of Augmentation can only be used on Magic items.');
    }
    if (this._isAtModLimit('magic')) {
      return this._fail('Item already has max mods for a Magic item (1 prefix + 1 suffix).');
    }

    const added = this._addRandomMod('magic');
    if (!added) return this._fail('No eligible mods available.');

    return this._success({ action: 'add', addedMods: [added], previousRarity: 'magic' });
  }

  applyRegal() {
    const err = this._checkCorrupted(); if (err) return err;
    if (this._item.rarity !== 'magic') {
      return this._fail('Regal Orb can only be used on Magic items.');
    }
    const previousRarity = this._item.rarity;
    this._item.rarity = 'rare';
    this._item.name = this._generateRareName();

    const added = this._addRandomMod('rare');
    if (!added) return this._fail('No eligible mods available.');

    return this._success({ action: 'transform', addedMods: [added], previousRarity });
  }

  applyExalted() {
    const err = this._checkCorrupted(); if (err) return err;
    if (this._item.rarity !== 'rare') {
      return this._fail('Exalted Orb can only be used on Rare items.');
    }
    if (this._isAtModLimit('rare')) {
      return this._fail('Item already has max mods for a Rare jewel (2 prefixes + 2 suffixes).');
    }

    const added = this._addRandomMod('rare');
    if (!added) return this._fail('No eligible mods available.');

    return this._success({ action: 'add', addedMods: [added], previousRarity: 'rare' });
  }

  applyChaos() {
    const err = this._checkCorrupted(); if (err) return err;
    if (this._item.rarity !== 'rare') {
      return this._fail('Chaos Orb can only be used on Rare items.');
    }
    const allMods = this._allModEntries();
    if (allMods.length === 0) return this._fail('Item has no mods to modify.');

    const removed = this._removeRandomMod();
    const added = this._addRandomMod('rare');

    if (!added) {
      return this._success({ action: 'remove', removedMods: [removed], previousRarity: 'rare' });
    }

    return this._success({ action: 'reroll', addedMods: [added], removedMods: [removed], previousRarity: 'rare' });
  }

  applyAlchemy() {
    const err = this._checkCorrupted(); if (err) return err;
    if (this._item.rarity !== 'normal' && this._item.rarity !== 'magic') {
      return this._fail('Orb of Alchemy can only be used on Normal or Magic items.');
    }
    
    const previousRarity = this._item.rarity;
    
    // Alchemy on Magic overrides mods
    const removedMods = [];
    if (this._item.rarity === 'magic') {
      const allMods = this._allModEntries();
      for (const m of allMods) removedMods.push(m.mod);
      this._item.prefixes = [];
      this._item.suffixes = [];
    }
    
    this._item.rarity = 'rare';
    this._item.name = this._generateRareName();

    // Alchemy rolls 3-4 mods (but cap is 4 anyway, so it fills 3 or 4)
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
      return this._fail('No eligible mods available.');
    }

    return this._success({ action: 'transform', addedMods, removedMods, previousRarity });
  }

  applyAnnulment() {
    const err = this._checkCorrupted(); if (err) return err;
    const allMods = this._allModEntries();
    if (allMods.length === 0) return this._fail('Item has no mods to remove.');
    
    const previousRarity = this._item.rarity;
    const removed = this._removeRandomMod();
    
    // No revert to normal. Rarity stays the same.

    return this._success({ action: 'remove', removedMods: [removed], previousRarity });
  }

  applyDivine() {
    const err = this._checkCorrupted(); if (err) return err;
    const allMods = this._allModEntries();
    if (allMods.length === 0) return this._fail('Item has no mods to re-roll values on.');

    const rerollable = allMods.filter(({ mod }) => !mod.fractured);
    const hasRange = rerollable.some(({ mod }) => mod.min !== mod.max);
    if (!hasRange) return this._fail('No re-rollable mods (fractured mods are locked).');

    for (const { mod } of rerollable) {
      if (mod.min !== mod.max) {
        mod.value = this._randomInt(mod.min, mod.max);
        mod.displayText = mod.modLine.replace('{0}', mod.value);
      }
    }

    return this._success({ action: 'reroll', previousRarity: this._item.rarity });
  }

  applyVaal() {
    const err = this._checkCorrupted(); if (err) return err;
    
    this._item.corrupted = true;
    const outcome = this._randomInt(1, 4);
    
    let vaalOutcome = 'none';
    let addedMods = [];
    let removedMods = [];
    
    if (outcome === 1) {
      // 1. No change, just corrupted
      vaalOutcome = 'none';
    } else if (outcome === 2) {
      // 2. Chaos-like reroll 1-3 times
      vaalOutcome = 'reroll';
      const times = this._randomInt(1, 3);
      for (let i = 0; i < times; i++) {
        if (this._allModEntries().length > 0) {
          removedMods.push(this._removeRandomMod());
        }
        const added = this._addRandomMod('rare');
        if (added) addedMods.push(added);
      }
    } else if (outcome === 3) {
      // 3. Add Vaal enchantment / Corrupted Mod
      vaalOutcome = 'enchant';
      if (this._vaalCorruptedPool && this._vaalCorruptedPool.length > 0) {
        const idx = this._randomInt(0, this._vaalCorruptedPool.length - 1);
        const selected = this._vaalCorruptedPool[idx];
        const value = (selected.min !== null && selected.min !== undefined && selected.max !== null && selected.max !== undefined) ? this._randomInt(selected.min, selected.max) : null;
        const text = value !== null ? selected.modLine.replace('{0}', value) : selected.modLine;
        this._item.enchantments.push(text);
      }
    } else if (outcome === 4) {
      // 4. Add or remove 1 random mod
      vaalOutcome = 'modify';
      const isAdd = this._randomInt(1, 2) === 1;
      const allMods = this._allModEntries();
      
      if (isAdd || allMods.length === 0) {
        // Add a random corrupted modifier
        if (this._vaalCorruptedPool && this._vaalCorruptedPool.length > 0) {
          const idx = this._randomInt(0, this._vaalCorruptedPool.length - 1);
          const selected = this._vaalCorruptedPool[idx];
          const value = (selected.min !== null && selected.min !== undefined && selected.max !== null && selected.max !== undefined) ? this._randomInt(selected.min, selected.max) : null;
          const text = value !== null ? selected.modLine.replace('{0}', value) : selected.modLine;
          this._item.enchantments.push(text);
          addedMods.push({ type: 'corrupted', displayText: text });
        }
      } else {
        removedMods.push(this._removeRandomMod());
      }
    }
    
    return this._success({ action: 'corrupt', vaalOutcome, addedMods, removedMods, previousRarity: this._item.rarity });
  }

  applyFracturing() {
    const err = this._checkCorrupted(); if (err) return err;
    if (this._item.rarity !== 'rare') {
      return this._fail('Fracturing Orb can only be used on Rare items.');
    }
    const allMods = this._allModEntries();
    if (allMods.length < 4) {
      return this._fail('Fracturing Orb requires a Rare item with 4 modifiers.');
    }
    if (allMods.some(e => e.mod.fractured)) {
      return this._fail('Item already has a fractured modifier.');
    }
    const pick = allMods[this._randomInt(0, allMods.length - 1)];
    pick.mod.fractured = true;
    return this._success({ action: 'fracture', fracturedMod: { ...pick.mod, type: pick.type }, previousRarity: 'rare' });
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Private — item factory
  // ═══════════════════════════════════════════════════════════════════════

  _createBlankItem(baseName) {
    return {
      rarity: 'normal',
      baseName,
      name: baseName,
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

  // ═══════════════════════════════════════════════════════════════════════
  //  Private — mod rolling helpers
  // ═══════════════════════════════════════════════════════════════════════

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
    const limits = CraftingEngine.LIMITS[rarity];
    return (this._item.prefixes.length >= limits.prefixes && this._item.suffixes.length >= limits.suffixes);
  }

  _addRandomMod(rarity) {
    const limits = CraftingEngine.LIMITS[rarity];
    const canPrefix = this._item.prefixes.length < limits.prefixes;
    const canSuffix = this._item.suffixes.length < limits.suffixes;
    if (!canPrefix && !canSuffix) return null;

    const existingGroups = this._existingGroups();
    const candidates = [];

    if (canPrefix) this._collectCandidates(this._prefixPool, 'prefix', existingGroups, candidates);
    if (canSuffix) this._collectCandidates(this._suffixPool, 'suffix', existingGroups, candidates);

    if (candidates.length === 0) return null;

    return this._selectAndApplyCandidate(candidates);
  }
  
  _addRandomModForce() {
    // For Vaal orb outcome 4: ignores cap limits
    const existingGroups = this._existingGroups();
    const candidates = [];
    this._collectCandidates(this._prefixPool, 'prefix', existingGroups, candidates);
    this._collectCandidates(this._suffixPool, 'suffix', existingGroups, candidates);
    if (candidates.length === 0) return null;
    return this._selectAndApplyCandidate(candidates);
  }

  _addRandomModOfType(type, rarity) {
    const limits = CraftingEngine.LIMITS[rarity];
    const pool = type === 'prefix' ? this._prefixPool : this._suffixPool;
    const current = type === 'prefix' ? this._item.prefixes : this._item.suffixes;
    const cap = type === 'prefix' ? limits.prefixes : limits.suffixes;

    if (current.length >= cap) return null;

    const existingGroups = this._existingGroups();
    const candidates = [];
    this._collectCandidates(pool, type, existingGroups, candidates);
    if (candidates.length === 0) return null;

    return this._selectAndApplyCandidate(candidates);
  }

  _collectCandidates(pool, type, existingGroups, out) {
    if (!pool) return;
    for (const group of pool) {
      if (existingGroups.has(group.modGroup)) continue;
      for (const tier of group.tiers) {
        if (tier.ilvlReq <= this._item.ilvl) {
          out.push({ type, group, tier, weight: tier.weight });
        }
      }
    }
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
    const value = this._randomInt(tier.min, tier.max);
    const displayText = tier.modLine ? tier.modLine.replace('{0}', value) : 'Unknown Mod';
    const modRecord = {
      modGroup: group.modGroup,
      tier: tier.tier,
      tierName: tier.name,
      modLine: tier.modLine,
      displayText,
      value,
      min: tier.min,
      max: tier.max,
    };

    if (type === 'prefix') {
      this._item.prefixes.push(modRecord);
    } else {
      this._item.suffixes.push(modRecord);
    }
    return { ...modRecord, type };
  }

  _removeRandomMod() {
    // Fractured mods are locked and can never be removed by Annulment/Chaos/Vaal.
    const entries = this._allModEntries().filter(e => !e.mod.fractured);
    if (entries.length === 0) return null;
    const pick = entries[this._randomInt(0, entries.length - 1)];

    if (pick.type === 'prefix') {
      this._item.prefixes.splice(pick.index, 1);
    } else {
      this._item.suffixes.splice(pick.index, 1);
    }
    return { ...pick.mod, type: pick.type };
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Private — random helpers
  // ══════════════════════════════════════════════════���════════════════════

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

  // ═══════════════════════════════════════════════════════════════════════
  //  Private — result builders
  // ═══════════════════════════════════════════════════════════════════════

  _success(payload) {
    return { success: true, item: this.getItem(), ...payload };
  }

  _fail(error) {
    return { success: false, error, item: this.getItem() };
  }
}
