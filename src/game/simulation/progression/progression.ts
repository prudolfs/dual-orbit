import type {
	GeneratorState,
	ObstacleState,
	SimulationState,
} from '../../types'
import { generateObstacleLayout } from '../generator'

const NEXT_LEVEL_TRIGGER_REMAINING = 4

export function continueEndlessProgression(
	state: SimulationState,
): SimulationState {
	if (state.stats.encounters > NEXT_LEVEL_TRIGGER_REMAINING) {
		return state
	}

	const nextGenerator = getNextGenerator(state.generator)
	const preliminaryLayout = generateObstacleLayout(nextGenerator, state.orbit)
	const shift = getAppendShift(
		state.obstacles,
		preliminaryLayout.obstacles,
		state.orbit.radius * 2,
	)
	const virtualOrbit = {
		...state.orbit,
		center: {
			...state.orbit.center,
			y: state.orbit.center.y - shift,
		},
	}
	const layout = generateObstacleLayout(nextGenerator, virtualOrbit)
	const appendedObstacles = layout.obstacles.map((obstacle) =>
		shiftObstacle(obstacle, shift, layout.generator),
	)
	const obstacles = [...state.obstacles, ...appendedObstacles]

	return {
		...state,
		obstacles,
		generator: layout.generator,
		stats: {
			...state.stats,
			obstacles: obstacles.length,
			encounters: state.stats.encounters + appendedObstacles.length,
		},
	}
}

function getNextGenerator(generator: GeneratorState): GeneratorState {
	const isLastLevelInGroup = generator.levelPerGroup >= generator.levelsPerGroup
	const group = isLastLevelInGroup
		? Math.min(generator.group + 1, generator.groups)
		: generator.group
	const levelPerGroup =
		isLastLevelInGroup && generator.group < generator.groups
			? 1
			: Math.min(generator.levelPerGroup + 1, generator.levelsPerGroup)

	return {
		...generator,
		group,
		levelPerGroup,
		level: levelPerGroup + generator.levelsPerGroup * (group - 1),
	}
}

function getAppendShift(
	currentObstacles: readonly ObstacleState[],
	nextObstacles: readonly ObstacleState[],
	gap: number,
): number {
	const currentMinY = Math.min(
		...currentObstacles.map((obstacle) => obstacle.position.y),
	)
	const nextMaxY = Math.max(
		...nextObstacles.map((obstacle) => obstacle.position.y),
	)

	return currentMinY - gap - nextMaxY
}

function shiftObstacle(
	obstacle: ObstacleState,
	shift: number,
	generator: GeneratorState,
): ObstacleState {
	return {
		...obstacle,
		id: `${generator.level}-${generator.seed}-${obstacle.id}`,
		position: {
			...obstacle.position,
			y: obstacle.position.y + shift,
		},
	}
}
