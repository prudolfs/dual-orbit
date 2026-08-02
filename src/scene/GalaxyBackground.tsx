import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import {
	Color,
	DynamicDrawUsage,
	Euler,
	InstancedBufferAttribute,
	type InstancedMesh,
	PlaneGeometry,
	Quaternion,
	Vector3,
} from 'three'
import { createGalaxyMaterial } from '../three/materials/galaxy'

/**
 * Animated galaxy background — bright, visible-sized stars distributed around
 * the signature `1/r` **twirl**, locked to the camera as a true backdrop.
 *
 * ## What changed from the previous `PointsNodeMaterial` version
 *
 * The reference `threejs-journey/30-animated-galaxy/` renders bright,
 * clearly-visible star particles (size-attenuated ~30px on a tilted camera)
 * that visibly spiral around a dense core. The previous implementation used a
 * `<points>` + `PointsNodeMaterial`. That is faithful to the reference's
 * data model but **cannot match the reference's *look*** under our renderer:
 * `WebGPURenderer`'s WebGL-fallback backend hardcodes `gl_PointSize = 1.0`
 * at the tail of the generated vertex shader (`GLSLNodeBuilder
 * ._getGLSLVertexCode`), so `sizeNode` is ignored and every "point" renders
 * at exactly 1 pixel. Pushing `count` to ~350k and relying on additive
 * clustering read as a flat, dim, white-noise-ish haze — no per-star body,
 * no readable twirl at the production billboarded scale (the spiral arms are
 * sub-pixel at most view angles).
 *
 * This version uses `<instancedMesh>` of tiny camera-facing quads, one per
 * "star". Each quad has a real world-space size (perspective-attenuated via
 * the per-instance `aScale` baked into the quad-corner offset in the
 * `positionNode`), so 200k instances read as bright solid stars like the
 * reference. The twirl is computed PER-INSTANCE in TSL inside the material's
 * `positionNode`, reading the per-instance skeleton position and a shared
 * `time` uniform — so the per-vertex **differential** rotation (inner arms
 * outrun outer arms at `1/r` rate) is honoured by the node builder and
 * animates in lockstep with the holographic orbs/obstacles, with no JS-side
 * per-frame matrix juggling and no `onBeforeCompile`.
 *
 * See `docs/visual-redesign.md` Step 4 / Step 7.
 *
 * ## Why this matches the reference
 *
 * Reference geometry (`30-animated-galaxy/src/script.js`):
 *   radius = rand * radius              (uniform area density, dense core)
 *   branchAngle = (i % branches)/branches * τ
 *   randomXYZ = pow(rand, power) * ±1 * randomness * radius
 *   positions = (cos(bA)*r, 0, sin(bA)*r)   (XZ disc, Y up)
 *   colors = inside.lerp(outside, r/radius)
 *   scales[i] = rand
 *
 * We mirror those defaults here EXCEPT the disc lies in **XY** (Z is the disc
 * normal) instead of the reference's XZ, because the camera looks down -Z at
 * the play field. An XZ disc would render edge-on (a thin line). The whole
 * `<instancedMesh>` is billboarded to the camera (Step 5) so XY "always faces
 * the view" anyway — the disc normal (+Z) points at the camera exactly like
 * the reference's tilted-camera view puts the disc roughly face-on.
 *
 * ## Randomness as a SEPARATE post-rotation attribute
 *
 * Exactly like the reference (`modelPosition.xyz += aRandomness`). Baking
 * randomness into the seed position before rotation, then clamping the
 * per-vertex min distance, flattens the inner-arm shear (no point is truly
 * near r=0, so the clamp kills the fastest-revolving points — the most
 * dramatic part of the twirl). Keeping randomness separate means the rotation
 * runs on the clean spiral skeleton and the fuzz halo inherits the motion —
 * no clamp needed, the full `1/r` curve survives, inner arms whip.
 *
 * ## Palette
 *
 * Default colors match the reference (`#ff6030` warm core, `#1b3984` cool
 * edge) — bright, **galaxy-looking**. Production overrides these with a
 * **cool** nebula palette so the warm red/cool blue identity orbs are the
 * brightest things on screen and the background frames them, never competes.
 *
 * ## Camera lock (Step 5, approach B refined)
 *
 * Each frame we billboard the disc to the camera (copy its quaternion, then
 * re-apply a fixed X-axis tilt so the disc presents at an angle rather than
 * dead face-on — this restores the visible Z-thickness/depth the reference
 * shows when its camera is at `(3,3,3)`), and park it a fixed distance
 * behind the play field along the camera's own view-forward axis.
 * Tilted-billboard + no parallax + alignment to the view axis (not world -Z)
 * means the nebula's apparent shape never warps as the camera pans/pitches
 * following the orbit center → no twitch on scroll. The billboard carries
 * NO in-plane spin (the twirl comes purely from the per-vertex shader shear
 * above). `depthWrite:false` + `AdditiveBlending` → never occludes
 * orbs/obstacles.
 */

// Opt-in kill-switch for visual tuning (docs/visual-redesign.md Step 7):
// `?nogalaxy` skips mounting the points cloud so orb/obstacle/ring brightness
// can be probed in isolation against the dark clear color.
const SEARCH = typeof window !== 'undefined' ? window.location.search : ''
const HIDDEN = new URLSearchParams(SEARCH).has('nogalaxy')

// URL-param overrides for the volumetric-glow sweep — let a probe sweep
// inject different `(count, pointSize)` without a rebuild. Read once at
// module load so the per-instance props are stable for the lifetime of the
// mounted component.
function numParam(key: string): number | undefined {
	const v = new URLSearchParams(SEARCH).get(key)
	return v === null ? undefined : Number(v)
}

// Reused scratch (avoid per-frame allocation in the hot useFrame path).
const _viewDir = new Vector3()
const _camQuat = new Quaternion()

export function GalaxyBackground({
	count = numParam('gx_count') ?? 300000,
	radius = 26,
	branches = 5,
	randomness = 0.2,
	randomnessPower = 3,
	insideColor = '#3a6fff',
	outsideColor = '#0a1030',
	pointSize = numParam('gx_ps') ?? 0.25,
	tilt = 0.5,
	behind = 14,
}: {
	count?: number
	radius?: number
	branches?: number
	randomness?: number
	randomnessPower?: number
	insideColor?: string
	outsideColor?: string
	/** World-space size of each star quad (× per-instance `aScale`). */
	pointSize?: number
	/** Radians to tip the disc-local X axis each frame, on top of the
	 * camera billboard. `0` is dead face-on (flat); ~0.5 rad ≈ 28.6° shows
	 * the disc at the reference's `(3,3,3)`-camera angle (visible depth). */
	tilt?: number
	behind?: number
}) {
	const root = useRef<InstancedMesh>(null)

	// Tilt applied on top of the camera billboard each frame (local X axis).
	// Pre-baked per `tilt` change so the `useFrame` path stays
	// allocation-free. `0` reduces to the prior flat face-on billboard.
	const tiltQuat = useMemo(
		() => new Quaternion().setFromEuler(new Euler(tilt, 0, 0)),
		[tilt],
	)

	// One shared 1×1 quad template; per-instance data lives in instanced
	// buffer attributes on the geometry (`aSkeleton`, `aRandomness`,
	// `color`, `aScale`). `frustumCulled:false` keeps the cloud visible even
	// though its world-space bounds come from the tiny template quad.
	const { geometry, material } = useMemo(() => {
		const geo = new PlaneGeometry(1, 1)
		const inside = new Color(insideColor)
		const outside = new Color(outsideColor)
		const PI2 = Math.PI * 2

		const skeletons = new Float32Array(count * 3)
		const randomnesses = new Float32Array(count * 3)
		const colors = new Float32Array(count * 3)
		const scales = new Float32Array(count)

		for (let i = 0; i < count; i++) {
			const i3 = i * 3
			// Reference: `radius = Math.random() * parameters.radius`
			// (uniform per-area density → dense bright core, exactly the
			// "galaxy-looking" density gradient we want). NOT the rim-biased
			// `sqrt(rand)` the old Points version used to bury the pie wedges
			// — with visible stars the bare branch skeleton IS the galaxy.
			const r = Math.random() * radius
			const branchAngle = ((i % branches) / branches) * PI2

			// Seed skeleton position lies on the branch ray at radius r, in
			// the disc-local XY plane (Z stays 0). The `positionNode` reads
			// `aSkeleton` and applies the twirl later, so this is the clean
			// spiral BEFORE any rotation.
			skeletons[i3 + 0] = Math.cos(branchAngle) * r
			skeletons[i3 + 1] = Math.sin(branchAngle) * r
			skeletons[i3 + 2] = 0

			// Randomness halo — identical to the reference: pow(rand, power)*
			// sign * randomness * radius. KEPT as a separate attribute added
			// AFTER the in-shader twirl (the reference does exactly this).
			const rpow = Math.random() ** randomnessPower
			const sign = Math.random() < 0.5 ? 1 : -1
			const rx = rpow * sign * randomness * r
			const ry = rpow * sign * randomness * r
			// Z thickness matches the reference's XY-magnitude on all 3 axes
			// (the reference assigns the same fuzzy radius to X, Y, AND Z).
			// With the disc now tilted to the camera (see `tilt` prop), this
			// real 3D volume reads as visible depth instead of being
			// compressed away by a face-on view.
			const rz = rpow * sign * randomness * r
			randomnesses[i3 + 0] = rx
			randomnesses[i3 + 1] = ry
			randomnesses[i3 + 2] = rz

			// Color: inside -> outside by r/radius, exactly the reference.
			const mixed = inside.clone().lerp(outside, r / radius)
			colors[i3 + 0] = mixed.r
			colors[i3 + 1] = mixed.g
			colors[i3 + 2] = mixed.b

			// Per-instance size — reference uses `Math.random()`.
			scales[i] = Math.random()
		}

		// `set usage = DynamicDrawUsage` is harmless here (we never rewrite
		// the buffers per frame), but signals the GPU it may live in
		// dynamic-ready memory for the instanced path — same as the reference.
		geo.setAttribute(
			'aSkeleton',
			new InstancedBufferAttribute(skeletons, 3).setUsage(DynamicDrawUsage),
		)
		geo.setAttribute(
			'aRandomness',
			new InstancedBufferAttribute(randomnesses, 3).setUsage(DynamicDrawUsage),
		)
		geo.setAttribute(
			'color',
			new InstancedBufferAttribute(colors, 3).setUsage(DynamicDrawUsage),
		)
		geo.setAttribute(
			'aScale',
			new InstancedBufferAttribute(scales, 1).setUsage(DynamicDrawUsage),
		)

		const mat = createGalaxyMaterial({ pointSize, falloff: 9 })
		return { geometry: geo, material: mat }
	}, [
		count,
		radius,
		branches,
		randomness,
		randomnessPower,
		insideColor,
		outsideColor,
		pointSize,
	])

	// Per-frame: lock the galaxy to the camera as a true backdrop
	// (billboarded + offset along the view-forward axis), then apply the
	// fixed tilt so the disc presents at an angle and its real 3D volume
	// reads as depth (the reference's `(3,3,3)`-camera look). NO in-plane
	// spin — the twirl is the per-vertex differential rotation in the
	// shader; a rigid whole-disc spin would mask it and read as a
	// "rotating backdrop".
	useFrame((state) => {
		if (root.current) {
			// camera billboard × tilt — first the tilt (disc-local), then the
			// camera orientation, so the disc tips relative to the view.
			_camQuat.copy(state.camera.quaternion).multiply(tiltQuat)
			root.current.quaternion.copy(_camQuat)
			state.camera.getWorldDirection(_viewDir)
			root.current.position
				.copy(state.camera.position)
				.addScaledVector(_viewDir, behind)
		}
	})

	if (HIDDEN) {
		return null
	}

	return (
		<instancedMesh
			ref={root}
			args={[geometry, material, count]}
			frustumCulled={false}
		/>
	)
}
