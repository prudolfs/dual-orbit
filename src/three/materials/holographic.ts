import type Node from 'three/src/nodes/core/Node.js'
import {
	cameraPosition,
	dot,
	Fn,
	faceDirection,
	fract,
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
 * Algorithm (the GLSL reference, ported 1:1):
 *   - vertex glitch: nudge local position.x/z by (random2D - 0.5) * glitchFn,
 *     where glitchFn is the time-driven multi-sine smoothed to [0,1] * strength
 *   - fragment: `alpha = (stripes*fresnel + fresnel*1.25) * falloff`, where
 *     `falloff = smoothstep(0.8, 0.2, fresnel)` (1 face-on, 0 at the rim). This
 *     yields a bright holographic *field* across the body that fades softly at
 *     the silhouette — the look from the example. Scaled by an `intensity`
 *     uniform so orbs/obstacles can be tuned independently.
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
	/** Overall brightness multiplier. Scales both the body scanline fill and
	 * the fresnel rim band. Keep obstacles ~0.7, orbs ~1.4. */
	readonly intensity?: number
	/** Strength of the view-independent scanline body fill (0-1). The
	 * reference fresnel-only formula is **transparent at face-on**
	 * (fresnel=0 → alpha=0), so flat surfaces perpendicular to the camera —
	 * i.e. obstacle box faces — render as nothing but a thin rim. A
	 * `baseFill` term adds a scrolling-stripe field across the whole body so
	 * the holographic panel reads front-on; orbs keep it low/zero so they
	 * stay shell-like energy spheres with a glowing rim band. Obstacles use
	 * ~0.15. */
	readonly baseFill?: number
	/** Write to the depth buffer so the mesh occludes additive peers. Default
	 * `false` (reference behavior — additive shells don't sort). Set `true`
	 * for the orb spheres so the orbit torus *behind* a sphere gets
	 * depth-culled instead of bleeding through. Obstacles stay `false` so orbs
	 * + ring draw over them. When `depthWrite` is on we also set `alphaTest`
	 * so fully-transparent holographic fragments are **discarded** (don't
	 * write depth) — otherwise the orb's dim center would shield the ring
	 * behind it through an invisible depth wall. */

	readonly depthWrite?: boolean
}

// Sentinel used only to name the uniform node's type without importing
// `UniformNode` (not re-exported from three/tsl). `uniformGlitchType`'s type
// is `UniformNode<'float', number>`; `.value` is mutable for live tuning.
const uniformGlitchType = uniform(0)
type GlitchUniform = typeof uniformGlitchType
const uniformIntensityType = uniform(0)
type IntensityUniform = typeof uniformIntensityType
const uniformBaseFillType = uniform(0)
type BaseFillUniform = typeof uniformBaseFillType

/**
 * Per-material glitch strength injected into the vertex displace Fn. `Fn`
 * closures capture node references, not JS values, so we rebuild this uniform
 * per factory call with the caller's value; the Fn references that specific
 * uniform node, whose `value` is mutable for live tuning (e.g. boost on
 * colliding obstacles).
 */
export type HolographicMaterial = MeshBasicNodeMaterial & {
	glitchStrength: GlitchUniform
	intensity: IntensityUniform
	baseFill: BaseFillUniform
}

export function createHolographicMaterial({
	color,
	glitchStrength = 0.25,
	intensity = 1.0,
	baseFill = 0,
	depthWrite = false,
}: HolographicOptions): HolographicMaterial {
	const glitchUniform = uniform(glitchStrength)
	const intensityUniform = uniform(intensity)
	const baseFillUniform = uniform(baseFill)
	const depthWriteFlag = depthWrite

	// Stage 1 — vertex displacement in OBJECT space. `positionNode` is
	// assigned to `positionLocal` by the renderer, so it must be expressed
	// relative to the mesh's own origin. The renderer then derives
	// `positionWorld` from this displaced local position via `modelWorldMatrix`
	// — which is exactly what the fragment stage reads below.
	const displacedLocal = Fn((): Node<'vec3'> => {
		const pos = positionLocal.toVar()

		// Time-driven multi-sine glitch factor smoothed to [0,1].
		// The reference uses `smoothstep(0.3, 1.0, glitch)` which only fires
		// when the sum-of-3-sines exceeds 0.3 — a brief intermittent burst.
		// That reads as "nothing most of the time" on small meshes, so we
		// widen the range to `(-0.5, 0.8)` so the displacement is continuously
		// modulated (always > 0 but varying with the sines) — the surface
		// shimmers steadily rather than ticking. Use the local y as the
		// per-vertex seed so equal-y rings jitter together (matches the GLSL
		// reference's per-vertex feel).
		const glitchTime = time.sub(pos.y)
		let glitch = sin(glitchTime)
			.add(sin(glitchTime.mul(3.45)))
			.add(sin(glitchTime.mul(8.76)))
		glitch = glitch.div(3)
		glitch = smoothstep(-0.5, 0.8, glitch)
		glitch = glitch.mul(glitchUniform)

		const offsetX = random2D(pos.xz.add(vec2(time, 0)))
			.sub(0.5)
			.mul(glitch)
		const offsetZ = random2D(pos.zx.add(vec2(time, 0)))
			.sub(0.5)
			.mul(glitch)
		return vec3(pos.x.add(offsetX), pos.y, pos.z.add(offsetZ))
	})()

	// Stage 2 — fragment alpha. The GLSL reference formula
	// `holographic = (stripes*fresnel + fresnel*1.25) * falloff` is **0 at
	// face-on** (fresnel=0 → alpha=0), so a surface pointing straight at the
	// camera renders as nothing. That's fine for **spheres** (the surface
	// curves smoothly so fresnel sweeps 0→1 across the disc and a glowing
	// mid-radius band appears). It's **deadly for flat box faces** whose
	// entire front is normal+z — those faces are uniformly face-on, so their
	// front face renders as nothing but a thin rim and obstacle boxes become
	// nearly invisible.
	//
	// So we add a view-independent **scanline body fill** — a 0..1 stripe
	// pattern (mod of world y, scrolling with `time`) multiplied by
	// `baseFillUniform`. Flat panels front-on now read as a scrolling
	// holographic field instead of being deleted by the fresnel. Orbs pass
	// `baseFill = 0` so they keep the pure rim-band shell look.
	//
	// Fresnel falloff and combine: see in-line. Total alpha =
	//   (bodyFill + (stripes*fresnel + fresnel*1.25) * falloff) * intensity
	const alpha = Fn((): Node<'float'> => {
		const pos = positionWorld.toVar()

		// normal flipped on back faces:
		//   normal = normalize(vNormal); if (!gl_FrontFacing) normal *= -1
		// faceDirection is +1 front / -1 back, so mul flips the sign correctly.
		const normal = normalize(normalLocal).mul(faceDirection)

		// Raw stripe position (before pow): used both for the rim-stripes and
		// the body fill. Cubed for rim-modulation (the reference), kept raw for
		// the body so the panel reads as bright lines instead of speckle.
		const stripePos = mod(sub(pos.y, time.mul(0.05)).mul(20), 1)
		const stripes = stripePos.pow(3)

		// Body fill — view-independent scrolling scanline band.
		// Average stripe contribution is ~0.5, so add an `0.5 * baseFill`
		// DC offset before modulating — gives the whole panel a soft constant
		// glow (holographic field) under the moving scanlines. `baseFill=0`
		// (orbs) opts out completely.
		const stripeContribution = stripePos.mul(stripePos).mul(0.5).sub(0.125)
		const bodyFill = stripeContribution.add(0.5).mul(baseFillUniform)

		// Fresnel: viewDir = normalize(pos - cameraPosition); dot+1; pow2
		const viewDir = normalize(sub(pos, cameraPosition))
		const fresnel = dot(viewDir, normal).add(1).pow(2)

		// Falloff: 1 at face-on (low fresnel), 0 at the silhouette (high
		// fresnel). smoothstep's edge args are intentionally reversed.
		const falloff = smoothstep(0.8, 0.2, fresnel)

		// Holographic combine (reference): stripes * fresnel + fresnel * 1.25,
		// then masked by falloff. The `fresnel * 1.25` term is what lights the
		// rim even where stripes are dark — keep it.
		let holographic = stripes.mul(fresnel)
		holographic = holographic.add(fresnel.mul(1.25))
		holographic = holographic.mul(falloff)

		return bodyFill.add(holographic).mul(intensityUniform)
	})()

	const material = new MeshBasicNodeMaterial()
	material.color = new Color(color)
	material.transparent = true
	material.depthWrite = depthWriteFlag
	// When writing depth, discard near-empty fragments so the orb's dim
	// center doesn't write an invisible depth wall that masks the ring behind.
	// 0.06 is just above the face-on center (~0) and underneath the bright
	// fresnel band, so only truly empty pixels are culled.
	if (depthWriteFlag) {
		material.alphaTest = 0.06
	}
	material.blending = AdditiveBlending
	material.side = DoubleSide
	material.positionNode = displacedLocal
	material.opacityNode = alpha

	const mat = material as HolographicMaterial
	mat.glitchStrength = glitchUniform
	mat.intensity = intensityUniform
	mat.baseFill = baseFillUniform
	return mat
}
