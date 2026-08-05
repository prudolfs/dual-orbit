import type Node from 'three/src/nodes/core/Node.js'
import { distance, Fn, pow, sub, uniform, uv, vec2 } from 'three/tsl'
import {
	AdditiveBlending,
	Color,
	DoubleSide,
	MeshBasicNodeMaterial,
} from 'three/webgpu'

/**
 * Energy materials for the orb "energy" layers (docs/visual-redesign.md
 * Step 2). Built on `MeshBasicNodeMaterial` (additive, no depth write) so
 * they stack over the holographic sphere and core without occluding gameplay.
 */

const uniformNumberType = uniform(0)
export type UniformNumber = typeof uniformNumberType

// --- Back-disc halo ---------------------------------------------------------
// A flat plane facing the camera (caller billboards it) with a soft radial
// falloff → a glow disc behind the orb.
//   strength = pow(1.0 - distance(uv, 0.5) * 2.0, 3.0) * uIntensity
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

	function buildAlpha(): Node<'float'> {
		const d = distance(uv(), vec2(0.5)).mul(2)
		const falloff = sub(1, d)
		return pow(falloff, 3).mul(uIntensity)
	}
	const alpha = Fn(buildAlpha)()

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
