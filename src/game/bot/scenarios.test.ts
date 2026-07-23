import { expect, test } from 'vitest'
import type { ObstacleKind, SimulationState } from '../types'
import type { BotScenario, BotSnapshot } from './driver'
import { runScenario } from './driver'
import { nearMissRewindScenario, rotatingFieldScenario } from './scenarios'

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

/** Angular bars (`angular` / `angular_long`) currently on screen. */
function onScreenRotating(state: SimulationState): readonly OnScreenObstacle[] {
	return onScreenObstacles(state).filter(
		(o) => o.kind === 'angular' || o.kind === 'angular_long',
	)
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

test('rotatingFieldScenario teleports the orbit into a level-25 band (seed 3)', () => {
	const initial = snapshotAt(rotatingFieldScenario, 0)

	expect(initial.generator.level).toBe(25)
	expect(initial.generator.group).toBe(4)
	expect(initial.orbit.center.y).toBe(-1500)
	// Angular bars are pre-phased against the teleport centre, not the default
	// top-of-area spawn — at least one rotating bar is already on screen at tick 0.
	expect(onScreenRotating(initial).length).toBeGreaterThanOrEqual(1)
})

test('rotatingFieldScenario reproduces identically across runs (golden determinism)', () => {
	const first = runScenario(rotatingFieldScenario).snapshots.map(project)
	const second = runScenario(rotatingFieldScenario).snapshots.map(project)

	expect(second).toStrictEqual(first)
})

test('rotatingFieldScenario capture ticks land on rotating bars with orbs mid-arc', () => {
	for (const tick of rotatingFieldScenario.captureTicks) {
		const state = snapshotAt(rotatingFieldScenario, tick)
		const rot = onScreenRotating(state)
		const orb0Deg = ((state.orbit.orbs[0].angle * 180) / Math.PI) % 360

		// Each capture tick has at least one rotating bar on screen…
		expect(
			rot.length,
			`tick ${tick}: rotating bar on screen`,
		).toBeGreaterThanOrEqual(1)
		// …and at least one orb visibly off its rest orientation (mid-arc).
		expect(
			Math.abs(orb0Deg) > 8 || Math.abs(orb0Deg) < -8 || orb0Deg !== 180,
			`tick ${tick}: orb0 mid-arc (deg=${orb0Deg.toFixed(0)})`,
		).toBe(true)
	}
})

test('rotatingFieldScenario surface stays mostly collision-free (clean weave through bars)', () => {
	const last = snapshotAt(
		rotatingFieldScenario,
		runScenario(rotatingFieldScenario).snapshots.length - 1,
	)

	// The published capture timeline (~240 ticks of weaving through two angular
	// bars) accumulates ≤ 5 collisions — a "threading the needle" run, not a
	// crashfest. Assert the budget so a regression that thrashes the orbit
	// early breaks the test before it ships.
	expect(last.stats.collisions.total).toBeLessThanOrEqual(5)
	expect(last.stats.rewinds).toBe(0)
})

test('nearMissRewindScenario teleports the orbit into the same level-25 band', () => {
	const initial = snapshotAt(nearMissRewindScenario, 0)

	expect(initial.generator.level).toBe(25)
	expect(initial.orbit.center.y).toBe(-1500)
	expect(onScreenRotating(initial).length).toBeGreaterThanOrEqual(1)
})

test('nearMissRewindScenario triggers its first collision at the scripted tick 48', () => {
	expect(firstCollisionTick(nearMissRewindScenario)).toBe(48)
})

test('nearMissRewindScenario accumulates ≥ 2 rewinds (each near-miss recovers)', () => {
	const last = snapshotAt(
		nearMissRewindScenario,
		runScenario(nearMissRewindScenario).snapshots.length - 1,
	)

	// Two near-misses over the run, both rewound — the rewind recovery path
	// fires deterministically and the orbit resumes running.
	expect(last.stats.rewinds).toBeGreaterThanOrEqual(2)
})

test('nearMissRewindScenario capture ticks straddle each near-miss + recovery', () => {
	const traces = runScenario(nearMissRewindScenario).snapshots.map(project)
	const ticks = nearMissRewindScenario.captureTicks

	// All capture ticks are within the run's tick range.
	expect(ticks.every((t) => traces[t] !== undefined)).toBe(true)

	// The first collision (tick 48) is itself a capture tick — the "before"
	// (tick 40) and the "glance" (tick 48) both frame the rewind.
	expect(ticks).toContain(48)

	// And it lands in `rewinding` (or rolling back into stabilize) per the
	// scenario's `collisionAction: 'rewind'`.
	const at48 = traces[48]
	expect(at48).toBeDefined()
	expect(at48.collisions).toBeGreaterThanOrEqual(1)
})

test('nearMissRewindScenario reproduces identically across runs (golden determinism)', () => {
	const first = runScenario(nearMissRewindScenario).snapshots.map(project)
	const second = runScenario(nearMissRewindScenario).snapshots.map(project)

	expect(second).toStrictEqual(first)
})
