import type { Vec2 } from '../types'
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
 * run already lands the camera among `angular` rotating bars — the signature
 * gameplay beat — instead of the static-only cold open the default curriculum
 * spawns at the top of the play area. The math that makes such teleports
 * *solvable* (the generator pre-phases each `angular` bar by
 * `(orbit.center.y − obstacle.y) / verticalSpeed`) is documented in
 * `docs/level-design.md`. Default resolution `sd` ⇒ `radius = 160`,
 * `verticalSpeed = 7`, `angularSpeed = 2π/90 ≈ 0.0698`.
 *
 * The capture ticks below are *not* spread evenly — they land on the
 * peak-density moments documented in `docs/sample.md`: a rotating bar
 * mid-sweep with an orb visibly mid-arc. Numbers were measured offline against
 * `runScenario` and reproduce bit-for-bit.
 */

// ---------------------------------------------------------------------------
// Tuning constants — kept at module top so exported-scenario initializers
// (which reference them) never hit a temporal-dead-zone.
// ---------------------------------------------------------------------------

/**
 * Ticks per burst of direction for the rotating-field weave. The orbit
 * rotates at `2π/90` per tick, so `22` ticks is `~1.53 rad ≈ 88°` — enough
 * to swing each orb between the angular bars' gap and the opposite shoulder.
 */
const ROTATE_BURST_TICKS = 22

/** Number of alternating direction bursts in the rotating-field weave. */
const ROTATE_NUM_BURSTS = 11

/**
 * Teleport target the two scenarios share: a seed-3 level-25 / group-4 layout
 * with two `angular` bars stacked in the visible window of a `y = −1500`
 * orbit. Confirmed offline to keep 1–2 bars in view for ~60 ticks at a time
 * and to produce a deterministic rotate-and-thread show.
 */
const TELEPORT_GENERATOR = {
	level: 25,
	levelPerGroup: 5,
	groups: 6,
	group: 4,
} as const

const TELEPORT_CENTER: Vec2 = { x: 320, y: -1500 }

/**
 * Rotating-field weave — teleport into a band of `angular` bars and alternate
 * direction in `~22`-tick bursts, threading the gaps while two sweeping bars
 * stay on screen.
 *
 * Authored offline (seed 3, level 25, group 4, orbit at `y = −1500`): the
 * `~22`-tick burst exactly matches the orb swing time and the angular bar's
 * half-turn, so each capture tick shows one bar sweeping through a new gap
 * with the orbs mid-arc. `captureTicks` skip the parked-orb opening and land
 * on the peak rotation moments deep in the run.
 */
export const rotatingFieldScenario: BotScenario = {
	seed: 3,
	generator: TELEPORT_GENERATOR,
	orbitCenter: TELEPORT_CENTER,
	steps: buildAlternatingBursts(
		ROTATE_NUM_BURSTS,
		ROTATE_BURST_TICKS,
		'rollback',
	),
	captureTicks: [15, 45, 75, 90, 120, 165, 195, 210, 240],
}

/**
 * Near-miss then rewind — teleport into the same rotating-field band, hold a
 * clockwise swing so the right orb glances the first `angular` bar, watch the
 * deterministic `rewind` recovery kick in, then resume running among the
 * bars. Two collisions over the run, both recovered via `collisionAction:
 * 'rewind'`, capture ticks landing before/after each near-miss and inside the
 * rewind replay.
 *
 * First collision lands at **tick 48** (measured offline) and a second at
 * ~tick 120; `captureTicks` straddle each. Asserted by the golden snapshot.
 */
export const nearMissRewindScenario: BotScenario = {
	seed: 3,
	generator: TELEPORT_GENERATOR,
	orbitCenter: TELEPORT_CENTER,
	// Hold clockwise for the run; the rewind path takes over on collision so a
	// single direction step per tick suffices to produce both near-misses.
	steps: buildHoldDirection(260, 1, 'rewind'),
	captureTicks: [0, 20, 40, 48, 80, 120, 160, 220],
}

// ---------------------------------------------------------------------------
// Step builders (function hoisting means these may sit after the exports)
// ---------------------------------------------------------------------------

function buildAlternatingBursts(
	numBursts: number,
	burstTicks: number,
	collisionAction: BotStep['collisionAction'],
): readonly BotStep[] {
	let direction: BotStep['direction'] = 1
	const steps: BotStep[] = []
	let tick = 1

	for (let burst = 0; burst < numBursts; burst++) {
		for (let d = 0; d < burstTicks; d++) {
			steps.push({
				tick: tick + d,
				direction,
				collisionAction,
			})
		}
		tick += burstTicks
		direction = direction === 1 ? -1 : 1
	}

	return steps
}

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
