# PoE2 Crafting Simulator

A click-and-play **Path of Exile 2 crafting *emulator*** (not a probability calculator). Double-click `index.html` to play — no server, no install, no terminal needed. Works offline and on a locked-down office laptop.

This README explains **what every file does** and **where to look when something breaks** — written so a human *or* an AI assistant can pick it up cold.

---

## ▶️ Quick start

- **Play it:** double-click `index.html`.
- **Changed mod data:** double-click `build.cmd` (home PC only), then open `index.html`.
- **Upload to GitHub:** double-click `push.cmd` (home PC only) → pushes to `Ri-el/poe2-crafting`.

> The app reads compiled `.data.js` files (because `file://` can't fetch raw `.json`). After editing any JSON you MUST run `build.cmd` to recompile, or the app won't see your change.

---

## 🗺️ Architecture in one paragraph

You edit **one small JSON file per base item** in `data/bases/` (e.g. `ruby.json`, `helmets_str.json`). `build.cmd` runs `build_data.ps1`, which bundles all of those into a single browser-loadable file, `data/mods.data.js` (it sets `window.MOD_BASES`). `app.js` boots the page, reads `window.MOD_BASES`, and hands the data to the crafting engine in `crafting.js`. `select.js` draws the item-picker menu. Styling is in the `.css` files. That's the whole loop: **edit JSON → build → play**.

---

## 📄 App files (the stuff that runs the simulator)

| File | What it does | Look here when… |
|---|---|---|
| `index.html` | The page itself. Loads every script/style in order. The `<script>` tags at the bottom decide what code runs. | A file you added isn't loading, or you need to add a new script/style tag. |
| `app.js` | **Boot + UI glue.** Wraps everything in an IIFE (`window.CraftingEngine`), reads `window.MOD_BASES` from the compiled data, builds the engine, wires up buttons, cursor orb, animations, the stash, and ALT tier tooltips. Has a guard that throws a clear error if the mod data didn't load (\"run build\"). | Buttons/clicks/tooltips/animations misbehave, or data isn't loading into the UI. |
| `crafting.js` | **The crafting engine (the rules).** All currency behavior lives here — Transmute, Augment, Regal, Exalt, Chaos, Annul, Alchemy, Divine, Vaal, Desecrate, plus prefix/suffix caps and tier rolling. `new CraftingEngine(modData, baseType, desecratedData)`. | An orb does the wrong thing, mods roll incorrectly, or affix caps are off. **Engine bugs live here, NOT in the data files.** |
| `select.js` | **Item-picker menu.** Defines the category tree (jewels, armour, weapons, etc.). Each category has a `status` of `'active'` or `'soon'` (greyed out). Flip `'soon'`→`'active'` once a base has real data. | A base/category isn't selectable, or you finished its data and want to turn it on. |
| `style.css` | Main look — item tooltip, stash panel, dark PoE2 theme, layout. | General visual styling. |
| `desecrate.css` | Styling specific to the Desecrate / abyssal-bones overlay feature. | The desecrate panel looks wrong. |
| `select.css` | Styling for the item-picker menu only. | The category picker looks wrong. |
| `sw.js` | Service worker — caches files so the app works offline / installs as a PWA. | Offline mode or \"install app\" behaves oddly (or stale cache after an update). |
| `manifest.json` | PWA metadata (app name, icons, colors) so it can install to desktop/phone. | Install name/icon is wrong. |

---

## 🧱 Data files

| File / folder | What it does | Look here when… |
|---|---|---|
| `data/bases/*.json` | **The mod data — one file per base item (61 files).** This is what you hand-edit. Each file is self-contained: `{ name, attribute?, prefixes:[], suffixes:[] }`. Only the 3 jewels `ruby`, `emerald`, `sapphire` are filled in; the other 58 are empty scaffolds waiting for real mods. | A specific base has wrong/missing mods — open just that one file. **Wrong weighting or a missing modifier = a data bug, fix it here.** |
| `data/mods.data.js` | **Auto-generated.** `build_data.ps1` bundles every `data/bases/*.json` into this one file (`window.MOD_BASES[\"<id>\"] = {...}`). The app loads this, not the raw JSON. | Never edit by hand. If it's stale/missing, run `build.cmd`. |
| `data/desecrated-mods.json` | Source data for the Desecrate (abyssal bone) feature — one shared jewel pool (Lightless prefixes + of-the-Abyss suffixes), keyed under `jewelTypes` and gated by `bones` (only `preserved_cranium` is valid for jewels). Hand-editable. | Desecrate offers wrong mods. |
| `data/desecrated-mods.data.js` | **Auto-generated** browser version of the above (built by `build_data.ps1`). | Don't edit by hand; rebuild instead. |

### The 61 base files at a glance
- **Jewels:** `ruby`, `emerald`, `sapphire` *(filled in)*; `diamond` *(empty scaffold)*
- **Time-Lost jewels (empty):** `time_lost_ruby/emerald/sapphire/diamond`
- **Armour (empty):** `gloves_*`, `boots_*`, `helmets_*` (6 attribute combos each), `body_armours_*` (7 combos)
- **Weapons (empty):** `claws, daggers, wands, one_hand_swords/axes/maces, sceptres, spears, flails, bows, staves, two_hand_swords/axes/maces, quarterstaves, crossbows`
- **Jewellery (empty):** `amulets, rings, belts`
- **Off-hand (empty):** `quivers, shields_str, shields_str_dex, shields_str_int, bucklers, foci`
- **Flasks (empty):** `life_flasks, mana_flasks, charms`

---

## 🛠️ Build & tooling files

| File | What it does | Notes |
|---|---|---|
| `build.cmd` | **Double-click to rebuild.** Runs `build_data.ps1` via PowerShell. | Home PC only (office laptops block PowerShell). Run after editing any JSON. |
| `build_data.ps1` | The actual build script: validates each `data/bases/*.json`, bundles them into `data/mods.data.js`, and also compiles `desecrated-mods.json` → `.data.js`. Writes UTF-8 (no BOM). | Edit only if the build process itself needs to change. |
| `push.cmd` | **Double-click to upload everything to GitHub.** Inits git if needed, then force-pushes the whole folder to `Ri-el/poe2-crafting` (`main`). | Home PC only. Force-push overwrites the old version on GitHub — pull/sync first if the repo changed elsewhere. |
| `serve.ps1` | Optional: starts a tiny local web server (only needed if you ever want to test PWA/service-worker features that `file://` can't do). | Not needed for normal play. |
| `.gitignore` | Tells git which files to skip (OS junk, `node_modules/`, the dev-only generator). | — |

---

## 🤖 Dev-only / not shipped

| File | What it does |
|---|---|
| `_scaffold_data.mjs` | One-off Node generator that split the jewel data into per-base files and created the empty scaffolds. Already done its job; kept for reference. Git-ignored. |
| `fuzz.mjs` | **Node fuzz / regression harness for the crafting engine.** Uses a seeded PRNG (mulberry32) so every run is reproducible, dynamically imports `crafting.js` with a small `window` shim, builds `modData` from `data/bases/*.json` + shared pools, and auto-discovers every base that actually has mods. It hammers the engine with random sequences from 19 labeled actions — every currency plus the full Desecrate / abyssal-bone flow — and runs an invariant sweep after each step (affix caps, prefix/suffix limits, rarity rules). Exits non-zero on any violation so it can gate CI. Run with `node fuzz.mjs [iterations] [seed]` (defaults: 20000 iterations, random seed). |

---

## 🧭 \"Something's wrong\" cheat sheet

- **An orb / currency behaves wrong, caps wrong, tiers wrong** → `crafting.js` (engine logic).
- **A specific item has wrong or missing mods** → that one file in `data/bases/` (data), then run `build.cmd`.
- **Clicks, tooltips, animations, cursor orb, stash UI** → `app.js`.
- **A category won't appear or won't select** → `select.js` (check `status`, flip `'soon'`→`'active'`).
- **Visuals/layout** → `style.css` (main), `select.css` (menu), `desecrate.css` (desecrate panel).
- **Edited JSON but nothing changed in the app** → you forgot to run `build.cmd` (the app reads the compiled `.data.js`, not raw JSON).
- **Offline/install issues or stale content after update** → `sw.js` (service worker cache).

---

## ➕ Adding a new base later (no code edits needed)
1. Drop a new file in `data/bases/`, e.g. `data/bases/my_new_base.json` with `{ \"name\": \"My Base\", \"prefixes\": [], \"suffixes\": [] }`.
2. Fill in its `prefixes` / `suffixes`.
3. Double-click `build.cmd`.
4. If it should show in the menu, set its category to `'active'` in `select.js`.

That's it — `index.html` and `app.js` never need to change.
