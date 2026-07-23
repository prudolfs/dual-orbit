import type { GeneratorState, SimulationState, Vec2 } from '../../types'
import { createGeneratorState, generateObstacleLayout } from '../generator'
import { createOrbitState } from '../orbit'
import { createRewindState } from '../rewind'

export type CreateSimulationOptions = {
	readonly generator?: Partial<GeneratorState>
	/**
	 * Overrides the orbit spawn centre. Used by bot scenarios that *teleport*
	 * the orbit deep into a seeded obstacle field (see `docs/level-design.md`):
	 * `generateObstacleLayout` then computes `angular` bar pre-rotations against
	 * the new centre so the spawned bars are correctly phased for the orbit
	 * that will actually arrive, not the default top-of-area spawn.
	 */
	readonly orbitCenter?: Vec2
}

export function createInitialSimulation(
	options: CreateSimulationOptions = {},
): SimulationState {
	const generator = createGeneratorState(options.generator)
	const orbit = createOrbitState({
		resolution: generator.resolution,
		center: options.orbitCenter,
	})
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
			rewinds: 0,
		},
	}
}
