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
	Vector3,
} from 'three'
import { time } from '../three/shaders/shared'

/**
 * Animated galaxy point-cloud background (docs/visual-redesign.md Step 4/7).
 *
 * Ported from `threejs-journey/30-animated-galaxy/`. A swirling spiral of
 * additive points colored `insideColor → outsideColor`. The signature journey
 * motion is a **per-vertex** rotation: every point revolves around the galaxy
 * center at angular speed `~1 / distanceToCenter`, so inner arms shear ahead
 * of outer arms → the visible swirl. We inject that rotation into the stock
 * `PointsMaterial` vertex shader via `onBeforeCompile` (the standard
 * `gl_PointSize` path that `WebGPURenderer`'s WebGL fallback honors —
 * `PointsNodeMaterial`'s `sizeNode` is hardcoded to 1px there; see
 * `GLSLNodeBuilder._getGLSLVertexCode`). The `uTime` uniform is bumped each
 * frame from the shared TSL `time` uniform so all scene materials stay in
 * lockstep. On top of the per-vertex shear, the whole `<points>` object is
 * slowly rotated on its disc-normal axis each frame so the arms sweep across
 * the full frame (the per-vertex shear alone is only obvious in the dense
 * core) — together this reproduces the journey-30 twirl.
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
 * center → no twitch on scroll. `depthWrite:false` + `AdditiveBlending` →
 * never occludes orbs/obstacles.
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

export function GalaxyBackground({
	count = 240000,
	radius = 26,
	branches = 5,
	randomness = 1.4,
	randomnessPower = 2.4,
	insideColor = '#3a6fff',
	outsideColor = '#0a1030',
	size = 0.6, // world units, attenuated by perspective
	spinSpeed = 0.45, // outward rotation factor; inner arms rotate ~1/r * spinSpeed
	discSpin = 0.04, // whole-disc rad/s on top of the per-vertex shear
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
	spinSpeed?: number
	discSpin?: number
	behind?: number
} = {}) {
	const root = useRef<Points>(null)

	const { geometry, material, shaderHolder } = useMemo(() => {
		// --- Geometry (journey 30's `generateGalaxy`, ported 1:1) ----------
		const positions = new Float32Array(count * 3)
		const colors = new Float32Array(count * 3)

		const cInside = new Color(insideColor)
		const cOutside = new Color(outsideColor)

		for (let i = 0; i < count; i++) {
			const i3 = i * 3
			const r = Math.random() * radius
			const branchAngle = ((i % branches) / branches) * Math.PI * 2

			// `rand^P * sign * randomness * r`: inner points hug the arm,
			// outer points fuzz into a halo.
			const randOffset = (amount: number) =>
				Math.random() ** randomnessPower *
				(Math.random() < 0.5 ? 1 : -1) *
				randomness *
				r *
				amount

			// Disc lies in the **XY plane** (normal +Z),billboarded to the
			// camera so its +Z normal faces the view at all times. We keep the
			// disc essentially flat (negligible Z thickness) so every point
			// sits at a single depth in front of the camera — no points stray
			// behind the near plane (which caused the size-attenuation twitch),
			// and the additive nebula reads as a clean flat swirling sheet.
			positions[i3] = Math.cos(branchAngle) * r + randOffset(1)
			positions[i3 + 1] = Math.sin(branchAngle) * r + randOffset(1)
			positions[i3 + 2] = randOffset(0.06) // very thin, in-plane

			const mixed = cInside.clone().lerp(cOutside, r / radius)
			colors[i3] = mixed.r
			colors[i3 + 1] = mixed.g
			colors[i3 + 2] = mixed.b
		}

		const geo = new BufferGeometry()
		geo.setAttribute('position', new BufferAttribute(positions, 3))
		geo.setAttribute('color', new BufferAttribute(colors, 3))

		// Per-vertex rotation is injected via `onBeforeCompile`. We stash the
		// shader's uniforms object on a mutable holder so the `useFrame` below
		// can bump its `uTime` uniform each frame.
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
			shader.uniforms.uSpinSpeed = { value: spinSpeed }
			// Per-vertex swirl: rotate each point around the disc center (XY
			// plane) by an angle proportional to `1 / distanceToCenter * uTime`
			// — the journey-30 algorithm. Inner points revolve faster → the
			// spiral arms shear visibly over time.
			shader.vertexShader = /* glsl */ `
				uniform float uTime;
				uniform float uSpinSpeed;
				${shader.vertexShader}
			`.replace(
				'#include <begin_vertex>',
				/* glsl */ `
				#include <begin_vertex>
				{
					// distance to the disc center in the XY plane (the
					// disc lies in the XY plane, normal +Z)
					float dist = length(position.xy);
					// base polar angle of this point in the XY plane
					float angle = atan(position.y, position.x);
					// inner arms rotate faster (1/r) — the signature shear
					angle += (1.0 / max(dist, 0.001)) * uTime * uSpinSpeed;
					transformed.x = cos(angle) * dist;
					transformed.y = sin(angle) * dist;
				}
			`,
			)
			// Soft round dots — smoothstep-mask the point sprite's corners so
			// the additive nebula reads as overlapping soft discs, not chunky
			// squares. AdditiveBlending ignores fragment alpha, so multiply RGB
			// (and alpha) by a radial mask.
			shader.fragmentShader = shader.fragmentShader.replace(
				'#include <output_fragment>',
				/* glsl */ `
				{
					float pd = distance(gl_PointCoord, vec2(0.5));
					float mask = smoothstep(0.5, 0.18, pd);
					diffuseColor.rgb *= mask;
					diffuseColor.a *= mask;
				}
				#include <output_fragment>
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
		spinSpeed,
	])

	useEffect(
		() => () => {
			material.dispose()
			geometry.dispose()
		},
		[material, geometry],
	)

	// Per-frame: advance the per-vertex rotation uniform from the shared
	// `time` clock, and lock the galaxy to the camera as a true backdrop
	// (billboarded + offset along the view-forward axis) so the swirl fills
	// the whole frame at any camera pan with no parallax-warp / no twitch.
	useFrame((state, delta) => {
		const u = shaderHolder.uniforms.uTime as { value: number } | undefined
		if (u) {
			u.value += Math.min(delta, 0.1)
		}
		if (root.current) {
			// Billboard the disc to the camera: copy the camera's quaternion
			// so the disc's +Z normal always faces the view. The apparent
			// shape of the nebula stays constant as the camera pans/pitches
			// following the orbit center → no frame-to-frame warp, hence no
			// twitch when the game scrolls.
			root.current.quaternion.copy(state.camera.quaternion)
			// Park the disc a fixed distance **in front of** the camera (just
			// behind the play field) along the camera's own view-forward axis —
			// NOT world -Z, so it stays framed as the orbit center pans/pitches.
			// `getWorldDirection` returns the camera's forward (look) direction,
			// so `+behind` moves along it, away from the camera, past the
			// playfield at z~0 (camera is at z~12).
			state.camera.getWorldDirection(_viewDir)
			root.current.position
				.copy(state.camera.position)
				.addScaledVector(_viewDir, behind)
			// Global disc spin on top of the per-vertex 1/r shear so the arms
			// sweep visibly across the full frame (the per-vertex shear alone
			// only reads in the dense core). `rotateZ` is in the disc's *local*
			// space (after the billboard copy its local +Z == camera forward),
			// so this is an in-plane spin — the journey-30 twirl.
			root.current.rotateZ(delta * discSpin)
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
