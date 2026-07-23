import { createInitialSimulation, tickSimulation } from '../simulation'
import type {
	DirectionState,
	GeneratorState,
	SimulationInput,
	SimulationState,
	Vec2,
} from '../types'
import { directionToInput } from '../types'

/**
 * A single scripted input applied at a simulation tick.
 *
 * The `direction` maps to {@link SimulationInput} via {@link directionToInput}
 * using the exact rotation math in `game/simulation/orbit`. `collisionAction`
 * is forwarded to {@link tickSimulation} so a scenario can request a `rewind`
 * (near-miss highlight) instead of the default `rollback`.
 */
export type BotStep = {
	readonly tick: number
	readonly direction: DirectionState
	readonly collisionAction: 'rollback' | 'rewind'
}

/**
 * A deterministic scripted run of the simulation, authored against the pure
 * `tickSimulation` path. No DOM, no rendering — only the seeded initial state
 * and the per-tick input timeline.
 *
 * `seed` alone reproduces the default-curriculum cold open (`levelPerGroup`,
 * `group` at the generator's defaults, orbiting the top of the play area).
 * `generator` and `orbitCenter` opt-in to *teleporting* the run deep into a
 * denser, higher-level obstacle field — see `docs/level-design.md`. Both
 * overrides are threaded into `createInitialSimulation` so the offline golden
 * and the browser bridge reproduce the same spawned state bit-for-bit.
 */
export type BotScenario = {
	readonly seed: number
	/**
	 * Partial generator override (level/group/levelsPerGroup/...). Merged on
	 * top of `{ seed: scenario.seed }` when seeding the run, so a teleport
	 * scenario only needs to specify the fields it changes.
	 */
	readonly generator?: Partial<Omit<GeneratorState, 'seed'>>
	/** Spawns the orbit at this centre. Defaults to top-of-area. */
	readonly orbitCenter?: Vec2
	readonly steps: readonly BotStep[]
	/** Ticks at which a frame should later be grabbed by the capture harness. */
	readonly captureTicks: readonly number[]
}

/**
 * An emitted snapshot from the bot driver: the full simulation state alongside
 * the input that produced it and whether this tick is a capture frame.
 *
 * The browser-side replay bridge consumes the same `(tick, state, input)`
 * triples so it can mirror the offline run exactly.
 */
export type BotSnapshot = {
	readonly tick: number
	readonly state: SimulationState
	readonly input: SimulationInput
	readonly capture: boolean
}

/**
 * Result of driving a scenario offline: one snapshot per tick advanced.
 */
export type BotResult = {
	readonly snapshots: readonly BotSnapshot[]
}

export type RunScenarioOptions = {
	/** Run the scenario at least this many ticks (pads with neutral input). */
	readonly minTicks?: number
}

const EMPTY_INPUT: SimulationInput = { left: false, right: false }

function neutralStep(
	tick: number,
	collisionAction: BotStep['collisionAction'],
): BotStep {
	return {
		tick,
		direction: 0,
		collisionAction,
	}
}

function stepForTick(
	steps: readonly BotStep[],
	nextStepIndex: number,
	tick: number,
): { readonly step: BotStep; readonly next: number } {
	const candidate = steps[nextStepIndex]

	if (candidate && candidate.tick === tick) {
		return { step: candidate, next: nextStepIndex + 1 }
	}

	// Before the first scripted step, or in any gap between scripted steps,
	// hold neutral input with the most recent collisionAction preference
	// (defaulting to `rollback`, the same default as `tickSimulation`).
	const fallbackAction =
		nextStepIndex > 0
			? (steps[nextStepIndex - 1]?.collisionAction ?? 'rollback')
			: 'rollback'

	return { step: neutralStep(tick, fallbackAction), next: nextStepIndex }
}

/**
 * Drive a {@link BotScenario} through the pure simulation, tick by tick,
 * emitting a snapshot for every tick. No DOM, no React, no Three.js — the
 * entire run is a deterministic function of `(seed, steps)` and reproduces
 * identically across runs (see `bot.driver.test.ts` golden snapshot).
 */
export function runScenario(
	scenario: BotScenario,
	options: RunScenarioOptions = {},
): BotResult {
	const state = createInitialSimulation({
		generator: { seed: scenario.seed, ...scenario.generator },
		orbitCenter: scenario.orbitCenter,
	})
	const captureSet = new Set(scenario.captureTicks)
	const totalTicks = Math.max(
		scenario.steps.length > 0
			? scenario.steps[scenario.steps.length - 1].tick
			: 0,
		options.minTicks ?? 0,
	)

	const snapshots: BotSnapshot[] = []
	let current = state
	let nextStepIndex = 0

	// Tick 0 is the freshly created seeded initial state — emit it as the
	// first snapshot so callers can render the "starting frame".
	snapshots.push({
		tick: 0,
		state: current,
		input: EMPTY_INPUT,
		capture: captureSet.has(0),
	})

	for (let tick = 1; tick <= totalTicks; tick++) {
		const { step, next } = stepForTick(scenario.steps, nextStepIndex, tick)
		nextStepIndex = next

		const input = directionToInput(step.direction)
		current = tickSimulation(current, {
			input,
			collisionAction: step.collisionAction,
		})

		snapshots.push({
			tick,
			state: current,
			input,
			capture: captureSet.has(tick),
		})
	}

	return { snapshots }
}

/**
 * Convenience window over the captured frames only.
 */
export function captureFrames(result: BotResult): readonly BotSnapshot[] {
	return result.snapshots.filter((snapshot) => snapshot.capture)
}
