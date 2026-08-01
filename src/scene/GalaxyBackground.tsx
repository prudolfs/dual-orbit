import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import {
	AdditiveBlending,
	BufferAttribute,
	BufferGeometry,
	Color,
	type Points,
	Quaternion,
	Vector3,
} from 'three'
import type Node from 'three/src/nodes/core/Node.js'
import {
	atan,
	attribute,
	cos,
	distance,
	Fn,
	float,
	length,
	pointUV,
	positionLocal,
	sin,
	vec2,
	vec3,
} from 'three/tsl'
import { PointsNodeMaterial } from 'three/webgpu'
import { time } from '../three/shaders/shared'

/**
 * Animated galaxy point-cloud background (docs/visual-redesign.md Step 4/7).
 *
 * 1:1 port of `threejs-journey/30-animated-galaxy/`'s signature **twirl**:
 * a per-vertex **differential** rotation — every point revolves around the
 * galaxy center at angular speed `1 / distanceToCenter * time`, so inner
 * arms outrun outer arms → the spiral arms visibly wind/unwind over time.
 * This is NOT a rigid whole-disc rotation (which reads as a "static rotating
 * backdrop"); the twirl is the *shear between arms at different radii*.
 *
 * ## Why a `PointsNodeMaterial`, not stock `PointsMaterial` + onBeforeCompile
 *
 * The earlier implementation injected the twirl into the stock
 * `PointsMaterial` vertex shader via `mat.onBeforeCompile`. That patch was
 * silently never applied: `WebGPURenderer` (R3F v9's renderer, even forced to
 * the WebGL backend) routes ALL materials through the node system
 * (`GLSLNodeBuilder`), and **only the legacy `WebGLRenderer.js` ever calls
 * `onBeforeCompile`** — `WebGPURenderer` / its WebGL-fallback backend ignore
 * the callback entirely. A Playwright probe (`window.__galaxyPatched ===
 * false`, `uTime === -1`) confirmed the patch never ran, so the stock vertex
 * shader was untouched → no `uTime`-driven rotation → points sat static (the
 * only motion was menu/orb movement reprojecting them via the camera
 * billboard). That looked like "no animation" and left the bare 5-branch
 * skeleton visible as pie slices.
 *
 * `PointsNodeMaterial` is the proper path under `WebGPURenderer`: its
 * `positionNode` runs through the node builder and IS honoured. The trade-off
 * (documented in `PointsNodeMaterial` itself): WebGPU/WebGL-fallback
 * hardcode `gl_PointSize = 1.0` at the tail of the vertex shader
 * (`GLSLNodeBuilder._getGLSLVertexCode`), so `sizeNode` is ignored for raw
 * `Points` — every point renders at exactly 1 pixel. We compensate with a
 * high `count` (~350k) + `AdditiveBlending` so clusters brighten into a
 * visible nebula rather than reading as sparse 1px sprinkles.
 *
 * ## Faithful twirl details that matter
 *
 * - **Randomness is a SEPARATE attribute added AFTER the rotation**, exactly
 *   like the reference (`modelPosition.xyz += aRandomness`). Baking
 *   randomness into `position` before rotation, then clamping
 *   `distanceToCenter` in the shader, flattens the inner-arm shear (no
 *   point is truly near r=0, so the clamp kills the fastest-revolving points
 *   — the most dramatic part of the twirl). Keeping randomness separate
 *   means the rotation runs on the clean spiral skeleton and the fuzz halo
 *   inherits the motion — no clamp needed, the full `1/r` curve survives,
 *   inner arms whip.
 * - **No whole-object spin.** The reference does NOT rotate the `Points`
 *   object at all — it only feeds `(1.0/distanceToCenter) * uTime` in the
 *   shader. We mirror that. An earlier version added a rigid `rotateZ` of
 *   the whole disc "on top of" the shear; that rigid rotation dominated and
 *   made the background read as "static rotating background".
 * - **Per-vertex `aScale`** for varied point brightness. It can't drive
 *   `gl_PointSize` in `Points` mode (1px is hardcoded), so we route it into
 *   the fragment's brightness multiplier instead — same visual effect, just
 *   per-point alpha rather than per-point size. (Visible-sized points would
 *   require `Sprite` + instancing per the `PointsNodeMaterial` doc, which
 *   would balloon the draw path.)
 *
 * The twirl reads `time` directly from the shared TSL uniform
 * (`../three/shaders/shared`), advanced by `<ShaderClock>` once per frame —
 * so the galaxy animates in lockstep with the holographic orbs/obstacles,
 * with NO JS-side uniform juggling and NO `onBeforeCompile`.
 *
 * Palette: **cool** nebula (cyan/purple core → deep indigo outside) so it
 * contrasts the warm red / cool blue identity orbs instead of competing with
 * the red orb. Dim overall — it must frame the action, never outshine the
 * orbs/orbit ring.
 *
 * Locked to the camera as a **true backdrop** (Step 5, approach B refined):
 * each frame we billboard the disc to the camera (copy its quaternion, so the
 * disc's +Z normal always faces the view) and park it a fixed distance behind
 * the play field along the camera's own view-forward axis. Billboard + no
 * parallax + alignment to the view axis (not world -Z) means the nebula's
 * apparent shape never warps as the camera pans/pitches following the orbit
 * center → no twitch on scroll. The billboard carries NO in-plane spin (the
 * twirl comes purely from the per-vertex shader shear above).
 * `depthWrite:false` + `AdditiveBlending` → never occludes orbs/obstacles.
 */

// Opt-in kill-switch for visual tuning (docs/visual-redesign.md Step 7):
// `?nogalaxy` skips mounting the points cloud so orb/obstacle/ring brightness
// can be probed in isolation against the dark clear color.
const HIDDEN =
	typeof window !== 'undefined'
		? new URLSearchParams(window.location.search).has('nogalaxy')
		: false

// Reused scratch vector for the camera view-forward offset (avoids per-frame
// allocation in the hot useFrame path).
const _viewDir = new Vector3()
// Reused scratch for the camera-facing billboard quaternion.
const _camQuat = new Quaternion()

export function GalaxyBackground({
	count = 350000,
	radius = 26,
	branches = 8,
	randomness = 1.5,
	randomnessPower = 2.0,
	insideColor = '#3a6fff',
	outsideColor = '#0a1030',
	behind = 14,
}: {
	count?: number
	radius?: number
	branches?: number
	randomness?: number
	randomnessPower?: number
	insideColor?: string
	outsideColor?: string
	behind?: number
}) {
	const root = useRef<Points>(null)

	// Geometry: build the same per-vertex spiral-skeleton + fuzz-halo the
	// reference uses. Randomness stays a SEPARATE attribute (added after
	// rotation in `positionNode`) so the inner `1/r` twirl isn't clamped away.
	const { geometry } = useMemo(() => {
		const geo = new BufferGeometry()
		const positions = new Float32Array(count * 3)
		const randomnesses = new Float32Array(count * 3)
		const colors = new Float32Array(count * 3)
		const scales = new Float32Array(count)
		const inside = new Color(insideColor)
		const outside = new Color(outsideColor)
		const PI2 = Math.PI * 2

		for (let i = 0; i < count; i++) {
			const i3 = i * 3
			// Rim-biased radius (`sqrt(rand)`) so the inner core is sparse
			// (frames the play field instead of crowding it — see Step 4
			// goal "sparse near screen center, denser at the edges") while
			// keeping a real density gradient toward the rim for the
			// additive glow to read as a nebula edge.
			const r = Math.sqrt(Math.random()) * radius
			const branchAngle = ((i % branches) / branches) * PI2

			// Position the spiral-skeleton vertex on its branch ray, at r.
			positions[i3 + 0] = Math.cos(branchAngle) * r
			positions[i3 + 1] = Math.sin(branchAngle) * r
			positions[i3 + 2] = 0

			// Randomness halo. The fuzz floor `r + radius*0.18` ensures even
			// near-center points have a minimum absolute spread so the very
			// core doesn't read as a single bright dot (no max(dist,0.5)
			// clamp in the shader — the absolute floor here substitutes).
			const fuzzBase = r + radius * 0.18
			const randomX =
				Math.random() ** randomnessPower *
				(Math.random() < 0.5 ? 1 : -1) *
				randomness *
				fuzzBase
			const randomY =
				Math.random() ** randomnessPower *
				(Math.random() < 0.5 ? 1 : -1) *
				randomness *
				fuzzBase
			// Small Z thickness so the additive stack has some soft depth.
			const randomZ =
				Math.random() ** randomnessPower *
				(Math.random() < 0.5 ? 1 : -1) *
				randomness *
				fuzzBase *
				0.3
			randomnesses[i3 + 0] = randomX
			randomnesses[i3 + 1] = randomY
			randomnesses[i3 + 2] = randomZ

			// Color: mix inside -> outside by r/radius. Slight darkening at
			// the very core so the play field reads clean against the
			// backdrop (dimmer center = "sparse near screen center").
			const mixed = inside.clone().lerp(outside, r / radius)
			colors[i3 + 0] = mixed.r
			colors[i3 + 1] = mixed.g
			colors[i3 + 2] = mixed.b

			// Per-vertex brightness scale. Mid-radius points get a small
			// boost so the arms cluster at intermediate densities. This can
			// not drive `gl_PointSize` (1px is hardcoded) — used in the
			// fragment below as a brightness multiplier instead.
			scales[i] = 0.6 + Math.random() * 0.8
		}

		geo.setAttribute('position', new BufferAttribute(positions, 3))
		geo.setAttribute('aRandomness', new BufferAttribute(randomnesses, 3))
		geo.setAttribute('color', new BufferAttribute(colors, 3))
		geo.setAttribute('aScale', new BufferAttribute(scales, 1))
		return { geometry: geo }
	}, [
		count,
		radius,
		branches,
		randomness,
		randomnessPower,
		insideColor,
		outsideColor,
	])

	// Material: `PointsNodeMaterial` so `positionNode` (per-vertex twirl) and
	// `colorNode` (soft-point mask, AdditiveBlending-friendly) are honoured by
	// the `WebGPURenderer` node system. `vertexColors:true` multiplies
	// `materialColor` by the geometry `color` attribute, then `colorNode`
	// applies the soft-point radial falloff and per-vertexbrightness.
	const material = useMemo(() => {
		const aRandomness = attribute<'vec3'>('aRandomness')
		const aScale = attribute<'float'>('aScale')
		const baseColor = attribute<'vec3'>('color')

		// Per-vertex twirl in OBJECT space. Read the clean spiral-skeleton
		// position (before randomness is added), compute its polar coords, and
		// add the differential angular shear `angle += (1/r) * time`. Then
		// add the fuzz halo. This matches the reference's
		//   modelPosition.xyz += aRandomness;
		// and `spinAngle = (1.0 / distanceToCenter) * uTime;` exactly — but in
		// TSL, so it's actually compiled and run by WebGPURenderer.
		const positionNode = Fn(() => {
			const p = vec3(positionLocal).toVar() // object-space skeleton pos
			// 2D radius in the disc plane (Z stays from skeleton, plus fuzz
			// later). max(0.01) guards exact-centre NaNs without clamping the
			// rest of the 1/r curve to a non-pathological floor.
			const dist = length(p.xy).max(0.01)
			// GLSL `atan(y, x)` is atan2-like → two-arg TSL `atan(y, x)`.
			const angle = atan(p.y, p.x)
			// Reference: `spinAngle = (1.0 / distanceToCenter) * uTime` then
			// `angle = baseAngle + spinAngle`. We keep the 1/r curve so inner
			// arms outrun outer arms → visible winding.
			const twirledAngle = angle.add(time.div(dist))
			return vec3(
				cos(twirledAngle).mul(dist),
				sin(twirledAngle).mul(dist),
				p.z,
			).add(aRandomness)
		})()

		// Soft round point mask + per-vertex brightness. The point sprite is
		// a 1px square at its centre; additive blending of square 1px points
		// reads chunky/blocky. We fade RGB to 0 at the corners using the
		// distance from the point sprite's centre (`pointUV` reads
		// gl_PointCoord ∈ [0,1]², centre (0.5,0.5)) so each point contributes
		// a soft circular blob. Standard `pow(1 - d, n)` light-point falloff
		// (n=8 tight soft dot). `pointUV` ships untyped in three@0.185 so we
		// cast it to `Node<'vec2'>` to satisfy the TSL call sites.
		const uv = pointUV as unknown as Node<'vec2'>
		const colorNode = Fn(() => {
			const pd = distance(uv, vec2(0.5))
			const soft = float(1.0).sub(pd).pow(8.0)
			return baseColor.mul(aScale).mul(soft)
		})()

		const mat = new PointsNodeMaterial()
		mat.vertexColors = true
		mat.transparent = true
		mat.depthWrite = false
		mat.blending = AdditiveBlending
		mat.positionNode = positionNode
		mat.colorNode = colorNode
		return mat
	}, [])

	// Per-frame: lock the galaxy to the camera as a true backdrop
	// (billboarded + offset along the view-forward axis). We do NOT rotate the
	// whole `<points>` object — the twirl is the per-vertex differential
	// rotation in the shader above (a rigid whole-disc rotateZ would mask it
	// and read as "static rotating background"). Billboard only → constant
	// apparent shape as the camera pans/pitches following the orbit center,
	// no twitch on scroll.
	useFrame((state) => {
		if (root.current) {
			_camQuat.copy(state.camera.quaternion)
			root.current.quaternion.copy(_camQuat)
			state.camera.getWorldDirection(_viewDir)
			root.current.position
				.copy(state.camera.position)
				.addScaledVector(_viewDir, behind)
		}
	})

	// `time` is referenced inside the TSL `Fn` closure below (`angle.add(time.div(dist))`).
	// `Fn` captures it lazily so the local-scope "unused" lint needs defusing.
	void time

	if (HIDDEN) {
		return null
	}

	return (
		<points
			ref={root}
			geometry={geometry}
			material={material}
			frustumCulled={false}
		/>
	)
}
