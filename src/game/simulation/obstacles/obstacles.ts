import type { ObstacleKind, ObstacleState, Vec2 } from '../../types'

export type CreateObstacleStateOptions = {
	readonly id: string
	readonly name: string
	readonly alias?: string
	readonly kind: ObstacleKind
	readonly position: Vec2
	readonly width: number
	readonly height: number
	readonly rotation?: number
	readonly speed?: number
	readonly alive?: boolean
	readonly exists?: boolean
	readonly shrunken?: boolean
}

export function createObstacleState(
	options: CreateObstacleStateOptions,
): ObstacleState {
	return {
		id: options.id,
		name: options.name,
		alias: options.alias ?? options.name,
		kind: options.kind,
		position: options.position,
		width: options.width,
		height: options.height,
		rotation: options.rotation ?? 0,
		speed: options.speed ?? 0,
		alive: options.alive ?? true,
		exists: options.exists ?? true,
		shrunken: options.shrunken ?? false,
	}
}
