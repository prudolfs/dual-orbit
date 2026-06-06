import type { GeneratorState, SimulationState } from '../../types'
import { createGeneratorState } from '../generator'
import { createOrbitState } from '../orbit'
import { createRewindState } from '../rewind'

export type CreateSimulationOptions = {
	readonly generator?: Partial<GeneratorState>
}

export function createInitialSimulation(
	options: CreateSimulationOptions = {},
): SimulationState {
	const generator = createGeneratorState(options.generator)
	const orbit = createOrbitState({ resolution: generator.resolution })

	return {
		mode: 'running',
		tick: 0,
		input: { left: false, right: false },
		orbit,
		obstacles: [],
		generator,
		rewind: createRewindState(orbit.center.y),
		stats: {
			obstacles: 0,
			encounters: 0,
			score: 0,
			collisions: {
				total: 0,
				safe: 0,
			},
		},
	}
}
