import type { SimulationState } from '../types'
import type { BotScenario } from './driver'
import { runScenario } from './driver'
import { BotPlayback } from './scripted-source'

/**
 * Public surface installed on `window.__BOT__` (preview build only,
 * runtime-gated to non-production by the installer in `App.tsx`).
 *
 * Mirrors the `robotics-lab` `window.__E2E__` bridge shape: a tiny backdoor
 * that lets Playwright drive the *real* running game with a deterministic bot
 * scenario instead of synthesizing keyboard events.
 *
 * The bridge never owns a parallel simulation — it only returns the seeded
 * initial state and exposes the active playback so the app's existing
 * `SimulationTicker` can step the same `tickSimulation` the player uses. The
 * screenshot and the offline golden snapshot are therefore governed by one
 * code path.
 */
export type BotBridge = {
	readonly __brand: 'bot-bridge'

	/** Start driving the game with the given scenario; returns the initial state. */
	playScenario: (scenario: BotScenario) => SimulationState

	/** Stop bot playback and hand control back to the keyboard. */
	stop: () => void

	/** The active playback, or `null` when the bot is idle. */
	readonly active: BotPlayback | null

	/** Subscribe to capture-tick events; returns an unsubscribe. */
	onCapture: (handler: (detail: BotCaptureEvent) => void) => () => void

	/**
	 * Read the deterministic state the offline driver produces at `tick`.
	 * Used by the parity test / Playwright spec to compare against the live
	 * browser state at the same tick. Pure (no DOM).
	 */
	offlineSnapshotAt: (scenario: BotScenario, tick: number) => SimulationState
}

export type BotCaptureEvent = {
	readonly tick: number
	readonly state: SimulationState
}

export type BotBridgeHost = {
	readonly setSimulation: (
		updater: (current: SimulationState) => SimulationState,
	) => void
	readonly getSimulation?: () => SimulationState
}

const BRAND = 'bot-bridge' as const

/**
 * Result the ticker observes from a bot-driven frame.
 *
 * - `'step'` — the bot advanced the simulation; apply the returned state.
 * - `'capture'` — same as `'step'` but it lands on a scenario capture tick.
 * - `'component'` would be richer, but these three cover the ticker's needs.
 */
export type BotFrameResult =
	| { readonly kind: 'idle' }
	| { readonly kind: 'step'; readonly state: SimulationState }
	| {
			readonly kind: 'capture'
			readonly tick: number
			readonly state: SimulationState
	  }

export function createBotBridge(host: BotBridgeHost): BotBridge {
	let active: BotPlayback | null = null
	const captureHandlers = new Set<(detail: BotCaptureEvent) => void>()

	function emitCapture(tick: number, state: SimulationState): void {
		for (const handler of captureHandlers) {
			handler({ tick, state })
		}
	}

	function playScenario(scenario: BotScenario): SimulationState {
		const playback = new BotPlayback(scenario)
		const initial = playback.createInitialState()

		active = playback
		host.setSimulation(() => initial)

		return initial
	}

	function stop(): void {
		active?.stop()
		active = null
	}

	function onCapture(handler: (detail: BotCaptureEvent) => void): () => void {
		captureHandlers.add(handler)

		return () => {
			captureHandlers.delete(handler)
		}
	}

	function offlineSnapshotAt(
		scenario: BotScenario,
		tick: number,
	): SimulationState {
		const { snapshots } = runScenario(scenario)
		const snapshot = snapshots[tick]

		if (!snapshot) {
			throw new RangeError(
				`bot bridge: tick ${tick} has no offline snapshot (scenario has ${snapshots.length} ticks 0..${snapshots.length - 1})`,
			)
		}

		return snapshot.state
	}

	const bridge: BotBridge = {
		__brand: BRAND,
		playScenario,
		stop,
		get active() {
			return active
		},
		onCapture,
		offlineSnapshotAt,
	}

	// Stash the emitter on the bridge instance so the frame stepper (which the
	// ticker calls many times per second) can fan capture events out without a
	// second lookup. Kept off the public surface via a non-enumerable symbol.
	;(
		bridge as unknown as {
			__emitCapture: typeof emitCapture
		}
	).__emitCapture = emitCapture

	return bridge
}

/**
 * Drive one bot frame: if a {@link BotPlayback} is active, step it forward
 * exactly one deterministic `tickSimulation`, bypassing the wall-clock
 * accumulator so the live run stays byte-identical with the offline golden.
 *
 * Returns the new state when the bot steps (and a `'capture'` kind when that
 * tick is a scenario capture tick, so the browser side can grab a
 * screenshot / run the parity check at the deterministic moment). Returns
 * `'idle'` when the bot is not driving — the caller then runs the normal
 * keyboard path.
 */
export function advanceBotFrame(
	simulation: SimulationState,
	bridge: BotBridge,
): BotFrameResult {
	const playback = bridge.active

	if (!playback?.active) {
		return { kind: 'idle' }
	}

	const instruction = playback.next()

	if (!instruction.step) {
		return { kind: 'idle' }
	}

	const stepped = playback.stepOffline(simulation, playback.tick)

	if (instruction.capture) {
		const emit = (
			bridge as unknown as {
				__emitCapture?: (tick: number, state: SimulationState) => void
			}
		).__emitCapture

		emit?.(playback.tick, stepped)

		return { kind: 'capture', tick: playback.tick, state: stepped }
	}

	return { kind: 'step', state: stepped }
}
