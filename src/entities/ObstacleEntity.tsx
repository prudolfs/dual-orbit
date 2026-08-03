import { useEffect, useMemo } from 'react'
import type { GeneratorState, ObstacleState } from '../game/types'
import type { ObstacleKind } from '../game/types/obstacle'
import { toWorldPosition, toWorldSize } from '../scene/coordinates'
import { OBSTACLE } from '../three/materials/holo-theme'
import { createHolographicMaterial } from '../three/materials/holographic'

type ObstacleEntityProps = {
	readonly obstacle: ObstacleState
	readonly resolution: GeneratorState['resolution']
}

/**
 * Holographic obstacle (see docs/visual-redesign.md Step 3).
 *
 * Each obstacle is a `boxGeometry` rendered with the shared holographic
 * node material. The hologram reads as a sharp-edged energy cube: a bright
 * fresnel rim band at the silhouette + scrolling scanline bands across the
 * faces. There is NO vertex displacement (no jelly warp) — the obstacle keeps
 * a crisp cuboid silhouette so collisions read precisely; the hologram is
 * purely a surface treatment.
 */
export function ObstacleEntity({ obstacle, resolution }: ObstacleEntityProps) {
	const visible = obstacle.exists && obstacle.alive

	const position = toWorldPosition(obstacle.position, resolution, 0)
	const width = toWorldSize(obstacle.width)
	const height = toWorldSize(obstacle.height)
	const depth = obstacle.kind === 'angular_long' ? 0.28 : 0.38
	const color = getObstacleColor(obstacle)
	const intensity = getObstacleIntensity(obstacle)

	// High subdivisions so each face carries many vertices → the holographic
	// fragment terms (fresnel + world-Y scanlines) evaluate on a fine grid
	// and the rim band + scanlines read as crisp smooth bands instead of
	// stair-stepped across 2 triangles per face. No vertex displacement here;
	// the density is purely so the per-fragment hologram samples smoothly.
	const segW = Math.max(16, Math.round(width * 10))
	const segH = Math.max(16, Math.round(height * 12))
	const segD = obstacle.kind === 'angular_long' ? 8 : 12

	// One material per obstacle instance so its `intensity`/`color` uniforms
	// are independent. Disposed on unmount. `depthWrite` stays at the default
	// `false` so the orb spheres + orbit ring draw on top of obstacles
	// (obstacles must never visually cover the orbs / ring — readability).
	//
	// Hooks run unconditionally (Rules of Hooks): even when the obstacle is
	// not visible we keep the material in memory so a flip back to `alive`
	// doesn't recreate it. The mesh simply isn't mounted when `!visible`.
	// `baseFill` gives obstacle box faces a view-independent scrolling
	// scanline body (the pure-fresnel reference is transparent at face-on,
	// so a flat front facing the camera would render as nothing but a thin
	// rim). Differentiated per kind so the more dangerous obstacles read as
	// denser energy panels; colliding obstacles get the strongest fill so
	// the collision highlight reads across the whole frame, not just the
	// rim band.
	// `glitchStrength: 0` disables the vertex displacement (no jelly warp) —
	// the box keeps a crisp cuboid silhouette; only the surface is holographic.
	const baseFill = getObstacleBaseFill(obstacle)
	const stripeFrequency = getObstacleStripeFrequency(obstacle)

	const material = useMemo(
		() =>
			createHolographicMaterial({
				color,
				// Light but visible glitch so obstacle cubes shimmer like the
				// reference hologram (energy ripple on the surface), without
				// destroying the crisp cuboid silhouette collisions read from.
				// Value comes from the shared `OBSTACLE` theme so the
				// `?holodebug=obstacle` debug scene stays in sync.
				glitchStrength: OBSTACLE.glitchStrength,
				intensity,
				baseFill,
				stripeFrequency,
			}),
		[color, intensity, baseFill, stripeFrequency],
	)
	useEffect(() => () => material.dispose(), [material])

	if (!visible) {
		return null
	}

	return (
		<mesh position={position} rotation={[0, 0, -obstacle.rotation]}>
			<boxGeometry args={[width, height, depth, segW, segH, segD]} />
			<primitive object={material} attach="material" />
		</mesh>
	)
}

// --- per-kind palette + glitch --------------------------------------------

/**
 * Per-kind color feeding the holographic (additive) material. Values come
 * from the shared `OBSTACLE` theme (`holo-theme.ts`, the SINGLE source of
 * truth shared with `?holodebug=obstacle`), so tuning the debug scene stays
 * in sync with the game. Additive blending contributes
 * `color.rgb * holographic_alpha`; the alpha is a thin fresnel *band*, so a
 * box face is mostly invisible except its angled rim band. To make that band
 * read against the dark violet backdrop, colors are kept bright/saturated
 * (mirroring the reference demo's bright `#70c1ff`).
 */
function getObstacleColor(obstacle: ObstacleState): string {
	if (obstacle.collidingOrbSides.length > 0) {
		return OBSTACLE.collision.color
	}
	return OBSTACLE.byKind[obstacle.kind as ObstacleKind].color
}

/** Per-kind brightness — see `OBSTACLE.byKind.<kind>.intensity`. */
function getObstacleIntensity(obstacle: ObstacleState): number {
	if (obstacle.collidingOrbSides.length > 0) {
		return OBSTACLE.collision.intensity
	}
	return OBSTACLE.byKind[obstacle.kind as ObstacleKind].intensity
}

/** Per-kind scanline body fill — see `OBSTACLE.byKind.<kind>.baseFill`. */
function getObstacleBaseFill(obstacle: ObstacleState): number {
	if (obstacle.collidingOrbSides.length > 0) {
		return OBSTACLE.collision.baseFill
	}
	return OBSTACLE.byKind[obstacle.kind as ObstacleKind].baseFill
}

/** Per-kind scanline frequency — see `OBSTACLE.byKind.<kind>.stripeFrequency`. */
function getObstacleStripeFrequency(obstacle: ObstacleState): number {
	if (obstacle.collidingOrbSides.length > 0) {
		return OBSTACLE.collision.stripeFrequency
	}
	return OBSTACLE.byKind[obstacle.kind as ObstacleKind].stripeFrequency
}
