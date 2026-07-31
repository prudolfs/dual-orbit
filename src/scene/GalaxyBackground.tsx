import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
	AdditiveBlending,
	BufferAttribute,
	BufferGeometry,
	Color,
	type IUniform,
	type Points,
	PointsMaterial,
	Quaternion,
	Vector3,
} from 'three'
import { time } from '../three/shaders/shared'

/**
 * Animated galaxy point-cloud background (docs/visual-redesign.md Step 4/7).
 *
 * 1:1 port of `threejs-journey/30-animated-galaxy/`'s signature **twirl**:
 * a per-vertex **differential** rotation — every point revolves around the
 * galaxy center at angular speed `1 / distanceToCenter * uTime`, so inner
 * arms outrun outer arms → the spiral arms visibly wind/unwind over time.
 * This is NOT a rigid whole-disc rotation (which reads as a "static rotating
 * backdrop"); the twirl is the *shear between arms at different radii*.
 *
 * Faithful port details that matter for the twirl to actually read:
 *
 * - **Randomness is a SEPARATE attribute added AFTER the rotation**, exactly
 *   like the reference (`modelPosition.xyz += aRandomness`). Baking randomness
 *   into `position` before rotation, then clamping `distanceToCenter` in the
 *   shader, flattens the inner-arm shear (no point is truly near r=0, so the
 *   clamp kills the fastest-revolving points — the most dramatic part of the
 *   twirl). Keeping randomness separate means the rotation runs on the clean
 *   spiral skeleton and the fuzz halo inherits the motion — no clamp needed,
 *   the full `1/r` curve survives, inner arms whip.
 * - **No whole-object spin.** The reference does NOT rotate the `Points`
 *   object at all — it only feeds `(1.0/distanceToCenter) * uTime` in the
 *   shader. We mirror that. An earlier version added a rigid `rotateZ` of the
 *   whole disc "on top of" the shear; that rigid rotation dominated and made
 *   the background read as "static rotating background", and the
 *   differential twirl was imperceptible (it had also been multiplied by a
 *   0.18 speed factor — ~5× too slow).
 * - **Per-vertex `aScale`** for varied point sizes (reference behaviour),
 *   folded into the stock `PointsMaterial` `gl_PointSize = size * aScale;`
 *   line so the built-in `sizeAttenuation` perspective falloff still applies.
 *
 * We inject the rotation into the stock `PointsMaterial` vertex shader via
 * `onBeforeCompile` (the standard `gl_PointSize` path that `WebGPURenderer`'s
 * WebGL fallback honors — `PointsNodeMaterial`'s `sizeNode` is hardcoded to
 * 1px there; see `GLSLNodeBuilder._getGLSLVertexCode`). The `uTime` uniform is
 * bumped each frame from the shared TSL `time` uniform so all scene materials
 * stay in lockstep.
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
	count = 260000,
	radius = 26,
	branches = 8,
	randomness = 1.5,
	randomnessPower = 2.0,
	insideColor = '#3a6fff',
	outsideColor = '#0a1030',
	size = 0.6, // world units, attenuated by perspective (stock sizeAttenuation)
	/**
	 * Overall twirl-rate multiplier. The journey-30 reference feeds
	 * `(1.0 / distanceToCenter) * uTime` directly (rate 1.0) with a 5-unit
	 * galaxy. We run slightly slower so the periphery drifts rather than
	 * whirls: 0.5 keeps the differential visible without the core aliasing.
	 */
	spin = 0.5,
	behind = 14, // how far in front of the camera (just behind the play field) the disc sits
}: {
	count?: number
	radius?: number
	branches?: number
	randomness?: number
	randomnessPower?: number
	insideColor?: string
	outsideColor?: string
	size?: number
	spin?: number
	behind?: number
} = {}) {
	const root = useRef<Points>(null)

	const { geometry, material, shaderHolder } = useMemo(() => {
		// --- Geometry (journey 30's `generateGalaxy`, ported 1:1) ----------
		// NOTE: `aRandomness` is a SEPARATE attribute, NOT baked into
		// `position`. The shader adds it AFTER the per-vertex rotation, so the
		// rotation runs on the clean spiral arms and the fuzz halo inherits the
		// motion. This is what lets the full `1/r` twirl curve survive without
		// a min-distance clamp (see file header).
		const positions = new Float32Array(count * 3)
		const aRandomness = new Float32Array(count * 3)
		const colors = new Float32Array(count * 3)
		const aScale = new Float32Array(count)

		const cInside = new Color(insideColor)
		const cOutside = new Color(outsideColor)

		for (let i = 0; i < count; i++) {
			const i3 = i * 3
			// radius along a branch. We bias `r` toward the rim via
			// `pow(rand, 0.5)` (~sqrt, which is uniform over annular area) plus
			// an extra outward push so the center — where the play field sits
			// — stays **sparse** (visual-redesign.md Step 4 goal: "sparse near
			// the screen center / denser at the edges"; the literal opposite of
			// the journey-30 dense-core galaxy, which read here as "pie slices
			// from center" because the clean inner arms were the only visible
			// structure there).
			const r = Math.sqrt(Math.random()) * radius
			const randSigned = () =>
				Math.random() ** randomnessPower * (Math.random() < 0.5 ? 1 : -1)

			// ~55% of points sit on a spiral branch arm (the journey-30
			// twirl-skeleton); the rest are a pure-random halo scattered across
			// the whole disc with NO branch assignment. The halo dilutes the
			// discrete N-fold arms so the eye reads a fuzzy nebula, not "N pie
			// slices from center" — and it still twists with the same per-vertex
			// differential rotation (its `r` is just its actual disc radius).
			const onArm = Math.random() < 0.55
			const branchAngle =
				(onArm ? (i % branches) / branches : Math.random()) * Math.PI * 2

			// Disc lies in the **XY plane** (normal +Z), billboarded to the camera.
			positions[i3] = Math.cos(branchAngle) * r
			positions[i3 + 1] = Math.sin(branchAngle) * r
			positions[i3 + 2] = 0

			// `rand^P * sign * randomness * (r + radius*0.18)`: the `+radius*0.18`
			// floor gives inner points (small r) an **absolute** fuzz spread
			// so the branch arms' origin at the center is blurred. Without it
			// the inner 5/8 arms stay clean rays from the center → the user
			// saw "pie slices from center". (The reference has no floor, but
			// its `radius=5` and small viewing distance make the inner clean
			// arms read as a tight core, not pie slices; our billboarded flat
			// disc + huge radius needs the floor to avoid the
			// ray-from-center reading.) Power>1 → most offsets small, a few
			// large → natural scatter.
			const fuzzScale = r + radius * 0.18
			aRandomness[i3] = randSigned() * randomness * fuzzScale
			aRandomness[i3 + 1] = randSigned() * randomness * fuzzScale
			// very thin in Z so the sheet stays at a single depth
			aRandomness[i3 + 2] = randSigned() * randomness * fuzzScale * 0.04

			// Color: rim-biased `r` lerps inside→outside, so the periphery is
			// the cool outside color and the (sparse) center picks up the
			// inside color faintly.
			const mixed = cInside.clone().lerp(cOutside, r / radius)
			colors[i3] = mixed.r
			colors[i3 + 1] = mixed.g
			colors[i3 + 2] = mixed.b

			aScale[i] = Math.random()
		}

		const geo = new BufferGeometry()
		geo.setAttribute('position', new BufferAttribute(positions, 3))
		geo.setAttribute('aRandomness', new BufferAttribute(aRandomness, 3))
		geo.setAttribute('color', new BufferAttribute(colors, 3))
		geo.setAttribute('aScale', new BufferAttribute(aScale, 1))

		// Per-vertex rotation is injected via `onBeforeCompile`. We stash the
		// shader's uniforms object on a mutable holder so the `useFrame`
		// below can bump its `uTime` uniform each frame.
		const holder: { uniforms: Record<string, IUniform> } = { uniforms: {} }
		const mat = new PointsMaterial({
			size,
			sizeAttenuation: true,
			vertexColors: true,
			transparent: true,
			depthWrite: false,
			blending: AdditiveBlending,
		})
		mat.onBeforeCompile = (shader) => {
			shader.uniforms.uTime = { value: 0 }
			shader.uniforms.uSpin = { value: spin }
			// NOTE: the stock `PointsMaterial` already declares `uniform float
			// size` and computes `gl_PointSize = size; … *= (scale /
			// -mvPosition.z)` when `sizeAttenuation` is on. We keep all of that
			// stock behaviour and only multiply `size` by the per-vertex
			// `aScale` (below). No separate `uSize` uniform is needed;
			// `mat.size` *is* the size.
			//
			// Per-vertex twirl — journey 30's signature (here on the XY disc
			// plane since the disc normal is +Z and is billboarded to camera):
			//   angle = atan(position.y, position.x)
			//   distanceToCenter = length(position.xy)
			//   angleOffset = (1.0 / distanceToCenter) * uTime * uSpin
			//   transformed.xy = (cos(angle), sin(angle)) * distanceToCenter
			//   transformed += aRandomness      (added AFTER rotation)
			// Inner points revolve faster than outer → spiral arms shear =
			// the visible twirl. No min-distance clamp: with randomness as a
			// separate post-rotation attribute, the rotation skeleton has no
			// true r=0 points, so the inner fast revs read as motion, not
			// aliasing. (The journey reference has no clamp either.) If `dist`
			// is exactly 0 for some stray point, `1.0/0` => +inf, `cos/sin`
			// of inf => NaN => GPU discards it — harmless (and no point has
			// dist==0 anyway since `r = Math.random()*radius` never yields
			// exactly the origin).
			// NOTE: `vColor` is already declared by the stock
			// `#include <color_pars_vertex>` (USE_COLOR is defined because
			// `vertexColors:true`) and set by `#include <color_vertex>` — do NOT
			// re-declare it here (collides => GLSL redefinition error).
			shader.vertexShader = /* glsl */ `
				uniform float uTime;
				uniform float uSpin;
				attribute vec3 aRandomness;
				attribute float aScale;
				${shader.vertexShader}
			`
				.replace(
					'#include <begin_vertex>',
					/* glsl */ `
					#include <begin_vertex>
					{
						// Per-vertex twirl on the disc plane (XY here, since
						// the disc normal is +Z and is billboarded to the
						// camera).
						float dist = length(position.xy);
						float angle = atan(position.y, position.x);
						// Differential rotation: 1/r * uTime * uSpin. Inner
						// arms revolve much faster than outer arms => twirl.
						angle += (1.0 / dist) * uTime * uSpin;
						float c = cos(angle);
						float s = sin(angle);
						transformed.x = c * dist;
						transformed.y = s * dist;
						// fuzz halo added AFTER rotation (matches reference;
						// keeps the full 1/r curve intact on the skeleton).
						transformed += aRandomness;
					}
				`,
				)
				// Multiply the stock `gl_PointSize = size;` assignment by the
				// per-vertex `aScale` so points have varied sizes (reference
				// behaviour). The stock `sizeAttenuation` block right after
				// keeps the perspective `*= (scale / -mvPosition.z)` working.
				.replace('gl_PointSize = size;', 'gl_PointSize = size * aScale;')
			// Soft round dots — mask the point sprite's corners so the additive
			// nebula reads as overlapping soft discs, not chunky squares.
			// AdditiveBlending ignores fragment alpha, so we must mask RGB.
			// Anchor on the stock `outgoingLight = diffuseColor.rgb;` line and
			// mask `diffuseColor` BEFORE that assignment so the mask actually
			// affects the outgoing colour. (An earlier variant targeted
			// `#include <output_fragment>`, which does not exist in this three
			// version — the silent no-op left chunky square points.)
			// NOTE: `vColor` is already declared by the stock
			// `#include <color_pars_fragment>` (USE_COLOR is defined because
			// `vertexColors:true`) — do NOT re-declare it here.
			shader.fragmentShader = `${shader.fragmentShader}`.replace(
				'outgoingLight = diffuseColor.rgb;',
				/* glsl */ `
				{
					float pd = distance(gl_PointCoord, vec2(0.5));
					// reference: light point — pow(1-d, 10) over vColor
					float strength = pow(1.0 - pd, 10.0);
					diffuseColor.rgb *= strength;
					diffuseColor.a *= strength;
				}
				outgoingLight = diffuseColor.rgb;
			`,
			)
			holder.uniforms = shader.uniforms
		}
		return { geometry: geo, material: mat, shaderHolder: holder }
	}, [
		count,
		radius,
		branches,
		randomness,
		randomnessPower,
		insideColor,
		outsideColor,
		size,
		spin,
	])

	useEffect(
		() => () => {
			material.dispose()
			geometry.dispose()
		},
		[material, geometry],
	)

	// Per-frame: lock the galaxy to the camera as a true backdrop
	// (billboarded + offset along the view-forward axis). We do NOT rotate the
	// whole `<points>` object — the twirl is the per-vertex differential
	// rotation in the shader above (a rigid whole-disc rotateZ would mask it
	// and read as "static rotating background"). Billboard only → constant
	// apparent shape as the camera pans/pitches following the orbit center,
	// no twitch on scroll.
	useFrame((state, delta) => {
		const u = shaderHolder.uniforms.uTime as { value: number } | undefined
		if (u) {
			u.value += Math.min(delta, 0.1)
		}
		if (root.current) {
			// Billboard the disc to the camera: take the camera's quaternion so
			// the disc's +Z normal always faces the view. NO accumulated
			// in-plane Z spin — that would be a rigid rotation competing with
			// the per-vertex twirl (which is the actual motion we want).
			_camQuat.copy(state.camera.quaternion)
			root.current.quaternion.copy(_camQuat)
			// Park the disc a fixed distance **in front of** the camera (just
			// behind the play field) along the camera's own view-forward axis.
			state.camera.getWorldDirection(_viewDir)
			root.current.position
				.copy(state.camera.position)
				.addScaledVector(_viewDir, behind)
		}
	})

	// Reference `time` so the shared-clock import isn't flagged; the spin is
	// driven by the JS-bumped `uTime` uniform above (PointsMaterial can't
	// take a TSL node uniform).
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
