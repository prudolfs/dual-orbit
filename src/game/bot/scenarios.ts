import type { DirectionState, GeneratorState, Vec2 } from '../types'
import type { BotScenario, BotStep } from './driver'

/**
 * Phase 2 curated highlight scenarios.
 *
 * Each scenario is authored against the *pure* simulation: the tick numbers
 * below come from the determinism of `tickSimulation` — they are not
 * wall-clock guesses. The orbit math (`angularSpeed` = 2π/90, vertical speed
 * `floor(4·radius / 90)`) and the seeded generator make a given `(seed,
 * steps)` tuple reproduce bit-for-bit, so a scenario's collision/rewind
 * counts are known before the GIF is ever captured. Vitest pins those numbers
 * in `scenarios.test.ts`.
 *
 * All scenarios teleport the orbit deep into a seeded, higher-level obstacle
 * field via `BotScenario.generator` + `BotScenario.orbitCenter` so a short
 * run already lands the camera among the curated obstacle mix — instead of
 * the static-only cold open the default curriculum spawns at the top of the
 * play area. The math that makes such teleports *solvable* (the generator
 * pre-phases each `angular` bar by
 * `(orbit.center.y − obstacle.y) / verticalSpeed`) is documented in
 * `docs/level-design.md`. Default resolution `sd` ⇒ `radius = 160`,
 * `verticalSpeed = 7`, `angularSpeed = 2π/90 ≈ 0.0698`.
 *
 * #### Gameplay diversity across the GIF
 *
 * {@link showcaseSequence} is the list the capture spec stitches into the
 * README header GIF. Unlike a single long-run scenario whose capture ticks
 * all share the same obstacle neighbourhood, each entry in the sequence
 * *teleports to a different place* and frames a *different gameplay beat*:

 *   1. **Static pair** — a `static` bar on each shoulder of the orbit.
 *   2. **Rotating bar** — a centred `angular` bar sweeping mid-arc.
 *   3. **Moving bar** — a `moving` obstacle oscillating among statics.
 *   4. **Slow sweep** — a full-width `angular_long` bar rotating lazily.
 *   5. **Mixed** — a `static` bar alongside an `angular_long` sweeper.
 *
 * Every GIF frame therefore shows obstacles from a *different* gameplay
 * situation, so the strip reads as actual gameplay diversity rather than the
 * same row repeated at different orb angles. Capture ticks are authored
 * offline against `runScenario` and reproduce bit-for-bit; the per-frame
 * on-screen kind mix is asserted by the golden snapshot so a generator drift
 * that empties a showcase frame breaks CI before the GIF goes stale.
 */

// ---------------------------------------------------------------------------
// Tuning constants — kept at module top so exported-scenario initializers
// (which reference them) never hit a temporal-dead-zone.
// ---------------------------------------------------------------------------

/**
 * Generator grid used by every showcase teleport (`levelsPerGroup = 5`,
 * `groups = 6` ⇒ `absoluteLevel ∈ [1, 30]`), tightening the level density so
 * every spawn plants several obstacles around the orbit. Kept as a shared
 * partial merged on top of each entry's `seed`.
 */
const SHOWCASE_GENERATOR_BASE = {
	levelPerGroup: 5,
	groups: 6,
} as const

/**
 * Showcase entry: a single-teleport scenario plus a human-readable label of
 * the gameplay beat it frames. The capture spec plays the entries of
 * {@link showcaseSequence} in order, grabbing the (one) capture tick from
 * each and stitching them into the GIF, so consecutive frames come from
 * different places.
 */
export type ShowcaseEntry = {
	readonly label: string
	readonly scenario: BotScenario
}

/**
 * Build a one-shot teleport scenario: a short scripted prefix that swings the
 * orbs mid-arc (so frames show motion, not rest) and a single capture tick at
 * the chosen peak moment. The `collisionAction: 'rewind'` lets any incidental
 * near-miss recover via the rewind path rather than audio-failing the frame.
 */
function showcase(
	label: string,
	seed: number,
	generator: Partial<Omit<GeneratorState, 'seed'>>,
	orbitCenter: Vec2,
	prefix: ReadonlyArray<readonly [number, DirectionState]>,
	captureTick: number,
): ShowcaseEntry {
	const steps: BotStep[] = []
	let tick = 1
	for (const [length, direction] of prefix) {
		for (let i = 0; i < length; i++) {
			steps.push({ tick: tick + i, direction, collisionAction: 'rewind' })
		}
		tick += length
	}

	return {
		label,
		scenario: {
			seed,
			generator: { ...SHOWCASE_GENERATOR_BASE, ...generator },
			orbitCenter,
			steps,
			captureTicks: [captureTick],
		},
	}
}

// ---------------------------------------------------------------------------
// Showcase sequence — the GIF's frame plan. Each entry teleports to a
// different gameplay place. Numbers measured offline against `runScenario`.
// ---------------------------------------------------------------------------

/**
 * 1. **Static pair on both sides** (`seed 19`, `rect3` mirror pair at
 * `y = −1120`) plus a centred `rect2` `angular` bar (`y = −1760`) pre-phased
 * to be visible at spawn. Driving 6 ticks clockwise swings orb₀ to `204°`
 * (mid-arc) while the bar sweeps to `57°` — a frame where two static bars
 * sit on opposite shoulders and a rotating bar sweeps the middle.
 */
const staticPairShowcase = showcase(
	'Static pair both sides + rotating bar',
	19,
	{ level: 4, group: 3 },
	{ x: 320, y: -1500 },
	[[6, 1]],
	6,
)

/**
 * 2. **Rotating bar showcase** (`seed 1`, `rect2` `angular` at
 * `y = −1920`, `x = 400`). Driving 22 ticks (left then right) sweeps the bar
 * to `~149°` — well away from its `0`/`π` edges so the rotation is legible —
 * with orb₀ at `212°` mid-arc.
 */
const rotatingBarShowcase = showcase(
	'Rotating angular bar mid-sweep',
	1,
	{ level: 3, group: 3 },
	{ x: 320, y: -1800 },
	[
		[11, -1],
		[11, 1],
	],
	22,
)

/**
 * 3. **Moving bar among statics** (`seed 11`, a `rect3` `moving` bar at
 * `x = 517` flanked by two `rect1`/`rect3` static bars). The frame is the
 * seeded initial state — orbit at `y = −1800`, orbs at rest, the moving bar
 * poised mid-oscillation beside its static pair.
 */
const movingBarShowcase = showcase(
	'Moving bar beside statics',
	11,
	{ level: 5, group: 3 },
	{ x: 320, y: -1800 },
	[],
	0,
)

/**
 * 4. **Slow sweeping bar** (`seed 3`, a `rect8` `angular_long` bar at
 * `x = 30`, `y = −1760`). Driving 12 ticks clockwise swings orb₀ to `~228°`
 * while the slow bar (`±orbSpeed/4`) sweeps to `~28°` — the patient
 * full-width rotation that defines the back half of the run.
 */
const slowSweepShowcase = showcase(
	'Slow angular_long sweep',
	3,
	{ level: 3, group: 3 },
	{ x: 320, y: -1800 },
	[[12, 1]],
	12,
)

/**
 * 5. **Mixed static + slow sweeper** (`seed 3`, a centred `rect3` static bar
 * alongside a `rect8` `angular_long` at `x = 30`). Driving 6 ticks left
 * swings orb₀ to `~156°` with both obstacles on screen — a frame that mixes
 * a gap-thread with a slow rotation in one shot.
 */
const mixedShowcase = showcase(
	'Static bar + slow sweeper',
	3,
	{ level: 3, group: 4 },
	{ x: 320, y: -900 },
	[[6, -1]],
	6,
)

/**
 * Ordered showcase plan the README-header capture spec stitches into the GIF.
 * Consecutive frames come from **different gameplay places** so the strip
 * shows obstacle diversity (static pair, rotating bar, moving bar, slow
 * sweep, mixed) rather than the same layout at different orb angles.
 */
export const showcaseSequence: readonly ShowcaseEntry[] = [
	staticPairShowcase,
	rotatingBarShowcase,
	movingBarShowcase,
	slowSweepShowcase,
	mixedShowcase,
]

// ---------------------------------------------------------------------------
// Back-compat single-run scenarios (drives the golden determinism tests).
// They still teleport to the seed-19 static-pair band so the offline golden
// snapshot doubles as regression cover for the showcase's head frame.
// ---------------------------------------------------------------------------

/**
 * Head entry reused as the single-scenario golden: a weave through the
 * seed-19 static pair + centred rotating bar. Forwarded from
 * {@link staticPairShowcase} so the legacy `rotatingFieldScenario` export
 * (referenced by the bridge parity tests and the wrapper's `SCENARIO`
 * env knob) stays wired to the showcase content.
 */
export const rotatingFieldScenario: BotScenario = {
	...staticPairShowcase.scenario,
	captureTicks: [0, 6],
}

/**
 * Near-miss then rewind — the rewind recovery showcase. Held clockwise for
 * 200 ticks against the seed-19 layout, triggering the deterministic
 * `rewind` path on every near-miss. Used by the bridge parity tests.
 */
export const nearMissRewindScenario: BotScenario = {
	seed: 19,
	generator: { ...SHOWCASE_GENERATOR_BASE, level: 4, group: 3 },
	orbitCenter: { x: 320, y: -1500 },
	steps: buildHoldDirection(200, 1, 'rewind'),
	captureTicks: [0, 18, 72, 180],
}

// ---------------------------------------------------------------------------
// Step builders (function hoisting means these may sit after the exports)
// ---------------------------------------------------------------------------

function buildHoldDirection(
	totalTicks: number,
	direction: BotStep['direction'],
	collisionAction: BotStep['collisionAction'],
): readonly BotStep[] {
	const steps: BotStep[] = []

	for (let tick = 1; tick <= totalTicks; tick++) {
		steps.push({ tick, direction, collisionAction })
	}

	return steps
}
