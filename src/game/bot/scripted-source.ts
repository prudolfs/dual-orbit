import { createInitialSimulation, tickSimulation } from '../simulation'
import type { DirectionState, SimulationState } from '../types'
import { directionToInput } from '../types'
import type { BotScenario } from './driver'

/**
 * The bot's per-frame instruction for the simulation ticker.
 *
 * - `step: false` — the bot is idle; the ticker runs the normal
 *   keyboard-driven path.
 * - `step: true` — step exactly one `tickSimulation` this frame with the
 *   scripted `(input, collisionAction)`, ignoring the wall-clock delta so the
 *   live run stays byte-identical with the offline `runScenario` golden.
 *
 * `capture` is set when the tick *just emitted* is a scenario `captureTick`,
 *   so the browser side can grab a screenshot at the deterministic moment.
 */
export type BotInstruction = {
	readonly step: boolean
	readonly input?: { readonly left: boolean; readonly right: boolean }
	readonly collisionAction?: 'rollback' | 'rewind'
	readonly capture: boolean
	readonly done: boolean
}

const DONE: BotInstruction = {
	step: false,
	capture: false,
	done: true,
}

/**
 * An active bot playback session over a {@link BotScenario}.
 *
 * Pure and environment-agnostic — no `window`, no React, no Three.js. The app
 * installs an instance behind `window.__BOT__` and the simulation ticker
 * calls {@link next} every frame instead of the keyboard path; the browser
 * test calls {@link createInitialState} to seed the run and inspects the
 * state at capture ticks via {@link isCaptureTick}.
 *
 * Pacing mirrors {@link runScenario} exactly:
 *   - tick 0 is the freshly seeded initial state (no step),
 *   - ticks 1..`totalTicks` step once with `tickSimulation(...)` using the
 *     scripted input, padding unscripted ticks with neutral input.
 *
 * Because both paths call the *same* `tickSimulation` with the *same* inputs,
 * the live browser state at any tick equals the offline snapshot at that tick
 * to within the fixed timestep (here: exactly equal, since the bot bypasses
 * the wall-clock accumulator).
 */
export class BotPlayback {
	readonly scenario: BotScenario
	private readonly captureSet: ReadonlySet<number>
	private readonly totalTicks: number
	private readonly minTicks: number
	private readonly seed: number
	private cursor: number
	private playing: boolean

	constructor(scenario: BotScenario, options?: { readonly minTicks?: number }) {
		this.scenario = scenario
		this.seed = scenario.seed
		this.captureSet = new Set(scenario.captureTicks)
		this.totalTicks =
			scenario.steps.length > 0
				? scenario.steps[scenario.steps.length - 1].tick
				: 0
		this.minTicks = options?.minTicks ?? 0
		this.cursor = 0
		this.playing = true
	}

	/**
	 * The seeded initial state that begins the run. Identical to what
	 * `runScenario` constructs internally for the same scenario.
	 */
	createInitialState(): SimulationState {
		return createInitialSimulation({ generator: { seed: this.seed } })
	}

	/** The current tick the playback has reached (before the next `next`). */
	get tick(): number {
		return this.cursor
	}

	/** Whether the playback has not yet completed. */
	get active(): boolean {
		return this.playing
	}

	/** Convenience predicate — is `tick` a scenario capture tick? */
	isCaptureTick(tick: number): boolean {
		return this.captureSet.has(tick)
	}

	/**
	 * Produce the next per-frame instruction. Call once per render frame.
	 *
	 * Semantics:
	 *   - tick 0 (initial) is implicit; the first `next()` produces the
	 *     instruction to step into tick 1.
	 *   - on the frame after the final tick, returns `done: true` and deactivates.
	 */
	next(): BotInstruction {
		if (!this.playing) {
			return DONE
		}

		const limit = Math.max(this.totalTicks, this.minTicks)
		const nextTick = this.cursor + 1

		if (nextTick > limit) {
			this.playing = false
			return DONE
		}

		const step = this.stepForTick(nextTick)
		this.cursor = nextTick

		return {
			step: true,
			input: directionToInput(step.direction),
			collisionAction: step.collisionAction,
			capture: this.captureSet.has(nextTick),
			done: nextTick === limit,
		}
	}

	/** Reset to the start of the timeline (used on `restart`/`stop`). */
	reset(): void {
		this.cursor = 0
		this.playing = true
	}

	/** Halt playback immediately. */
	stop(): void {
		this.playing = false
	}

	/**
	 * Step the supplied state forward exactly one tick using the scenario's
	 * directive for `tick` (the scripted input, or neutral padding otherwise).
	 * Re-exported tick path so the browser can verify parity against the offline
	 * driver without importing `runScenario` directly.
	 */
	stepOffline(state: SimulationState, tick: number): SimulationState {
		const directive = this.stepForTick(tick)

		return tickSimulation(state, {
			input: directionToInput(directive.direction),
			collisionAction: directive.collisionAction,
		})
	}

	private stepForTick(tick: number): {
		readonly direction: DirectionState
		readonly collisionAction: 'rollback' | 'rewind'
	} {
		const steps = this.scenario.steps
		const candidate = steps.find((step) => step.tick === tick)

		if (candidate) {
			return {
				direction: candidate.direction,
				collisionAction: candidate.collisionAction,
			}
		}

		// Pad unscripted ticks with neutral input, carrying forward the most
		// recent collision-action preference (default `rollback`, same as the
		// offline driver).
		const before = [...steps].reverse().find((step) => step.tick < tick)
		const fallback = before?.collisionAction ?? 'rollback'

		return {
			direction: 0,
			collisionAction: fallback,
		}
	}
}
