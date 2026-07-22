import type { BotScenario } from './driver'

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
 * All scenarios use the default resolution (sd) so the orbit numbers match the
 * probe runs: radius 160, verticalSpeed 7, angularSpeed 2π/90 ≈ 0.0698.
 */

// ---------------------------------------------------------------------------
// Tuning constants — kept at module top so exported scenario initializers
// (which reference them) never hit a temporal-dead-zone.
// ---------------------------------------------------------------------------

/**
 * Ticks per burst of direction for the gauntlet. The orbit rotates at
 * `2π/90` per tick, so `22` ticks is `~1.53 rad ≈ 88°` — roughly enough to
 * swing each orb from one obstacle lane into the open lane.
 */
const GAUNTLET_DIRECTION_BURST = 22

/** Number of alternating direction bursts in the gauntlet. */
const GAUNTLET_NUM_BURSTS = 11

/**
 * Total ticks the near-miss scenario runs, long enough for the rewind path to
 * finish (collision at tick 141, rewind replay + stabilize, then resume).
 */
const NEAR_MISS_TICKS = 260

/** How long the near-miss scenario holds the initial clockwise swing. */
const NEAR_MISS_HOLD_TICKS = 130

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

/**
 * Gauntlet — a weave that threads several spaced-out static obstacles.
 *
 * The generator (seed 3) lays out alternating left/right `rect3` triplets and
 * `rect1` bars every `~350` vertical units; with `verticalSpeed = 7` that is
 * roughly `~50` ticks between obstacles. The orbit's orbs start at angle `π`
 * (left) and `0` (right); rotating clockwise (direction `1`) moves the orbs
 * *up* through the gaps. The weave alternates direction in `~22`-tick bursts
 * (`22 × 0.0698 ≈ 1.53 rad ≈ 88°`) — enough to swing each orb from the
 * obstacle's lane to the open lane and back, threading the gauntlet.
 * `captureTicks` land on each swing's peak so the GIF shows the
 * "just-made-it" frames rather than the in-between drift.
 *
 * Authored offline: with `collisionAction: 'rollback'` the run threads the
 * whole gauntlet. Drift in spacing or rotation is caught by the
 * golden-snapshot test asserting the final collision profile.
 */
export const gauntletScenario: BotScenario = {
	seed: 3,
	steps: buildGauntletSteps(GAUNTLET_NUM_BURSTS, GAUNTLET_DIRECTION_BURST),
	captureTicks: [0, 22, 44, 66, 88, 110, 132, 154, 176, 198, 242],
}

/**
 * Near-miss then rewind — deliberately glance the first obstacle, trigger a
 * `rewind` collision, and let the deterministic input-replay produce a clean
 * pass on the corrected side.
 *
 * Holding `direction 1` from tick 1 keeps the right orb swinging through the
 * first obstacle's lane. With seed 3 the first (and only) collision occurs at
 * **tick 141** (measured offline, see `scenarios.test.ts`). `collisionAction: 'rewind'` hands control to the
 * rewind path, which replays the prior direction memory backward, then
 * stabilizes the orbit and resumes `running` — a known clean follow-up. The
 * scenario runs long enough to capture the *before*, the *glance*, the
 * *rewind*, and the *clean pass* frames.
 *
 * Authored offline: the run ends with exactly one collision and
 * `rewinds == 1` (asserted by the golden snapshot).
 */
export const nearMissRewindScenario: BotScenario = {
	seed: 3,
	steps: buildNearMissSteps(NEAR_MISS_HOLD_TICKS, NEAR_MISS_TICKS),
	captureTicks: [0, 50, 120, 141, 155, 175, 200, 230],
}

// ---------------------------------------------------------------------------
// Step builders (function hoisting means these may sit after the exports)
// ---------------------------------------------------------------------------

function buildGauntletSteps(
	numBursts: number,
	burstTicks: number,
): readonly BotScenario['steps'][number][] {
	let direction: BotScenario['steps'][number]['direction'] = 1
	const steps: BotScenario['steps'][number][] = []
	let tick = 1

	for (let burst = 0; burst < numBursts; burst++) {
		for (let d = 0; d < burstTicks; d++) {
			steps.push({
				tick: tick + d,
				direction,
				collisionAction: 'rollback',
			})
		}
		tick += burstTicks
		direction = direction === 1 ? -1 : 1
	}

	return steps
}

function buildNearMissSteps(
	holdTicks: number,
	totalTicks: number,
): readonly BotScenario['steps'][number][] {
	const steps: BotScenario['steps'][number][] = []

	// Hold a clockwise swing for the first `holdTicks` ticks so the right orb
	// glances the first `rect1` obstacle around tick ~141.
	for (let tick = 1; tick <= holdTicks; tick++) {
		steps.push({
			tick,
			direction: 1,
			collisionAction: 'rewind',
		})
	}

	// After the rewind triggers, let the simulation steer for itself (neutral
	// input) so the deterministic rewind/stabilize/replay path completes and
	// the orbit settles running.
	for (let tick = holdTicks + 1; tick <= totalTicks; tick++) {
		steps.push({
			tick,
			direction: 0,
			collisionAction: 'rewind',
		})
	}

	return steps
}
