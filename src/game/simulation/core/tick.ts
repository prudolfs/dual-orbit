import { FIXED_TIMESTEP_MS } from '../../constants'
import type { SimulationInput, SimulationState } from '../../types'
import { updateObstacles } from '../obstacles'
import {
	moveOrbitVertically,
	setOrbitRollbackTicks,
	updateOrbit,
} from '../orbit'
import { recordDirectionMemory } from '../rewind'

export type TickSimulationOptions = {
	readonly input?: SimulationInput
}

export type FixedTimestepState = {
	readonly simulation: SimulationState
	readonly accumulatorMs: number
	readonly steps: number
}

export function tickSimulation(
	state: SimulationState,
	options: TickSimulationOptions = {},
): SimulationState {
	const input = options.input ?? state.input

	if (state.mode !== 'running') {
		return {
			...state,
			input,
		}
	}

	const rewind = recordDirectionMemory(state.rewind, input)
	const orbitWithTicks = setOrbitRollbackTicks(
		state.orbit,
		rewind.rollbackTicks,
	)
	const obstacles = updateObstacles(state.obstacles, orbitWithTicks, 1)
	const rotatedOrbit = updateOrbit(orbitWithTicks, input)
	const orbit = moveOrbitVertically(rotatedOrbit, 1)

	return {
		...state,
		tick: state.tick + 1,
		input,
		orbit,
		obstacles,
		rewind,
		stats: updateProgressionStats(state, obstacles),
	}
}

export function advanceFixedSimulation(
	state: SimulationState,
	elapsedMs: number,
	options: TickSimulationOptions & { readonly accumulatorMs?: number } = {},
): FixedTimestepState {
	let simulation = state
	let accumulatorMs = (options.accumulatorMs ?? 0) + elapsedMs
	let steps = 0

	while (accumulatorMs >= FIXED_TIMESTEP_MS) {
		simulation = tickSimulation(simulation, options)
		accumulatorMs -= FIXED_TIMESTEP_MS
		steps++
	}

	return {
		simulation,
		accumulatorMs,
		steps,
	}
}

function updateProgressionStats(
	state: SimulationState,
	obstacles: readonly SimulationState['obstacles'][number][],
): SimulationState['stats'] {
	const encounters = countEncounters(obstacles, state.orbit)

	return {
		...state.stats,
		encounters,
		score: Math.max(state.stats.obstacles - encounters, 0),
	}
}

function countEncounters(
	obstacles: readonly SimulationState['obstacles'][number][],
	orbit: SimulationState['orbit'],
): number {
	let count = 0

	for (let i = obstacles.length - 1; i >= 0; i--) {
		const obstacle = obstacles[i]

		if (!obstacle.exists || !obstacle.alive) {
			continue
		}

		if (obstacle.position.y > orbit.center.y + orbit.radius) {
			break
		}

		count++
	}

	return count
}
