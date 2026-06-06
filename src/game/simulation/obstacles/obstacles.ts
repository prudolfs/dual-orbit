import { lerp, normalize } from '../../math'
import type { ObstacleKind, ObstacleState, OrbitState, Vec2 } from '../../types'

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

export function updateObstacles(
	obstacles: readonly ObstacleState[],
	orbit: OrbitState,
	direction: 1 | -1,
	scale = 1,
): readonly ObstacleState[] {
	return obstacles.map((obstacle, index) => {
		switch (obstacle.kind) {
			case 'moving':
				return updateMovingObstacle(obstacle, obstacles, index, orbit)
			case 'angular':
			case 'angular_long':
				return {
					...obstacle,
					rotation: obstacle.rotation + obstacle.speed * direction * scale,
				}
			case 'static':
				return obstacle
		}

		return obstacle
	})
}

function updateMovingObstacle(
	obstacle: ObstacleState,
	obstacles: readonly ObstacleState[],
	index: number,
	orbit: OrbitState,
): ObstacleState {
	const next = obstacles[index + 1]
	const previous = obstacles[index - 1]

	if (!next || !previous || obstacle.speed === 0) {
		return obstacle
	}

	const a = next.position.y
	const b = previous.position.y
	const c = a + (b - a) / 2
	const t1 = (c - a) / obstacle.speed
	const t2 = (orbit.center.y - b) / orbit.verticalSpeed
	let y = c

	if (t2 >= 0) {
		y = t1 >= t2 ? lerp(a, c, normalize(t2, t1, 0)) : a
	}

	return {
		...obstacle,
		position: { ...obstacle.position, y },
	}
}
