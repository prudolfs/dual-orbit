export type Vec2 = {
	readonly x: number
	readonly y: number
}

export function vec2(x: number, y: number): Vec2 {
	return { x, y }
}
