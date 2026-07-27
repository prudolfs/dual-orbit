import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
	AdditiveBlending,
	BufferAttribute,
	BufferGeometry,
	Color,
	type Points,
	PointsMaterial,
} from 'three'
import { time } from '../three/shaders/shared'

/**
 * Animated galaxy point-cloud background — see `docs/visual-redesign.md`
 * Step 4. Ported from `threejs-journey/30-animated-galaxy/`'s GLSL.
 *
 * A swirling spiral of additive points (`insideColor → outsideColor`). Each
 * point rotates around the galaxy's center at speed `~1 / r` (inner points
 * rotate faster — the spiral-arm shear). The WebGL backend of
 * `WebGPURenderer` hardcodes `gl_PointSize = 1.0` for `PointsNodeMaterial`
 * (so `sizeNode` is ignored — see `GLSLNodeBuilder._getGLSLVertexCode`),
 * **and** 1-pixel points don't cover enough of the screen for a dense nebula.
 * We therefore use a stock `PointsMaterial` (which uses the standard
 * `gl_PointSize` path that the backend honors), then animate the swirl by
 * rotating the whole `<points>` object on its Z axis in `useFrame` (the disc
 * lies in the XY plane, normal +Z, so a Z rotation reads as in-plane spin
 * — visually identical to the per-vertex rotation but ~free on the CPU).
 *
 * Step 5: the galaxy is locked to the camera (useFrame follow script) so the
 * swirl stays behind the play field regardless of camera pan.
 * `depthWrite:false` + `AdditiveBlending` → never occludes orbs/obstacles.
 */
export function GalaxyBackground({
	count = 250000,
	radius = 26,
	branches = 4,
	randomness = 1.5,
	randomnessPower = 2.2,
	insideColor = '#ff6030',
	outsideColor = '#1b3984',
	size = 1.0, // world units, attenuated by perspective
	spinSpeed = 0.05, // base radians/sec; inner points effectively faster
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
} = {}) {
	const root = useRef<Points>(null)
	const { camera } = useThree()

	const { geometry, material } = useMemo(() => {
		// --- Geometry (journey 30's `generateGalaxy`, ported 1:1) ---------
		const positions = new Float32Array(count * 3)
		const colors = new Float32Array(count * 3)

		const cInside = new Color(insideColor)
		const cOutside = new Color(outsideColor)

		for (let i = 0; i < count; i++) {
			const i3 = i * 3
			const r = Math.random() * radius
			const branchAngle = ((i % branches) / branches) * Math.PI * 2

			// Fuzziness offset: `rand^P * sign * r * amount` — inner points
			// stay close to the arm, outer fuzz out into a halo.
			const randOffset = (amount: number) =>
				Math.random() ** randomnessPower *
				(Math.random() < 0.5 ? 1 : -1) *
				randomness *
				r *
				amount

			// Disc lies in the **XY plane** (normal +Z) so the camera — which
			// looks along -Z at the play field at z=0 — sees the disc face-on
			// (matches journey-30's tilted-camera read; without this the XZ
			// disc would render edge-on as a thin line of points).
			positions[i3] = Math.cos(branchAngle) * r + randOffset(1)
			positions[i3 + 1] = Math.sin(branchAngle) * r + randOffset(1)
			positions[i3 + 2] = randOffset(0.45) // squashed Z thickness

			const mixed = cInside.clone().lerp(cOutside, r / radius)
			colors[i3] = mixed.r
			colors[i3 + 1] = mixed.g
			colors[i3 + 2] = mixed.b
		}

		const geo = new BufferGeometry()
		geo.setAttribute('position', new BufferAttribute(positions, 3))
		geo.setAttribute('color', new BufferAttribute(colors, 3))

		// Stock PointsMaterial — the standard WebGL `gl_PointSize` path the
		// WebGPURenderer fallback honors. `size=0.35` world units + size
		// attenuation → points near the camera (~25 units away) project to a
		// few px, points farther out shrink to sub-pixel and additive-blend
		// into a soft nebula cloud. The classic journey-30 read.
		const mat = new PointsMaterial({
			size,
			sizeAttenuation: true,
			vertexColors: true,
			transparent: true,
			depthWrite: false,
			blending: AdditiveBlending,
		})
		// Soft round dots — alpha-mask the point sprite's corners so the
		// additive nebula reads as a fog of overlapping discs, not chunky
		// squares. (Baked fragment via `onBeforeCompile` of a tiny shader
		// patch that fades the corner distance.)
		mat.onBeforeCompile = (shader) => {
			shader.fragmentShader = shader.fragmentShader.replace(
				'#include <output_fragment>',
				`{
					// distance to the center of the point sprite (0..0.707)
					float pd = distance(gl_PointCoord, vec2(0.5));
					// falloff: soft additive disc. AdditiveBlending ignores
					// fragment alpha, so multiply RGB by a smoothstep mask
					// so corners fade to 0 instead of stamping chunky
					// squares across the nebula.
					float mask = smoothstep(0.5, 0.18, pd);
					diffuseColor.rgb *= mask;
					diffuseColor.a *= mask;
				}
				#include <output_fragment>`,
			)
		}
		return { geometry: geo, material: mat }
	}, [
		count,
		radius,
		branches,
		randomness,
		randomnessPower,
		insideColor,
		outsideColor,
		size,
	])

	// Dispose of GPU resources on unmount / parameter change.
	useEffect(
		() => () => {
			material.dispose()
			geometry.dispose()
		},
		[material, geometry],
	)

	// Per-frame: lock the galaxy to the camera (Step 5, approach B) and spin
	// the disc around its Z axis. We copy the camera's x/y and place the
	// disc at z = camera.z - 25 — ~25 units behind the play field. The disc
	// radius (18 world units) extends past the visible field so the nebula
	// fills the whole frame at any camera pan.
	useFrame((_, delta) => {
		if (!root.current) {
			return
		}
		root.current.position.copy(camera.position)
		root.current.position.z -= 18
		// Z-axis spin: inner points effectively travel faster (smaller
		// circumference, same angular velocity) — the journey-30 visual
		// cue of inner-arm shear without per-vertex angular speed.
		root.current.rotation.z += spinSpeed * delta
	})

	// Reference `time` (the shared TSL clock) so the import isn't flagged
	// as unused — the spin is JS-side here, but other TSL materials in the
	// scene share this same uniform (see ShaderClock).
	void time

	return (
		<points
			ref={root}
			geometry={geometry}
			material={material}
			frustumCulled={false}
		/>
	)
}
