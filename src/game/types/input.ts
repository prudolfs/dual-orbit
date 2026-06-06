export type DirectionState = -1 | 0 | 1

export type SimulationInput = {
	readonly left: boolean
	readonly right: boolean
}

export type DirectionMemento = {
	readonly state: DirectionState
	readonly enterTick: number
	readonly exitTick: number
}

export function inputToDirection(input: SimulationInput): DirectionState {
	if (input.left) {
		return -1
	}

	if (input.right) {
		return 1
	}

	return 0
}

export function directionToInput(direction: DirectionState): SimulationInput {
	return {
		left: direction === -1,
		right: direction === 1,
	}
}
