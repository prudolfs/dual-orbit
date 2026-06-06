import { REWIND_SPEED, ROLLBACK_SPEED } from '../../constants'
import {
	type DirectionMemento,
	inputToDirection,
	type RewindState,
	type SimulationInput,
} from '../../types'

export function createDirectionMemento(
	state: DirectionMemento['state'],
	enterTick: number,
	exitTick: number,
): DirectionMemento {
	return { state, enterTick, exitTick }
}

export function createInitialDirectionMemory(): readonly DirectionMemento[] {
	return [createDirectionMemento(0, 0, 0)]
}

export function createRewindState(rewindTargetY: number): RewindState {
	return {
		directionMemory: createInitialDirectionMemory(),
		rollbackTicks: 0,
		rollbackSpeed: ROLLBACK_SPEED,
		rewindTicks: 0,
		rewindSpeed: REWIND_SPEED,
		rewindTargetY,
	}
}

export function recordDirectionMemory(
	rewind: RewindState,
	input: SimulationInput,
): RewindState {
	const rollbackTicks = rewind.rollbackTicks + 1
	const state = inputToDirection(input)
	const directionMemory = [...rewind.directionMemory]
	const current =
		directionMemory[directionMemory.length - 1] ??
		createDirectionMemento(0, 0, 0)
	const extended = { ...current, exitTick: rollbackTicks }

	directionMemory[directionMemory.length - 1] = extended

	if (extended.state !== state) {
		directionMemory.push(
			createDirectionMemento(state, rollbackTicks, rollbackTicks),
		)
	}

	return {
		...rewind,
		rollbackTicks,
		directionMemory,
	}
}
