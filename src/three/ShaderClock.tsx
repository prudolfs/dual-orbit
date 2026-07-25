import { useFrame } from '@react-three/fiber'
import { time } from './shaders/shared'

/**
 * Advances the shared global `time` uniform once per frame.
 *
 * Place a single `<ShaderClock />` in the scene. Every TSL material that
 * references `time` (holographic orbs/obstacles, galaxy background) animates
 * for free. See docs/visual-redesign.md Step 0.
 */
export function ShaderClock() {
	useFrame((_, delta) => {
		time.value += Math.min(delta, 0.1) // clamp to avoid huge jumps on tab refocus
	})
	return null
}
