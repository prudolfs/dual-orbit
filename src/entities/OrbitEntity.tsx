import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import type { Mesh } from 'three'
import { Color, RingGeometry } from 'three'
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

const RING_THETA_SEGMENTS = 128

type OrbitEntityProps = {
	readonly orbit: OrbitState
	readonly resolution: GeneratorState['resolution']
}

export function OrbitEntity({ orbit, resolution }: OrbitEntityProps) {
	const center = toWorldPosition(orbit.center, resolution, 0.15)
	const centerRadius = toWorldSize(14)

	// Orbit-path ring: a thin `ringGeometry` trace along the orbs' rotation
	// circle. Recreated when the live `orbit.radius` changes (only on
	// progression, not every frame — cheap).
	const orbitRadiusWorld = toWorldSize(orbit.radius)
	const ringThickness = Math.max(orbitRadiusWorld * 0.02, 0.01)

	const ringMaterial = useMemo(() => createOrbitRingMaterial(RING_COLOR), [])
	const ringGeometry = useMemo(() => {
		const g = new RingGeometry(
			orbitRadiusWorld - ringThickness,
			orbitRadiusWorld + ringThickness,
			RING_THETA_SEGMENTS,
		)
		return g
	}, [orbitRadiusWorld, ringThickness])
	useEffect(() => () => ringGeometry.dispose(), [ringGeometry])
	useEffect(() => () => ringMaterial.dispose(), [ringMaterial])

	// --- Center anchor (dim holographic sphere, no pulsing core) ---
	const centerMaterial = useMemo(
		() =>
			createHolographicMaterial({
				color: '#3a5a78',
				glitchStrength: 0.05,
			}),
		[],
	)
	useEffect(() => () => centerMaterial.dispose(), [centerMaterial])

	return (
		<group>
			{/* Orbit-path ring — bright additive line tracing the orb rotation */}
			<mesh position={center} rotation={[-Math.PI / 2, 0, 0]}>
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
	const position = toWorldPosition(
		{
			x: orbitCenter.x + orb.localPosition.x,
			y: orbitCenter.y + orb.localPosition.y,
		},
		resolution,
		0.45,
	)

	// Materials created once per orb and disposed on unmount.
	const sphereMaterial = useMemo(
		() => createHolographicMaterial({ color, glitchStrength: 0.25 }),
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
	const discScale = orbRadius * 1.8 // slightly larger than the orb
	const coreZ = 0.01 // tiny offset so additive core sits over sphere

	useFrame((state) => {
		if (sphereRef.current) {
			sphereRef.current.rotation.y += 0.3 * state.clock.getDelta()
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

			{/* Holographic sphere */}
			<mesh ref={sphereRef}>
				<sphereGeometry args={[orbRadius, 32, 18]} />
				<primitive object={sphereMaterial} attach="material" />
			</mesh>

			{/* Pulsing core (bright additive hotspot) */}
			<mesh position={[0, 0, coreZ]}>
				<sphereGeometry args={[orbRadius * 0.35, 16, 12]} />
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
