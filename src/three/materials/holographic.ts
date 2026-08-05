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
 *     `falloff = smoothstep(0.8, 0.2, fresnel)` (0 face-on, 1 at the rim). This
 *     yields a crisp bright holographic *band* sweeping the silhouette that
 *     fades to nothing at face-on — the look from the reference demo. Add a
 *     `baseFill` term (view-independent scrolling scanlines) so flat box faces
 *     read as a holographic panel front-on instead of disappearing.
 *
 * Coordinate-space note (the bug we fixed earlier here):
 *   `material.positionNode` is assigned back to `positionLocal` by
 *   `NodeMaterial.setupPosition` and is then transformed into world space by
 *   `modelWorldMatrix`. So `positionNode` MUST be an **object-space**
 *   expression. We displace in local space; the fragment reads the (correctly
 *   derived) `positionWorld`.
 *
 * Render flags match the reference:
 *   transparent, depthWrite:false (default), AdditiveBlending, DoubleSide.
 */

// random2D(value) -> fract(sin(dot(value, vec2(12.9898, 78.233))) * 43758.5453123)
function random2D(value: Node<'vec2'>): Node<'float'> {
	return fract(sin(dot(value, vec2(12.9898, 78.233))).mul(43758.5453123))
}

export type HolographicOptions = {
	readonly color: Color | string | number
	readonly glitchStrength?: number
	/** Overall brightness multiplier on the final alpha. Orbs ~1.4, obstacles
	 * 1.0–2.0 (additive can't brighten a dim color, so colors themselves are
	 * already luminous; intensity scales the whole holographic field). */
	readonly intensity?: number
	/** Strength of the view-independent scanline body fill (0..N). The pure
	 * fresnel formula is transparent at face-on, so flat box faces facing the
	 * camera render as nothing but a thin rim. `baseFill` adds a scrolling
	 * scanline field across the whole body so a flat front reads as a
	 * holographic panel with moving scanlines. Spheres keep it 0 to stay
	 * shell-like with a glowing rim band. */
	readonly baseFill?: number
	/** Scanline frequency along world Y (higher = tighter stripes). */
	readonly stripeFrequency?: number
	/** Scanline scroll speed (world-y units per second). */
	readonly stripeSpeed?: number
	/** Optional brightness pulse applied on top of `intensity`:
	 *  effective = intensity * (pulseFloor + pulseAmp * sin(time*speed + phase)).
	 * Use to make a small holographic core (orb hotspot) beat. The orb
	 *  shell leaves this off (static intensity) and the core pulses. */
	readonly pulse?: {
		readonly speed?: number
		readonly phase?: number
		/** Sin floor (baseline brightness). Default 0.6. */
		readonly floor?: number
		/** Sin amplitude (0..1). Default 0.4 → 0.2..1.0 range. */
		readonly amp?: number
	}
	/** Write to the depth buffer so the mesh occludes additive peers. Default
	 * `false`. Set `true` for orb spheres so the orbit ring behind a sphere
	 * is depth-culled instead of bleeding through. With `depthWrite` on we also
	 * set `alphaTest` so fully-transparent holographic fragments are
	 * discarded (don't write depth). */
	readonly depthWrite?: boolean
}

const uniformGlitchType = uniform(0)
type GlitchUniform = typeof uniformGlitchType
const uniformIntensityType = uniform(0)
type IntensityUniform = typeof uniformIntensityType
const uniformBaseFillType = uniform(0)
type BaseFillUniform = typeof uniformBaseFillType

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
	stripeFrequency = 20,
	stripeSpeed = 0.05,
	depthWrite = false,
	pulse,
}: HolographicOptions): HolographicMaterial {
	const glitchUniform = uniform(glitchStrength)
	const intensityUniform = uniform(intensity)
	const baseFillUniform = uniform(baseFill)
	const pulseSpeed = uniform(pulse?.speed ?? 0)
	const pulsePhase = uniform(pulse?.phase ?? 0)
	const pulseFloor = uniform(pulse?.floor ?? 0.6)
	const pulseAmp = uniform(pulse?.amp ?? 0.4)
	const depthWriteFlag = depthWrite

	// --- Stage 1 — vertex glitch in OBJECT space --------------------------------
	function buildDisplacedLocal(): Node<'vec3'> {
		const pos = positionLocal.toVar()

		// Time-driven multi-sine glitch factor smoothed to [0,1]. Widened
		// from the reference's smoothstep(0.3, 1.0) so the displacement is
		// continuously modulated, not an intermittent tick.
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
	}
	const displacedLocal = Fn(buildDisplacedLocal)()

	// --- Stage 2 — fragment alpha -----------------------------------------------
	// Reference: `holographic = (stripes*fresnel + fresnel*1.25) * falloff`.
	// We add a view-independent `baseFill` scanline band so flat obstacle box
	// faces read as a holographic panel front-on (the pure fresnel formula is
	// 0 at face-on → boxes with a full face pointing at the camera vanish).
	function buildAlpha(): Node<'float'> {
		const pos = positionWorld.toVar()

		// normal flipped on back faces (== reference's
		//   `if(!gl_FrontFacing) normal *= -1`)
		const normal = normalize(normalLocal).mul(faceDirection)

		// Scanlines: stripePos ∈ [0,1), scrolling down with time. Cubed for
		// the rim-modulation (sharp bright lines), kept raw for the body fill
		// (a continuous field with moving bright bands).
		const stripePos = mod(
			sub(pos.y, time.mul(stripeSpeed)).mul(stripeFrequency),
			1,
		)
		const stripes = stripePos.pow(3)

		// Body fill — view-independent scrolling scanlines + a soft DC glow so
		// a flat panel reads front-on as a holographic field with moving
		// bright bands, not empty space. `baseFill=0` (orbs) opts out.
		const band = stripePos.mul(stripePos).mul(0.5) // ~0..0.5 bright band
		const bodyFill = band.add(0.15).mul(baseFillUniform)

		// Fresnel: viewDir = normalize(pos - cameraPosition); dot+1; pow2.
		// 0 at face-on, 1 at the silhouette.
		const viewDir = normalize(sub(pos, cameraPosition))
		const fresnel = dot(viewDir, normal).add(1).pow(2)

		// Falloff: 0 face-on, 1 at the rim (reverse smoothstep edges).
		const falloff = smoothstep(0.8, 0.2, fresnel)

		// Reference combine: stripes*fresnel + fresnel*1.25, masked by falloff.
		// The `fresnel*1.25` lights the rim even where stripes are dark.
		let holographic = stripes.mul(fresnel)
		holographic = holographic.add(fresnel.mul(1.25))
		holographic = holographic.mul(falloff)

		// Optional brightness pulse on top of the static `intensity`. When
		// `pulseSpeed` is 0 the pulse term collapses to `floor` (a no-op when
		// floor==1, which we don't reach here — so callers who want a static
		// intensity simply omit `pulse`).
		const pulseTerm = pulseFloor.add(
			pulseAmp.mul(sin(add(mul(time, pulseSpeed), pulsePhase))),
		)
		// Slight warm-cool tint shift of the rim toward the identity color on
		// the fresnel band so the silhouette rim reads in-hue (matches the
		// reference's uniform uColor, but lets body fill stay mid-bright).
		return bodyFill.add(holographic).mul(intensityUniform).mul(pulseTerm)
	}
	const alpha = Fn(buildAlpha)()

	const material = new MeshBasicNodeMaterial()
	material.color = new Color(color)
	material.transparent = true
	material.depthWrite = depthWriteFlag
	// When writing depth, discard near-empty fragments so the orb's dim center
	// doesn't write an invisible depth wall that masks the ring behind.
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
