import { useFrame, useThree } from '@react-three/fiber'
import { Vector3 } from 'three'
import type { SimulationState } from '../game/types'
import { toWorldPosition } from './coordinates'

type CameraControllerProps = {
	readonly simulation: SimulationState
}

const cameraTarget = new Vector3()
const lookTarget = new Vector3()

export function CameraController({ simulation }: CameraControllerProps) {
	const camera = useThree((state) => state.camera)

	useFrame(() => {
		const [x, y] = toWorldPosition(
			simulation.orbit.center,
			simulation.generator.resolution,
		)
		cameraTarget.set(x, y + 2.2, 12)
		lookTarget.set(x, y + 1.2, 0)
		camera.position.lerp(cameraTarget, 0.08)
		camera.lookAt(lookTarget)
	})

	return null
}
