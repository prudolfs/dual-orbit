import type { DirectionMemento } from './input'

export type RewindState = {
	readonly directionMemory: readonly DirectionMemento[]
	readonly rollbackTicks: number
	readonly rollbackSpeed: number
	readonly rewindTicks: number
	readonly rewindSpeed: number
	readonly rewindTargetY: number
}
