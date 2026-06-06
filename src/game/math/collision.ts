import type { Vec2 } from '../types'
import { clamp } from './scalar'

export type RectBounds = {
	readonly left: number
	readonly top: number
	readonly right: number
	readonly bottom: number
}

export function circleVsRect(
	center: Vec2,
	radius: number,
	rect: RectBounds,
): boolean {
	const cx = clamp(center.x, rect.left, rect.right)
	const cy = clamp(center.y, rect.top, rect.bottom)
	const dx = center.x - cx
	const dy = center.y - cy

	return dx * dx + dy * dy < radius * radius
}

export function circleVsRotatedRect(
	center: Vec2,
	radius: number,
	rectCenter: Vec2,
	width: number,
	height: number,
	angle: number,
): boolean {
	const dx = center.x - rectCenter.x
	const dy = center.y - rectCenter.y
	const cosAngle = Math.cos(angle)
	const sinAngle = Math.sin(angle)
	const rotatedCenter = {
		x: cosAngle * dx - sinAngle * dy + rectCenter.x,
		y: sinAngle * dx + cosAngle * dy + rectCenter.y,
	}
	const halfWidth = width / 2
	const halfHeight = height / 2

	return circleVsRect(rotatedCenter, radius, {
		left: rectCenter.x - halfWidth,
		top: rectCenter.y - halfHeight,
		right: rectCenter.x + halfWidth,
		bottom: rectCenter.y + halfHeight,
	})
}
