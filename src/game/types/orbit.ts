import type { Vec2 } from './vector'

export type OrbSide = 'left' | 'right'

export type OrbState = {
	readonly side: OrbSide
	readonly angle: number
	readonly localPosition: Vec2
	readonly radius: number
	readonly colliding: boolean
}

export type OrbitState = {
	readonly center: Vec2
	readonly start: Vec2
	readonly radius: number
	readonly verticalSpeed: number
	readonly angularSpeed: number
	readonly rollbackTicks: number
	readonly rollbackSpeed: number
	readonly rewindTicks: number
	readonly rewindSpeed: number
	readonly rewindResetSpeed: number
	readonly rewindTargetY: number
	readonly stabilizeDirection: -1 | 0 | 1
	readonly orbs: readonly [OrbState, OrbState]
}
