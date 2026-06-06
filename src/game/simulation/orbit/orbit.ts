import {
	DEFAULT_RESOLUTION,
	ORB_ANGULAR_SPEED,
	ORB_DIAMETER,
	ORBIT_DIAMETER,
	ORBIT_VERTICAL_SPEED_FACTOR,
	ORIGINAL_AREA,
	ORIGINAL_SCALE,
	REWIND_RESET_SPEED,
	REWIND_SPEED,
	ROLLBACK_SPEED,
} from '../../constants'
import { normalizeAngle } from '../../math'
import type {
	DirectionState,
	OrbitState,
	OrbState,
	SimulationInput,
	Vec2,
} from '../../types'
import { directionToInput, inputToDirection } from '../../types'

export type CreateOrbitOptions = {
	readonly resolution?: keyof typeof ORIGINAL_SCALE
	readonly center?: Vec2
}

export function createOrbitState(options: CreateOrbitOptions = {}): OrbitState {
	const resolution = options.resolution ?? DEFAULT_RESOLUTION
	const scale = ORIGINAL_SCALE[resolution]
	const area = ORIGINAL_AREA[resolution]
	const radius = Math.round((ORBIT_DIAMETER * scale) / 2)
	const orbRadius = Math.round((ORB_DIAMETER * scale) / 2)
	const verticalSpeed = Math.floor(ORBIT_VERTICAL_SPEED_FACTOR * radius)
	const center =
		options.center ??
		({ x: area.centerX, y: area.height - radius - orbRadius } satisfies Vec2)

	return {
		center,
		start: center,
		radius,
		verticalSpeed,
		angularSpeed: ORB_ANGULAR_SPEED,
		rollbackTicks: 0,
		rollbackSpeed: ROLLBACK_SPEED,
		rewindTicks: 0,
		rewindSpeed: REWIND_SPEED,
		rewindResetSpeed: REWIND_RESET_SPEED,
		rewindTargetY: center.y,
		stabilizeDirection: 0,
		orbs: [
			createOrbState('left', Math.PI, radius, orbRadius),
			createOrbState('right', 0, radius, orbRadius),
		],
	}
}

export function createOrbState(
	side: OrbState['side'],
	angle: number,
	orbitRadius: number,
	radius: number,
): OrbState {
	return {
		side,
		angle,
		localPosition: positionOnOrbit(angle, orbitRadius),
		radius,
		colliding: false,
	}
}

export function positionOnOrbit(angle: number, radius: number): Vec2 {
	return {
		x: Math.cos(angle) * radius,
		y: Math.sin(angle) * radius,
	}
}

export function rotateOrb(
	orb: OrbState,
	deltaAngle: number,
	orbitRadius: number,
): OrbState {
	const angle = orb.angle + deltaAngle

	return {
		...orb,
		angle,
		localPosition: positionOnOrbit(angle, orbitRadius),
	}
}

export function updateOrbit(
	orbit: OrbitState,
	input: SimulationInput,
	scale = 1,
): OrbitState {
	return updateOrbitByDirection(orbit, inputToDirection(input), scale)
}

export function updateOrbitByDirection(
	orbit: OrbitState,
	direction: DirectionState,
	scale = 1,
): OrbitState {
	if (direction === 0) {
		return orbit
	}

	const deltaAngle = orbit.angularSpeed * direction * scale

	return {
		...orbit,
		orbs: [
			rotateOrb(orbit.orbs[0], deltaAngle, orbit.radius),
			rotateOrb(orbit.orbs[1], deltaAngle, orbit.radius),
		],
	}
}

export function updateOrbitLeft(orbit: OrbitState, scale = 1): OrbitState {
	return updateOrbitByDirection(orbit, -1, scale)
}

export function updateOrbitRight(orbit: OrbitState, scale = 1): OrbitState {
	return updateOrbitByDirection(orbit, 1, scale)
}

export function getOrbWorldPosition(
	orbit: OrbitState,
	side: OrbState['side'],
): Vec2 {
	const orb = orbit.orbs.find((candidate) => candidate.side === side)

	if (!orb) {
		return orbit.center
	}

	return {
		x: orbit.center.x + orb.localPosition.x,
		y: orbit.center.y + orb.localPosition.y,
	}
}

export type OrbitRhythmSample = {
	readonly tick: number
	readonly leftAngle: number
	readonly rightAngle: number
	readonly leftPosition: Vec2
	readonly rightPosition: Vec2
}

export function sampleOrbitRhythm(
	ticks: number,
	direction: DirectionState,
	initialOrbit: OrbitState = createOrbitState(),
): readonly OrbitRhythmSample[] {
	const input = directionToInput(direction)
	const samples: OrbitRhythmSample[] = []
	let orbit = initialOrbit

	for (let tick = 1; tick <= ticks; tick++) {
		orbit = updateOrbit(orbit, input)
		samples.push({
			tick,
			leftAngle: orbit.orbs[0].angle,
			rightAngle: orbit.orbs[1].angle,
			leftPosition: getOrbWorldPosition(orbit, 'left'),
			rightPosition: getOrbWorldPosition(orbit, 'right'),
		})
	}

	return samples
}

export function moveOrbitVertically(
	orbit: OrbitState,
	direction: 1 | -1,
): OrbitState {
	const y = orbit.center.y - orbit.verticalSpeed * direction

	return {
		...orbit,
		center: { ...orbit.center, y },
	}
}

export function setOrbitRollbackTicks(
	orbit: OrbitState,
	rollbackTicks: number,
): OrbitState {
	return {
		...orbit,
		rollbackTicks,
	}
}

export function isOrbitStable(orbit: OrbitState): boolean {
	const theta = normalizeAngle(orbit.orbs[0].angle)
	const threshold = orbit.angularSpeed / 2

	return (
		(theta > Math.PI - threshold && theta < Math.PI + threshold) ||
		theta < threshold ||
		theta > Math.PI * 2 - threshold
	)
}

export function getStabilizeDirection(orbit: OrbitState): DirectionState {
	const theta = normalizeAngle(orbit.orbs[0].angle)

	if (theta >= 0 && theta < Math.PI / 2) {
		return -1
	}

	if (theta >= Math.PI / 2 && theta < Math.PI) {
		return 1
	}

	if (theta >= Math.PI && theta < Math.PI * 1.5) {
		return -1
	}

	return 1
}
