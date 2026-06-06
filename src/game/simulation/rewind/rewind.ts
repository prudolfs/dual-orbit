import { REWIND_SPEED, ROLLBACK_SPEED } from '../../constants'
import type { DirectionMemento, RewindState } from '../../types'

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
