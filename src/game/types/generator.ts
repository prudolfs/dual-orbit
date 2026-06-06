import type { ObstacleKind } from './obstacle'

export type EasingName =
	| 'linear'
	| 'sinusoidalOut'
	| 'quarticIn'
	| 'quarticOut'
	| 'exponentialOut'

export type ChanceState = {
	readonly min: number
	readonly max: number
	readonly start: number
	readonly end: number
	readonly ease: EasingName
	readonly value: number
}

export type WaveState = {
	readonly startMin: number
	readonly startMax: number
	readonly endMin: number
	readonly endMax: number
	readonly levels: number
	readonly levelEase: EasingName
	readonly groups: number
	readonly groupEase: EasingName
}

export type ObstacleArchetype = {
	readonly id: number
	readonly name: string
	readonly alias: string
	readonly kind: ObstacleKind | 'mirror'
	readonly mirror: string | readonly string[]
	readonly width: number
	readonly height: number
	readonly offsetX: number | readonly number[]
	readonly offsetTop: number
	readonly offsetBottom: number
	readonly speed: number
	readonly chance: ChanceState
}

export type GeneratorState = {
	readonly resolution: 'xd' | 'sd' | 'ld'
	readonly level: number
	readonly group: number
	readonly levelPerGroup: number
	readonly levelsPerGroup: number
	readonly groups: number
	readonly wave: WaveState
	readonly archetypes: readonly ObstacleArchetype[]
	readonly seed: number
}
