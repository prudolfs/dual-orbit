import { RoundedBoxGeometry } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { type Mesh, TorusGeometry } from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import GUI from 'three/examples/jsm/libs/lil-gui.module.min.js'
import {
	type BackDiscMaterial,
	createBackDiscMaterial,
} from '../three/materials/energy'
import {
	CENTER,
	HOLO_BACKDROP,
	OBSTACLE,
	OBSTACLE_BEVEL,
	ORB_COLORS,
	ORB_CORE,
	ORB_CORE_GEOMETRY,
	ORB_HALO,
	ORB_SHELL,
	RING,
} from '../three/materials/holo-theme'
import {
	createHolographicMaterial,
	type HolographicMaterial,
} from '../three/materials/holographic'
import { ShaderClock } from '../three/ShaderClock'
import { createWebGPURenderer, RenderLoop } from '../three/WebGPUCanvas'

/**
 * Standalone hologram-tuning debug scene, mounted from `?holodebug=obstacle`
 * or `?holodebug=orbit` (see `src/App.tsx`).
 *
 * It mirrors `?galaxydebug`: a lil-gui panel of live visual parameters + free
 * `OrbitControls` so you can pan around one centered subject and preview the
 * holographic shader from any angle. NO game, NO bot, NO animation logic —
 * just the materials/geometry so we can dial the look (closer to
 * `screenshot-037.png`) and copy tuned params back into production.
 *
 * Two modes share this file:
 *  - `?holodebug=obstacle`: one centered holographic box (mirrors
 *    `ObstacleEntity`) exposing color, intensity, baseFill, glitchStrength,
 *    stripeFrequency, stripeSpeed, box dimensions and segment density.
 *  - `?holodebug=orbit`: one holographic ring + center-anchor sphere + one
 *    orb (sphere + pulsing core + back-disc halo), exposing the same
 *    holographic params for each layer plus ring stroke / orb radius /
 *    pulse.
 *
 * All materials use the EXACT production factory (`createHolographicMaterial`
 * / `createBackDiscMaterial`) so any look dialed here applies 1:1 to the game.
 */

// ---------------------------------------------------------------------------
// Shared holographic params (subset of HolographicOptions).
// ---------------------------------------------------------------------------

export interface HoloTuning {
	// holographic material params
	color: string
	intensity: number
	baseFill: number
	glitchStrength: number
	stripeFrequency: number
	stripeSpeed: number
	depthWrite: boolean
}

export interface ObstacleTuning extends HoloTuning {
	width: number
	height: number
	depth: number
	/** Corner bevel radius (absolute world units in the debug scene; production
	 *  derives it as a fraction of the smallest box dim via `OBSTACLE_BEVEL`). */
	bevelRadius: number
	/** Per-corner arc subdivision (drei `RoundedBoxGeometry.bevelSegments`). */
	bevelSegments: number
	/** Corner-curve smoothness (drei `RoundedBoxGeometry.smoothness`). */
	smoothness: number
	segW: number
	segH: number
	segD: number
	rotation: number
}

export interface OrbitTuning {
	// ring (TORUS — real donut with depth/volume, not a flat annulus)
	ringColor: string
	ringRadius: number
	ringTube: number
	ringIntensity: number
	ringBaseFill: number
	ringGlitch: number
	ringStripeFrequency: number
	ringTubularSegments: number
	ringRadialSegments: number
	// center anchor sphere
	centerColor: string
	centerRadius: number
	centerIntensity: number
	centerGlitch: number
	// orb shell (per-side identity color; left=red, right=blue)
	orbColor: string
	orbColorLeft: string
	orbRadius: number
	orbIntensity: number
	orbGlitch: number
	orbStripeFrequency: number
	orbWidthSegments: number
	orbHeightSegments: number
	// pulsing core (right/blue at phase 0, left/red at phase π/2 so they
	// beat out of sync, matching production)
	coreIntensity: number
	coreGlitch: number
	coreStripeFrequency: number
	corePulseSpeed: number
	corePulseAmp: number
	corePulseFloor: number
	// back-disc halo
	haloIntensity: number
	haloScale: number
}

/**
 * Default obstacle tuning — seeded from the shared `OBSTACLE` theme
 * (`holo-theme.ts`, the SAME source the production `ObstacleEntity` reads),
 * so the debug scene's starting point is exactly what the game renders. The
 * per-kind differentiation in production collapses to the `angular`-ish
 * representative here (one box); the GUI lets you find a better value, then
 * you copy it back into the theme.
 */
export const DEFAULT_OBSTACLE_TUNING: ObstacleTuning = {
	color: OBSTACLE.byKind.angular.color,
	intensity: OBSTACLE.byKind.angular.intensity,
	baseFill: OBSTACLE.byKind.angular.baseFill,
	glitchStrength: OBSTACLE.glitchStrength,
	stripeFrequency: OBSTACLE.byKind.angular.stripeFrequency,
	stripeSpeed: OBSTACLE.stripeSpeed,
	depthWrite: false,
	width: 0.6,
	height: 0.45,
	depth: 0.38,
	// Bevel defaults from the shared `OBSTACLE_BEVEL` theme so the debug
	// scene opens at EXACTLY what production renders — production now reads
	// `OBSTACLE_BEVEL.radius` (an absolute tuned world radius), and the GUI
	// slider here starts at that same value, so `?holodebug=obstacle` and the
	// in-game obstacles start identical. Scrub the slider → copy the
	// dialed-good number back into `OBSTACLE_BEVEL.radius` and both update.
	bevelRadius: OBSTACLE_BEVEL.radius,
	bevelSegments: OBSTACLE_BEVEL.bevelSegments,
	smoothness: OBSTACLE_BEVEL.smoothness,
	segW: 16,
	segH: 16,
	segD: 12,
	rotation: 0,
}

/**
 * Default orbit tuning — seeded from the shared `holo-theme.ts` (the SAME
 * source the production `OrbitEntity` reads), so the debug scene's starting
 * point is exactly what the game renders. Edit a value in the theme → both
 * update together; or scrub here first and copy the dialed number back.
 */
export const DEFAULT_ORBIT_TUNING: OrbitTuning = {
	ringColor: RING.color,
	ringRadius: 2.0,
	// Torus tube radius — real 3D donut depth (NOT a flat annulus).
	ringTube: 0.05,
	ringIntensity: RING.intensity,
	ringBaseFill: RING.baseFill,
	ringGlitch: RING.glitchStrength,
	ringStripeFrequency: RING.stripeFrequency,
	ringTubularSegments: RING.tubularSegments,
	ringRadialSegments: RING.radialSegments,

	centerColor: CENTER.color,
	centerRadius: 0.14,
	centerIntensity: CENTER.intensity,
	centerGlitch: CENTER.glitchStrength,

	orbColor: ORB_COLORS.right,
	orbColorLeft: ORB_COLORS.left,
	orbRadius: 0.3,
	orbIntensity: ORB_SHELL.intensity,
	orbGlitch: ORB_SHELL.glitchStrength,
	orbStripeFrequency: ORB_SHELL.stripeFrequency,
	orbWidthSegments: ORB_SHELL.widthSegments,
	orbHeightSegments: ORB_SHELL.heightSegments,

	coreIntensity: ORB_CORE.intensity,
	coreGlitch: ORB_CORE.glitchStrength,
	coreStripeFrequency: ORB_CORE.stripeFrequency,
	corePulseSpeed: ORB_CORE.pulse.speed,
	corePulseAmp: ORB_CORE.pulse.amp,
	corePulseFloor: ORB_CORE.pulse.floor,

	haloIntensity: ORB_HALO.intensity,
	haloScale: ORB_HALO.scaleRatio,
}

// ---------------------------------------------------------------------------
// Camera + OrbitControls wrapper (mounts controls once, updates per frame).
// ---------------------------------------------------------------------------

function useOrbitDebug() {
	const { camera, gl } = useThree()
	const controlsRef = useRef<OrbitControls | null>(null)
	// biome-ignore lint/correctness/useExhaustiveDependencies: mounted once
	useEffect(() => {
		camera.position.set(2.5, 1.8, 2.5)
		camera.lookAt(0, 0, 0)
		const controls = new OrbitControls(camera, gl.domElement)
		controls.enableDamping = true
		controls.dampingFactor = 0.05
		controlsRef.current = controls
		return () => {
			controls.dispose()
			controlsRef.current = null
		}
		// eslint-disable-next-line react-hooks/exhaustive-dependencies
	}, [])
	useFrame(() => controlsRef.current?.update())
}

// ---------------------------------------------------------------------------
// Obstacle debug scene: one centered holographic box.
// ---------------------------------------------------------------------------

function ObstacleDebugScene({
	tuning,
	onTuningChange,
}: {
	tuning: ObstacleTuning
	onTuningChange: (patch: Partial<ObstacleTuning>) => void
}) {
	useOrbitDebug()

	// Rebuild material whenever any holographic shader param changes (these
	// fold into TSL constants / properties, not live uniforms, except
	// `glitchStrength`/`intensity`/`baseFill` which ARE exposed back as live
	// uniforms on the returned material — we sync them below to scrub live).
	const material = useMemo(
		() =>
			createHolographicMaterial({
				color: tuning.color,
				intensity: tuning.intensity,
				baseFill: tuning.baseFill,
				glitchStrength: tuning.glitchStrength,
				stripeFrequency: tuning.stripeFrequency,
				stripeSpeed: tuning.stripeSpeed,
				depthWrite: tuning.depthWrite,
			}),
		[
			tuning.color,
			tuning.intensity,
			tuning.baseFill,
			tuning.glitchStrength,
			tuning.stripeFrequency,
			tuning.stripeSpeed,
			tuning.depthWrite,
		],
	)

	// Live-sync the mutable uniforms so scrubbing the sliders updates
	// immediately without rebuilding the material each tick (smoother).
	const mat = material as HolographicMaterial
	useEffect(() => {
		mat.glitchStrength.value = tuning.glitchStrength
	}, [mat, tuning.glitchStrength])
	useEffect(() => {
		mat.intensity.value = tuning.intensity
	}, [mat, tuning.intensity])
	useEffect(() => {
		mat.baseFill.value = tuning.baseFill
	}, [mat, tuning.baseFill])

	// Geometry (box dimensions only; the bevel radius / arc density are fed
	// directly to `RoundedBoxGeometry` props below — the segment density knob
	// is now the per-corner arc, not face subdivision).
	const boxArgs = useMemo(
		() => [tuning.width, tuning.height, tuning.depth] as const,
		[tuning.width, tuning.height, tuning.depth],
	)

	// Cleanup material on unmount / rebuild.
	useEffect(() => () => material.dispose(), [material])

	// Bind lil-gui once.
	// biome-ignore lint/correctness/useExhaustiveDependencies: bind once
	useEffect(() => {
		const gui = new GUI({ title: 'Obstacle Hologram' })
		const apply = (patch: Partial<ObstacleTuning>) => onTuningChange(patch)
		gui
			.addColor(tuning, 'color')
			.onFinishChange(() => apply({ color: tuning.color }))
		gui
			.add(tuning, 'intensity')
			.min(0)
			.max(6)
			.step(0.05)
			.onChange((v: number) => apply({ intensity: v }))
		gui
			.add(tuning, 'baseFill')
			.min(0)
			.max(2)
			.step(0.01)
			.onChange((v: number) => apply({ baseFill: v }))
		gui
			.add(tuning, 'glitchStrength')
			.min(0)
			.max(1)
			.step(0.005)
			.onChange((v: number) => apply({ glitchStrength: v }))
		gui
			.add(tuning, 'stripeFrequency')
			.min(2)
			.max(120)
			.step(1)
			.onFinishChange(() => apply({ stripeFrequency: tuning.stripeFrequency }))
		gui
			.add(tuning, 'stripeSpeed')
			.min(-0.5)
			.max(0.5)
			.step(0.005)
			.onFinishChange(() => apply({ stripeSpeed: tuning.stripeSpeed }))
		gui
			.add(tuning, 'depthWrite')
			.onChange((v: boolean) => apply({ depthWrite: v }))

		const geo = gui.addFolder('Geometry')
		geo
			.add(tuning, 'width')
			.min(0.05)
			.max(3)
			.step(0.01)
			.onFinishChange(() => apply({ width: tuning.width }))
		geo
			.add(tuning, 'height')
			.min(0.05)
			.max(3)
			.step(0.01)
			.onFinishChange(() => apply({ height: tuning.height }))
		geo
			.add(tuning, 'depth')
			.min(0.02)
			.max(3)
			.step(0.01)
			.onFinishChange(() => apply({ depth: tuning.depth }))
		geo
			.add(tuning, 'rotation')
			.min(-Math.PI)
			.max(Math.PI)
			.step(0.01)
			.onChange((v: number) => apply({ rotation: v }))

		// Bevel (rounded-edge) controls — these are the knobs that turn the
		// sharp cube into the glitchy orb-like silhouette. Tuned values copy
		// back into `OBSTACLE_BEVEL` in `holo-theme.ts` (the single source the
		// production `ObstacleEntity` reads), keeping the debug scene in sync.
		const bevel = gui.addFolder('Bevel')
		bevel
			.add(tuning, 'bevelRadius')
			.min(0)
			.max(0.5)
			.step(0.005)
			.onChange((v: number) => apply({ bevelRadius: v }))
		bevel
			.add(tuning, 'bevelSegments')
			.min(0)
			.max(16)
			.step(1)
			.onFinishChange(() => apply({ bevelSegments: tuning.bevelSegments }))
		bevel
			.add(tuning, 'smoothness')
			.min(0)
			.max(16)
			.step(1)
			.onFinishChange(() => apply({ smoothness: tuning.smoothness }))

		return () => gui.destroy()
		// eslint-disable-next-line react-hooks/exhaustive-dependencies
	}, [])

	return (
		<mesh rotation={[0, 0, -tuning.rotation]}>
			{/*
				Beveled (rounded-edge) cube — drei's `RoundedBoxGeometry` wraps
				`ExtrudeGeometry` + `toCreasedNormals`, preserving per-vertex
				normals so the holographic fresnel reads smoothly across the
				rounded corners. The bevel radius / arc density come from the
				GUI + `OBSTACLE_BEVEL`, matching production `ObstacleEntity` so
				whatever you dial here is exactly what ships.
			*/}
			<RoundedBoxGeometry
				args={boxArgs as [number, number, number]}
				radius={tuning.bevelRadius}
				bevelSegments={tuning.bevelSegments}
				smoothness={tuning.smoothness}
			/>
			<primitive object={material} attach="material" />
		</mesh>
	)
}

// ---------------------------------------------------------------------------
// Orbit debug scene: ring + center sphere + one orb (sphere+core+halo).
// ---------------------------------------------------------------------------

function OrbitDebugScene({
	tuning,
	onTuningChange,
}: {
	tuning: OrbitTuning
	onTuningChange: (patch: Partial<OrbitTuning>) => void
}) {
	useOrbitDebug()

	// --- ring as a TORUS (real donut, 3D volume) ---
	const ringGeometry = useMemo(
		() =>
			new TorusGeometry(
				tuning.ringRadius,
				tuning.ringTube,
				tuning.ringRadialSegments,
				tuning.ringTubularSegments,
			),
		[
			tuning.ringRadius,
			tuning.ringTube,
			tuning.ringRadialSegments,
			tuning.ringTubularSegments,
		],
	)
	const ringMaterial = useMemo(
		() =>
			createHolographicMaterial({
				color: tuning.ringColor,
				intensity: tuning.ringIntensity,
				baseFill: tuning.ringBaseFill,
				glitchStrength: tuning.ringGlitch,
				stripeFrequency: tuning.ringStripeFrequency,
			}),
		[
			tuning.ringColor,
			tuning.ringIntensity,
			tuning.ringBaseFill,
			tuning.ringGlitch,
			tuning.ringStripeFrequency,
		],
	)
	const ringMat = ringMaterial as HolographicMaterial
	useEffect(() => {
		ringMat.intensity.value = tuning.ringIntensity
	}, [ringMat, tuning.ringIntensity])
	useEffect(() => {
		ringMat.baseFill.value = tuning.ringBaseFill
	}, [ringMat, tuning.ringBaseFill])
	useEffect(() => {
		ringMat.glitchStrength.value = tuning.ringGlitch
	}, [ringMat, tuning.ringGlitch])

	// --- center anchor sphere ---
	const centerMaterial = useMemo(
		() =>
			createHolographicMaterial({
				color: tuning.centerColor,
				intensity: tuning.centerIntensity,
				glitchStrength: tuning.centerGlitch,
			}),
		[tuning.centerColor, tuning.centerIntensity, tuning.centerGlitch],
	)
	const centerMat = centerMaterial as HolographicMaterial
	useEffect(() => {
		centerMat.intensity.value = tuning.centerIntensity
	}, [centerMat, tuning.centerIntensity])
	useEffect(() => {
		centerMat.glitchStrength.value = tuning.centerGlitch
	}, [centerMat, tuning.centerGlitch])

	// --- orbs (left=red at angle π, right=blue at angle 0) ---
	// Rendered via the shared `OrbGroup` subcomponent below — two instances,
	// per-side identity color + out-of-sync pulse phase, so both orbs share
	// the ONE set of tuned params and we don't duplicate ~120 lines per side.

	// Dispose ring + center on rebuild/unmount (orbs dispose themselves).
	useEffect(
		() => () => {
			ringGeometry.dispose()
			ringMaterial.dispose()
			centerMaterial.dispose()
		},
		[ringGeometry, ringMaterial, centerMaterial],
	)

	// Orb Z == ring's Z so both orbs lie in the ring's plane.
	const orbZ = 0.15

	// Bind lil-gui once.
	// biome-ignore lint/correctness/useExhaustiveDependencies: bind once
	useEffect(() => {
		const gui = new GUI({ title: 'Orbit Hologram' })
		const apply = (patch: Partial<OrbitTuning>) => onTuningChange(patch)

		const ring = gui.addFolder('Ring')
		ring
			.addColor(tuning, 'ringColor')
			.onFinishChange(() => apply({ ringColor: tuning.ringColor }))
		ring
			.add(tuning, 'ringRadius')
			.min(0.3)
			.max(6)
			.step(0.01)
			.onChange((v: number) => apply({ ringRadius: v }))
		ring
			.add(tuning, 'ringIntensity')
			.min(0)
			.max(6)
			.step(0.05)
			.onChange((v: number) => apply({ ringIntensity: v }))
		ring
			.add(tuning, 'ringBaseFill')
			.min(0)
			.max(2)
			.step(0.01)
			.onChange((v: number) => apply({ ringBaseFill: v }))
		ring
			.add(tuning, 'ringGlitch')
			.min(0)
			.max(1)
			.step(0.005)
			.onChange((v: number) => apply({ ringGlitch: v }))
		ring
			.add(tuning, 'ringStripeFrequency')
			.min(2)
			.max(120)
			.step(1)
			.onFinishChange(() =>
				apply({ ringStripeFrequency: tuning.ringStripeFrequency }),
			)
		ring
			.add(tuning, 'ringTube')
			.min(0.01)
			.max(0.4)
			.step(0.005)
			.onChange((v: number) => apply({ ringTube: v }))
		ring
			.add(tuning, 'ringRadialSegments')
			.min(3)
			.max(48)
			.step(1)
			.onFinishChange(() =>
				apply({ ringRadialSegments: tuning.ringRadialSegments }),
			)
		ring
			.add(tuning, 'ringTubularSegments')
			.min(16)
			.max(512)
			.step(1)
			.onFinishChange(() =>
				apply({ ringTubularSegments: tuning.ringTubularSegments }),
			)

		const center = gui.addFolder('Center anchor')
		center
			.addColor(tuning, 'centerColor')
			.onFinishChange(() => apply({ centerColor: tuning.centerColor }))
		center
			.add(tuning, 'centerRadius')
			.min(0.02)
			.max(1)
			.step(0.005)
			.onChange((v: number) => apply({ centerRadius: v }))
		center
			.add(tuning, 'centerIntensity')
			.min(0)
			.max(6)
			.step(0.05)
			.onChange((v: number) => apply({ centerIntensity: v }))
		center
			.add(tuning, 'centerGlitch')
			.min(0)
			.max(1)
			.step(0.005)
			.onChange((v: number) => apply({ centerGlitch: v }))

		const orb = gui.addFolder('Orb shell')
		orb
			.addColor(tuning, 'orbColorLeft')
			.name('orbColor (left/red)')
			.onFinishChange(() => apply({ orbColorLeft: tuning.orbColorLeft }))
		orb
			.addColor(tuning, 'orbColor')
			.name('orbColor (right/blue)')
			.onFinishChange(() => apply({ orbColor: tuning.orbColor }))
		orb
			.add(tuning, 'orbRadius')
			.min(0.05)
			.max(1)
			.step(0.01)
			.onChange((v: number) => apply({ orbRadius: v }))
		orb
			.add(tuning, 'orbIntensity')
			.min(0)
			.max(6)
			.step(0.05)
			.onChange((v: number) => apply({ orbIntensity: v }))
		orb
			.add(tuning, 'orbGlitch')
			.min(0)
			.max(1)
			.step(0.005)
			.onChange((v: number) => apply({ orbGlitch: v }))
		orb
			.add(tuning, 'orbStripeFrequency')
			.min(2)
			.max(120)
			.step(1)
			.onFinishChange(() =>
				apply({ orbStripeFrequency: tuning.orbStripeFrequency }),
			)
		orb
			.add(tuning, 'orbWidthSegments')
			.min(4)
			.max(64)
			.step(1)
			.onFinishChange(() =>
				apply({ orbWidthSegments: tuning.orbWidthSegments }),
			)
		orb
			.add(tuning, 'orbHeightSegments')
			.min(4)
			.max(48)
			.step(1)
			.onFinishChange(() =>
				apply({ orbHeightSegments: tuning.orbHeightSegments }),
			)

		const core = gui.addFolder('Pulsing core')
		core
			.add(tuning, 'coreIntensity')
			.min(0)
			.max(6)
			.step(0.05)
			.onChange((v: number) => apply({ coreIntensity: v }))
		core
			.add(tuning, 'coreGlitch')
			.min(0)
			.max(1)
			.step(0.005)
			.onChange((v: number) => apply({ coreGlitch: v }))
		core
			.add(tuning, 'coreStripeFrequency')
			.min(2)
			.max(120)
			.step(1)
			.onFinishChange(() =>
				apply({ coreStripeFrequency: tuning.coreStripeFrequency }),
			)
		core
			.add(tuning, 'corePulseSpeed')
			.min(0)
			.max(8)
			.step(0.05)
			.onFinishChange(() => apply({ corePulseSpeed: tuning.corePulseSpeed }))
		core
			.add(tuning, 'corePulseAmp')
			.min(0)
			.max(1)
			.step(0.01)
			.onFinishChange(() => apply({ corePulseAmp: tuning.corePulseAmp }))
		core
			.add(tuning, 'corePulseFloor')
			.min(0)
			.max(1)
			.step(0.01)
			.onFinishChange(() => apply({ corePulseFloor: tuning.corePulseFloor }))

		const halo = gui.addFolder('Back-disc halo')
		halo
			.add(tuning, 'haloIntensity')
			.min(0)
			.max(3)
			.step(0.01)
			.onChange((v: number) => apply({ haloIntensity: v }))
		halo
			.add(tuning, 'haloScale')
			.min(1)
			.max(6)
			.step(0.05)
			.onChange((v: number) => apply({ haloScale: v }))

		return () => gui.destroy()
		// eslint-disable-next-line react-hooks/exhaustive-dependencies
	}, [])

	return (
		<group>
			{/* center anchor */}
			<mesh>
				<sphereGeometry args={[tuning.centerRadius, 24, 16]} />
				<primitive object={centerMaterial} attach="material" />
			</mesh>

			{/* right (blue) orb at angle 0 */}
			<OrbGroup
				tuning={tuning}
				color={tuning.orbColor}
				phase={0}
				angle={0}
				z={orbZ}
			/>
			{/* left (red) orb at angle π */}
			<OrbGroup
				tuning={tuning}
				color={tuning.orbColorLeft}
				phase={Math.PI / 2}
				angle={Math.PI}
				z={orbZ}
			/>

			{/* ring (torus) */}
			<mesh position={[0, 0, orbZ]}>
				<primitive object={ringGeometry} attach="geometry" />
				<primitive object={ringMaterial} attach="material" />
			</mesh>
		</group>
	)
}

// ---------------------------------------------------------------------------
// OrbGroup — one orb (back-disc halo + holographic shell + pulsing core)
// placed on the ring at a given angle. Shared by the right (blue) and left
// (red) orbs so both share the single set of tuned params; only `color`,
// `phase` and `angle` differ.
// ---------------------------------------------------------------------------

function OrbGroup({
	tuning,
	color,
	phase,
	angle,
	z,
}: {
	tuning: OrbitTuning
	color: string
	phase: number
	angle: number
	z: number
}) {
	const sphereRef = useRef<Mesh>(null)
	const coreRef = useRef<Mesh>(null)
	const discRef = useRef<Mesh>(null)

	const orbMaterial = useMemo(
		() =>
			createHolographicMaterial({
				color,
				intensity: tuning.orbIntensity,
				glitchStrength: tuning.orbGlitch,
				stripeFrequency: tuning.orbStripeFrequency,
			}),
		[color, tuning.orbIntensity, tuning.orbGlitch, tuning.orbStripeFrequency],
	)
	const orbMat = orbMaterial as HolographicMaterial
	useEffect(() => {
		orbMat.intensity.value = tuning.orbIntensity
	}, [orbMat, tuning.orbIntensity])
	useEffect(() => {
		orbMat.glitchStrength.value = tuning.orbGlitch
	}, [orbMat, tuning.orbGlitch])

	const orbRadius = tuning.orbRadius
	const coreRadius = orbRadius * 0.3
	const coreMaterial = useMemo(
		() =>
			createHolographicMaterial({
				color,
				intensity: tuning.coreIntensity,
				glitchStrength: tuning.coreGlitch,
				stripeFrequency: tuning.coreStripeFrequency,
				pulse: {
					speed: tuning.corePulseSpeed,
					phase,
					floor: tuning.corePulseFloor,
					amp: tuning.corePulseAmp,
				},
			}),
		[
			color,
			tuning.coreIntensity,
			tuning.coreGlitch,
			tuning.coreStripeFrequency,
			tuning.corePulseSpeed,
			phase,
			tuning.corePulseAmp,
			tuning.corePulseFloor,
		],
	)
	const coreMat = coreMaterial as HolographicMaterial
	useEffect(() => {
		coreMat.intensity.value = tuning.coreIntensity
	}, [coreMat, tuning.coreIntensity])
	useEffect(() => {
		coreMat.glitchStrength.value = tuning.coreGlitch
	}, [coreMat, tuning.coreGlitch])

	const discMaterial = useMemo(
		() => createBackDiscMaterial({ color, intensity: tuning.haloIntensity }),
		[color, tuning.haloIntensity],
	)
	const discMat = discMaterial as BackDiscMaterial
	useEffect(() => {
		discMat.intensity.value = tuning.haloIntensity
	}, [discMat, tuning.haloIntensity])

	useEffect(
		() => () => {
			orbMaterial.dispose()
			coreMaterial.dispose()
			discMaterial.dispose()
		},
		[orbMaterial, coreMaterial, discMaterial],
	)

	useFrame((state) => {
		const dt = state.clock.getDelta()
		if (sphereRef.current) {
			sphereRef.current.rotation.x -= 1.2 * dt
			sphereRef.current.rotation.y += 2.0 * dt
		}
		if (coreRef.current) {
			coreRef.current.rotation.x += 1.6 * dt
			coreRef.current.rotation.y -= 2.4 * dt
		}
		if (discRef.current) {
			discRef.current.quaternion.copy(state.camera.quaternion)
		}
	})

	const orbX = Math.cos(angle) * tuning.ringRadius
	const orbY = Math.sin(angle) * tuning.ringRadius
	const haloScale = orbRadius * tuning.haloScale

	return (
		<group position={[orbX, orbY, z]}>
			<mesh ref={discRef} position={[0, 0, -0.04]} scale={haloScale}>
				<planeGeometry args={[1, 1]} />
				<primitive object={discMaterial} attach="material" />
			</mesh>
			<mesh ref={sphereRef}>
				<sphereGeometry
					args={[orbRadius, tuning.orbWidthSegments, tuning.orbHeightSegments]}
				/>
				<primitive object={orbMaterial} attach="material" />
			</mesh>
			<mesh ref={coreRef} position={[0, 0, 0.02]}>
				<sphereGeometry
					args={[
						coreRadius,
						ORB_CORE_GEOMETRY.widthSegments,
						ORB_CORE_GEOMETRY.heightSegments,
					]}
				/>
				<primitive object={coreMaterial} attach="material" />
			</mesh>
		</group>
	)
}

// ---------------------------------------------------------------------------
// Public wrapper component.
// ---------------------------------------------------------------------------

export type HoloDebugMode = 'obstacle' | 'orbit'

export function HologramDebug({
	mode,
	tuning,
}: {
	mode: HoloDebugMode
	tuning: ObstacleTuning | OrbitTuning
}) {
	if (mode === 'obstacle') {
		return <ObstacleHologramDebug tuning={tuning as ObstacleTuning} />
	}
	return <OrbitHologramDebug tuning={tuning as OrbitTuning} />
}

function ObstacleHologramDebug({ tuning }: { tuning: ObstacleTuning }) {
	const [live, setLive] = useState<ObstacleTuning>(tuning)
	return (
		<Canvas
			camera={{ position: [2.5, 1.8, 2.5], fov: 50, near: 0.01, far: 1000 }}
			gl={createWebGPURenderer}
			dpr={[1, 2]}
			style={{ background: HOLO_BACKDROP }}
		>
			<color attach="background" args={[HOLO_BACKDROP]} />
			<ShaderClock />
			<ObstacleDebugScene
				tuning={live}
				onTuningChange={(patch) => setLive((prev) => ({ ...prev, ...patch }))}
			/>
			<RenderLoop />
		</Canvas>
	)
}

function OrbitHologramDebug({ tuning }: { tuning: OrbitTuning }) {
	const [live, setLive] = useState<OrbitTuning>(tuning)
	return (
		<Canvas
			// Orbit is bigger (ring radius ~2 + orb halo) → pull camera back.
			camera={{ position: [5, 3, 5], fov: 50, near: 0.01, far: 1000 }}
			gl={createWebGPURenderer}
			dpr={[1, 2]}
			style={{ background: HOLO_BACKDROP }}
		>
			<color attach="background" args={[HOLO_BACKDROP]} />
			<ShaderClock />
			<OrbitDebugScene
				tuning={live}
				onTuningChange={(patch) => setLive((prev) => ({ ...prev, ...patch }))}
			/>
			<RenderLoop />
		</Canvas>
	)
}
