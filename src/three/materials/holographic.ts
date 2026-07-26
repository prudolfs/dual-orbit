import type Node from 'three/src/nodes/core/Node.js'
import {
	add,
	cameraPosition,
	dot,
	Fn,
	faceDirection,
	fract,
	mod,
	mul,
	normalize,
	normalLocal,
	positionWorld,
	sin,
	smoothstep,
	sub,
	uniform,
	varying,
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
 * Algorithm preserved 1:1:
 *   - vertex glitch: nudge position.x/z by (random2D - 0.5) * glitchFn,
 *     where glitchFn is the time-driven multi-sine smoothed to [0,1] * strength
 *   - fragment: vertical scrolling stripes (mod/pow) over the displaced
 *     world position's y
 *   - fresnel from cameraPosition vs world normal (flipped on back faces)
 *   - smoothstep falloff; final alpha = (stripes*fresnel + fresnel*1.25)*falloff
 *
 * TSL mapping:
 *   - Vertex displacement is computed in `displaceFn`, which is set as the
 *     material's `positionNode` (runs at the vertex stage). The displaced
 *     position is forwarded to the fragment stage via `varying(vPosition)`.
 *   - Fragment alpha computed in `alphaFn`, which reads `vPosition` — matching
 *     the GLSL reference's `vPosition` varying (post-glitch modelPosition.xyz).
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

// Computes the V-quarters multi-sine glitch factor and the x/z offsets that
// displace the vertex. Pure (does not mutate inputs). Returns vec2(x, z).
const glitchOffset = Fn(
	([pos, strength]: [Node<'vec3'>, Node<'float'>]): Node<'vec2'> => {
		const glitchTime = sub(time, pos.y)
		let glitch = add(
			add(sin(glitchTime), sin(mul(glitchTime, 3.45))),
			sin(mul(glitchTime, 8.76)),
		)
		glitch = glitch.div(3)
		glitch = smoothstep(0.3, 1.0, glitch)
		glitch = glitch.mul(strength)

		const offsetX = sub(random2D(add(pos.xz, time)), 0.5).mul(glitch)
		const offsetZ = sub(random2D(add(pos.zx, time)), 0.5).mul(glitch)
		return vec2(offsetX, offsetZ)
	},
)

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
 * Per-material glitch strength injected into both the vertex displace Fn and
 * the fragment alpha Fn. `Fn` closures capture node references, not JS values,
 * so we rebuild this uniform per factory call with the caller's value; both
 * Fns reference that specific uniform node, whose `value` is mutable for live
 * tuning (e.g. boost on colliding obstacles).
 */
export type HolographicMaterial = MeshBasicNodeMaterial & {
	glitchStrength: GlitchUniform
}

export function createHolographicMaterial({
	color,
	glitchStrength = 0.25,
}: HolographicOptions): HolographicMaterial {
	const glitchUniform = uniform(glitchStrength)

	// Stage 1 — vertex displacement. `positionNode` runs at the vertex stage.
	// We compute the world-space glitch offsets on `positionWorld` and add them
	// to x/z, producing the final vertex position. We forward the displaced
	// position to the fragment stage via `varying(vPosition)` so the alpha Fn
	// reads the post-glitch coordinate (matching the GLSL reference's
	// `vPosition = modelPosition.xyz`).
	const vPosition = varying(
		Fn((): Node<'vec3'> => {
			const pos = positionWorld.toVar()
			const offset = glitchOffset(pos, glitchUniform)
			return vec3(pos.x.add(offset.x), pos.y, pos.z.add(offset.y))
		})(),
		'vPosition',
	)

	// Stage 2 — fragment alpha. Reads `vPosition`, `normalLocal` (flipped on
	// back faces via `faceDirection`), and `cameraPosition` for the fresnel
	// term.
	const alpha = Fn((): Node<'float'> => {
		const pos = vPosition.toVar()

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
	material.positionNode = vPosition
	material.opacityNode = alpha

	const mat = material as HolographicMaterial
	mat.glitchStrength = glitchUniform
	return mat
}
