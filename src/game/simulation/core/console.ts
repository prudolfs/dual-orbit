import type { SimulationInput, SimulationState } from '../../types'
import { createInitialSimulation } from './create-simulation'
import { tickSimulation } from './tick'

export type ConsoleSimulationSample = {
	readonly tick: number
	readonly orbitY: number
	readonly leftAngle: number
	readonly rightAngle: number
	readonly memoryLength: number
}

export function runSimulationTicks(
	inputs: readonly SimulationInput[],
	initialState: SimulationState = createInitialSimulation(),
): readonly ConsoleSimulationSample[] {
	const samples: ConsoleSimulationSample[] = []
	let state = initialState

	for (const input of inputs) {
		state = tickSimulation(state, { input })
		samples.push({
			tick: state.tick,
			orbitY: state.orbit.center.y,
			leftAngle: state.orbit.orbs[0].angle,
			rightAngle: state.orbit.orbs[1].angle,
			memoryLength: state.rewind.directionMemory.length,
		})
	}

	return samples
}
