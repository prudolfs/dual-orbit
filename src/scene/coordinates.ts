import { ORIGINAL_AREA } from '../game/constants'
import type { GeneratorState, Vec2 } from '../game/types'

export const WORLD_SCALE = 80

export function toWorldPosition(
	position: Vec2,
	resolution: GeneratorState['resolution'],
	z = 0,
): [number, number, number] {
	const area = ORIGINAL_AREA[resolution]

	return [
		(position.x - area.centerX) / WORLD_SCALE,
		-position.y / WORLD_SCALE,
		z,
	]
}

export function toWorldSize(value: number): number {
	return value / WORLD_SCALE
}
