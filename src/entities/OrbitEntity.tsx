import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import type { Mesh } from 'three'
import { Color, TorusGeometry } from 'three'
import type { GeneratorState, OrbitState } from '../game/types'
import { toWorldPosition, toWorldSize } from '../scene/coordinates'
import {
	createBackDiscMaterial,
	createOrbitRingMaterial,
	createPulsingCoreMaterial,
} from '../three/materials/energy'
import { createHolographicMaterial } from '../three/materials/holographic'

/**
 * Orb identity palette — explicitly red/blue, not the former green. Kept here as
 * the single source of truth so the HUD accent system (docs Step 6b) can mirror
 * it.
 */
const ORB_COLOR = {
	left: '#d84f3f',
	right: '#2f6fd8',
} as const

const RING_COLOR = '#dce6ff'

const RING_THETA_SEGMENTS = 160
const RING_TUBE_SEGMENTS = 16

type OrbitEntityProps = {
	readonly orbit: OrbitState
	readonly resolution: GeneratorState['resolution']
}

export function OrbitEntity({ orbit, resolution }: OrbitEntityProps) {
	const center = toWorldPosition(orbit.center, resolution, 0.15)
	const centerRadius = toWorldSize(14)

	// Orbit-path ring: a thin **torus** tube tracing the orbs' rotation circle.
	// Using a torus (not a flat `ringGeometry`) gives the orbit a real 3D track
	// the orbs straddle — the orbs sit on the tube's centerline and the torus
	// has depth, so the orbs' front/back read as in-front-of / behind the ring.
	// Rebuilt when the live `orbit.radius` changes (only on progression).
	//
	// `orbit.radius` is the world distance the orbs travel at — the torus's main
	// radius IS that value, so the tube centerline passes exactly through the
	// centers of the two orbs ("drawn from center of orbs").
	const orbitRadiusWorld = toWorldSize(orbit.radius)
	// Tube thickness: ~1.2% of the orbit radius makes a clear but THIN track
	// — the orbs sit on the centerline and the ring reads as a narrow glowing
	// line, not a fat torus. Floor at 0.008 so even tiny orbits keep a
	// renderable tube. (Down from the earlier 3.2%/0.02 floor — that produced
	// a 0.06 unit tube on a 2.0 unit orbit, ~3% the diameter, which read as a
	// thick sausage rather than a thin orbit line.)
	const ringTubeRadius = Math.max(orbitRadiusWorld * 0.012, 0.008)

	const ringMaterial = useMemo(
		() => createOrbitRingMaterial({ color: RING_COLOR, intensity: 1.0 }),
		[],
	)
	const ringGeometry = useMemo(
		() =>
			new TorusGeometry(
				orbitRadiusWorld,
				ringTubeRadius,
				RING_TUBE_SEGMENTS,
				RING_THETA_SEGMENTS,
			),
		[orbitRadiusWorld, ringTubeRadius],
	)
	useEffect(() => () => ringGeometry.dispose(), [ringGeometry])
	useEffect(() => () => ringMaterial.dispose(), [ringMaterial])

	// --- Center anchor (dim holographic sphere, no pulsing core) ---
	const centerMaterial = useMemo(
		() =>
			createHolographicMaterial({
				color: '#3a5a78',
				glitchStrength: 0.05,
				intensity: 0.6,
			}),
		[],
	)
	useEffect(() => () => centerMaterial.dispose(), [centerMaterial])

	return (
		<group>
			{/*
				Orbit-path ring — a glowing additive **torus** tracing the orbs'
				rotation. The orbs live in the XY play plane (camera looks down
				-Z), and `TorusGeometry` defaults to lying in the XY plane (its
				axis is +Z), so no rotation is needed: it faces the camera and
				the orbs straddle it. (`ringGeometry` is also native-XY, but a
				flat disc can't show 3D depth and always drew *over* the orbs
				because nothing occluded it.)

				The torus's main radius == `orbit.radius`, so the tube centerline
				runs exactly through the centers of the two orbs (localPosition =
				positionOnOrbit(angle, orbit.radius)).
			*/}
			<mesh position={center}>
				<primitive object={ringGeometry} attach="geometry" />
				<primitive object={ringMaterial} attach="material" />
			</mesh>

			{/* Orbit center anchor sphere */}
			<mesh position={center}>
				<sphereGeometry args={[centerRadius, 24, 16]} />
				<primitive object={centerMaterial} attach="material" />
			</mesh>

			{orbit.orbs.map((orb, index) => (
				<Orb
					key={orb.side}
					orb={orb}
					orbitCenter={orbit.center}
					resolution={resolution}
					phase={index === 0 ? 0 : Math.PI / 2}
				/>
			))}
		</group>
	)
}

type OrbProps = {
	readonly orb: OrbitState['orbs'][number]
	readonly orbitCenter: OrbitState['center']
	readonly resolution: GeneratorState['resolution']
	readonly phase: number
}

function Orb({ orb, orbitCenter, resolution, phase }: OrbProps) {
	const color = ORB_COLOR[orb.side]
	const orbRadius = toWorldSize(orb.radius)
	// z = 0.15 == orbit-ring z (the parent group's `center`). Putting the orb
	// body on exactly the same z as the ring means the thin ring tube passes
	// through the orb's CENTER (the orbs straddle the tube) instead of sitting
	// 0.3 units in front of it as the previous `z = 0.45` did. With
	// `depthWrite = true` on the orb sphere the back half of the tube is
	// occluded by the orb body; the front half draws over the orb body.
	const position = toWorldPosition(
		{
			x: orbitCenter.x + orb.localPosition.x,
			y: orbitCenter.y + orb.localPosition.y,
		},
		resolution,
		0.15,
	)

	// Materials created once per orb and disposed on unmount.
	// `glitchStrength` 0.14 was tuned by eye: orbs are ~0.3 world units in
	// radius, so the reference's 0.25 world-space jitter would displace vertices
	// by ~40% of the radius and the silhouette would visibly explode. 0.14
	// keeps ~22% displacement — enough for a clearly visible energy shimmer
	// across the surface without the orb losing its read.
	// `intensity = 1.6` makes the orb body read as a bright energy sphere
	// (not just a thin fresnel rim) so it stays clearly the brightest gameplay
	// object on screen. Orb spawns at the same z as the orbit ring so the thin
	// ring tube passes exactly through the orb's center (the orbs straddle
	// the tube and depthWrite sorts the back half behind the orb body).
	const sphereMaterial = useMemo(
		() =>
			createHolographicMaterial({
				color,
				glitchStrength: 0.14,
				intensity: 1.6,
				depthWrite: true,
			}),
		[color],
	)
	const coreMaterial = useMemo(
		() => createPulsingCoreMaterial({ color: whiteTint(color), phase }),
		[color, phase],
	)
	const discMaterial = useMemo(() => createBackDiscMaterial({ color }), [color])
	useEffect(
		() => () => {
			sphereMaterial.dispose()
			coreMaterial.dispose()
			discMaterial.dispose()
		},
		[sphereMaterial, coreMaterial, discMaterial],
	)

	const sphereRef = useRef<Mesh>(null)
	const discRef = useRef<Mesh>(null)
	// The visible holographic sphere silhouette is a touch larger than its
	// base radius because of additive fresnel glow; size the halo to clearly
	// envelope it (≈2.4× base radius) without overpowering the orb identity.
	const discScale = orbRadius * 2.4
	const coreZ = 0.02 // tiny offset so additive core sits over sphere

	useFrame((state) => {
		// Spin the orb body on TWO axes — like the reference demo's sphere
		// (`rotation.x = -t * 0.1; rotation.y = t * 0.2`). The `x` axis spin is
		// critical: our scanlines are along `positionWorld.y`, so a `y`-only
		// spin leaves the stripes pinned to the silhouette (rotation around y
		// doesn't change any vertex's world y) and the orb looks static.
		// Spinning around `x` sweeps each vertex's world y → the scanlines
		// cascade across the silhouette as it tilts, giving the wavy/lively
		// "hologram rotating" read from the reference. Speeds are in rad/s
		// (clock.getDelta is seconds), much snappier than the previous
		// `0.3 * delta` = 0.05 rev/s; matches the reference's ~0.2-0.3 rad/s.
		const dt = state.clock.getDelta()
		if (sphereRef.current) {
			sphereRef.current.rotation.x -= 1.2 * dt
			sphereRef.current.rotation.y += 2.0 * dt
		}
		// Billboard the halo plane to face the camera.
		if (discRef.current) {
			discRef.current.quaternion.copy(state.camera.quaternion)
		}
	})

	return (
		<group position={position}>
			{/* Back-disc halo (behind the sphere) */}
			<mesh ref={discRef} position={[0, 0, -coreZ * 2]} scale={discScale}>
				<planeGeometry args={[1, 1]} />
				<primitive object={discMaterial} attach="material" />
			</mesh>

			{/*
				Holographic sphere. `depthWrite=true` so the orb occludes the
				half of the orbit torus that lies behind it (the orbs straddle
				the torus centerline; without writing depth the ring drew over
				the orb). The pulsing core + back-disc stay `depthWrite:false`
				so they glow through as additive overlays.
			*/}
			<mesh ref={sphereRef}>
				<sphereGeometry args={[orbRadius, 32, 18]} />
				<primitive object={sphereMaterial} attach="material" />
			</mesh>

			{/*
				Pulsing core — a smaller bright additive sphere at the orb
				center whose brightness pulses. Kept small (~0.2× orb radius,
				down from 0.35×) so it reads as a tight hotspot, not a second
				orb-diameter ball beating over the identity body.
			*/}
			<mesh position={[0, 0, coreZ]}>
				<sphereGeometry args={[orbRadius * 0.2, 16, 12]} />
				<primitive object={coreMaterial} attach="material" />
			</mesh>
		</group>
	)
}

// --- helpers --------------------------------------------------------------

const _whiteVec = new Color('#ffffff')

function whiteTint(base: string): Color {
	// Lerp the orb identity color toward white by ~0.5 for the bright core.
	return new Color(base).lerp(_whiteVec, 0.5)
}
