import { ObstacleEntity } from '../entities/ObstacleEntity'
import { OrbitEntity } from '../entities/OrbitEntity'
import type { SimulationState } from '../game/types'
import { ShaderClock } from '../three/ShaderClock'
import { CameraController } from './CameraController'
import { GalaxyBackground } from './GalaxyBackground'

type GameSceneProps = {
	readonly simulation: SimulationState
}

export function GameScene({ simulation }: GameSceneProps) {
	return (
		<>
			{/* Dark backdrop so additive holographic/energy layers read. */}
			{/* No lights: every gameplay mesh is a `MeshBasicNodeMaterial`
			    (holographic/energy) which ignores lighting entirely. The
			    scene is fully emissive/additive against this dark clear color. */}
			<color attach="background" args={['#05060d']} />
			<ShaderClock />
			{/*
				`CameraController` is mounted BEFORE `<GalaxyBackground />` on
				purpose: R3F runs same-priority `useFrame` subscribers in mount
				order, and the galaxy copies `state.camera` each frame to billboard
				+ follow. If it ran before the camera update it would read a
				one-frame-stale camera (position + quaternion) → on scroll the
				camera pitches to track the orbit center and the stale billboard
				orientation mis-aligns by one frame, reading as a visible
				"jump/glitch". Mounting the camera first keeps the galaxy in sync.
			*/}
			<CameraController simulation={simulation} />
			{/* Animated galaxy point cloud — locked behind the play field, additive
			    so it never occludes orbs/obstacles. Rendered before the gameplay
			    group so its transparent additive points sort correctly behind. */}
			<GalaxyBackground />
			<group>
				{simulation.obstacles.map((obstacle) => (
					<ObstacleEntity
						key={obstacle.id}
						obstacle={obstacle}
						resolution={simulation.generator.resolution}
					/>
				))}
				<OrbitEntity
					orbit={simulation.orbit}
					resolution={simulation.generator.resolution}
				/>
			</group>
		</>
	)
}
