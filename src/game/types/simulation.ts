import type { GeneratorState } from './generator'
import type { SimulationInput } from './input'
import type { ObstacleState } from './obstacle'
import type { OrbitState } from './orbit'
import type { RewindState } from './rewind'

export type SimulationMode =
	| 'running'
	| 'rewinding'
	| 'stabilizing'
	| 'rollingBack'
	| 'checkpoint'
	| 'gameOver'
	| 'paused'

export type SimulationStats = {
	readonly obstacles: number
	readonly encounters: number
	readonly score: number
	readonly collisions: {
		readonly total: number
		readonly safe: number
	}
}

export type SimulationState = {
	readonly mode: SimulationMode
	readonly tick: number
	readonly input: SimulationInput
	readonly orbit: OrbitState
	readonly obstacles: readonly ObstacleState[]
	readonly generator: GeneratorState
	readonly rewind: RewindState
	readonly stats: SimulationStats
}
