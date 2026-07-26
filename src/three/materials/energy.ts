import type Node from 'three/src/nodes/core/Node.js'
import {
	add,
	distance,
	Fn,
	float,
	mul,
	pow,
	sin,
	sub,
	uniform,
	uv,
	vec2,
} from 'three/tsl'
import {
	AdditiveBlending,
	Color,
	DoubleSide,
	MeshBasicNodeMaterial,
} from 'three/webgpu'
import { time } from '../shaders/shared'

/**
 * Energy materials for the orb "energy" layers (see docs/visual-redesign.md
 * Step 2). Built on `MeshBasicNodeMaterial` (additive, no depth write) so they
 * stack over the holographic sphere and core without occluding gameplay.
 *
 * All animate from the shared global `time` uniform (src/three/shaders/shared).
 */

// `uniform()` has no type arg in three/tsl (the generic is keyed to an internal
// `UniformValue` map); derive the actual return type via a sentinel instead.
const uniformNumberType = uniform(0)
export type UniformNumber = typeof uniformNumberType

// --- Pulsing core -----------------------------------------------------------
// A smaller bright additive sphere at the orb center whose opacity pulses:
//   intensity = 0.6 + 0.4 * sin(time * speed + phase)
// `speed`/`phase` are per-instance uniforms so the two orbs can beat out of
// sync and the pulse visually alive.
export type PulsingCoreMaterial = MeshBasicNodeMaterial & {
	speed: UniformNumber
	phase: UniformNumber
}

export function createPulsingCoreMaterial({
	color,
	speed = 2.5,
	phase = 0,
}: {
	color: Color | string | number
	speed?: number
	phase?: number
}): PulsingCoreMaterial {
	const uSpeed = uniform(speed)
	const uPhase = uniform(phase)

	const alpha = Fn((): Node<'float'> => {
		// intensity = 0.6 + 0.4 * sin(time * speed + phase)
		return add(0.6, mul(0.4, sin(add(mul(time, uSpeed), uPhase))))
	})()

	const material = new MeshBasicNodeMaterial()
	material.color = new Color(color)
	material.transparent = true
	material.depthWrite = false
	material.blending = AdditiveBlending
	material.side = DoubleSide
	material.opacityNode = float(alpha)

	const mat = material as PulsingCoreMaterial
	mat.speed = uSpeed
	mat.phase = uPhase
	return mat
}

// --- Back-disc halo ---------------------------------------------------------
// A flat plane facing the camera (caller billboards it) with a soft radial
// falloff so it reads as a glow disc behind the orb.
//   strength = pow(1.0 - distance(uv, 0.5) * 2.0, 4.0)
// `uIntensity` lets callers dim the disc (lower than the orbs) or fade it.
export type BackDiscMaterial = MeshBasicNodeMaterial & {
	intensity: UniformNumber
}

export function createBackDiscMaterial({
	color,
	intensity = 0.5,
}: {
	color: Color | string | number
	intensity?: number
}): BackDiscMaterial {
	const uIntensity = uniform(intensity)

	const alpha = Fn((): Node<'float'> => {
		// distance from disk center in [0..~0.707]; *2 -> [0..~1.414]; clamp via pow
		const d = distance(uv(), vec2(0.5)).mul(2)
		const falloff = sub(1, d)
		return pow(falloff, 4).mul(uIntensity)
	})()

	const material = new MeshBasicNodeMaterial()
	material.color = new Color(color)
	material.transparent = true
	material.depthWrite = false
	material.blending = AdditiveBlending
	material.side = DoubleSide
	material.opacityNode = alpha

	const mat = material as BackDiscMaterial
	mat.intensity = uIntensity
	return mat
}

// --- Orbit-path ring --------------------------------------------------------
// A thin `ringGeometry` traced along the orbs' rotation path, bright so the
// orbit reads against the dim galaxy. Pure additive constant (no animation).
export function createOrbitRingMaterial(
	color: Color | string | number = '#dce6ff',
): MeshBasicNodeMaterial {
	const material = new MeshBasicNodeMaterial()
	material.color = new Color(color)
	material.transparent = true
	material.depthWrite = false
	material.blending = AdditiveBlending
	material.side = DoubleSide
	// ringGeometry is a flat strip in XY; we keep it opaque (modulated by ring
	// geometry's own radial alpha — none here, so flat constant alpha 1). The
	// geometry's thinness gives the "line" look.
	material.opacityNode = float(1.0)
	return material
}
