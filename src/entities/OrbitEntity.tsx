import type { GeneratorState, OrbitState } from '../game/types'
import { toWorldPosition, toWorldSize } from '../scene/coordinates'

type OrbitEntityProps = {
	readonly orbit: OrbitState
	readonly resolution: GeneratorState['resolution']
}

export function OrbitEntity({ orbit, resolution }: OrbitEntityProps) {
	const center = toWorldPosition(orbit.center, resolution, 0.15)
	const centerRadius = toWorldSize(14)

	return (
		<group>
			<mesh position={center}>
				<sphereGeometry args={[centerRadius, 24, 16]} />
				<meshStandardMaterial color="#243044" roughness={0.45} />
			</mesh>
			{orbit.orbs.map((orb) => {
				const position = toWorldPosition(
					{
						x: orbit.center.x + orb.localPosition.x,
						y: orbit.center.y + orb.localPosition.y,
					},
					resolution,
					0.45,
				)

				return (
					<mesh key={orb.side} position={position}>
						<sphereGeometry args={[toWorldSize(orb.radius), 32, 18]} />
						<meshStandardMaterial
							color={orb.side === 'left' ? '#d84f3f' : '#2f8f83'}
							roughness={0.38}
						/>
					</mesh>
				)
			})}
		</group>
	)
}
