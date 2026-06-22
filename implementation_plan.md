# PoE2 Jewel Crafting Emulator — PWA

A Progressive Web App that faithfully simulates the hands-on jewel crafting experience of Path of Exile 2. Right-click a currency to arm it, left-click the jewel to apply — infinite practice mode.

## Proposed Changes

### Architecture Overview

Pure vanilla HTML + CSS + JS — no frameworks, no build tools, no npm. This keeps it simple, fast, and trivially hostable on any free static host. The PWA service worker handles offline caching.

```
c:\Users\Haziq\Documents\POE2\
├── index.html              # Single-page app shell
├── style.css               # All styling (PoE2 dark theme)
├── app.js                  # Main application logic, UI rendering, event handling
├── crafting.js             # Crafting engine (currency effects, mod rolling, validation)
├── data/
│   └── jewel-mods.json     # All modifier data (editable, separate file)
├── audio/
│   └── (generated .wav)    # Tiny procedurally-generated sounds per orb (Web Audio API)
├── icons/
│   ├── icon-192.png        # PWA icon 192×192
│   └── icon-512.png        # PWA icon 512×512
├── manifest.json           # PWA manifest
└── sw.js                   # Service worker for offline support
```

---

### Data File — `data/jewel-mods.json`

Separate, editable JSON file containing all jewel modifier data. Structure:

```json
{
  "prefixes": [
    {
      "modGroup": "IncreasedLife",
      "tiers": [
        { "tier": 1, "name": "Transcendent", "modLine": "+{0} to maximum Life", "min": 35, "max": 40, "ilvlReq": 75, "weight": 500 },
        { "tier": 2, "name": "Prime", "modLine": "+{0} to maximum Life", "min": 28, "max": 34, "ilvlReq": 60, "weight": 750 }
      ]
    }
  ],
  "suffixes": [ /* same structure */ ]
}
```

Will include ~8-10 prefix groups and ~8-10 suffix groups with 2-4 tiers each — enough for realistic crafting variety. Weights control drop rates.

---

### Crafting Engine — `crafting.js`

Core logic, fully separated from UI:

| Currency | Precondition | Effect |
|---|---|---|
| **Transmutation** | Normal item | → Magic, rolls 1 random mod (prefix or suffix) |
| **Augmentation** | Magic item, not full | Adds 1 random mod (respects 1P/1S cap) |
| **Regal** | Magic item | → Rare, adds 1 random mod |
| **Exalted** | Rare item, not full | Adds 1 random mod (respects 3P/3S cap) |
| **Chaos** | Rare item | Removes 1 random mod, adds 1 random mod |
| **Alchemy** | Normal item | → Rare with 4 random mods |
| **Annulment** | Has ≥1 mod | Removes 1 random mod. If Magic has 0 mods → Normal. If Rare has 0 mods → Normal |
| **Divine** | Has ≥1 mod with range | Re-rolls all numeric values within each mod's [min, max] range |

Rules enforced:
- Max 1 prefix + 1 suffix on Magic
- Max 3 prefixes + 3 suffixes on Rare
- No duplicate mod groups on the same item
- Weighted random selection using the `weight` field
- Item level 83 (default high ilvl, all tiers accessible)

---

### UI & Interaction — `app.js` + `style.css`

#### Layout (responsive)
- **Desktop**: Two-column — Currency stash panel (left), Jewel tooltip (center/right)
- **Mobile**: Stacked — Jewel tooltip (top), Currency stash (bottom, scrollable row)

#### Jewel Tooltip (faithful to PoE2)
- Near-black background (`#0c0c0e`) with subtle border gradient
- Header: Base name + rarity color (white/`#c8c8c8` Normal, `#8888ff` Magic, `#ff0` Rare)
- Separator line styled like in-game
- Explicit modifiers listed with PoE2's signature font feel (using `Fontin SmallCaps` lookalike via Google Fonts fallback to a clean serif)
- Item Level shown at bottom in grey

#### Modifier Hover / Alt-Key Tooltip
- On hover (desktop) or long-press (mobile), show an overlay with:
  - **Prefix** or **Suffix** tag (colored)
  - Tier number (e.g., "T1")
  - Mod group name
  - Roll range (e.g., "35–40") with current value highlighted
- Alt key held = show all mods' details simultaneously (like in-game)

#### Cursor Interaction
- **Right-click** a currency orb → "arms" it (cursor changes to show the orb, orb in stash gets a selection glow)
- **Left-click** the jewel → applies the armed currency
- **Right-click** anywhere else or press Escape → disarms
- On mobile: **Tap** a currency to arm it, **Tap** the jewel to apply. Tap elsewhere to disarm.
- Invalid applications show a brief red flash + error text (e.g., "Item is not Normal")

#### Animations
- Successful craft: brief white/golden glow pulse radiating from the jewel center
- Rarity change: smooth color transition on the title
- Mod added: new mod line fades in with a subtle slide-down
- Mod removed: line fades out

#### Sounds (Web Audio API — no external files needed)
- Each orb gets a procedurally generated sound using `OscillatorNode` + `GainNode`:
  - Transmutation: soft chime (high sine sweep)
  - Augmentation: double-tap (two short blips)
  - Regal: ascending crystalline tone
  - Exalted: deep resonant gong
  - Chaos: distorted warble
  - Annulment: sharp descending sweep
  - Alchemy: multi-layered sparkle
  - Divine: harmonic shimmer
- Each sound is ~200-400ms, generated at runtime. No audio files to host.

#### Reset Button
- "Reset Item" button returns the jewel to a clean Normal (white) base with no modifiers
- Plays a subtle "whoosh" sound

---

### PWA — `manifest.json` + `sw.js`

- **manifest.json**: App name "PoE2 Craft Sim", theme color `#0c0c0e`, display `standalone`, icons
- **sw.js**: Cache-first strategy. On install, pre-caches all HTML/CSS/JS/JSON/icons. Works fully offline.
- Icons will be generated using the image generation tool (jewel-themed)

---

### Mobile Considerations

- Touch-friendly button sizes (min 44×44px)
- Tap-to-arm replaces right-click
- Long-press on mod shows details (replaces hover)
- Viewport meta tag for proper scaling
- Bottom currency bar with horizontal scroll for thumb reach

---

## Verification Plan

### Manual Verification
1. Open in browser, verify all 8 currencies work correctly
2. Test prefix/suffix caps (Magic: 1+1, Rare: 3+3)
3. Test mod group uniqueness (no duplicate groups)
4. Test Divine re-rolls stay within tier ranges
5. Test Annulment edge case (removing last mod → Normal)
6. Verify Alt-key shows all mod details
7. Verify hover shows individual mod details
8. Test right-click arm → left-click apply flow
9. Install as PWA on desktop Chrome
10. Install as PWA on mobile (Android Chrome / iOS Safari)
11. Test offline: enable airplane mode, verify app still works
12. Test responsive layout at various breakpoints

### Hosting Verification
- Deploy to GitHub Pages and verify it loads correctly
