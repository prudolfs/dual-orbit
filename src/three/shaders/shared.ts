import { uniform } from 'three/tsl'

/**
 * Global animation clock shared by every TSL material in the scene.
 *
 * A single `<ShaderClock>` component (placed once in the scene) bumps
 * `time.value` each frame via `useFrame`. Every material that references this
 * same uniform animates for free — no per-material ref juggling, no registry.
 *
 * See docs/visual-redesign.md Step 0.
 */
export const time = uniform(0)
