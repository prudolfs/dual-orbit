import type { Vec2 } from './vector'

export type ObstacleKind = 'static' | 'moving' | 'angular' | 'angular_long'

type ObstacleBase = {
	readonly id: string
	readonly name: string
	readonly alias: string
	readonly position: Vec2
	readonly width: number
	readonly height: number
	readonly rotation: number
	readonly speed: number
	readonly alive: boolean
	readonly exists: boolean
	readonly shrunken: boolean
	readonly collidingOrbSides: readonly ('left' | 'right')[]
}

export type StaticObstacleState = ObstacleBase & {
	readonly kind: 'static'
}

export type MovingObstacleState = ObstacleBase & {
	readonly kind: 'moving'
}

export type AngularObstacleState = ObstacleBase & {
	readonly kind: 'angular'
}

export type AngularLongObstacleState = ObstacleBase & {
	readonly kind: 'angular_long'
}

export type ObstacleState =
	| StaticObstacleState
	| MovingObstacleState
	| AngularObstacleState
	| AngularLongObstacleState
