import type Node from 'three/src/nodes/core/Node.js'
import {
	cameraPosition,
	dot,
	faceDirection,
	fract,
	Fn,
	mod,
	normalize,
	normalLocal,
	positionLocal,
	positionWorld,
	sin,
	smoothstep,
	sub,
	uniform,
	vec2,
	vec3,
} from 'three/tsl'
import {
	AdditiveBlending,
	Color,
	DoubleSide,
	MeshBasicNodeMaterial,
} from 'three/webgpu'
import { time } from '../shaders/shared'

/**
 * Holographic energy material ported from the GLSL reference in
 * `quantum-digital/.../shaders/holographic/{vertex,fragment}.glsl`
 * (== `threejs-journey/33-hologram-shaderl`) into TSL.
 *
 * Algorithm preserved:
 *   - vertex glitch: nudge local position.x/z by (random2D - 0.5) * glitchFn,
 *     where glitchFn is the time-driven multi-sine smoothed to [0,1] * strength
 *   - fragment: vertical scrolling stripes (mod/pow) over the displaced
 *     world position's y
 *   - fresnel from cameraPosition vs world normal (flipped on back faces)
 *   - smoothstep falloff; final alpha = (stripes*fresnel + fresnel*1.25)*falloff
 *
 * Coordinate-space note (the bug we fixed here):
 *   `material.positionNode` is assigned back to `positionLocal` by
 *   `NodeMaterial.setupPosition` (see `three/src/materials/nodes/NodeMaterial.js`)
 *   and is then transformed into world space by `modelWorldMatrix`. So
 *   `positionNode` MUST be an **object-space** expression. Assigning a
 *   world-space expression (as we originally did with a `varying` of
 *   `positionWorld + offset`) caused the renderer to re-apply the model
 *   matrix on an already-world vector — the orb got double-transformed and
 *   visibly exploded away from its group's translation (the meshes appeared
 *   to wander off their cores). Now we displace in local space; the fragment
 *   reads the (correctly derived) `positionWorld`.
 *
 * Render flags match the reference:
 *   transparent, depthWrite:false, AdditiveBlending, DoubleSide.
 *
 * `time` is the shared global uniform (src/three/shaders/shared.ts) updated
 * once per frame by `<ShaderClock>`.
 *
 * See docs/visual-redesign.md Step 1.
 */

// random2D(value) -> fract(sin(dot(value, vec2(12.9898, 78.233))) * 43758.5453123)
// Pure expression — no shader stack needed, so a plain helper suffices.
const random2D = (value: Node<'vec2'>) =>
	fract(sin(dot(value, vec2(12.9898, 78.233))).mul(43758.5453123))

export type HolographicOptions = {
	readonly color: Color | string | number
	readonly glitchStrength?: number
}

// Sentinel used only to name the uniform node's type without importing
// `UniformNode` (not re-exported from three/tsl). `uniformGlitchType`'s type
// is `UniformNode<'float', number>`; `.value` is mutable for live tuning.
const uniformGlitchType = uniform(0)
type GlitchUniform = typeof uniformGlitchType

/**
 * Per-material glitch strength injected into the vertex displace Fn. `Fn`
 * closures capture node references, not JS values, so we rebuild this uniform
 * per factory call with the caller's value; the Fn references that specific
 * uniform node, whose `value` is mutable for live tuning (e.g. boost on
 * colliding obstacles).
 */
export type HolographicMaterial = MeshBasicNodeMaterial & {
	glitchStrength: GlitchUniform
}

export function createHolographicMaterial({
	color,
	glitchStrength = 0.25,
}: HolographicOptions): HolographicMaterial {
	const glitchUniform = uniform(glitchStrength)

	// Stage 1 — vertex displacement in OBJECT space. `positionNode` is
	// assigned to `positionLocal` by the renderer, so it must be expressed
	// relative to the mesh's own origin. The renderer then derives
	// `positionWorld` from this displaced local position via `modelWorldMatrix`
	// — which is exactly what the fragment stage reads below.
	const displacedLocal = Fn((): Node<'vec3'> => {
		const pos = positionLocal.toVar()

		// Time-driven multi-sine glitch factor smoothed to [0,1].
		// Use the local y as the per-vertex seed so equal-y rings jitter
		// together (matches the GLSL reference's per-vertex feel).
		const glitchTime = time.sub(pos.y)
		let glitch = sin(glitchTime)
			.add(sin(glitchTime.mul(3.45)))
			.add(sin(glitchTime.mul(8.76)))
		glitch = glitch.div(3)
		glitch = smoothstep(0.3, 1.0, glitch)
		glitch = glitch.mul(glitchUniform)

		const offsetX = random2D(pos.xz.add(vec2(time, 0))).sub(0.5).mul(glitch)
		const offsetZ = random2D(pos.zx.add(vec2(time, 0))).sub(0.5).mul(glitch)
		return vec3(pos.x.add(offsetX), pos.y, pos.z.add(offsetZ))
	})()

	// Stage 2 — fragment alpha. Reads the *displaced* `positionWorld` (which
	// the renderer derives from our `positionNode` assignment), `normalLocal`
	// (flipped on back faces via `faceDirection`), and `cameraPosition` for the
	// fresnel term. Using positionWorld here keeps stripes consistent across
	// orbs at the same world y, matching the GLSL reference's `vPosition`.
	const alpha = Fn((): Node<'float'> => {
		const pos = positionWorld.toVar()

		// normal flipped on back faces:
		//   normal = normalize(vNormal); if (!gl_FrontFacing) normal *= -1
		// faceDirection is +1 front / -1 back, so mul flips the sign correctly.
		const normal = normalize(normalLocal).mul(faceDirection)

		// Stripes: mod((pos.y - uTime*0.02) * 20, 1); pow(stripes, 3)
		const stripes = mod(sub(pos.y, time.mul(0.02)).mul(20), 1).pow(3)

		// Fresnel: viewDir = normalize(pos - cameraPosition); dot+1; pow2
		const viewDir = normalize(sub(pos, cameraPosition))
		const fresnel = dot(viewDir, normal).add(1).pow(2)

		// Falloff + holographic combine
		const falloff = smoothstep(0.8, 0.2, fresnel)
		let holographic = stripes.mul(fresnel)
		holographic = holographic.add(fresnel.mul(1.25))
		holographic = holographic.mul(falloff)

		return holographic
	})()

	const material = new MeshBasicNodeMaterial()
	material.color = new Color(color)
	material.transparent = true
	material.depthWrite = false
	material.blending = AdditiveBlending
	material.side = DoubleSide
	material.positionNode = displacedLocal
	material.opacityNode = alpha

	const mat = material as HolographicMaterial
	mat.glitchStrength = glitchUniform
	return mat
}
