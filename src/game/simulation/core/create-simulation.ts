import type { GeneratorState, SimulationState } from '../../types'
import { createGeneratorState, generateObstacleLayout } from '../generator'
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
	const layout = generateObstacleLayout(generator, orbit)

	return {
		mode: 'running',
		tick: 0,
		input: { left: false, right: false },
		orbit,
		obstacles: layout.obstacles,
		generator: layout.generator,
		rewind: createRewindState(orbit.center.y),
		stats: {
			obstacles: layout.obstacles.length,
			encounters: 0,
			score: 0,
			collisions: {
				total: 0,
				safe: 0,
			},
		},
	}
}
