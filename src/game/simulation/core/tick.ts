import { FIXED_TIMESTEP_MS } from '../../constants'
import type { SimulationInput, SimulationState } from '../../types'
import {
	checkObstacleCollisions,
	getRewindObstacleIndices,
	hideRewindObstacles,
	markCollision,
	restoreObstaclesForRollback,
	updateObstacles,
} from '../obstacles'
import {
	getStabilizeDirection,
	isOrbitStable,
	moveOrbitVertically,
	setOrbitRollbackTicks,
	updateOrbit,
	updateOrbitByDirection,
} from '../orbit'
import { continueEndlessProgression } from '../progression'
import { createInitialDirectionMemory, recordDirectionMemory } from '../rewind'

export type TickSimulationOptions = {
	readonly input?: SimulationInput
	readonly collisionAction?: 'continue' | 'rollback' | 'rewind'
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

	switch (state.mode) {
		case 'rewinding':
			return tickRewind({ ...state, input })
		case 'rollingBack':
			return tickRollback({ ...state, input })
		case 'stabilizing':
			return tickStabilize({ ...state, input })
		case 'running':
			break
		case 'checkpoint':
		case 'gameOver':
		case 'paused':
			return {
				...state,
				input,
			}
	}

	return tickRunning(state, input, options.collisionAction ?? 'rollback')
}

export function startRollback(state: SimulationState): SimulationState {
	return {
		...state,
		mode: 'rollingBack',
	}
}

export function startRewind(
	state: SimulationState,
	collisionIndex: number,
	quantity = 2,
): SimulationState {
	const indices = getRewindObstacleIndices(
		state.obstacles,
		collisionIndex,
		quantity,
	)
	const hasEnoughHistory = indices.length >= quantity
	const lastIndex = indices[indices.length - 1]
	const rewindTicks =
		hasEnoughHistory && lastIndex !== undefined
			? Math.floor(
					Math.abs(
						state.obstacles[lastIndex].position.y - state.orbit.center.y,
					) / state.orbit.verticalSpeed,
				)
			: state.rewind.rollbackTicks
	const rewindSpeed = hasEnoughHistory
		? state.orbit.rewindResetSpeed
		: state.rewind.rollbackSpeed
	const rewindTargetY = hasEnoughHistory
		? state.orbit.center.y + state.orbit.verticalSpeed * rewindTicks
		: state.orbit.start.y

	return {
		...state,
		mode: 'rewinding',
		obstacles: hideRewindObstacles(state.obstacles, indices),
		orbit: {
			...state.orbit,
			rewindTicks,
			rewindSpeed,
			rewindTargetY,
		},
		rewind: {
			...state.rewind,
			rewindTicks,
			rewindSpeed,
			rewindTargetY,
		},
		stats: {
			...state.stats,
			collisions: {
				...state.stats.collisions,
				safe: state.stats.collisions.safe + 1,
			},
			rewinds: state.stats.rewinds + 1,
		},
	}
}

function tickRunning(
	state: SimulationState,
	input: SimulationInput,
	collisionAction: NonNullable<TickSimulationOptions['collisionAction']>,
): SimulationState {
	const collision = checkObstacleCollisions(state.obstacles, state.orbit)
	const collisionState = markCollision(state.obstacles, state.orbit, collision)
	const collisionStats = collision
		? {
				...state.stats,
				collisions: {
					...state.stats.collisions,
					total: state.stats.collisions.total + 1,
				},
			}
		: state.stats

	if (collision) {
		const collidedState = {
			...state,
			input,
			orbit: collisionState.orbit,
			obstacles: collisionState.obstacles,
			stats: collisionStats,
		}

		if (collisionAction === 'rollback') {
			return startRollback(collidedState)
		}

		if (collisionAction === 'rewind') {
			return startRewind(collidedState, collision.obstacleIndex)
		}
	}

	const rewind = recordDirectionMemory(state.rewind, input)
	const orbitWithTicks = setOrbitRollbackTicks(
		collisionState.orbit,
		rewind.rollbackTicks,
	)
	const obstacles = updateObstacles(collisionState.obstacles, orbitWithTicks, 1)
	const rotatedOrbit = updateOrbit(orbitWithTicks, input)
	const orbit = moveOrbitVertically(rotatedOrbit, 1)
	const progressedState = continueEndlessProgression({
		...state,
		tick: state.tick + 1,
		input,
		orbit,
		obstacles,
		rewind,
		stats: updateProgressionStats(
			{ ...state, stats: collisionStats, orbit },
			obstacles,
		),
	})

	return progressedState
}

function tickRewind(state: SimulationState): SimulationState {
	let current = state

	for (let i = current.rewind.rewindSpeed; i > 0; i--) {
		const stepped = stepBack(current)
		current = decrementRewindTicks(stepped.state)

		if (stepped.exhausted || current.rewind.rewindTicks <= 0) {
			return stepped.exhausted || isOrbitStable(current.orbit)
				? {
						...current,
						mode: 'running',
					}
				: startStabilizing(current)
		}
	}

	return current
}

function tickRollback(state: SimulationState): SimulationState {
	let current = state

	for (let i = current.rewind.rollbackSpeed; i > 0; i--) {
		const stepped = stepBack(current)
		current = stepped.state

		if (stepped.exhausted) {
			return {
				...current,
				mode: 'running',
				obstacles: restoreObstaclesForRollback(current.obstacles),
			}
		}
	}

	return current
}

function tickStabilize(state: SimulationState): SimulationState {
	let current = state

	for (let i = current.rewind.rewindSpeed; i > 0; i--) {
		const stabilizeDirection =
			current.orbit.stabilizeDirection || getStabilizeDirection(current.orbit)
		const rewind = recordDirectionMemory(current.rewind, {
			left: stabilizeDirection === -1,
			right: stabilizeDirection === 1,
		})
		const orbitWithTicks = setOrbitRollbackTicks(
			{
				...current.orbit,
				stabilizeDirection,
			},
			rewind.rollbackTicks,
		)
		const orbit = updateOrbitByDirection(orbitWithTicks, stabilizeDirection)

		current = {
			...current,
			tick: current.tick + 1,
			orbit,
			rewind,
		}

		if (isOrbitStable(orbit)) {
			return {
				...current,
				mode: 'running',
			}
		}
	}

	return current
}

function stepBack(state: SimulationState): {
	readonly state: SimulationState
	readonly exhausted: boolean
} {
	if (state.rewind.rollbackTicks <= 0) {
		return {
			state: resetRollbackHistory(state),
			exhausted: true,
		}
	}

	const currentMemento =
		state.rewind.directionMemory[state.rewind.directionMemory.length - 1] ??
		null

	if (!currentMemento) {
		return {
			state: resetRollbackHistory(state),
			exhausted: true,
		}
	}

	const obstacles = updateObstacles(state.obstacles, state.orbit, -1)
	const reversedOrbit = updateOrbitByDirection(
		state.orbit,
		currentMemento.state,
		-1,
	)
	const movedOrbit = moveOrbitVertically(reversedOrbit, -1)
	let rollbackTicks = state.rewind.rollbackTicks - 1
	let directionMemory = [...state.rewind.directionMemory]
	let exhausted = false

	if (rollbackTicks < currentMemento.enterTick) {
		directionMemory = directionMemory.slice(0, -1)

		if (directionMemory.length <= 0) {
			rollbackTicks = 0
			directionMemory = [...createInitialDirectionMemory()]
			exhausted = true
		}
	}

	const orbit = setOrbitRollbackTicks(movedOrbit, rollbackTicks)
	const rewind = {
		...state.rewind,
		rollbackTicks,
		directionMemory,
	}

	return {
		state: {
			...state,
			tick: state.tick + 1,
			orbit,
			obstacles,
			rewind,
		},
		exhausted,
	}
}

function decrementRewindTicks(state: SimulationState): SimulationState {
	const rewindTicks = Math.max(state.rewind.rewindTicks - 1, 0)

	return {
		...state,
		orbit: {
			...state.orbit,
			rewindTicks,
		},
		rewind: {
			...state.rewind,
			rewindTicks,
		},
	}
}

function startStabilizing(state: SimulationState): SimulationState {
	const stabilizeDirection = getStabilizeDirection(state.orbit)

	return {
		...state,
		mode: 'stabilizing',
		orbit: {
			...state.orbit,
			stabilizeDirection,
		},
	}
}

function resetRollbackHistory(state: SimulationState): SimulationState {
	return {
		...state,
		orbit: setOrbitRollbackTicks(state.orbit, 0),
		rewind: {
			...state.rewind,
			rollbackTicks: 0,
			directionMemory: createInitialDirectionMemory(),
		},
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
