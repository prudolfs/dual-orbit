import { createInitialSimulation, tickSimulation } from '../simulation'
import type { DirectionState, SimulationState, Vec2 } from '../types'
import { directionToInput } from '../types'
import type { BotScenario } from './driver'

/**
 * The bot's per-frame instruction for the simulation ticker.
 *
 * - `step: false` — the bot is idle; the ticker runs the normal
 *   keyboard-driven path.
 * - `step: true` — step exactly one `tickSimulation` this frame with the
 *     scripted `(input, collisionAction)`, ignoring the wall-clock delta so the
 *     live run stays byte-identical with the offline `runScenario` golden.
 *
 * `capture` is set when the tick *just emitted* is a scenario `captureTick`,
 *   so the browser side can grab a screenshot at the deterministic moment.
 *
 * `done` is `true` on the final tick so the browser-side ticker knows when
 *   playback has completed without consulting another API.
 */
export type BotInstruction = {
	readonly step: boolean
	readonly input: { readonly left: boolean; readonly right: boolean }
	readonly collisionAction: 'rollback' | 'rewind'
	readonly capture: boolean
	readonly done: boolean
}

const DONE: BotInstruction = {
	step: false,
	input: { left: false, right: false },
	collisionAction: 'rollback',
	capture: false,
	done: true,
}

/**
 * Back-compat alias for the old class name. The playback module no longer
 * exports a class, but `BotBridge.active` is documented as `BotPlayback | null`
 * and several tests still import the name; aliasing it to the immutable
 * cursor type keeps the public surface stable.
 */
export type BotPlayback = Playback

/**
 * An immutable cursor over a {@link BotScenario}. Each call to {@link next}
 * returns *the next cursor* and the instruction that produced it, so callers
 * advance the playback by replacing their held cursor — no mutation, no
 * hidden state. Memory of "what tick am I on" and "am I still playing" lives
 * *only* on this record, so the browser bridge and the offline golden path
 * share one identical data shape.
 *
 * Replaces the previous `BotPlayback` class. The class had two pieces of
 * recomputable state — `cursor` and `playing` — and no behaviour that
 * survived the transition to immutability. Keeping it a module-level type and
 * a handful of pure functions composes better with the rest of the bot layer
 * (modules of free functions) and gives `runScenario` and the browser path
 * the same closed form per tick.
 */
export type Playback = {
	readonly scenario: BotScenario
	readonly captureSet: ReadonlySet<number>
	readonly totalTicks: number
	readonly cursor: number
	readonly playing: boolean
}

/**
 * Build the seeded initial state that begins the run — identical to what
 * `runScenario` constructs internally for the same scenario. Threaded through
 * the scenario's `generator` and `orbitCenter` overrides so a teleport
 * scenario (`BotScenario.generator`/`orbitCenter`) reproduces the same
 * obstacle layout both offline and in-browser (see `docs/level-design.md`).
 */
export function createInitialState(scenario: BotScenario): SimulationState {
	const orbitCenter: Vec2 | undefined = scenario.orbitCenter ?? undefined
	return createInitialSimulation({
		generator: { seed: scenario.seed, ...scenario.generator },
		orbitCenter,
	})
}

/**
 * Create a {@link Playback} cursor at the start of `scenario`. Tick 0 (the
 * freshly seeded initial state) is implicit; the first call to {@link next}
 * produces the instruction to step into tick 1.
 *
 * `minTicks` pads the timeline past the last scripted step (mirroring
 * {@link runScenario}'s option), so a scenario whose `steps` end early but
 * whose `captureTicks` extend further still emits those trailing captures.
 */
export function createPlayback(
	scenario: BotScenario,
	options: { readonly minTicks?: number } = {},
): Playback {
	const scripted = lastTick(scenario)
	const totalTicks = Math.max(scripted, options.minTicks ?? 0)

	return {
		scenario,
		captureSet: new Set(scenario.captureTicks),
		totalTicks,
		cursor: 0,
		playing: true,
	}
}

/**
 * The tick that the playback just emitted (0 at the start, before any `next`
 * call). Used in the browser bridge to surface the *current* tick to capture
 * handlers and parity checks.
 */
export function playbackTick(playback: Playback): number {
	return playback.cursor
}

/** Whether the playback has not yet completed. */
export function playbackActive(playback: Playback): boolean {
	return playback.playing
}

/** Convenience predicate — is `tick` a scenario capture tick? */
export function isCaptureTick(playback: Playback, tick: number): boolean {
	return playback.captureSet.has(tick)
}

/**
 * Decide whether this cursor is at a scenario capture tick. Pure read of the
 * cursor; the call site checks this on the *next* cursor to know whether to
 * grab a frame.
 */
export function isCaptureNow(playback: Playback): boolean {
	return playback.captureSet.has(playback.cursor)
}

/**
 * Produce the next {@link BotInstruction} and the advanced cursor. Call once
 * per render frame.
 *
 * Semantics:
 *   - tick 0 (initial) is implicit; the first `next()` produces the
 *     instruction to step into tick 1.
 *   - on the frame after the final tick, returns `DONE` and a stopped cursor
 *     (`playing: false`), so the caller can keep the returned cursor without
 *     branching on "is this still active?".
 */
export function next(playback: Playback): {
	readonly playback: Playback
	readonly instruction: BotInstruction
} {
	if (!playback.playing) {
		return { playback, instruction: DONE }
	}

	const limit = playback.totalTicks
	const nextTick = playback.cursor + 1

	if (nextTick > limit) {
		return {
			playback: { ...playback, playing: false },
			instruction: DONE,
		}
	}

	const step = stepForTick(playback.scenario, nextTick)
	const advanced: Playback = {
		...playback,
		cursor: nextTick,
	}

	const instruction: BotInstruction = {
		step: true,
		input: directionToInput(step.direction),
		collisionAction: step.collisionAction,
		capture: playback.captureSet.has(nextTick),
		done: nextTick === limit,
	}

	return { playback: advanced, instruction }
}

/** Reset the cursor to the start of the timeline (used on `restart`). */
export function reset(playback: Playback): Playback {
	return { ...playback, cursor: 0, playing: true }
}

/** Halt playback immediately. */
export function stop(playback: Playback): Playback {
	return { ...playback, playing: false }
}

/**
 * Step the supplied state forward exactly one tick using the scenario's
 * directive for `tick` (the scripted input, or neutral padding otherwise).
 * Re-exported tick path so the browser can verify parity against the offline
 * `runScenario` without importing it directly.
 */
export function stepOffline(
	state: SimulationState,
	scenario: BotScenario,
	tick: number,
): SimulationState {
	const directive = stepForTick(scenario, tick)

	return tickSimulation(state, {
		input: directionToInput(directive.direction),
		collisionAction: directive.collisionAction,
	})
}

function lastTick(scenario: BotScenario): number {
	return scenario.steps.length > 0
		? scenario.steps[scenario.steps.length - 1].tick
		: 0
}

function stepForTick(
	scenario: BotScenario,
	tick: number,
): {
	readonly direction: DirectionState
	readonly collisionAction: 'rollback' | 'rewind'
} {
	const candidate = scenario.steps.find((step) => step.tick === tick)

	if (candidate) {
		return {
			direction: candidate.direction,
			collisionAction: candidate.collisionAction,
		}
	}

	// Pad unscripted ticks with neutral input, carrying forward the most
	// recent collision-action preference (default `rollback`, same as the
	// offline driver).
	const before = [...scenario.steps].reverse().find((s) => s.tick < tick)
	const fallback = before?.collisionAction ?? 'rollback'

	return {
		direction: 0,
		collisionAction: fallback,
	}
}
