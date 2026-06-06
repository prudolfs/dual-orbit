import { circleVsRect, circleVsRotatedRect, lerp, normalize } from '../../math'
import type {
	ObstacleKind,
	ObstacleState,
	OrbitState,
	OrbState,
	Vec2,
} from '../../types'

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
		collidingOrbSides: [],
	}
}

export type CollisionResult = {
	readonly obstacle: ObstacleState
	readonly obstacleIndex: number
	readonly orbSides: readonly OrbState['side'][]
}

export function checkObstacleCollisions(
	obstacles: readonly ObstacleState[],
	orbit: OrbitState,
): CollisionResult | null {
	for (
		let obstacleIndex = 0;
		obstacleIndex < obstacles.length;
		obstacleIndex++
	) {
		const obstacle = obstacles[obstacleIndex]

		if (!obstacle.exists || !obstacle.alive) {
			continue
		}

		const orbSides = orbit.orbs
			.filter((orb) => collideOrbWithObstacle(orbit, orb, obstacle))
			.map((orb) => orb.side)

		if (orbSides.length > 0) {
			return {
				obstacle: {
					...obstacle,
					collidingOrbSides: orbSides,
				},
				obstacleIndex,
				orbSides,
			}
		}
	}

	return null
}

export function markCollision(
	obstacles: readonly ObstacleState[],
	orbit: OrbitState,
	collision: CollisionResult | null,
): {
	readonly obstacles: readonly ObstacleState[]
	readonly orbit: OrbitState
} {
	if (!collision) {
		return {
			obstacles: obstacles.map((obstacle) => ({
				...obstacle,
				collidingOrbSides: [],
			})),
			orbit: {
				...orbit,
				orbs: setOrbCollisionFlags(orbit, []),
			},
		}
	}

	return {
		obstacles: obstacles.map((obstacle, index) =>
			index === collision.obstacleIndex
				? collision.obstacle
				: { ...obstacle, collidingOrbSides: [] },
		),
		orbit: {
			...orbit,
			orbs: setOrbCollisionFlags(orbit, collision.orbSides),
		},
	}
}

export function restoreObstaclesForRollback(
	obstacles: readonly ObstacleState[],
): readonly ObstacleState[] {
	return obstacles.map((obstacle) => ({
		...obstacle,
		alive: true,
		exists: true,
		shrunken: false,
		collidingOrbSides: [],
	}))
}

export function hideRewindObstacles(
	obstacles: readonly ObstacleState[],
	indices: readonly number[],
): readonly ObstacleState[] {
	const indexSet = new Set(indices)

	return obstacles.map((obstacle, index) =>
		indexSet.has(index)
			? {
					...obstacle,
					alive: false,
					collidingOrbSides: [],
				}
			: obstacle,
	)
}

export function getRewindObstacleIndices(
	obstacles: readonly ObstacleState[],
	collisionIndex: number,
	quantity: number,
): readonly number[] {
	const indices: number[] = []
	let index = collisionIndex - 1

	while (index >= 0 && indices.length !== quantity) {
		indices.push(index)
		index--
	}

	const lastIndex = indices[indices.length - 1]

	if (
		index >= 0 &&
		lastIndex !== undefined &&
		obstacles[index]?.position.y === obstacles[lastIndex]?.position.y
	) {
		indices.push(index)
	}

	return indices
}

function setOrbCollisionFlags(
	orbit: OrbitState,
	collidingSides: readonly OrbState['side'][],
): OrbitState['orbs'] {
	return [
		{
			...orbit.orbs[0],
			colliding: collidingSides.includes(orbit.orbs[0].side),
		},
		{
			...orbit.orbs[1],
			colliding: collidingSides.includes(orbit.orbs[1].side),
		},
	]
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

function collideOrbWithObstacle(
	orbit: OrbitState,
	orb: OrbState,
	obstacle: ObstacleState,
): boolean {
	const center = {
		x: orbit.center.x + orb.localPosition.x,
		y: orbit.center.y + orb.localPosition.y,
	}

	if (obstacle.kind === 'angular' || obstacle.kind === 'angular_long') {
		return circleVsRotatedRect(
			center,
			orb.radius,
			obstacle.position,
			obstacle.width,
			obstacle.height,
			-obstacle.rotation,
		)
	}

	return circleVsRect(center, orb.radius, {
		left: obstacle.position.x - obstacle.width / 2,
		top: obstacle.position.y - obstacle.height / 2,
		right: obstacle.position.x + obstacle.width / 2,
		bottom: obstacle.position.y + obstacle.height / 2,
	})
}
