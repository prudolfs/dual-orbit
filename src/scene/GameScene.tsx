import { ObstacleEntity } from '../entities/ObstacleEntity'
import { OrbitEntity } from '../entities/OrbitEntity'
import type { SimulationState } from '../game/types'
import { CameraController } from './CameraController'

type GameSceneProps = {
	readonly simulation: SimulationState
}

export function GameScene({ simulation }: GameSceneProps) {
	return (
		<>
			<color attach="background" args={['#f6f7f2']} />
			<ambientLight intensity={0.8} />
			<directionalLight position={[3, 6, 8]} intensity={1.4} />
			<directionalLight position={[-5, 2, 5]} intensity={0.5} />
			<CameraController simulation={simulation} />
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
