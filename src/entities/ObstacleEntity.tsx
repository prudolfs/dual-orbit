import type { GeneratorState, ObstacleState } from '../game/types'
import { toWorldPosition, toWorldSize } from '../scene/coordinates'

type ObstacleEntityProps = {
	readonly obstacle: ObstacleState
	readonly resolution: GeneratorState['resolution']
}

export function ObstacleEntity({ obstacle, resolution }: ObstacleEntityProps) {
	if (!obstacle.exists || !obstacle.alive) {
		return null
	}

	const position = toWorldPosition(obstacle.position, resolution, 0)
	const width = toWorldSize(obstacle.width)
	const height = toWorldSize(obstacle.height)
	const depth = obstacle.kind === 'angular_long' ? 0.28 : 0.38
	const color = getObstacleColor(obstacle)

	return (
		<mesh position={position} rotation={[0, 0, -obstacle.rotation]}>
			<boxGeometry args={[width, height, depth]} />
			<meshStandardMaterial color={color} roughness={0.55} />
		</mesh>
	)
}

function getObstacleColor(obstacle: ObstacleState): string {
	if (obstacle.collidingOrbSides.length > 0) {
		return '#f5c84b'
	}

	switch (obstacle.kind) {
		case 'moving':
			return '#7f5ab6'
		case 'angular':
			return '#394c79'
		case 'angular_long':
			return '#c46d3a'
		case 'static':
			return '#242935'
	}
}
