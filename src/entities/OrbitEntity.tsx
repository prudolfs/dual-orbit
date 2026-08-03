import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import type { Mesh } from 'three'
import { TorusGeometry } from 'three'
import type { GeneratorState, OrbitState } from '../game/types'
import { toWorldPosition, toWorldSize } from '../scene/coordinates'
import { createBackDiscMaterial } from '../three/materials/energy'
import {
	CENTER,
	ORB_COLORS,
	ORB_CORE,
	ORB_CORE_GEOMETRY,
	ORB_HALO,
	ORB_SHELL,
	RING,
} from '../three/materials/holo-theme'
import { createHolographicMaterial } from '../three/materials/holographic'

/**
 * Orb identity palette — explicitly red/blue, from the shared `holo-theme`
 * `ORB_COLORS` so the HUD accent system and `?holodebug=orbit` stay in sync.
 */

// Ring reads as a holographic energy band — same shader language as the
// orbs & obstacles. Gold-yellow (inspired by the target reference's
// accent) so the orbit track reads as a warm energy band.
const RING_COLOR = RING.color

type OrbitEntityProps = {
	readonly orbit: OrbitState
	readonly resolution: GeneratorState['resolution']
}

export function OrbitEntity({ orbit, resolution }: OrbitEntityProps) {
	const center = toWorldPosition(orbit.center, resolution, 0.15)
	const centerRadius = toWorldSize(CENTER.radius)

	// Orbit-path ring: a **torus** (`TorusGeometry`) in the orbs' XY play
	// plane — a real 3D donut with depth/volume (NOT the flat annulus we used
	// to use), matching the `?holodebug=orbit` debug scene 1:1. Rebuilt only
	// when the live `orbit.radius` changes (on progression). Material consts
	// come from the shared `RING` theme; segment counts come from
	// `RING.tubularSegments` / `RING.radialSegments`.
	const orbitRadiusWorld = toWorldSize(orbit.radius)
	// Tube radius: ~`RING.tubeRatio` of the orbit radius, floored at
	// `RING.tubeFloor` so even tiny orbits keep a renderable tube.
	const ringTube = Math.max(orbitRadiusWorld * RING.tubeRatio, RING.tubeFloor)

	// Holographic ring — uses the SAME holographic material as orbs/obstacles
	// (fresnel rim + scrolling scanlines) so the orbit track reads as part of
	// the hologram energy language. TRUE hologram look: bright fresnel band at
	// the silhouette of the torus tube, translucent body — NOT a solid band.
	// `baseFill` is low (faint scroll band) and `intensity` high so the band
	// reads crisp + bright against the dark violet backdrop.
	const ringMaterial = useMemo(
		() =>
			createHolographicMaterial({
				color: RING_COLOR,
				glitchStrength: RING.glitchStrength,
				intensity: RING.intensity,
				baseFill: RING.baseFill,
				stripeFrequency: RING.stripeFrequency,
			}),
		[],
	)
	const ringGeometry = useMemo(
		() =>
			new TorusGeometry(
				orbitRadiusWorld,
				ringTube,
				RING.radialSegments,
				RING.tubularSegments,
			),
		[orbitRadiusWorld, ringTube],
	)
	useEffect(() => () => ringGeometry.dispose(), [ringGeometry])
	useEffect(() => () => ringMaterial.dispose(), [ringMaterial])

	// --- Center anchor (dim holographic sphere shell, no pulsing core) —
	// gold-yellow to match the ring/accent identity. `baseFill` defaults to 0
	// so it's a true fresnel rim shell (bright edge, transparent middle)
	// matching the orb hologram look, not a solid bead.
	const centerMaterial = useMemo(
		() =>
			createHolographicMaterial({
				color: CENTER.color,
				glitchStrength: CENTER.glitchStrength,
				intensity: CENTER.intensity,
			}),
		[],
	)
	useEffect(() => () => centerMaterial.dispose(), [centerMaterial])

	return (
		<group>
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

			{/*
				Orbit-path ring — a holographic energy band (same shader as
				orbs/obstacles) tracing the orbs' rotation. Rendered LAST in this
				group on purpose: both the ring and orb materials are additive with
				`depthWrite:false`, so the ring's holographic glow (scanlines +
				fresnel + glitch) paints over the orb bodies/cores at the two
				points where the orbit path crosses each orb — the ring visibly
				"passes through" the orbs rather than hiding behind them.
				`TorusGeometry` lies in the XY plane by default (its tube sweeps around
				Y) so no rotation is needed — same orientation as the old annulus.
			*/}
			<mesh position={center}>
				<primitive object={ringGeometry} attach="geometry" />
				<primitive object={ringMaterial} attach="material" />
			</mesh>
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
	const color = ORB_COLORS[orb.side]
	const orbRadius = toWorldSize(orb.radius)
	// z = 0.15 == orbit-ring z (the parent group's `center`). The orbs sit in
	// the same XY plane as the ring. Because the ring is an additive overlay
	// with depthTest off, the orbs (drawn after it) composited additively on
	// top — no z-fighting, no hard occlusion.
	const position = toWorldPosition(
		{
			x: orbitCenter.x + orb.localPosition.x,
			y: orbitCenter.y + orb.localPosition.y,
		},
		resolution,
		0.15,
	)

	// Holographic shell — params from the shared `ORB_SHELL` theme so the
	// `?holodebug=orbit` scene matches 1:1. `depthWrite=false` (default):
	// the orb is a translucent additive shell; writing depth shielded the
	// additive ring behind it.
	const sphereMaterial = useMemo(
		() =>
			createHolographicMaterial({
				color,
				glitchStrength: ORB_SHELL.glitchStrength,
				intensity: ORB_SHELL.intensity,
				stripeFrequency: ORB_SHELL.stripeFrequency,
			}),
		[color],
	)
	// Pulsing core — small (~`ORB_CORE.radiusRatio`× orb radius) holographic
	// shell, same shader as the orb. Per-orb `phase` (π/2 offset between
	// left/right) makes the two cores beat out of sync. Params (incl. pulse
	// speed/floor/amp) live in the shared `ORB_CORE` theme.
	const coreMaterial = useMemo(
		() =>
			createHolographicMaterial({
				color,
				glitchStrength: ORB_CORE.glitchStrength,
				intensity: ORB_CORE.intensity,
				stripeFrequency: ORB_CORE.stripeFrequency,
				pulse: {
					speed: ORB_CORE.pulse.speed,
					phase,
					floor: ORB_CORE.pulse.floor,
					amp: ORB_CORE.pulse.amp,
				},
			}),
		[color, phase],
	)
	const discMaterial = useMemo(
		() => createBackDiscMaterial({ color, intensity: ORB_HALO.intensity }),
		[color],
	)
	useEffect(
		() => () => {
			sphereMaterial.dispose()
			coreMaterial.dispose()
			discMaterial.dispose()
		},
		[sphereMaterial, coreMaterial, discMaterial],
	)

	const sphereRef = useRef<Mesh>(null)
	const coreRef = useRef<Mesh>(null)
	const discRef = useRef<Mesh>(null)
	// Halo envelope (`ORB_HALO.scaleRatio`× orb radius) so it clearly
	// surrounds the additive fresnel glow without overpowering the orb
	// identity color.
	const discScale = orbRadius * ORB_HALO.scaleRatio
	const coreZ = 0.02 // tiny offset so additive core sits in front of sphere
	// Core is smaller (`ORB_CORE.radiusRatio`× orb radius) than the shell — a
	// tight bright hologram bead rather than a fat second sphere.
	const coreRadius = orbRadius * ORB_CORE.radiusRatio

	useFrame((state) => {
		const dt = state.clock.getDelta()
		// Spin the orb SHELL on two axes — `x` sweeps each vertex's world y so
		// the scanlines cascade across the silhouette as the sphere tilts
		// (y-only spin would leave stripes pinned to the silhouette).
		if (sphereRef.current) {
			sphereRef.current.rotation.x += ORB_SHELL.spinX * dt
			sphereRef.current.rotation.y += ORB_SHELL.spinY * dt
		}
		// Spin the CORE in the OPPOSITE direction to the shell so the two
		// hologram fields counter-rotate — the core reads as a distinct
		// ticking energy bead inside the shell, not a mini-echo of it.
		if (coreRef.current) {
			coreRef.current.rotation.x += ORB_CORE.spinX * dt
			coreRef.current.rotation.y += ORB_CORE.spinY * dt
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
				Holographic sphere (additive shell). With `depthWrite=false` it
				glows through the ring; the pulsing core + back-disc stay
				additive overlays on top.
			*/}
			<mesh ref={sphereRef}>
				<sphereGeometry
					args={[orbRadius, ORB_SHELL.widthSegments, ORB_SHELL.heightSegments]}
				/>
				<primitive object={sphereMaterial} attach="material" />
			</mesh>

			{/*
				Pulsing holographic core — a small (~0.3× orb radius) bright
				energy bead at the orb center. Shares the holographic shader
				(fresnel + stripes + glitch + pulse) so it reads as part of the
				same energy language but tighter and brighter, and counter-spins
				vs the shell.
			*/}
			<mesh ref={coreRef} position={[0, 0, coreZ]}>
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

// --- helpers --------------------------------------------------------------
