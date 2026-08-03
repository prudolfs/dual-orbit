import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import type { Mesh } from 'three'
import { RingGeometry } from 'three'
import type { GeneratorState, OrbitState } from '../game/types'
import { toWorldPosition, toWorldSize } from '../scene/coordinates'
import { createBackDiscMaterial } from '../three/materials/energy'
import { createHolographicMaterial } from '../three/materials/holographic'

/**
 * Orb identity palette — explicitly red/blue. Single source of truth so the
 * HUD accent system (docs Step 6b) can mirror it.
 */
const ORB_COLOR = {
	left: '#d84f3f',
	right: '#2f6fd8',
} as const

// Ring reads as a holographic energy band — same shader language as the
// orbs & obstacles. Gold-yellow (inspired by the target reference's
// accent) so the orbit track reads as a warm energy band.
const RING_COLOR = '#ffce4d'

// Dense theta (around the circle) + a few radial segments so the holographic
// vertex-glitch ripples along the band instead of snapping per-corner. A
// bare 1-segment ring has no verts on the tube to displace into a smooth
// warp; a few phi segments give the glitch geometry to work with.
const RING_THETA_SEGMENTS = 220
const RING_PHI_SEGMENTS = 4

type OrbitEntityProps = {
	readonly orbit: OrbitState
	readonly resolution: GeneratorState['resolution']
}

export function OrbitEntity({ orbit, resolution }: OrbitEntityProps) {
	const center = toWorldPosition(orbit.center, resolution, 0.15)
	const centerRadius = toWorldSize(14)

	// Orbit-path ring: a thin flat **annulus** (`ringGeometry`) in the orbs'
	// XY play plane. The ring's inner radius == `orbit.radius` minus a thin
	// tube and outer == plus a thin tube, so the ring's centerline traces the
	// circle the two orbs travel along. Rebuilt when the live `orbit.radius`
	// changes (only on progression).
	const orbitRadiusWorld = toWorldSize(orbit.radius)
	// Thin stroke: ~1.5% of orbit radius as the annulus width, split evenly
	// each side of the `orbit.radius` circle. Floor at 0.012 so even tiny
	// orbits keep a renderable line.
	const ringStroke = Math.max(orbitRadiusWorld * 0.015, 0.012)
	const ringInner = orbitRadiusWorld - ringStroke
	const ringOuter = orbitRadiusWorld + ringStroke

	// Holographic ring — uses the SAME holographic material as orbs/obstacles
	// (fresnel rim + scrolling scanlines) so the orbit track reads as part of
	// the hologram energy language. TRUE hologram look: bright fresnel band at
	// the inner & outer edges of the annulus, translucent body in between —
	// NOT a solid stripe-filled band. `baseFill` is low (faint scroll band)
	// and `intensity` moderate so the body doesn't read as a solid panel.
	const ringMaterial = useMemo(
		() =>
			createHolographicMaterial({
				color: RING_COLOR,
				glitchStrength: 0.05,
				intensity: 1.0,
				baseFill: 0.2,
				stripeFrequency: 40,
			}),
		[],
	)
	const ringGeometry = useMemo(
		() =>
			new RingGeometry(
				ringInner,
				ringOuter,
				RING_THETA_SEGMENTS,
				RING_PHI_SEGMENTS,
			),
		[ringInner, ringOuter],
	)
	useEffect(() => () => ringGeometry.dispose(), [ringGeometry])
	useEffect(() => () => ringMaterial.dispose(), [ringMaterial])

	// --- Center anchor (dim holographic sphere shell, no pulsing core) —
	// gold-yellow to match the ring/accent identity. `baseFill: 0` so it's
	// a true fresnel rim shell (bright edge, transparent middle) matching
	// the orb hologram look, not a solid bead.
	const centerMaterial = useMemo(
		() =>
			createHolographicMaterial({
				color: '#ffce4d',
				glitchStrength: 0.05,
				intensity: 0.9,
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
				`RingGeometry` is native-XY so no rotation is needed.
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
	const color = ORB_COLOR[orb.side]
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

	// Holographic shell. `intensity = 2.4` makes the fresnel rim band read as
	// a bright energy sphere (the reference demo's signature look — a crisp
	// bright silhouette band on a dim body). `glitchStrength 0.14` keeps
	// ~22% displacement on the ~0.3-unit-radius sphere — visible energy
	// shimmer without the silhouette exploding. `depthWrite=false` (default)
	// because the orb is now a translucent additive shell; it doesn't need
	// to occlude, and writing depth caused it to shield the additive ring
	// behind it.
	const sphereMaterial = useMemo(
		() =>
			createHolographicMaterial({
				color,
				glitchStrength: 0.14,
				intensity: 2.4,
				stripeFrequency: 28,
			}),
		[color],
	)
	// Pulsing core — a SMALL (~0.3× orb radius) holographic shell, the SAME
	// holographic look as the orb itself (fresnel rim + stripes + glitch),
	// using the orb's own identity color (not tinted white — the core must
	// read as the same energy as the orb, just tighter and *pulsing*). No
	// `baseFill`: like the orb shell it's a pure fresnel shell so it shows
	// the same hologram band. The `pulse` option modulates the whole
	// holographic field (0.4..1.0) at its own speed/phase, making the core
	// visibly beat, out of sync with the static shell.
	const coreMaterial = useMemo(
		() =>
			createHolographicMaterial({
				color,
				glitchStrength: 0.08,
				intensity: 2.0,
				stripeFrequency: 40,
				pulse: { speed: 1.8, phase, floor: 0.5, amp: 0.5 },
			}),
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
	const coreRef = useRef<Mesh>(null)
	const discRef = useRef<Mesh>(null)
	// Halo envelope (~2.6× orb radius) so it clearly surrounds the additive
	// fresnel glow without overpowering the orb identity color.
	const discScale = orbRadius * 2.8
	const coreZ = 0.02 // tiny offset so additive core sits in front of sphere
	// Core is smaller (~0.3× orb radius) than the shell — a tight bright
	// hologram bead rather than a fat second sphere.
	const coreRadius = orbRadius * 0.3

	useFrame((state) => {
		const dt = state.clock.getDelta()
		// Spin the orb SHELL on two axes — `x` sweeps each vertex's world y so
		// the scanlines cascade across the silhouette as the sphere tilts
		// (y-only spin would leave stripes pinned to the silhouette).
		if (sphereRef.current) {
			sphereRef.current.rotation.x -= 1.2 * dt
			sphereRef.current.rotation.y += 2.0 * dt
		}
		// Spin the CORE in the OPPOSITE direction to the shell so the two
		// hologram fields counter-rotate — the core reads as a distinct
		// ticking energy bead inside the shell, not a mini-echo of it.
		if (coreRef.current) {
			coreRef.current.rotation.x += 1.6 * dt
			coreRef.current.rotation.y -= 2.4 * dt
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
				<sphereGeometry args={[orbRadius, 32, 18]} />
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
				<sphereGeometry args={[coreRadius, 20, 14]} />
				<primitive object={coreMaterial} attach="material" />
			</mesh>
		</group>
	)
}

// --- helpers --------------------------------------------------------------
