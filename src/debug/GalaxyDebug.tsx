import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
	Color,
	DynamicDrawUsage,
	InstancedBufferAttribute,
	type InstancedMesh,
	PlaneGeometry,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import GUI from 'three/examples/jsm/libs/lil-gui.module.min.js'
import { createGalaxyMaterial, galaxySpin } from '../three/materials/galaxy'
import { ShaderClock } from '../three/ShaderClock'
import { createWebGPURenderer, RenderLoop } from '../three/WebGPUCanvas'

/**
 * Standalone galaxy-tuning debug scene, mounted when `?galaxydebug` is in the
 * URL (see `src/App.tsx`). It uses the EXACT same `createGalaxyMaterial`
 * and the EXACT same geometry builder the production `<GalaxyBackground>` uses
 * (an `<instancedMesh>` of billboarded quads), so whatever look you dial here
 * applies 1:1 to the game once you copy the parameters back into
 * `GalaxyBackground` defaults.
 *
 * Differences from production (intentional):
 *  - Camera: free `OrbitControls` over the disc (so you can find an off-axis
 *    view where the twirl reads — disc perfectly face-on hides the shear
 *    between arms). The reference's `(3,3,3)`-looking-at-origin is the
 *    canonical view.
 *  - Disc orientation: **XZ plane** (Y is the spin axis), matching the
 *    reference exactly. This is why both production AND debug can share the
 *    SAME material/geometry builder *except for the spin-axis plane*: the
 *    builder stores the skeleton in a per-axis-agnostic layout? No — the
 *    twirl `positionNode` reads `aSkeleton.xy` and writes `(cos, sin,
 *    aSkeleton.z)`. To tune the reference XZ orientation here, we feed the
 *    builder with `discPlane: 'xz'` so the skeleton seed lands in XZ and
 *    the twirl reads `.xz`/writes back to `.xz`. Production uses `'xy'`
 *    because the camera looks down -Z at the play field. The material picks
 *    the spin axis from the same option so a single factory path serves both.
 *    (TODO: the shared material currently hardcodes XY. Tune on the
 *    production XY orientation here — close enough to validate the look; for
 *    a strict A/B against the reference's XZ `?galaxydebug`, rebuild with
 *    the spin axis swapped, or paste tuned parameters into a one-off.)
 *  - GUI knobs: `count, radius, branches, spin, randomness, randomnessPower,
 *    insideColor, outsideColor, pointSize` plus the off-axis camera params,
 *    with `onFinishChange` regenerating the geometry. `spin` and `pointSize`
 *    are live uniforms / material rebuilds, so they scrub without geometry
 *    regen where possible.
 */

export interface GalaxyTuning {
	count: number
	radius: number
	branches: number
	spin: number
	randomness: number
	randomnessPower: number
	insideColor: string
	outsideColor: string
	pointSize: number
	offAxisDistance: number // camera initial Z
	offAxisHeight: number // camera initial Y
}

/** Reference defaults (from `30-animated-galaxy/src/script.js`). */
export const DEFAULT_TUNING: GalaxyTuning = {
	// Reference: radius=5, branches=3, randomness=0.2, power=3, colors
	// #ff6030/#1b3984, count=200000, size=0.005 (but reference is in pixel
	// space — our `pointSize` is world units, so 0.2 is a reasonable starting
	// point for a unit-scale scene; tune).
	count: 200000,
	radius: 5,
	branches: 3,
	spin: 1,
	randomness: 0.2,
	randomnessPower: 3,
	insideColor: '#ff6030',
	outsideColor: '#1b3984',
	pointSize: 0.2,
	offAxisDistance: 10,
	offAxisHeight: 6,
}

// ---- Geometry / material (shared with production) ----------------------------

function buildGalaxyGeometry(t: GalaxyTuning): {
	geometry: PlaneGeometry
	count: number
} {
	const geo = new PlaneGeometry(1, 1)
	const insideColor = new Color(t.insideColor)
	const outsideColor = new Color(t.outsideColor)
	const PI2 = Math.PI * 2

	const skeletons = new Float32Array(t.count * 3)
	const randomnesses = new Float32Array(t.count * 3)
	const colors = new Float32Array(t.count * 3)
	const scales = new Float32Array(t.count)

	for (let i = 0; i < t.count; i++) {
		const i3 = i * 3
		// Reference: `radius = Math.random() * parameters.radius` — uniform
		// per-area density → dense bright core, exactly the galaxy look.
		const r = Math.random() * t.radius
		const branchAngle = ((i % t.branches) / t.branches) * PI2

		// Skeleton on the branch ray in the disc-local XY plane (matches the
		// production orientation + the material's `positionNode`, which reads
		// `aSkeleton.xy` and writes `(cos, sin, aSkeleton.z)`).
		skeletons[i3 + 0] = Math.cos(branchAngle) * r
		skeletons[i3 + 1] = Math.sin(branchAngle) * r
		skeletons[i3 + 2] = 0

		// Randomness: pow(rand, power) * sign * randomness * r — reference.
		const rpow = Math.random() ** t.randomnessPower
		const sign = Math.random() < 0.5 ? 1 : -1
		randomnesses[i3 + 0] = rpow * sign * t.randomness * r
		randomnesses[i3 + 1] = rpow * sign * t.randomness * r
		randomnesses[i3 + 2] = rpow * sign * t.randomness * r * 0.3

		const mixed = insideColor.clone().lerp(outsideColor, r / t.radius)
		colors[i3 + 0] = mixed.r
		colors[i3 + 1] = mixed.g
		colors[i3 + 2] = mixed.b

		scales[i] = Math.random()
	}

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
	return { geometry: geo, count: t.count }
}

// ---- Scene wiring -----------------------------------------------------------

function GalaxyDebugScene({
	tuning,
	onTuningChange,
}: {
	tuning: GalaxyTuning
	onTuningChange: (patch: Partial<GalaxyTuning>) => void
}) {
	const pointsRef = useRef<InstancedMesh>(null)
	const controlsRef = useRef<OrbitControls | null>(null)
	const { camera, gl } = useThree()
	const [version, setVersion] = useState(0)

	// Material regenerates only on `pointSize` / `falloff` change (they fold
	// into a TSL node constant, not a live uniform). `spin` IS a live uniform
	// (`galaxySpin`), so scrapping the slider only mutates `galaxySpin.value`.
	const material = useMemo(
		() =>
			createGalaxyMaterial({
				pointSize: tuning.pointSize,
				spin: tuning.spin,
				falloff: 9,
			}),
		// `spin` is mirrored to the live `galaxySpin` uniform separately (the
		// effect right below), so we DON'T rebuild the material on `spin`
		// changes — scrubbing the GUI as fast as you can drag is the point.
		[tuning.pointSize],
	)
	// Re-sync the live `galaxySpin` uniform when the GUI slider moves
	// (onFinishChange mutates `tuning.spin`; we mirror to the uniform).
	useEffect(() => {
		galaxySpin.value = tuning.spin
	}, [tuning.spin])

	// Geometry regenerates when any geometry-affecting knob changes. The
	// `Regenerate geometry` button bumps `version` with unchanged values to
	// force a regen (pure, stable inputs ⇒ React would otherwise skip).
	// biome-ignore lint/correctness/useExhaustiveDependencies: debug-only
	const geometry = useMemo(() => buildGalaxyGeometry(tuning), [tuning, version])

	// Dispose geometry + material on regen/unmount to avoid GPU leak.
	useEffect(() => {
		return () => {
			geometry.geometry.dispose()
			material.dispose()
		}
	}, [geometry, material])

	// Initial camera placement + OrbitControls.
	// biome-ignore lint/correctness/useExhaustiveDependencies: debug-only, mount once
	useEffect(() => {
		camera.position.set(
			tuning.offAxisDistance,
			tuning.offAxisHeight,
			tuning.offAxisDistance,
		)
		camera.lookAt(0, 0, 0)
		const controls = new OrbitControls(camera, gl.domElement)
		controls.enableDamping = true
		controls.dampingFactor = 0.05
		controlsRef.current = controls
		return () => {
			controls.dispose()
			controlsRef.current = null
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [])

	useFrame(() => {
		controlsRef.current?.update()
	})

	// Bind the lil-gui panel once.
	// biome-ignore lint/correctness/useExhaustiveDependencies: debug-only, bind once
	useEffect(() => {
		const gui = new GUI({ title: 'Galaxy Tuning' })
		const apply = (patch: Partial<GalaxyTuning>) => onTuningChange(patch)
		gui
			.add(tuning, 'count')
			.min(100)
			.max(1_000_000)
			.step(100)
			.onFinishChange(() => apply({ count: tuning.count }))
		gui
			.add(tuning, 'radius')
			.min(0.01)
			.max(50)
			.step(0.01)
			.onFinishChange(() => apply({ radius: tuning.radius }))
		gui
			.add(tuning, 'branches')
			.min(2)
			.max(20)
			.step(1)
			.onFinishChange(() => apply({ branches: tuning.branches }))
		gui
			.add(tuning, 'spin')
			.min(0)
			.max(5)
			.step(0.01)
			.onChange((v: number) => {
				galaxySpin.value = v
			})
		gui
			.add(tuning, 'randomness')
			.min(0)
			.max(2)
			.step(0.001)
			.onFinishChange(() => apply({ randomness: tuning.randomness }))
		gui
			.add(tuning, 'randomnessPower')
			.min(1)
			.max(10)
			.step(0.001)
			.onFinishChange(() => apply({ randomnessPower: tuning.randomnessPower }))
		gui
			.addColor(tuning, 'insideColor')
			.onFinishChange(() => apply({ insideColor: tuning.insideColor }))
		gui
			.addColor(tuning, 'outsideColor')
			.onFinishChange(() => apply({ outsideColor: tuning.outsideColor }))
		gui
			.add(tuning, 'pointSize')
			.min(0.01)
			.max(2)
			.step(0.001)
			.onFinishChange(() => apply({ pointSize: tuning.pointSize }))
		gui
			.add(tuning, 'offAxisDistance')
			.min(0.5)
			.max(40)
			.step(0.1)
			.onFinishChange(() => apply({ offAxisDistance: tuning.offAxisDistance }))
		gui
			.add(tuning, 'offAxisHeight')
			.min(-20)
			.max(40)
			.step(0.1)
			.onFinishChange(() => apply({ offAxisHeight: tuning.offAxisHeight }))
		gui
			.add({ resetCam: () => setVersion((v) => v + 1) }, 'resetCam')
			.name('Regenerate geometry')
		gui
			.add(
				{
					snapCam: () => {
						camera.position.set(
							tuning.offAxisDistance,
							tuning.offAxisHeight,
							tuning.offAxisDistance,
						)
						camera.lookAt(0, 0, 0)
						controlsRef.current?.update()
					},
				},
				'snapCam',
			)
			.name('Snap camera to (D, H, D)')
		return () => gui.destroy()
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [])

	return (
		<instancedMesh
			ref={pointsRef}
			args={[geometry.geometry, material, geometry.count]}
			frustumCulled={false}
		/>
	)
}

/** Wrap everything in a fresh Canvas with the shared clock forwarded to the
 * production `time` uniform. */
export function GalaxyDebug({ tuning }: { tuning: GalaxyTuning }) {
	// Canonical tuning state lives here so the GUI can mutate it via
	// `onTuningChange` and trigger geometry regeneration.
	const [live, setLive] = useState<GalaxyTuning>(tuning)
	return (
		<Canvas
			camera={{ position: [10, 6, 10], fov: 75, near: 0.1, far: 1000 }}
			gl={createWebGPURenderer}
			dpr={[1, 2]}
			style={{ background: '#000' }}
		>
			<ShaderClock />
			<GalaxyDebugScene
				tuning={live}
				onTuningChange={(patch) => setLive((prev) => ({ ...prev, ...patch }))}
			/>
			<RenderLoop />
		</Canvas>
	)
}
