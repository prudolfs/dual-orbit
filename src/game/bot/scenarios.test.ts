import { expect, test } from 'vitest'
import type { ObstacleKind, SimulationState } from '../types'
import type { BotScenario, BotSnapshot } from './driver'
import { runScenario } from './driver'
import {
	nearMissRewindScenario,
	rotatingFieldScenario,
	showcaseSequence,
} from './scenarios'

/**
 * Projection of a {@link BotSnapshot} into the gameplay-relevant fields the
 * assertions below care about: mode, collisions, rewinds, orb angles, orbit
 * height, obstacle count. We deliberately avoid snapshotting every field of
 * `SimulationState` so incidental non-gameplay additions (e.g. a new debug
 * counter) do not churn the assertions; only the numbers that drive the GIF
 * — mode, collisions, rewinds, orb angles, orbit height, obstacle layout —
 * are read.
 */
type Projection = {
	readonly tick: number
	readonly mode: SimulationState['mode']
	readonly capt: boolean
	readonly orbitY: number
	readonly orb0: number
	readonly orb1: number
	readonly collisions: number
	readonly rewinds: number
	readonly obstacles: number
}

function project(snapshot: BotSnapshot): Projection {
	const { state } = snapshot
	return {
		tick: snapshot.tick,
		mode: state.mode,
		capt: snapshot.capture,
		orbitY: Math.round(state.orbit.center.y),
		orb0: Math.round(state.orbit.orbs[0].angle * 1000) / 1000,
		orb1: Math.round(state.orbit.orbs[1].angle * 1000) / 1000,
		collisions: state.stats.collisions.total,
		rewinds: state.stats.rewinds,
		obstacles: state.obstacles.length,
	}
}

function snapshotAt(scenario: BotScenario, tick: number): SimulationState {
	const snapshot = runScenario(scenario).snapshots[tick]

	if (!snapshot) {
		throw new RangeError(
			`no snapshot at tick ${tick} (scenario has ${runScenario(scenario).snapshots.length} snapshots)`,
		)
	}

	return snapshot.state
}

/**
 * Vertical half-extent of the play area in sim units at the default `sd`
 * resolution, used to decide which spawned obstacles are *on screen* at a
 * given orbit `y`. Matches the world-scale + camera-fov math documented in
 * `docs/level-design.md` (R3F fov 48°, distance 12, world scale 80).
 */
const VIEW_HALF_EXTENT = 427

type OnScreenObstacle = {
	readonly kind: ObstacleKind
	readonly y: number
	readonly rotationDeg: number
	readonly speed: number
}

function onScreenObstacles(
	state: SimulationState,
): readonly OnScreenObstacle[] {
	const lo = state.orbit.center.y - VIEW_HALF_EXTENT
	const hi = state.orbit.center.y + VIEW_HALF_EXTENT

	return state.obstacles
		.filter((o) => o.alive && o.position.y >= lo && o.position.y <= hi)
		.map((o) => ({
			kind: o.kind,
			y: Math.round(o.position.y),
			rotationDeg: Math.round((o.rotation * 180) / Math.PI),
			speed: o.speed,
		}))
}

function firstCollisionTick(scenario: BotScenario): number {
	let prev = 0
	for (const snap of runScenario(scenario).snapshots) {
		const total = snap.state.stats.collisions.total
		if (total > prev) return snap.tick
		prev = total
	}
	return Number.POSITIVE_INFINITY
}

// ---------------------------------------------------------------------------
// rotatingFieldScenario — the showcase head frame (seed-19 static pair +
// centred rotating bar). Doubles as the legacy single-scenario export.
// ---------------------------------------------------------------------------

test('rotatingFieldScenario teleports the orbit into the seed-19 static-pair band', () => {
	const initial = snapshotAt(rotatingFieldScenario, 0)

	expect(initial.generator.level).toBe(4)
	expect(initial.generator.group).toBe(3)
	expect(initial.orbit.center.y).toBe(-1500)
	// A `static` bar on each shoulder plus a centred `angular` bar already on
	// screen at tick 0 — the showcase diversity frame.
	const kinds: Set<ObstacleKind> = new Set(
		onScreenObstacles(initial).map((o) => o.kind),
	)
	expect(kinds.has('static')).toBe(true)
	expect(kinds.has('angular')).toBe(true)
})

test('rotatingFieldScenario reproduces identically across runs (golden determinism)', () => {
	const first = runScenario(rotatingFieldScenario).snapshots.map(project)
	const second = runScenario(rotatingFieldScenario).snapshots.map(project)

	expect(second).toStrictEqual(first)
})

test('rotatingFieldScenario capture ticks land with both statics and a rotating bar in view', () => {
	for (const tick of rotatingFieldScenario.captureTicks) {
		const state = snapshotAt(rotatingFieldScenario, tick)
		const onScreen = onScreenObstacles(state)
		const kinds: Set<ObstacleKind> = new Set(onScreen.map((o) => o.kind))

		// Every capture tick keeps the diverse showcase frame — a static pair
		// plus a rotating angular bar on screen together.
		const hasStatic = kinds.has('static')
		const hasAngular = kinds.has('angular')
		const orb0Deg = ((state.orbit.orbs[0].angle * 180) / Math.PI) % 360

		expect(
			onScreen.length,
			`tick ${tick}: showcase frame has obstacles on screen`,
		).toBeGreaterThanOrEqual(2)
		expect(hasStatic, `tick ${tick}: shows a static bar`).toBe(true)
		expect(hasAngular, `tick ${tick}: shows a rotating bar`).toBe(true)
		// The non-zero capture tick shows the orbs mid-arc.
		if (tick !== 0) {
			expect(
				Math.abs(orb0Deg) > 4 || Math.abs(orb0Deg - 360) > 4,
				`tick ${tick}: orb0 mid-arc (deg=${orb0Deg.toFixed(0)})`,
			).toBe(true)
		}
	}
})

// ---------------------------------------------------------------------------
// nearMissRewindScenario — rewind-recovery showcase.
// ---------------------------------------------------------------------------

test('nearMissRewindScenario teleports the orbit into the seed-19 band', () => {
	const initial = snapshotAt(nearMissRewindScenario, 0)

	expect(initial.generator.level).toBe(4)
	expect(initial.orbit.center.y).toBe(-1500)
	const kinds: Set<ObstacleKind> = new Set(
		onScreenObstacles(initial).map((o) => o.kind),
	)
	expect(kinds.has('static')).toBe(true)
	expect(kinds.has('angular')).toBe(true)
})

test('nearMissRewindScenario triggers its first collision at the scripted tick 18', () => {
	expect(firstCollisionTick(nearMissRewindScenario)).toBe(18)
})

test('nearMissRewindScenario accumulates ≥ 2 rewinds (each near-miss recovers)', () => {
	const last = snapshotAt(
		nearMissRewindScenario,
		runScenario(nearMissRewindScenario).snapshots.length - 1,
	)

	expect(last.stats.rewinds).toBeGreaterThanOrEqual(2)
})

test('nearMissRewindScenario capture ticks straddle near-misses + recovery', () => {
	const traces = runScenario(nearMissRewindScenario).snapshots.map(project)
	const ticks = nearMissRewindScenario.captureTicks

	expect(ticks.every((t) => traces[t] !== undefined)).toBe(true)
	// Tick 18 is the first collision itself — the rewind moment.
	expect(ticks).toContain(18)
	const at18 = traces[18]
	expect(at18).toBeDefined()
	expect(at18.collisions).toBeGreaterThanOrEqual(1)
})

test('nearMissRewindScenario reproduces identically across runs (golden determinism)', () => {
	const first = runScenario(nearMissRewindScenario).snapshots.map(project)
	const second = runScenario(nearMissRewindScenario).snapshots.map(project)

	expect(second).toStrictEqual(first)
})

// ---------------------------------------------------------------------------
// showcaseSequence — the GIF frame plan. Each entry teleports to a
// *different* gameplay place, so consecutive frames show distinct obstacle
// kinds (the gameplay diversity the README header exists to advertise).
// ---------------------------------------------------------------------------

test('showcaseSequence contains at least five distinct gameplay places', () => {
	// Five entries covering the diversity beats: static pair, rotating bar,
	// moving bar, slow sweep, mixed.
	expect(showcaseSequence.length).toBeGreaterThanOrEqual(5)
})

test('every showcaseSequence entry reproduces deterministically (golden)', () => {
	for (const entry of showcaseSequence) {
		const first = runScenario(entry.scenario).snapshots.map(project)
		const second = runScenario(entry.scenario).snapshots.map(project)
		expect(second, `showcase '${entry.label}' Golden mismatch`).toStrictEqual(
			first,
		)
	}
})

test('every showcaseSequence entry frames its declared obstacle kind on screen at the capture tick', () => {
	// Each showcase label declares the gameplay beat it frames; assert the
	// on-screen kind mix at the capture tick actually contains the kind the
	// label promises. This pins the GIF diversity against generator drift —
	// a change that empties a showcase frame breaks CI here before the GIF
	// goes stale.
	const expectedKindPerLabel: ReadonlyArray<readonly [string, ObstacleKind]> = [
		['Static pair both sides + rotating bar', 'static'],
		['Rotating angular bar mid-sweep', 'angular'],
		['Mirror static pair — gap threading', 'static'],
		['Slow angular_long sweep', 'angular_long'],
		['Static bar + slow sweeper', 'static'],
	]

	for (const entry of showcaseSequence) {
		const tick = entry.scenario.captureTicks[0]
		const state = snapshotAt(entry.scenario, tick)
		const kinds: Set<ObstacleKind> = new Set(
			onScreenObstacles(state).map((o) => o.kind),
		)
		const want = expectedKindPerLabel.find(([label]) =>
			entry.label.startsWith(label),
		)?.[1]
		expect(
			want,
			`showcase '${entry.label}' has no expected-kind assertion`,
		).toBeDefined()
		expect(
			kinds.has(want as ObstacleKind),
			`showcase '${entry.label}' expected to show a '${want}' on screen at tick ${tick}, got kinds=[${[...kinds].join(',')}]`,
		).toBe(true)
		expect(
			onScreenObstacles(state).length,
			`showcase '${entry.label}' has at least one obstacle on screen`,
		).toBeGreaterThanOrEqual(1)
	}
})

test('no showcaseSequence frame has a colliding orb at the capture tick', () => {
	// A capture frame that has an orb mid-collision is a bad showcase — it
	// reads as a glitch rather than gameplay. Pinned because the original
	// "moving bar beside statics" frame teleported the orbit ON TOP of a
	// `static` bar (orb0 colliding for every tick).
	for (const entry of showcaseSequence) {
		const tick = entry.scenario.captureTicks[0]
		const state = snapshotAt(entry.scenario, tick)
		const colliding = state.orbit.orbs.filter((orb) => orb.colliding).length
		expect(
			colliding,
			`showcase '${entry.label}' has ${colliding} colliding orb(s) at capture tick ${tick}`,
		).toBe(0)
	}
})

test('showcaseSequence entries land on DIFFERENT gameplay places (no two share the same obstacle neighbourhood)', () => {
	// Pin the user's actual requirement: consecutive GIF frames come from
	// different places. We hash each showcase frame's on-screen obstacle set
	// by `(alias, kind, round(y))` and assert every entry's hash is unique.
	const hashes = new Set<string>()
	for (const entry of showcaseSequence) {
		const tick = entry.scenario.captureTicks[0]
		const state = snapshotAt(entry.scenario, tick)
		const hash = onScreenObstacles(state)
			.map((o) => `${o.kind}@${o.y}`)
			.sort()
			.join('|')
		expect(
			hashes.has(hash),
			`showcase '${entry.label}' reuses the same obstacle layout as a prior entry (${hash})`,
		).toBe(false)
		hashes.add(hash)
	}
})
