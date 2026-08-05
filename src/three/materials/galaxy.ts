import { AdditiveBlending, FrontSide } from 'three'
import {
	atan,
	attribute,
	cos,
	distance,
	Fn,
	float,
	length,
	positionLocal,
	sin,
	uniform,
	vec2,
	vec3,
} from 'three/tsl'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { time } from '../shaders/shared'

/**
 * Galaxy twirl material — a billboarded-quad `MeshBasicNodeMaterial` driving
 * an `<instancedMesh>` of tiny camera-facing planes, one per "star".
 *
 * ## Why not raw `Points`?
 *
 * The previous galaxy used a `PointsNodeMaterial` on a `<points>` cloud.
 * `WebGPURenderer`'s WebGL-fallback backend hardcodes `gl_PointSize = 1.0`
 * at the tail of the generated vertex shader (`GLSLNodeBuilder
 * ._getGLSLVertexCode`), so `PointsNodeMaterial.sizeNode` is ignored and
 * every point renders at exactly 1 pixel. `count` had to be pushed to ~350k
 * and AdditiveBlending relied on to cluster 1px specks into a faint haze —
 * which read as flat, dim, white-noise-ish, with no visible per-star body and
 * no readable twirl at the production billboarded scale.
 *
 * A `<instancedMesh>` of small quads is the supported escape hatch
 * (documented in the `PointsNodeMaterial` doc itself): each "point" is now a
 * real textured quad with perspective-attenuated size, so fewer instances
 * (we still use 200k for a dense nebula) read as bright solid stars. The
 * twirl is computed PER-INSTANCE in the `positionNode`, in TSL, so the
 * per-vertex differential rotation (the signature `1/r` shear — inner arms
 * outrun outer arms) is honoured by the node builder and animates in
 * lockstep with the shared `time` uniform.
 *
 * ## The node work
 *
 * ### positionNode (object-space, before the instance `modelMatrix` transform)
 *
 * Each vertex of the shared quad template is a `planeGeometry(1,1)` corner in
 * `[-0.5, 0.5]²` of XY (Z=0). We:
 *
 *  1. Read the instance's per-instance skeleton position `aSkeleton`
 *     (object-space seed position on the branch ray — the clean spiral),
 *     its `aRandomness` fuzz offset, and `aScale` per-star size.
 *  2. Compute the disc-plane polar coords of the skeleton `(x, y)` and add
 *     the differential twirl `angle += (1/dist) * time` — exactly the
 *     reference's `angleOffset = (1.0 / distanceToCenter) * uTime`.
 *  3. Rebuild the world- & view-independent skeleton xy from the twirled
 *     angle and original radius, add `aRandomness`, and keep the quad's Z
 *     (thin disc thickness — same plane orientation as the reference).
 *  4. Scale the quad template corner by `pointSize * aScale` so the quad
 *     becomes the visible-size "star". A small extra `* (1.0 / -viewZ)`
 *     perspective falloff is applied through `aScale` already being baked at
 *     a chosen world size — instanced quads don't auto-attenuate by depth
 *     like `PointsMaterial` does, but the galaxy is billboarded at a near-
 *     constant camera distance anyway (locked `behind` the camera), so depth
 *     variance across the disc is tiny and the *world-space* point size is
 *     what we want (matches the reference's effective behaviour when the
 *     whole disc is roughly at one depth).
 *
 * Because the disc lies in the disc-local XY plane (Z is the disc normal)
 * and the whole `<instancedMesh>` root is billboarded to the camera (its +Z
 * always faces the view), the template quad in XY already faces the camera —
 * we do NOT need a per-instance camera-facing rotation in the shader.
 *
 * ### colorNode (fragment)
 *
 * `strength = pow(1 - distance(uv, 0.5), exp)` — the reference's 'Light
 * point' soft circular falloff. Multiplied by the per-instance `color`
 * (from the geometry's `color` instanced buffer attribute) so the additive
 * blend reads each star as a soft bright dot, fading smoothly to nothing at
 * the quad edges (no harsh square clipping).
 *
 * ## Flags
 *
 * `transparent` + `AdditiveBlending` + `depthWrite:false` — same additive
 * backdrop contract as the `Points` version. Sunken into the factory so the
 * production `<GalaxyBackground>` and the `?galaxydebug` tuning scene can be
 * kept identical by construction.
 */

export interface GalaxyMaterialOptions {
	/** Soft-point falloff exponent (reference value: 10). */
	readonly falloff?: number
	/** Per-instance size multiplier on the quad template (world units). */
	readonly pointSize?: number
	/** Twirl rate multiplier on the `1/r` angular shear (reference: 1). */
	readonly spin?: number
}

export function createGalaxyMaterial(
	opts: GalaxyMaterialOptions = {},
): MeshBasicNodeMaterial {
	const falloff = opts.falloff ?? 10
	const pointSize = opts.pointSize ?? 1.0
	if (opts.spin !== undefined) galaxySpin.value = opts.spin

	// Per-instance attributes — `attribute(name)` inside an instanced mesh's
	// node system auto-indexes `InstancedBufferAttribute`s by `instanceIndex`.
	const aSkeleton = attribute<'vec3'>('aSkeleton')
	const aRandomness = attribute<'vec3'>('aRandomness')
	const aScale = attribute<'float'>('aScale')
	const aColor = attribute<'vec3'>('color')

	// Per-vertex `uv` of the shared quad template (centred at (0.5, 0.5)).
	// `attribute('uv')` on a `MeshBasicNodeMaterial` resolves to the geometry's
	// uv attribute like any standard material.
	const uv = attribute<'vec2'>('uv')

	// Per-instance twirl. `time` is the shared TSL uniform advanced by
	// `<ShaderClock>`.
	function buildPositionNode() {
		// The quad corner in object space, XY in [-0.5, 0.5], Z = 0.
		const corner = vec3(positionLocal).toVar()

		// Skeleton disc-plane position (clean spiral before fuzz).
		const dist = length(aSkeleton.xy).max(0.01)
		const angle = atan(aSkeleton.y, aSkeleton.x).add(
			time.mul(galaxySpin).div(dist),
		)
		const twirled = vec3(
			cos(angle).mul(dist),
			sin(angle).mul(dist),
			aSkeleton.z,
		)

		// Add the fuzz halo and the visible-size quad offset (the quad
		// template is centred on the star's twirled position; the quad
		// corner offset * pointSize * aScale makes the "point" visible).
		const size = float(pointSize).mul(aScale)
		// Quad is in the disc-local XY plane (Z stays 0 — thin disc), so the
		// quad's Z offset is aSkeleton.z + aRandomness.z.
		return twirled.add(aRandomness).add(vec3(corner.xy.mul(size), 0))
	}
	const positionNode = Fn(buildPositionNode)()

	// Soft round point + per-instance color. AdditiveBlending: the RGB must
	// fade to 0 at the quad edges (alpha is irrelevant), so we mask the color
	// rather than the opacity.
	function buildColorNode() {
		const pd = distance(uv, vec2(0.5))
		const strength = float(1.0).sub(pd).pow(falloff)
		return aColor.mul(strength)
	}
	const colorNode = Fn(buildColorNode)()

	const mat = new MeshBasicNodeMaterial()
	mat.transparent = true
	mat.depthWrite = false
	mat.blending = AdditiveBlending
	mat.side = FrontSide // billboarded root means we only see front.
	mat.positionNode = positionNode
	mat.colorNode = colorNode
	return mat
}

/**
 * Live twirl-rate uniform shared by every `createGalaxyMaterial` instance.
 * Exposed so the `?galaxydebug` GUI can scrub it without rebuilding the
 * geometry/material; production leaves it at its construction-time default
 * (1). Mutating `.value` re-fires the node graph automatically (TSL
 * uniforms are reactive).
 */
export const galaxySpin = uniform(1)
