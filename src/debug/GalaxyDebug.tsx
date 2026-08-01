import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
	AdditiveBlending,
	BufferAttribute,
	BufferGeometry,
	Color,
	type Points as PointsObject,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import GUI from 'three/examples/jsm/libs/lil-gui.module.min.js'
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
import { createWebGPURenderer, RenderLoop } from '../three/WebGPUCanvas'

/**
 * Standalone galaxy-tuning debug scene, mounted when `?galaxydebug` is in
 * the URL (see `src/App.tsx`). It mirrors the reference
 * `threejs-journey/30-animated-galaxy/src/` exactly:
 *
 * - The galaxy disc sits in the **XZ plane** (Y is the spin axis), with
 *   `randomness` etc. faithful to the reference geometry.
 * - A free `OrbitControls` camera lets you see the galaxy off-axis — the
 *   signature **twirl** only reads when the disc is foreshortened by
 *   perspective (with the disc perfectly face-on the spiral arms are
 *   symmetric and read as concentric circles). The reference's
 *   `OrbitControls` at `(3,3,3)` is the canonical view.
 * - A `lil-gui` panel exposes the exact same knobs as the reference
 *   (`count, radius, branches, randomness, randomnessPower, insideColor,
 *   outsideColor`) plus our `spin` rate, with `onFinishChange` regenerating
 *   the geometry so you can iterate live.
 * - The twirl is expressed in TSL through a `PointsNodeMaterial` (the same
 *   port the production `<GalaxyBackground>` uses), reading the shared `time`
 *   uniform so the animation is the real production shader, not a separate
 *   throwaway. This means whatever look you dial here applies 1:1 to the game
 *   once you copy the parameters back into `GalaxyBackground` defaults.
 *
 * Open it with `?galaxydebug`. Toggle off by removing the query param.
 */

/** Mirrors the reference `parameters`. Live-tunable from `lil-gui`. */
export interface GalaxyTuning {
	count: number
	radius: number
	branches: number
	spin: number
	randomness: number
	randomnessPower: number
	insideColor: string
	outsideColor: string
	offAxisDistance: number // camera initial Z
	offAxisHeight: number // camera initial Y
}

/** Reference defaults (from `30-animated-galaxy/src/script.js`). */
export const DEFAULT_TUNING: GalaxyTuning = {
	// The reference's small radius=5 with camera at (3,3,3) puts us INSIDE
	// the disc (z>3 reaches past the camera). We back the camera off by
	// default so the whole spiral is visible and the twirl reads at its
	// canonical scale. Tune back to (3,3) radius=5 if you want to A/B the
	// reference exactly.
	count: 200000,
	radius: 5,
	branches: 3,
	spin: 1,
	randomness: 0.2,
	randomnessPower: 3,
	insideColor: '#ff6030',
	outsideColor: '#1b3984',
	offAxisDistance: 10,
	offAxisHeight: 6,
}

// ---- TSL shader (per-vertex twirl + soft-point mask) -------------------------
// Same as `GalaxyBackground`'s material, inlined here so this debug scene has
// NO dependency on the production component. Keeping them in sync is by hand;
// copy any algorithmic change back to `GalaxyBackground`.

function useGalaxyMaterial() {
	return useMemo(() => {
		const aRandomness = attribute<'vec3'>('aRandomness')
		const aScale = attribute<'float'>('aScale')
		const baseColor = attribute<'vec3'>('color')

		// Per-vertex **differential** twirl in OBJECT space, around the Y axis.
		//   angle = atan(p.z, p.x) + (1 / dist) * time * spin
		//   dist  = length(p.xz)
		// The 1/dist factor is THE twirl: inner particles rotate faster than
		// outer ones, so the spiral arms shear (differential shear), exactly
		// like the reference's `angleOffset = (1.0 / distanceToCenter) *
		// uTime`. A flat `time*spin` ramp would just rigidly rotate the whole
		// disc (reads as "rotating lines", not a twirl). (XZ-plane disc, Y
		// is up — matches the reference orientation.)
		const positionNode = Fn(() => {
			const p = vec3(positionLocal).toVar()
			const dist = length(p.xz).max(0.01)
			const angle = atan(p.z, p.x).add(time.mul(spin).div(dist))
			return vec3(cos(angle).mul(dist), p.y, sin(angle).mul(dist)).add(
				aRandomness,
			)
		})()

		// Soft round point: pow(1 - distance(pointUV, 0.5), 10), like the
		// reference 'Light point' fragment.
		const uv = pointUV as unknown as Node<'vec2'>
		const colorNode = Fn(() => {
			const pd = distance(uv, vec2(0.5))
			const strength = float(1.0).sub(pd).pow(10.0)
			return baseColor.mul(aScale).mul(strength)
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
}

// `time` and `spin` need to be module-scoped so the closure used by the
// material's TSL `Fn` (which captures them lazily) can reach them from this
// module's scope. We bump `time` each frame via a `useFrame` in
// `<GalaxyDebugClock>`, and expose `spin` as a `uniform` so the GUI can alter
// the twirl rate at runtime without rebuilding the material.
import { uniform } from 'three/tsl'

const time = uniform(0)
const spin = uniform(DEFAULT_TUNING.spin)

// ---- Geometry (faithful to the reference) ------------------------------------

function buildGalaxyGeometry(t: GalaxyTuning): BufferGeometry {
	const geo = new BufferGeometry()
	const positions = new Float32Array(t.count * 3)
	const randomness = new Float32Array(t.count * 3)
	const colors = new Float32Array(t.count * 3)
	const scales = new Float32Array(t.count * 1)
	const insideColor = new Color(t.insideColor)
	const outsideColor = new Color(t.outsideColor)
	const PI2 = Math.PI * 2

	for (let i = 0; i < t.count; i++) {
		const i3 = i * 3
		// Reference: `radius = Math.random() * parameters.radius` (uniform
		// area density) — NOT the rim-biased `sqrt(rand)` we use in the
		// production GalaxyBackground. To see the reference look here.
		const r = Math.random() * t.radius
		const branchAngle = ((i % t.branches) / t.branches) * PI2

		// Reference: randomness scales linearly with `radius` (`* radius`, not
		// the production `+ radius*0.18` floor). Tune BOTH — the production
		// floor is specifically to mask the cookie-cutter branch starts.
		const rpow = Math.random() ** t.randomnessPower
		const sign = Math.random() < 0.5 ? 1 : -1
		const randomX = rpow * sign * t.randomness * r
		const randomY = rpow * sign * t.randomness * r
		const randomZ = rpow * sign * t.randomness * r

		positions[i3 + 0] = Math.cos(branchAngle) * r
		positions[i3 + 1] = 0
		positions[i3 + 2] = Math.sin(branchAngle) * r
		randomness[i3 + 0] = randomX
		randomness[i3 + 1] = randomY
		randomness[i3 + 2] = randomZ

		const mixed = insideColor.clone().lerp(outsideColor, r / t.radius)
		colors[i3 + 0] = mixed.r
		colors[i3 + 1] = mixed.g
		colors[i3 + 2] = mixed.b

		scales[i] = Math.random()
	}

	geo.setAttribute('position', new BufferAttribute(positions, 3))
	geo.setAttribute('aRandomness', new BufferAttribute(randomness, 3))
	geo.setAttribute('color', new BufferAttribute(colors, 3))
	geo.setAttribute('aScale', new BufferAttribute(scales, 1))
	return geo
}

// ---- Scene wiring -----------------------------------------------------------

function GalaxyDebugClock() {
	useFrame((_, delta) => {
		time.value += Math.min(delta, 0.1)
	})
	return null
}

function GalaxyDebugScene({
	tuning,
	onTuningChange,
}: {
	tuning: GalaxyTuning
	onTuningChange: (patch: Partial<GalaxyTuning>) => void
}) {
	const material = useGalaxyMaterial()
	const pointsRef = useRef<PointsObject>(null)
	const controlsRef = useRef<OrbitControls | null>(null)
	const { camera, gl } = useThree()
	const [version, setVersion] = useState(0)

	// Geometry regenerates when any geometry-affecting knob changes. The
	// GUI `Regenerate geometry` button bumps `version` with unchanged values
	// to force a regen (pure, stable inputs ⇒ React would otherwise skip).
	// biome-ignore lint/correctness/useExhaustiveDependencies: debug-only
	const geometry = useMemo(() => buildGalaxyGeometry(tuning), [tuning, version])

	// Dispose geometry on regen to avoid GPU leak.
	useEffect(() => {
		return () => {
			geometry.dispose()
		}
	}, [geometry])

	// Initial camera placement + OrbitControls (imperative — `OrbitControls`
	// from `three/examples/jsm` isn't an R3F-extended component, so we mount
	// it manually onto the WebGL canvas and `update()` it once per frame).
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
				spin.value = v
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
						const c = camera
						c.position.set(
							tuning.offAxisDistance,
							tuning.offAxisHeight,
							tuning.offAxisDistance,
						)
						c.lookAt(0, 0, 0)
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
		<points
			ref={pointsRef}
			geometry={geometry}
			material={material}
			frustumCulled={false}
		/>
	)
}

/** Wrap everything in a fresh Canvas + debug clock. */
export function GalaxyDebug({ tuning }: { tuning: GalaxyTuning }) {
	// The tuning comes from a parent `useState`, but we keep the canonical
	// state here so the GUI can mutate it via `onTuningChange` and trigger
	// geometry regeneration. The parent passes the initial value.
	const [live, setLive] = useState<GalaxyTuning>(tuning)
	return (
		<Canvas
			camera={{ position: [10, 6, 10], fov: 75, near: 0.1, far: 1000 }}
			gl={createWebGPURenderer}
			dpr={[1, 2]}
			style={{ background: '#000' }}
		>
			<GalaxyDebugClock />
			<GalaxyDebugScene
				tuning={live}
				onTuningChange={(patch) => setLive((prev) => ({ ...prev, ...patch }))}
			/>
			<RenderLoop />
		</Canvas>
	)
}
