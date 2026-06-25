#!/usr/bin/env node
// fuzz.mjs - deterministic, invariant-checking fuzz harness for the PoE2 jewel crafting engine.
//
// Usage:   node fuzz.mjs [iterations=20000] [seed]
//
// What it does:
//  - Loads crafting.js the same way the browser app does (window shim + side-effect import),
//    then reads globalThis.window.CraftingEngine. (The old fuzz used a static
//    `import CraftingEngine from './crafting.js'`, but crafting.js has no ESM export - it only
//    assigns window.CraftingEngine - so the old harness could never run a single iteration.)
//  - Rebuilds `modData` from data/bases/*.json (+ optional data/shared/*.json), mirroring the
//    app's mergeModSources()/resolveInherits() pipeline. Auto-discovers every base that actually
//    has mods, so newly-wired bases get fuzzed automatically with no code change.
//  - Loads data/desecrated-mods.json raw and feeds it to the engine (3rd constructor arg), so the
//    Well-of-Souls / desecration code paths are exercised.
//  - Seeds a mulberry32 PRNG and OVERRIDES Math.random, so BOTH the fuzzer's choices and the
//    engine's internal rolls are fully deterministic. The seed is printed so any run is replayable.
//  - Drives ~19 labelled actions covering every public engine method, and after EVERY action checks
//    a set of invariants (affix caps per rarity, no duplicate mod groups, ilvl bounds, rolled values
//    inside their [min,max], corruption lockout). Any breach is a failure.
//  - Prints a full report and exits non-zero on any invariant violation or harness error (CI-ready).

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DATA = path.join(HERE, 'data')

// ---------- args ----------
const ITERATIONS = Math.max(1, parseInt(process.argv[2] ?? '20000', 10) || 20000)
const SEED = process.argv[3] !== undefined ? (parseInt(process.argv[3], 10) >>> 0) : ((Math.random() * 0xffffffff) >>> 0)

// ---------- seeded RNG (mulberry32) ----------
function mulberry32(a) {
	return function () {
		a |= 0
		a = (a + 0x6d2b79f5) | 0
		let t = Math.imul(a ^ (a >>> 15), 1 | a)
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}
const rng = mulberry32(SEED)
const _origRandom = Math.random
Math.random = rng // makes the engine's internal rolls deterministic too

const rnd = () => rng()
const ri = (n) => Math.floor(rng() * n)
const pick = (arr) => arr[ri(arr.length)]

// ---------- load the engine the same way the app does ----------
globalThis.window = globalThis.window || globalThis
async function loadEngine() {
	const url = new URL('./crafting.js', import.meta.url).href
	await import(url) // side-effect: assigns window.CraftingEngine
	const Engine = globalThis.window.CraftingEngine
	if (typeof Engine !== 'function') {
		throw new Error('crafting.js did not define window.CraftingEngine')
	}
	return Engine
}

// ---------- data pipeline (mirrors app.js mergeModSources/resolveInherits) ----------
function readJSON(file) {
	return JSON.parse(readFileSync(file, 'utf8'))
}
function loadShared() {
	const dir = path.join(DATA, 'shared')
	const shared = {}
	if (existsSync(dir)) {
		for (const f of readdirSync(dir)) {
			if (!f.endsWith('.json')) continue
			shared[f.replace(/\.json$/, '')] = readJSON(path.join(dir, f))
		}
	}
	return shared
}
function resolveInherits(baseDef, shared) {
	if (!Array.isArray(baseDef.inherits)) return baseDef
	const def = { ...baseDef }
	const pre = []
	const suf = []
	for (const key of baseDef.inherits) {
		const s = shared[key]
		if (!s) continue
		if (Array.isArray(s.prefixes)) pre.push(...s.prefixes)
		if (Array.isArray(s.suffixes)) suf.push(...s.suffixes)
	}
	def.prefixes = [...pre, ...(baseDef.prefixes || [])]
	def.suffixes = [...suf, ...(baseDef.suffixes || [])]
	delete def.inherits
	return def
}
function hasMods(def) {
	const p = Array.isArray(def.prefixes) ? def.prefixes.length : 0
	const s = Array.isArray(def.suffixes) ? def.suffixes.length : 0
	return p + s > 0
}
function buildModData() {
	const dir = path.join(DATA, 'bases')
	const shared = loadShared()
	const bases = {}
	const discovered = []
	for (const f of readdirSync(dir)) {
		if (!f.endsWith('.json')) continue
		const id = f.replace(/\.json$/, '')
		let def
		try {
			def = readJSON(path.join(dir, f))
		} catch (e) {
			continue
		}
		def = resolveInherits(def, shared)
		bases[id] = def
		if (hasMods(def)) discovered.push(id)
	}
	return { modData: { bases }, fuzzable: discovered }
}
function loadDesecData() {
	const file = path.join(DATA, 'desecrated-mods.json')
	return existsSync(file) ? readJSON(file) : null
}

// ---------- invariants ----------
const PLACEHOLDERS = new Set(['__desecrated_pending__', '__mark_of_abyssal_lord__'])
const EPS = 1e-9

function capFor(Engine, rarity) {
	const r = String(rarity || 'normal').toLowerCase()
	if (r === 'normal') return { p: 0, s: 0 }
	const lim = (Engine.LIMITS || {})[r]
	const read = (e, keys, dflt) => {
		if (!e) return dflt
		for (const k of keys) if (typeof e[k] === 'number') return e[k]
		if (Array.isArray(e) && typeof e[0] === 'number') return e[0]
		return dflt
	}
	if (lim) return { p: read(lim, ['prefixes', 'p', 'max'], 99), s: read(lim, ['suffixes', 's', 'max'], 99) }
	if (r === 'magic') return { p: 1, s: 1 }
	if (r === 'rare') return { p: 2, s: 2 }
	return { p: 99, s: 99 }
}

function affixTriples(affix) {
	const out = []
	const num = (x) => typeof x === 'number' && isFinite(x)
	const push = (v, mn, mx) => {
		if (num(v) && num(mn) && num(mx)) out.push({ v, mn, mx })
	}
	const valOf = (o) => {
		if (!o) return undefined
		for (const k of ['value', 'val', 'roll', 'rolled', 'current']) if (num(o[k])) return o[k]
		return undefined
	}
	if (Array.isArray(affix?.lines)) for (const ln of affix.lines) push(valOf(ln), ln?.min, ln?.max)
	push(valOf(affix), affix?.min, affix?.max)
	return out
}

function checkInvariants(Engine, item) {
	const v = []
	if (!item || typeof item !== 'object') {
		v.push('getItem() returned no item')
		return v
	}
	const pre = Array.isArray(item.prefixes) ? item.prefixes : []
	const suf = Array.isArray(item.suffixes) ? item.suffixes : []
	const cap = capFor(Engine, item.rarity)
	if (pre.length > cap.p) v.push(`${item.rarity} item has ${pre.length} prefixes (max ${cap.p})`)
	if (suf.length > cap.s) v.push(`${item.rarity} item has ${suf.length} suffixes (max ${cap.s})`)

	if (typeof item.ilvl === 'number' && (item.ilvl < 1 || item.ilvl > 100)) v.push(`ilvl out of range: ${item.ilvl}`)

	const groups = [...pre, ...suf].map((a) => a && a.modGroup).filter((g) => g && !PLACEHOLDERS.has(g))
	const seen = new Set()
	for (const g of groups) {
		if (seen.has(g)) {
			v.push(`duplicate mod group on item: ${g}`)
			break
		}
		seen.add(g)
	}

	if (!item.sanctified) {
		for (const a of [...pre, ...suf]) {
			if (a && a.sanctified) continue
			for (const t of affixTriples(a)) {
				if (t.v < t.mn - EPS || t.v > t.mx + EPS) {
					v.push(`rolled value ${t.v} outside [${t.mn}, ${t.mx}] in group ${a && a.modGroup}`)
					break
				}
			}
		}
	}
	return v
}

// ---------- main ----------
const Engine = await loadEngine()
const { modData, fuzzable } = buildModData()
const desecData = loadDesecData()

if (fuzzable.length === 0) {
	console.error('No fuzzable bases found in data/bases (need non-empty prefixes/suffixes).')
	process.exit(2)
}

const QUALS = [0, 0.5, 0.8]
const CHAOS_OMENS = [null, 'whittling', 'sinistral_erasure', 'dextral_erasure']
const ANNUL_OPTS = [{}, { desecratedOnly: true }, { omen: 'sinistral_annulment' }, { omen: 'dextral_annulment' }]
const DIVINE_OMENS = [null, 'sanctification']
const DESEC_OMENS = ['sinistral_necromancy', 'dextral_necromancy', 'abyssal_echoes']

const ACTIONS = [
	['setItemLevel', (e) => e.setItemLevel(1 + ri(100))],
	['transmutation', (e) => e.applyTransmutation(pick(QUALS))],
	['augmentation', (e) => e.applyAugmentation(pick(QUALS))],
	['regal', (e) => e.applyRegal(pick(QUALS))],
	['exalted', (e) => e.applyExalted(pick(QUALS))],
	['chaos', (e) => e.applyChaos(pick(CHAOS_OMENS), pick(QUALS))],
	['alchemy', (e) => e.applyAlchemy()],
	['annulment', (e) => e.applyAnnulment(pick(ANNUL_OPTS))],
	['divine', (e) => e.applyDivine(pick(DIVINE_OMENS))],
	['vaal', (e) => {
		try {
			if (e.vaalOutcomeOptions) e.vaalOutcomeOptions()
		} catch (_) {}
		return e.applyVaal(rnd() < 0.5 ? null : 1 + ri(4))
	}],
	['fracturing', (e) => e.applyFracturing()],
	['essenceOfAbyss', (e) => e.applyEssenceOfAbyss()],
	['essenceOfBreach', (e) => e.applyEssenceOfBreach()],
	['hinekoraLock', (e) => (rnd() < 0.5 ? e.setHinekoraLock() : e.clearHinekoraLock())],
	['recordCurrencyUse', (e) => {
		if (typeof e.recordCurrencyUse === 'function') e.recordCurrencyUse('Chaos Orb', 1)
	}],
	['desecration', (e) => {
		const omens = DESEC_OMENS.filter(() => rnd() < 0.5)
		e.startDesecration({ bone: 'preserved_cranium', omen: omens[0] || null, omens })
		let pending = e.getPendingDesecration ? e.getPendingDesecration() : null
		if (!pending) return
		if (omens.includes('abyssal_echoes') && rnd() < 0.5) {
			e.rerollDesecration()
			pending = e.getPendingDesecration ? e.getPendingDesecration() : pending
		}
		const opts = pending && Array.isArray(pending.options) ? pending.options : null
		const n = opts ? opts.length : 3
		if (n > 0 && rnd() < 0.8) e.chooseDesecratedMod(ri(n))
		else e.cancelDesecration()
	}],
	['loadItemRoundTrip', (e) => {
		const snap = JSON.parse(JSON.stringify(e.getItem()))
		const pend = e.getPendingDesecration && e.getPendingDesecration() ? JSON.parse(JSON.stringify(e.getPendingDesecration())) : null
		e.resetItem()
		e.loadItem(snap, pend)
	}],
	['probeCorruptedLockout', (e) => {
		const it = e.getItem()
		if (!it || !it.corrupted) return
		const before = (it.prefixes ? it.prefixes.length : 0) + (it.suffixes ? it.suffixes.length : 0)
		try {
			e.applyExalted(0)
		} catch (_) {}
		const after = e.getItem()
		const cnt = (after.prefixes ? after.prefixes.length : 0) + (after.suffixes ? after.suffixes.length : 0)
		if (cnt > before) return { violation: 'corrupted item gained an affix from Exalted (corruption lockout failed)' }
	}],
]

const stats = {
	ops: 0,
	resets: 0,
	engineExceptions: 0,
	harnessErrors: 0,
	violations: 0,
	perAction: {},
	exceptionSamples: [],
	violationSamples: [],
}
for (const [name] of ACTIONS) stats.perAction[name] = { ok: 0, threw: 0, violated: 0 }

const perBase = Math.ceil(ITERATIONS / fuzzable.length)

for (const base of fuzzable) {
	let engine
	try {
		engine = new Engine(modData, base, desecData)
	} catch (e) {
		stats.harnessErrors++
		stats.exceptionSamples.push(`[${base}] constructor: ${e && e.message}`)
		continue
	}
	for (let i = 0; i < perBase; i++) {
		// occasional reset to re-explore from a fresh normal item
		if (rnd() < 0.03) {
			try {
				engine.resetItem()
				stats.resets++
			} catch (_) {}
		}

		const [name, fn] = pick(ACTIONS)
		stats.ops++
		let result
		try {
			result = fn(engine)
			stats.perAction[name].ok++
		} catch (e) {
			stats.engineExceptions++
			stats.perAction[name].threw++
			if (stats.exceptionSamples.length < 15) stats.exceptionSamples.push(`[${base} #${i}] ${name}: ${e && e.message}`)
		}

		// action-reported violation (e.g. corruption lockout probe)
		if (result && result.violation) {
			stats.violations++
			stats.perAction[name].violated++
			if (stats.violationSamples.length < 10) stats.violationSamples.push({ base, i, action: name, msg: result.violation })
		}

		// invariant sweep after every action
		try {
			const item = engine.getItem()
			const vs = checkInvariants(Engine, item)
			if (vs.length) {
				stats.violations += vs.length
				stats.perAction[name].violated++
				if (stats.violationSamples.length < 10) {
					stats.violationSamples.push({
						base,
						i,
						action: name,
						msg: vs.join('; '),
						snapshot: {
							rarity: item && item.rarity,
							ilvl: item && item.ilvl,
							corrupted: item && item.corrupted,
							sanctified: item && item.sanctified,
							prefixes: item && item.prefixes ? item.prefixes.length : 0,
							suffixes: item && item.suffixes ? item.suffixes.length : 0,
						},
					})
				}
			}
		} catch (e) {
			stats.harnessErrors++
			if (stats.exceptionSamples.length < 15) stats.exceptionSamples.push(`[${base} #${i}] getItem/invariants: ${e && e.message}`)
		}
	}
}

// restore Math.random
Math.random = _origRandom

// ---------- report ----------
const L = []
L.push('PoE2 jewel crafting - fuzz harness')
L.push('='.repeat(48))
L.push(`seed:        ${SEED}   (replay: node fuzz.mjs ${ITERATIONS} ${SEED})`)
L.push(`iterations:  ${stats.ops} ops across ${fuzzable.length} base(s)`)
L.push(`bases:       ${fuzzable.join(', ')}`)
L.push(`resets:      ${stats.resets}`)
L.push(`exceptions:  ${stats.engineExceptions} (engine-level; treated as non-fatal control flow)`)
L.push(`harness err: ${stats.harnessErrors}`)
L.push(`VIOLATIONS:  ${stats.violations}`)
L.push('')
L.push('per-action            ok / threw / violated')
for (const [name] of ACTIONS) {
	const a = stats.perAction[name]
	L.push(`  ${name.padEnd(22)} ${String(a.ok).padStart(7)} ${String(a.threw).padStart(7)} ${String(a.violated).padStart(9)}`)
}
if (stats.violationSamples.length) {
	L.push('')
	L.push('sample invariant violations:')
	for (const s of stats.violationSamples) {
		L.push(`  [${s.base} #${s.i}] ${s.action}: ${s.msg}`)
		if (s.snapshot) L.push(`      item: ${JSON.stringify(s.snapshot)}`)
	}
}
if (stats.exceptionSamples.length) {
	L.push('')
	L.push('sample exceptions:')
	for (const s of stats.exceptionSamples) L.push(`  ${s}`)
}
L.push('')
const fatal = stats.violations > 0 || stats.harnessErrors > 0
L.push(fatal ? 'RESULT: FAIL' : 'RESULT: PASS')
console.log(L.join('\n'))
process.exit(fatal ? 1 : 0)
