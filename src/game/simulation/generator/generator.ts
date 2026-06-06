import {
	DEFAULT_GROUPS,
	DEFAULT_LEVELS_PER_GROUP,
	DEFAULT_RANDOM_SEED,
	DEFAULT_RESOLUTION,
} from '../../constants'
import type { GeneratorState, WaveState } from '../../types'

export type CreateGeneratorOptions = {
	readonly resolution?: GeneratorState['resolution']
	readonly level?: number
	readonly group?: number
	readonly levelPerGroup?: number
	readonly levelsPerGroup?: number
	readonly groups?: number
	readonly seed?: number
}

export function createDefaultWave(
	levels: number = DEFAULT_LEVELS_PER_GROUP,
	groups: number = DEFAULT_GROUPS,
): WaveState {
	return {
		startMin: 5,
		startMax: 10,
		endMin: 10,
		endMax: 15,
		levels,
		levelEase: 'sinusoidalOut',
		groups,
		groupEase: 'sinusoidalOut',
	}
}

export function createGeneratorState(
	options: CreateGeneratorOptions = {},
): GeneratorState {
	const levelsPerGroup = options.levelsPerGroup ?? DEFAULT_LEVELS_PER_GROUP
	const groups = options.groups ?? DEFAULT_GROUPS
	const level = options.level ?? levelsPerGroup
	const group = options.group ?? 1

	return {
		resolution: options.resolution ?? DEFAULT_RESOLUTION,
		level,
		group,
		levelPerGroup:
			options.levelPerGroup ?? level - (group - 1) * levelsPerGroup,
		levelsPerGroup,
		groups,
		wave: createDefaultWave(levelsPerGroup, groups),
		archetypes: [],
		seed: options.seed ?? DEFAULT_RANDOM_SEED,
	}
}
