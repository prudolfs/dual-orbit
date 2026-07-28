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
 * Energy materials for the orb "energy" layers (docs/visual-redesign.md
 * Step 2). Built on `MeshBasicNodeMaterial` (additive, no depth write) so
 * they stack over the holographic sphere and core without occluding gameplay.
 *
 * All animate from the shared global `time` uniform (src/three/shaders/shared).
 */

const uniformNumberType = uniform(0)
export type UniformNumber = typeof uniformNumberType

// --- Pulsing core -----------------------------------------------------------
// A bright additive sphere at the orb center whose opacity pulses:
//   intensity = 0.5 + 0.5 * sin(time * speed + phase)   ∈ [0, 1]
// `speed`/`phase` are per-instance uniforms so the two orbs beat out of sync.
// Bright enough (lerp toward white ~0.75 by the caller's `color` choice) to
// read as the bright hotspot of the energy orb on top of the fresnel shell.
export type PulsingCoreMaterial = MeshBasicNodeMaterial & {
	speed: UniformNumber
	phase: UniformNumber
}

export function createPulsingCoreMaterial({
	color,
	speed = 2.0,
	phase = 0,
}: {
	color: Color | string | number
	speed?: number
	phase?: number
}): PulsingCoreMaterial {
	const uSpeed = uniform(speed)
	const uPhase = uniform(phase)

	const alpha = Fn((): Node<'float'> => {
		// 0.5 + 0.5 * sin → [0, 1]; baseline floor so the core never fully
		// vanishes between pulses (keeps the orb identity alive).
		return add(0.5, mul(0.5, sin(add(mul(time, uSpeed), uPhase))))
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
// falloff → a glow disc behind the orb.
//   strength = pow(1.0 - distance(uv, 0.5) * 2.0, 4.0) * uIntensity
export type BackDiscMaterial = MeshBasicNodeMaterial & {
	intensity: UniformNumber
}

export function createBackDiscMaterial({
	color,
	intensity = 0.7,
}: {
	color: Color | string | number
	intensity?: number
}): BackDiscMaterial {
	const uIntensity = uniform(intensity)

	const alpha = Fn((): Node<'float'> => {
		const d = distance(uv(), vec2(0.5)).mul(2)
		const falloff = sub(1, d)
		return pow(falloff, 3).mul(uIntensity)
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
// A thin glowing ring tracing the orbs' rotation path. Rendered as a flat
// `ringGeometry` disc (a thin annulus) in the orbs' XY play plane:
//  - additive, `depthWrite:false` and `depthTest:false` → it never occludes
//    orbs and never z-fights at the orb/ring intersection (the previous torus
//    with depthWrite:true flickered as it traded depth against the orb
//    spheres, and could render *over* an orb depending on draw order).
//    With depthTest off the ring is a fixed translucent overlay glowing
//    through the orbs.
//  - a gentle pulse along `time` so it feels alive without strobing.
// `intensity` is a uniform for live tuning. Tuned to read as a crisp bright
// accent but sit just under the orb-core brightness (the orbs are the
// brightest gameplay object; the ring is the readability anchor).
export type OrbitRingMaterial = MeshBasicNodeMaterial & {
	intensity: UniformNumber
}

export function createOrbitRingMaterial({
	color = '#dce6ff',
	intensity = 0.9,
}: {
	color?: Color | string | number
	intensity?: number
} = {}): OrbitRingMaterial {
	const uIntensity = uniform(intensity)

	// Steady base glow + a gentle 20% pulse.
	const alpha = Fn((): Node<'float'> => {
		const base = float(0.85)
		const pulse = sin(time.mul(2.0)).mul(0.5).add(0.5).mul(0.2)
		return base.add(pulse).mul(uIntensity)
	})()

	const material = new MeshBasicNodeMaterial()
	material.color = new Color(color)
	material.transparent = true
	// No depth interaction: the ring is a pure additive overlay so it neither
	// occludes the orbs nor fights them at the intersection line.
	material.depthWrite = false
	material.depthTest = false
	material.blending = AdditiveBlending
	material.side = DoubleSide
	material.opacityNode = alpha

	const mat = material as OrbitRingMaterial
	mat.intensity = uIntensity
	return mat
}
