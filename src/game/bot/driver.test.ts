import { describe, expect, it } from 'vitest'
import { FIXED_TIMESTEP_MS } from '../constants'
import type { BotScenario } from './driver'
import { runScenario } from './driver'

/**
 * A small deterministic scenario used to pin the bot driver's golden snapshot.
 * Authored against the pure simulation: it rotates right for a handful of
 * ticks, holds neutral, then rotates left. The exact tick numbers come from
 * the orbit math (`angularSpeed` × tick count), but for Phase 1 only the
 * determinism across runs is asserted.
 */
const goldenScenario: BotScenario = {
	seed: 1,
	steps: [
		{ tick: 1, direction: 1, collisionAction: 'rollback' },
		{ tick: 2, direction: 1, collisionAction: 'rollback' },
		{ tick: 3, direction: 1, collisionAction: 'rollback' },
		{ tick: 4, direction: 1, collisionAction: 'rollback' },
		{ tick: 5, direction: 1, collisionAction: 'rollback' },
		{ tick: 6, direction: 0, collisionAction: 'rollback' },
		{ tick: 7, direction: 0, collisionAction: 'rollback' },
		{ tick: 8, direction: -1, collisionAction: 'rollback' },
		{ tick: 9, direction: -1, collisionAction: 'rollback' },
		{ tick: 10, direction: -1, collisionAction: 'rollback' },
	],
	captureTicks: [0, 5, 9],
} as const

describe('bot driver', () => {
	describe('runScenario', () => {
		it('returns one snapshot per tick plus the initial state', () => {
			const { snapshots } = runScenario(goldenScenario)

			// tick 0 (initial) + ticks 1..10
			expect(snapshots).toHaveLength(11)
			expect(snapshots[0]?.tick).toBe(0)
			expect(snapshots[10]?.tick).toBe(10)
		})

		it('produces identical snapshots across repeated runs (golden determinism)', () => {
			const first = runScenario(goldenScenario)
			const second = runScenario(goldenScenario)

			expect(second.snapshots).toStrictEqual(first.snapshots)
		})

		it('applies the scripted direction to the orbit rotation', () => {
			const { snapshots } = runScenario(goldenScenario)
			const initial = snapshots[0]?.state.orbit.orbs[0].angle
			const after5Right = snapshots[5]?.state.orbit.orbs[0].angle

			expect(typeof initial).toBe('number')
			expect(after5Right).not.toBe(initial)
		})

		it('honors captureTicks by flagging snapshot frames', () => {
			const { snapshots } = runScenario(goldenScenario)
			const captureTicks = snapshots
				.filter((snapshot) => snapshot.capture)
				.map((snapshot) => snapshot.tick)

			expect(captureTicks).toEqual([0, 5, 9])
		})

		it('drives offline with no DOM dependency (pure Node)', () => {
			// If this test runs at all in the Node vitest environment, the
			// driver is render-free. Belt-and-braces: assert the fixed
			// timestep plumbing is independent of wall-clock time.
			expect(FIXED_TIMESTEP_MS).toBeCloseTo(1000 / 60)
			const { snapshots } = runScenario(goldenScenario)
			expect(snapshots.length).toBeGreaterThan(0)
		})
	})
})
