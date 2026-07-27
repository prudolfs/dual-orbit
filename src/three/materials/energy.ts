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
// A thin **torus** tracing the orbs' rotation path. We switched from a flat
// `ringGeometry` to a torus so the orbit reads as a real 3D track the orbs
// ride (the orbs straddle the tube), instead of a flat disc drawn on top.
// It writes depth (`depthWrite:true`) and the orb spheres also write depth, so
// the orbs occlude the back half of the tube and the front half of the tube
// occludes the back of the orbs — true 3D "orb sitting on the ring".
// It glows: a steady additive base plus a soft pulse along `time` so the
// ring feels alive without strobing. `intensity` is a uniform for live tuning.
export type OrbitRingMaterial = MeshBasicNodeMaterial & {
	intensity: UniformNumber
}

export function createOrbitRingMaterial({
	color = '#dce6ff',
	intensity = 1.0,
}: {
	color?: Color | string | number
	intensity?: number
} = {}): OrbitRingMaterial {
	const uIntensity = uniform(intensity)

	// Steady base glow + a gentle 25% pulse. Keeps the ring visible at all
	// times (it's the gameplay-readability anchor) while feeling energetic.
	const alpha = Fn((): Node<'float'> => {
		const base = float(0.85)
		const pulse = sin(time.mul(2.0)).mul(0.5).add(0.5).mul(0.25)
		return base.add(pulse).mul(uIntensity)
	})()

	const material = new MeshBasicNodeMaterial()
	material.color = new Color(color)
	material.transparent = true
	// Write + test depth so the torus is a real 3D tube: the orbs (which also
	// write depth) straddle it and occlude the half of the tube behind them,
	// while the front half of the tube occludes the back of the orbs. Without
	// depthWrite the flat-on-paper ring just drew *over* every orb.
	material.depthWrite = true
	material.depthTest = true
	material.blending = AdditiveBlending
	material.side = DoubleSide
	material.opacityNode = alpha

	const mat = material as OrbitRingMaterial
	mat.intensity = uIntensity
	return mat
}
