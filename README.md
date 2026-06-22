# PoE2 Jewel Crafting Simulator

A browser-based sandbox for practicing **Path of Exile 2** jewel crafting. Arm a
currency, click your jewel, and watch the mods roll — with PoE2-style tooltips,
weighted/ilvl-aware modifiers, sounds, and a stash. Runs fully offline as an
installable PWA. No build step, no dependencies, just vanilla JS.

## Features

- **Three jewel types:** Ruby (Str), Emerald (Dex), Sapphire (Int).
- **Currencies:** Transmutation, Augmentation, Alchemy, Regal, Exalted, Chaos,
  Annulment, Divine, Vaal, Fracturing, and Hinekora's Lock.
- **Click-to-apply UX:** arm a currency (left-click or right-click a currency
  button), then click the jewel to apply it. A glowing cursor orb follows the
  pointer in the currency's colour.
- **ALT to inspect:** hold `Alt` to reveal mod tiers, groups, and value ranges.
- **Weighted rolling:** mods are chosen by weight and item-level eligibility,
  respecting prefix/suffix limits and one-mod-per-group rules.
- **Stash:** 24 slots, persisted to `localStorage`. Left-click to load,
  right-click to delete.
- **Undo / Reset** and a currency-used counter that travels with the jewel.
- **Audio:** procedural Web Audio sound effects out of the box, with optional
  sound files (toggle `USE_SOUND_FILES` in `app.js`).
- **PWA:** offline support via a service worker and an installable manifest.

## Run it locally

The app uses `fetch()` and ES modules, so it must be served over HTTP — opening
`index.html` directly via `file://` will not work.

Using the included PowerShell helper:

```powershell
pwsh ./serve.ps1
```

Or any static server, for example:

```bash
python -m http.server 8000
# then open http://localhost:8000
```

## Project structure

| Path | Purpose |
| --- | --- |
| `index.html` | App shell and layout. |
| `app.js` | UI controller: input, rendering, sounds, stash, cursor orb. |
| `crafting.js` | `CraftingEngine` — dependency-free crafting/mod-rolling logic. |
| `style.css` | PoE2-flavoured dark theme. |
| `data/jewel-mods.v2.json` | Mod pools per jewel type (prefixes, suffixes, corrupted implicits). |
| `assets/icons/` | Currency / mark icons. |
| `manifest.json`, `sw.js` | PWA manifest and service worker. |
| `build_data.ps1`, `extract.ps1`, `serve.ps1` | Data-build and local-serve helpers. |

## Notes

This is a practice/learning tool and is **not affiliated with Grinding Gear
Games**. Mod data and behaviour are approximations of in-game mechanics and may
not perfectly match live Path of Exile 2.

## License

[MIT](./LICENSE)
