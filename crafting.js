// crafting.js - PoE2 Crafting Engine (base-agnostic)
// ES Module — no external dependencies
//
// The engine is no longer hardcoded to jewels. It reads a generic base data
// object keyed by base type (supports both `bases` and the legacy `jewelTypes`
// key) and per-base affix limits. Jewels remain the default base.

class CraftingEngine {
  static LIMITS = {
    magic: { prefixes: 1, suffixes: 1 },
    rare:  { prefixes: 2, suffixes: 2 },
  };

  static RARE_NAME_A = ['Brood','Cataclysm','Dragon','Doom','Vortex','Storm','Blood','Onslaught','Eagle','Empyrean','Phoenix','Grim','Hypnotic','Maelstrom','Pandemonium','Rune','Skull','Sol','Spirit','Tempest','Vengeance','Viper','Wrath','Carrion','Corpse','Demon','Dusk','Gloom','Hate','Morbid'];
  static RARE_NAME_B = ['Husk','Wound','Whorl','Bane','Crest','Glyph','Grasp','Knot','Mark','Pith','Sigil','Song','Star','Thirst','Veil','Ward','Weave','Bauble','Charm','Eye','Heart','Light','Loop','Nexus','Pulse','Shard','Spark','Token','Visage','Core'];

  // Abyssal Bone configuration. For jewels the relevant bone is the
  // Preserved Cranium: it opens the Well of Souls and reveals 3 options
  // (a mix of Desecrated/Abyssal and ordinary affixes on the targeted side).
  static BONES = {
    // Cranium is the jewel bone. In-game only the Preserved quality exists for
    // Craniums (Gnawed/Ancient apply to Jawbone/Rib/Collarbone, not jewels).
    preserved_cranium: { name: 'Preserved Cranium', reveal: 3, desecratedOnly: false },
  };

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

  loadItem(item, pending = null) {
    this._item = structuredClone(item);
    if (!this._item.currencyUsed) this._item.currencyUsed = {};
    if (!Array.isArray(this._item.enchantments)) this._item.enchantments = [];
    if (!Array.isArray(this._item.prefixes)) this._item.prefixes = [];
    if (!Array.isArray(this._item.suffixes)) this._item.suffixes = [];
    if (this._item.sanctified == null) this._item.sanctified = false;
    // Optionally restore a pending (unrevealed) desecration so undo/redo can
    // bring the Reveal step back exactly as it was.
    this._pendingDesecration = pending ? structuredClone(pending) : null;
    return this.getItem();
  }

  // Set the item level (1-100). Rebuilds the eligible candidate pools so the
  // tiers that can roll always match the current ilvl.
  setItemLevel(level) {
    const n = Math.max(1, Math.min(100, Math.round(Number(level) || 0)));
    this._item.ilvl = n;
    this._prefixCandidates = this._buildCandidatePool(this._prefixPool, 'prefix');
    this._suffixCandidates = this._buildCandidatePool(this._suffixPool, 'suffix');
    return n;
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
    if (this._item.sanctified) return this._fail('Item is sanctified and cannot be modified further.');
    return null;
  }

  // `quality` (0..1) biases the newly added mod toward the top of its value
  // range (Greater 0.5 / Perfect 0.8). 0 = an ordinary, fully-random roll.
  applyTransmutation(quality = 0) {
    const err = this._checkCorrupted(); if (err) return err;
    if (this._item.rarity !== 'normal') return this._fail('Orb of Transmutation can only be used on Normal items.');
    const previousRarity = this._item.rarity;
    this._item.rarity = 'magic';
    const added = this._addRandomMod('magic', quality);
    if (!added) { this._item.rarity = previousRarity; return this._fail('No eligible mods available.'); }
    return this._success({ action: 'transform', addedMods: [added], previousRarity });
  }

  applyAugmentation(quality = 0) {
    const err = this._checkCorrupted(); if (err) return err;
    if (this._item.rarity !== 'magic') return this._fail('Orb of Augmentation can only be used on Magic items.');
    if (this._isAtModLimit('magic')) return this._fail('Item already has max mods for a Magic item (1 prefix + 1 suffix).');
    const added = this._addRandomMod('magic', quality);
    if (!added) return this._fail('No eligible open affix available.');
    return this._success({ action: 'add', addedMods: [added], previousRarity: 'magic' });
  }

  applyRegal(quality = 0) {
    const err = this._checkCorrupted(); if (err) return err;
    if (this._item.rarity !== 'magic') return this._fail('Regal Orb can only be used on Magic items.');
    const previousRarity = this._item.rarity;
    const previousName = this._item.name;
    this._item.rarity = 'rare';
    this._item.name = this._generateRareName();
    const added = this._addRandomMod('rare', quality);
    if (!added) {
      this._item.rarity = previousRarity;
      this._item.name = previousName;
      return this._fail('No eligible mods available.');
    }
    return this._success({ action: 'transform', addedMods: [added], previousRarity });
  }

  applyExalted(quality = 0) {
    const err = this._checkCorrupted(); if (err) return err;
    if (this._item.rarity !== 'rare') return this._fail('Exalted Orb can only be used on Rare items.');
    if (this._isAtModLimit('rare')) return this._fail('Item already has max mods for a Rare jewel (2 prefixes + 2 suffixes).');
    const added = this._addRandomMod('rare', quality);
    if (!added) return this._fail('No eligible open affix available.');
    return this._success({ action: 'add', addedMods: [added], previousRarity: 'rare' });
  }

  // `omen` may be one of: 'whittling' (remove the lowest modifier level),
  // 'sinistral_erasure' (remove a prefix), or 'dextral_erasure' (remove a
  // suffix). The Chaos Orb then adds a new random modifier as usual.
  applyChaos(omen = null, quality = 0) {
    const err = this._checkCorrupted(); if (err) return err;
    if (this._item.rarity !== 'rare') return this._fail('Chaos Orb can only be used on Rare items.');
    if (this._allModEntries().length === 0) return this._fail('Item has no mods to modify.');

    let removed;
    if (omen === 'whittling') {
      removed = this._removeMod({ mode: 'lowest' });
      if (!removed) return this._fail('Omen of Whittling: all modifiers are fractured and cannot be changed.');
    } else if (omen === 'sinistral_erasure') {
      removed = this._removeMod({ side: 'prefix' });
      if (!removed) return this._fail('Omen of Sinistral Erasure: no removable prefix on this item.');
    } else if (omen === 'dextral_erasure') {
      removed = this._removeMod({ side: 'suffix' });
      if (!removed) return this._fail('Omen of Dextral Erasure: no removable suffix on this item.');
    } else {
      removed = this._removeRandomMod();
      if (!removed) return this._fail('All modifiers are fractured and cannot be changed.');
    }

    const added = this._addRandomMod('rare', quality);
    if (!added) return this._success({ action: 'remove', removedMods: [removed], previousRarity: 'rare', omen });
    return this._success({ action: 'reroll', addedMods: [added], removedMods: [removed], previousRarity: 'rare', omen });
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

  applyAnnulment(opts = {}) {
    const err = this._checkCorrupted(); if (err) return err;
    if (this._allModEntries().length === 0) return this._fail('Item has no mods to remove.');
    const previousRarity = this._item.rarity;

    // Omen of Light: the next Orb of Annulment removes ONLY a Desecrated mod.
    if (opts.desecratedOnly) {
      const desEntries = this._allModEntries()
        .filter(e => !e.mod.fractured && e.mod.desecrated);
      if (desEntries.length === 0) {
        return this._fail('Omen of Light: this item has no Desecrated modifier to remove.');
      }
      const pick = desEntries[this._randomInt(0, desEntries.length - 1)];
      if (pick.type === 'prefix') this._item.prefixes.splice(pick.index, 1);
      else this._item.suffixes.splice(pick.index, 1);
      return this._success({ action: 'remove', removedMods: [{ ...pick.mod, type: pick.type }], previousRarity });
    }

    // Sinistral / Dextral Annulment omens remove ONLY a prefix / suffix.
    if (opts.omen === 'sinistral_annulment') {
      const removed = this._removeMod({ side: 'prefix' });
      if (!removed) return this._fail('Omen of Sinistral Annulment: no removable prefix to remove.');
      return this._success({ action: 'remove', removedMods: [removed], previousRarity, omen: opts.omen });
    }
    if (opts.omen === 'dextral_annulment') {
      const removed = this._removeMod({ side: 'suffix' });
      if (!removed) return this._fail('Omen of Dextral Annulment: no removable suffix to remove.');
      return this._success({ action: 'remove', removedMods: [removed], previousRarity, omen: opts.omen });
    }

    const removed = this._removeRandomMod();
    if (!removed) return this._fail('All modifiers are fractured and cannot be removed.');
    return this._success({ action: 'remove', removedMods: [removed], previousRarity });
  }

  // `omen` may be 'sanctification': the Divine Orb instead SANCTIFIES the item,
  // rolling every modifier toward (and potentially beyond) its normal range and
  // locking the item from any further modification.
  applyDivine(omen = null) {
    const err = this._checkCorrupted(); if (err) return err;
    if (this._allModEntries().length === 0) return this._fail('Item has no mods to re-roll values on.');

    if (omen === 'sanctification') {
      if (this._item.rarity !== 'rare') return this._fail('Omen of Sanctification can only be used on Rare items.');
      const sanctifiable = this._allModEntries().filter(({ mod }) => !mod.fractured);
      if (sanctifiable.length === 0) return this._fail('Omen of Sanctification: all modifiers are fractured.');
      this._applySanctification();
      return this._success({ action: 'sanctify', previousRarity: this._item.rarity, omen, sanctified: true });
    }

    const rerollable = this._allModEntries().filter(({ mod }) => !mod.fractured);
    const lineHasRange = (l) => l.min != null && l.max != null && l.min !== l.max;
    const modHasRange = (mod) =>
      (mod.min != null && mod.max != null && mod.min !== mod.max) ||
      (Array.isArray(mod.lines) && mod.lines.some(lineHasRange));
    const hasRange = rerollable.some(({ mod }) => modHasRange(mod));
    if (!hasRange) return this._fail('No re-rollable mods (fractured or fixed-value mods are locked).');

    for (const { mod } of rerollable) {
      if (Array.isArray(mod.lines) && mod.lines.length) {
        let changed = false;
        for (const l of mod.lines) {
          if (lineHasRange(l)) {
            l.value = this._randomInt(l.min, l.max);
            l.text = l.modLine.replaceAll('{0}', l.value);
            changed = true;
          }
        }
        if (changed) mod.displayText = mod.lines.map(l => l.text).join('\n');
      } else if (mod.min != null && mod.max != null && mod.min !== mod.max) {
        mod.value = this._randomInt(mod.min, mod.max);
        mod.displayText = mod.modLine.replaceAll('{0}', mod.value);
      }
    }
    return this._success({ action: 'reroll', previousRarity: this._item.rarity });
  }

  // Which corruption outcomes are currently valid (used by Hinekora's Lock).
  vaalOutcomeOptions() {
    const hasMods = this._allModEntries().length > 0;
    const affixRarity = this._item.rarity === 'magic' || this._item.rarity === 'rare';
    const opts = [{ outcome: 1, key: 'none' }];
    if (hasMods && affixRarity) opts.push({ outcome: 2, key: 'reroll' });
    opts.push({ outcome: 3, key: 'enchant' });
    opts.push({ outcome: 4, key: 'modify' });
    return opts;
  }

  applyVaal(forcedOutcome = null) {
    const err = this._checkCorrupted(); if (err) return err;

    this._item.corrupted = true;
    const previousRarity = this._item.rarity;
    const hasMods = this._allModEntries().length > 0;

    const affixRarity = this._item.rarity === 'magic' ? 'magic'
                      : this._item.rarity === 'rare' ? 'rare'
                      : null;

    let outcome = forcedOutcome != null ? forcedOutcome : this._randomInt(1, 4);
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
  //  Omens (a directional omen MAY be combined with Abyssal Echoes):
  //   - 'sinistral_necromancy' -> target a prefix
  //   - 'dextral_necromancy'   -> target a suffix (exclusive with sinistral)
  //   - 'abyssal_echoes'       -> one reroll of the revealed options

  getPendingDesecration() {
    return this._pendingDesecration ? structuredClone(this._pendingDesecration) : null;
  }

  // Essence of the Abyss: removes a random modifier and augments a Rare item
  // with the guaranteed "Mark of the Abyssal Lord" modifier. The Mark does
  // nothing on its own until the item is next Desecrated, at which point the
  // Mark is consumed and guarantees a Desecrated modifier (of a higher tier
  // once per-base modifier levels exist).
  applyEssenceOfAbyss() {
    const err = this._checkCorrupted(); if (err) return err;
    if (this._item.rarity !== 'rare') return this._fail('Essence of the Abyss can only be used on a Rare item.');
    if (this._item.prefixes.some(m => m.mark) || this._item.suffixes.some(m => m.mark)) {
      return this._fail('This item already carries the Mark of the Abyssal Lord.');
    }
    const removed = this._removeRandomMod();
    if (!removed) return this._fail('Essence of the Abyss: all modifiers are fractured and cannot be removed.');

    const lim = this._limits[this._item.rarity] || this._limits.rare;
    const sides = [];
    if (this._item.prefixes.length < lim.prefixes) sides.push('prefix');
    if (this._item.suffixes.length < lim.suffixes) sides.push('suffix');
    const side = sides.length ? sides[this._randomInt(0, sides.length - 1)] : (removed.type || 'prefix');
    const mark = {
      modGroup: '__mark_of_abyssal_lord__',
      tier: 'D',
      tierName: 'Mark of the Abyssal Lord',
      displayText: 'Mark of the Abyssal Lord',
      fractured: false,
      desecrated: true,
      unrevealed: true,
      mark: true,
      affix: side,
    };
    (side === 'prefix' ? this._item.prefixes : this._item.suffixes).push(mark);
    return this._success({ action: 'mark', addedMods: [{ ...mark, type: side }], removedMods: [removed], previousRarity: 'rare' });
  }

  // Essence of the Breach has no effect on Jewels (its guaranteed modifier
  // category does not exist on jewel bases). Intentionally a no-op here and
  // disabled in the jewel UI; it will be implemented when other bases land.
  applyEssenceOfBreach() {
    return this._fail('Essence of the Breach has no effect on Jewels.');
  }

  startDesecration({ bone = 'preserved_cranium', omen = null, omens = null } = {}) {
    const err = this._checkCorrupted(); if (err) return err;
    if (this._item.rarity !== 'rare') {
      return this._fail('Desecration can only be used on a Rare item (use Alchemy or Regal first).');
    }
    // Mark of the Abyssal Lord (applied by Essence of the Abyss): desecrating an
    // item that carries the Mark ALWAYS consumes it, guaranteeing an Unrevealed
    // Desecrated modifier. Remove the Mark up front so the one-time "already
    // desecrated" guard below doesn't block this intended interaction.
    let markConsumed = false;
    let markSide = null;
    for (const [arrName, sideName] of [['prefixes', 'prefix'], ['suffixes', 'suffix']]) {
      const idx = this._item[arrName].findIndex(m => m.mark);
      if (idx !== -1) { this._item[arrName].splice(idx, 1); markConsumed = true; markSide = sideName; }
    }

    // PoE2 rule: an item that already carries a Desecrated modifier cannot be
    // desecrated again — desecration is a one-time, permanent step per item.
    if (this._item.prefixes.some(m => m.desecrated) ||
        this._item.suffixes.some(m => m.desecrated)) {
      return this._fail('This item already has a Desecrated modifier and cannot be desecrated again.');
    }
    if (this._desecratedPrefixes.length === 0 && this._desecratedSuffixes.length === 0) {
      return this._fail('No Desecrated modifiers are available for this base.');
    }

    // Accept either a single `omen` (legacy) or an `omens` array, so a
    // directional Necromancy omen can be combined with Abyssal Echoes.
    const omenList = Array.isArray(omens) ? omens.slice() : (omen ? [omen] : []);

    let targetSide = null;
    if (omenList.includes('sinistral_necromancy')) targetSide = 'prefix';
    else if (omenList.includes('dextral_necromancy')) targetSide = 'suffix';
    else if (markConsumed) targetSide = markSide;

    const side = this._resolveDesecrationSide(targetSide);
    const sidePool = side === 'prefix' ? this._desecratedPrefixes : this._desecratedSuffixes;
    if (sidePool.length === 0) {
      return this._fail(`No Desecrated ${side} modifiers available for this base.`);
    }

    const lim = this._limits[this._item.rarity] || this._limits.rare;
    const cap = lim[side === 'prefix' ? 'prefixes' : 'suffixes'];
    const current = (side === 'prefix' ? this._item.prefixes : this._item.suffixes).length;
    const mode = current < cap ? 'add' : 'replace';
    const rerollsLeft = omenList.includes('abyssal_echoes') ? 1 : 0;

    // Bone sets the base number of revealed options. Omen of Light is NOT a
    // reveal omen — it modifies the next Orb of Annulment instead.
    const boneCfg = CraftingEngine.BONES[bone] || CraftingEngine.BONES.preserved_cranium;
    const desecratedOnly = !!boneCfg.desecratedOnly || markConsumed;
    const revealCount = boneCfg.reveal || 3;

    // Bone item-level gating (PoE2 0.5.0 Abyssal bones):
    //  - Gnawed:    can only desecrate items of ilvl <= maxItemLevel (64).
    //  - Preserved: no item-level limit.
    //  - Ancient:   no ilvl limit, but guarantees a minimum modifier level (40).
    if (boneCfg.maxItemLevel != null && (this._item.ilvl || 0) > boneCfg.maxItemLevel) {
      return this._fail(`${boneCfg.name} can only desecrate items of Item Level ${boneCfg.maxItemLevel} or lower (this item is Item Level ${this._item.ilvl}).`);
    }
    const minModLevel = boneCfg.minModLevel || 0;

    const options = this._rollDesecratedOptions(side, revealCount, { desecratedOnly, minModLevel });
    if (options.length === 0) return this._fail('No eligible Desecrated modifiers to reveal.');

    // Place an UNREVEALED Desecrated modifier on the item immediately (PoE2
    // style): it fills the open slot on the targeted side, or replaces a random
    // non-fractured mod there when the side is full. The actual modifier stays
    // hidden (rendered as a green "Desecrated Modifier" line) until the player
    // reveals it at the Well of Souls. The reveal options are rolled now and
    // kept pending until then.
    const arr = side === 'prefix' ? this._item.prefixes : this._item.suffixes;
    const placeholder = {
      modGroup: '__desecrated_pending__',
      tier: 'D',
      tierName: 'Desecrated',
      displayText: 'Desecrated Modifier',
      fractured: false,
      desecrated: true,
      unrevealed: true,
      affix: side,
    };
    let removedMod = null;
    if (mode === 'add') {
      arr.push(placeholder);
    } else {
      const candidates = arr.map((m, i) => ({ m, i })).filter(x => !x.m.fractured && !x.m.unrevealed);
      if (candidates.length === 0) {
        return this._fail('All modifiers on that side are fractured and cannot be replaced.');
      }
      const pick = candidates[this._randomInt(0, candidates.length - 1)];
      removedMod = { ...arr[pick.i], type: side };
      arr.splice(pick.i, 1, placeholder);
    }

    this._pendingDesecration = { bone, omens: omenList, side, mode, rerollsLeft, revealCount, desecratedOnly, options, removedMod };
    return {
      success: true,
      action: 'desecrate-pending',
      bone, side, mode, rerollsLeft, options,
      addedMods: [{ ...placeholder, type: side }],
      removedMods: removedMod ? [removedMod] : [],
      item: this.getItem(),
    };
  }

  rerollDesecration() {
    const pd = this._pendingDesecration;
    if (!pd) return this._fail('No desecration in progress.');
    // Omen of Abyssal Echoes is activated AT REVEAL TIME (not before
    // desecrating). It rerolls the revealed Well of Souls options.
    pd.options = this._rollDesecratedOptions(pd.side, pd.revealCount || 3, { desecratedOnly: !!pd.desecratedOnly });
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

    const previousRarity = this._item.rarity;

    const record = structuredClone(chosen);
    delete record.affix;
    // Anything pulled from the Well of Souls counts as a Desecrated modifier,
    // even base prefixes/suffixes in the reveal pool (renders green).
    record.desecrated = true;
    delete record.unrevealed;

    // Replace the unrevealed placeholder (placed when the item was desecrated)
    // with the revealed modifier, in its exact slot.
    let placedSide = pd.side;
    let replaced = false;
    for (const s of ['prefixes', 'suffixes']) {
      const idx = this._item[s].findIndex(m => m.unrevealed);
      if (idx !== -1) {
        this._item[s].splice(idx, 1, record);
        placedSide = s === 'prefixes' ? 'prefix' : 'suffix';
        replaced = true;
        break;
      }
    }
    if (!replaced) {
      // Fallback (should not happen): no placeholder present — add to the side.
      const arr = pd.side === 'prefix' ? this._item.prefixes : this._item.suffixes;
      arr.push(record);
    }

    this._pendingDesecration = null;
    return this._success({
      action: 'desecrate',
      addedMods: [{ ...record, type: placedSide }],
      removedMods: [],
      desecratedSide: placedSide,
      previousRarity,
    });
  }

  cancelDesecration() {
    this._pendingDesecration = null;
    return { success: true, action: 'desecrate-cancel', item: this.getItem() };
  }

  _resolveDesecrationSide(targetSide) {
    if (targetSide === 'prefix' || targetSide === 'suffix') return targetSide;
    const lim = this._limits[this._item.rarity] || this._limits.rare;
    const pCap = lim.prefixes;
    const sCap = lim.suffixes;
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

  _rollDesecratedOptions(side, count = 3, { desecratedOnly = false, minModLevel = 0 } = {}) {
    const existing = this._existingGroups();

    // Desecrated (Abyssal) candidates for this side.
    const desPool = side === 'prefix' ? this._desecratedPrefixes : this._desecratedSuffixes;
    const desCandidates = (desPool || []).map(c => ({
      kind: 'desecrated',
      modGroup: c.modGroup,
      weight: c.weight || 1,
      data: c,
    }));

    // Normal base candidates for this side — the same ilvl-eligible pool the
    // regular orbs roll from — so the Well of Souls also surfaces ordinary
    // prefixes/suffixes, not just Desecrated mods.
    const normPool = side === 'prefix' ? this._prefixCandidates : this._suffixCandidates;
    const normCandidates = desecratedOnly ? [] : (normPool || [])
      // Ancient bone guarantees a minimum modifier level: filter the ordinary
      // affixes surfaced at the Well of Souls to those whose required level
      // meets the floor. (Desecrated jewel mods carry no level yet, so they
      // are intentionally left ungated — per-base modifier levels land later.)
      .filter(c => minModLevel <= 0 || (c.tier.ilvlReq || 0) >= minModLevel)
      .map(c => ({
        kind: 'normal',
        modGroup: c.group.modGroup,
        weight: c.tier.weight || 1,
        data: c,
      }));

    let work = desCandidates.concat(normCandidates).filter(c => !existing.has(c.modGroup));
    if (work.length === 0) work = desCandidates.concat(normCandidates);

    const out = [];
    const usedGroups = new Set();
    while (out.length < count && work.length > 0) {
      // Uniform reveal: every revealed candidate has an EQUAL chance,
      // regardless of its configured weight. (Design choice: if there are 50
      // possible modifiers, each has the same chance to appear.)
      const idx = this._randomInt(0, work.length - 1);
      const pick = work[idx];
      work.splice(idx, 1);
      if (usedGroups.has(pick.modGroup)) continue; // one mod per group in the reveal
      usedGroups.add(pick.modGroup);
      out.push(pick.kind === 'desecrated'
        ? this._materializeDesecrated(pick.data, side)
        : this._materializeNormal(pick.data, side));
    }
    return out;
  }

  // Roll a normal (non-Desecrated) affix candidate into the same option shape
  // the Well of Souls uses. Mirrors _applyMod but does not mutate the item.
  _materializeNormal(candidate, side) {
    const { group, tier } = candidate;
    const hasRange = tier.min != null && tier.max != null;
    const value = hasRange ? this._randomInt(tier.min, tier.max) : null;
    const displayText = tier.modLine
      ? (value != null ? tier.modLine.replaceAll('{0}', value) : tier.modLine)
      : 'Unknown Mod';
    return {
      modGroup: group.modGroup,
      tier: tier.tier,
      tierName: tier.name,
      modLine: tier.modLine,
      displayText,
      value,
      min: tier.min,
      max: tier.max,
      fractured: false,
      affix: side,
    };
  }

  // Build a single rolled stat line from a { modLine, min, max } template.
  _materializeLine(ln) {
    const hasRange = ln.min != null && ln.max != null;
    const value = hasRange ? this._randomInt(ln.min, ln.max) : null;
    const text = ln.modLine
      ? (value != null ? ln.modLine.replaceAll('{0}', value) : ln.modLine)
      : '';
    return { modLine: ln.modLine, min: ln.min, max: ln.max, value, text };
  }

  _materializeDesecrated(c, side) {
    // Multi-stat desecrated mods carry a `lines` array; each line rolls
    // independently and renders on its own row.
    if (Array.isArray(c.lines) && c.lines.length) {
      const lines = c.lines.map(ln => this._materializeLine(ln));
      return {
        modGroup: c.modGroup,
        tier: c.tier || 'D',
        tierName: c.name || 'Desecrated',
        lines,
        displayText: lines.map(l => l.text).join('\n'),
        fractured: false,
        desecrated: true,
        affix: side,
      };
    }
    // Legacy single-stat path.
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
      sanctified: false,
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

  // `quality` (0..1) is forwarded to the value roll so Greater/Perfect orbs
  // produce a high-value modifier. 0 keeps the normal fully-random roll.
  _addRandomMod(rarity, quality = 0) {
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
    return this._selectAndApplyCandidate(candidates, quality);
  }

  _addRandomModOfType(type, rarity, quality = 0) {
    const limits = this._limits[rarity];
    if (!limits) return null;
    const current = type === 'prefix' ? this._item.prefixes : this._item.suffixes;
    const cap = type === 'prefix' ? limits.prefixes : limits.suffixes;
    if (current.length >= cap) return null;
    const candidates = this._eligibleCandidates(type, this._existingGroups());
    if (candidates.length === 0) return null;
    return this._selectAndApplyCandidate(candidates, quality);
  }

  _selectAndApplyCandidate(candidates, quality = 0) {
    const groupMap = new Map();
    for (const c of candidates) {
      const key = `${c.type}:${c.group.modGroup}`;
      groupMap.set(key, (groupMap.get(key) || 0) + c.tier.weight);
    }
    const selectedGroupKey = this._weightedRandom(groupMap);
    const groupCandidates = candidates.filter(c => `${c.type}:${c.group.modGroup}` === selectedGroupKey);
    const tierWeights = groupCandidates.map(c => [c, c.tier.weight]);
    const selected = this._weightedRandomFromPairs(tierWeights);
    return this._applyMod(selected.type, selected.group, selected.tier, quality);
  }

  _applyMod(type, group, tier, quality = 0) {
    const hasRange = tier.min != null && tier.max != null;
    // `quality` (0..1) raises the low end of the roll toward max, so Greater and
    // Perfect orbs land in the upper part of the mod's value range.
    let value = null;
    if (hasRange) {
      const lo = quality > 0 ? Math.ceil(tier.min + (tier.max - tier.min) * quality) : tier.min;
      value = this._randomInt(Math.min(lo, tier.max), tier.max);
    }
    const displayText = tier.modLine
      ? (value != null ? tier.modLine.replaceAll('{0}', value) : tier.modLine)
      : 'Unknown Mod';
    const modRecord = {
      modGroup: group.modGroup,
      tier: tier.tier,
      tierName: tier.name,
      ilvlReq: tier.ilvlReq,
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

  // Remove a single (non-fractured) modifier.
  //  - `side`: 'prefix' | 'suffix' | null (any side)
  //  - `mode`: 'random' (default) or 'lowest' (lowest modifier level / ilvlReq)
  _removeMod({ side = null, mode = 'random' } = {}) {
    // Never strip a pending UNREVEALED desecrated placeholder via Annulment /
    // Chaos / Essence removals — it must persist until it is revealed (or removed
    // explicitly by Omen of Light). This keeps the Reveal panel alive when an
    // unrelated modifier is annulled.
    let entries = this._allModEntries().filter(e => !e.mod.fractured && !e.mod.unrevealed);
    if (side) entries = entries.filter(e => e.type === side);
    if (entries.length === 0) return null;

    let pick;
    if (mode === 'lowest') {
      const levelOf = (m) => (m.ilvlReq != null ? m.ilvlReq : (m.tier != null ? m.tier : 0));
      pick = entries.reduce((lo, e) => (levelOf(e.mod) < levelOf(lo.mod) ? e : lo), entries[0]);
    } else {
      pick = entries[this._randomInt(0, entries.length - 1)];
    }

    if (pick.type === 'prefix') this._item.prefixes.splice(pick.index, 1);
    else this._item.suffixes.splice(pick.index, 1);
    return { ...pick.mod, type: pick.type };
  }

  _removeRandomMod() {
    return this._removeMod({ mode: 'random' });
  }

  // Omen of Sanctification: roll every non-fractured modifier toward (and
  // possibly beyond) its range, then lock the item from further modification.
  _applySanctification() {
    const sanctify = (base) => Math.round(Number(base) * (0.78 + Math.random() * 0.44));
    for (const { mod } of this._allModEntries()) {
      if (mod.fractured) continue;
      if (Array.isArray(mod.lines) && mod.lines.length) {
        for (const l of mod.lines) {
          if (l.value != null && l.modLine) {
            l.value = sanctify(l.value);
            l.text = l.modLine.replaceAll('{0}', l.value);
          }
        }
        mod.displayText = mod.lines.map(l => l.text).join('\n');
      } else if (mod.value != null && mod.modLine) {
        mod.value = sanctify(mod.value);
        mod.displayText = mod.modLine.replaceAll('{0}', mod.value);
      }
    }
    this._item.sanctified = true;
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

window.CraftingEngine = CraftingEngine;
