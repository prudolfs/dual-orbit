import { expect, test } from 'vitest'
import type { SimulationState } from '../types'
import type { BotBridge } from './bridge'
import { advanceBotFrame, createBotBridge } from './bridge'
import type { BotScenario, BotSnapshot } from './driver'
import { runScenario } from './driver'
import { installBot, installBotIfDev } from './installer'
import { nearMissRewindScenario, rotatingFieldScenario } from './scenarios'
import {
	createInitialState,
	createPlayback,
	next,
	playbackActive,
	playbackTick,
	stepOffline,
} from './scripted-source'

/**
 * The Phase 3 done-condition: the browser-driven state at a capture tick
 * matches the offline golden snapshot to within the fixed timestep.
 *
 * `Playback` is pure and the bridge stepping path drives the identical
 * `tickSimulation` the player uses (`stepOffline`), so the parity check can
 * run in Node by simulating one bot frame per tick:
 *   - `runScenario(scenario)`       → offline golden snapshots
 *   - `createPlayback` + `stepOffline` → the exact frame-by-frame path the
 *     installed `window.__BOT__` bridge runs inside the real R3F ticker.
 *
 * They must agree bit-for-bit at every tick (which is "to within the fixed
 * timestep" — here exactly, since the bot bypasses the wall-clock accumulator
 * and steps one deterministic tick per frame).
 */
function drivePlaybackGolden(
	scenario: BotScenario,
): readonly SimulationState[] {
	let cursor = createPlayback(scenario)
	const states: SimulationState[] = []
	let current = createInitialState(scenario)

	states.push(current)

	while (playbackActive(cursor)) {
		const advanced = next(cursor)
		cursor = advanced.playback

		if (!advanced.instruction.step) {
			break
		}

		current = stepOffline(current, cursor.scenario, playbackTick(cursor))
		states.push(current)
	}

	return states
}

const SCENARIOS = [
	['rotatingField', rotatingFieldScenario],
	['nearMissRewind', nearMissRewindScenario],
] as const

test.each(
	SCENARIOS,
)('%s: playback-driven states equal offline golden at every tick', (_name, scenario) => {
	const offline = runScenario(scenario).snapshots.map(
		(snapshot: BotSnapshot) => snapshot.state,
	)
	const driven = drivePlaybackGolden(scenario)

	expect(driven).toHaveLength(offline.length)
	expect(driven).toStrictEqual(offline)
})

test.each(
	SCENARIOS,
)('%s: capture ticks match offline state', (_name, scenario) => {
	let cursor = createPlayback(scenario)
	const offline = runScenario(scenario).snapshots
	let current = createInitialState(cursor.scenario)

	while (playbackActive(cursor)) {
		const advanced = next(cursor)
		cursor = advanced.playback

		if (!advanced.instruction.step) {
			break
		}

		current = stepOffline(current, cursor.scenario, playbackTick(cursor))

		if (advanced.instruction.capture) {
			const offlineAtTick = offline[playbackTick(cursor)]?.state

			expect(offlineAtTick).toBeDefined()
			expect(current).toStrictEqual(offlineAtTick)
		}
	}
})

type TickAllResult = {
	readonly bridge: BotBridge
	readonly states: readonly SimulationState[]
	readonly captures: readonly {
		readonly tick: number
		readonly state: SimulationState
	}[]
}

function tickAll(scenario: BotScenario): TickAllResult {
	const events: { tick: number; state: SimulationState }[] = []
	const states: SimulationState[] = []

	const bridge = createBotBridge({
		setSimulation: (updater) => {
			states[0] = updater({} as SimulationState)
		},
	})

	bridge.onCapture((e) => events.push(e))

	const initial = bridge.playScenario(scenario)
	let current = initial

	while (bridge.active && playbackActive(bridge.active)) {
		const result = advanceBotFrame(current, bridge)

		if (result.kind === 'idle') {
			break
		}

		current = result.state
		states.push(current)
	}

	expect(states[0]).toEqual(initial)

	return { bridge, states, captures: events }
}

test('createBotBridge seeds the simulation with that scenario (matches offline tick 0)', () => {
	const { bridge } = tickAll(rotatingFieldScenario)

	const initial = bridge.playScenario(rotatingFieldScenario)
	const offlineTick0 = runScenario(rotatingFieldScenario).snapshots[0]?.state

	expect(offlineTick0).toBeDefined()
	expect(initial.tick).toBe(0)
	expect(initial.mode).toBe('running')
	expect(initial.generator.seed).toBe(offlineTick0?.generator.seed)
	// full parity on the seeded initial state
	expect(initial).toStrictEqual(offlineTick0)
})

test('createBotBridge emits a capture event for each scenario capture tick', () => {
	const { captures } = tickAll(nearMissRewindScenario)

	expect(captures.map((c) => c.tick)).toEqual(
		nearMissRewindScenario.captureTicks.filter((t) => t !== 0),
	)
})

test('createBotBridge capture-event state equals offline golden state', () => {
	const { captures } = tickAll(nearMissRewindScenario)
	const offline = runScenario(nearMissRewindScenario).snapshots

	for (const event of captures) {
		expect(event.state).toStrictEqual(offline[event.tick]?.state)
	}
})

test('createBotBridge.stop() deactivates the bridge', () => {
	let captured: SimulationState | null = null
	const bridge = createBotBridge({
		setSimulation: (updater) => {
			captured = updater({} as SimulationState)
		},
	})

	bridge.onCapture(() => {})
	bridge.playScenario(rotatingFieldScenario)
	expect(
		playbackActive(bridge.active ?? createPlayback(rotatingFieldScenario)),
	).toBe(true)

	bridge.stop()
	expect(bridge.active).toBe(null)

	// A stopped bridge no longer drives frames; advanceBotFrame stays idle
	// regardless of the input state.
	const result = advanceBotFrame(captured ?? ({} as SimulationState), bridge)
	expect(result.kind).toBe('idle')
})

function withWindow(impl: () => void): void {
	const win = globalThis as unknown as { __BOT__?: BotBridge | undefined }
	const previous = win.__BOT__

	try {
		impl()
	} finally {
		win.__BOT__ = previous
	}
}

test('installBot exposes window.__BOT__ and returns the cached instance', () => {
	withWindow(() => {
		const a = installBot({ setSimulation: () => {} })
		expect((globalThis as unknown as { __BOT__?: BotBridge }).__BOT__).toBe(a)

		const b = installBot({ setSimulation: () => {} })
		expect(b).toBe(a)
	})
})

test('installBotIfDev installs the bridge in a non-production build', () => {
	const win = globalThis as unknown as { __BOT__?: BotBridge | undefined }

	withWindow(() => {
		installBotIfDev({ setSimulation: () => {} })
		expect(win.__BOT__).not.toBeNull()
	})
})
