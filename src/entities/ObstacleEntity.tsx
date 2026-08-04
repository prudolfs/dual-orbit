import { RoundedBoxGeometry } from '@react-three/drei'
import { useEffect, useMemo } from 'react'
import type { GeneratorState, ObstacleState } from '../game/types'
import type { ObstacleKind } from '../game/types/obstacle'
import { toWorldPosition, toWorldSize } from '../scene/coordinates'
import {
	hashStringToUint32,
	OBSTACLE,
	OBSTACLE_BEVEL,
} from '../three/materials/holo-theme'
import { createHolographicMaterial } from '../three/materials/holographic'

type ObstacleEntityProps = {
	readonly obstacle: ObstacleState
	readonly resolution: GeneratorState['resolution']
}

/**
 * Holographic obstacle (see docs/visual-redesign.md Step 3).
 *
 * Each obstacle is a **beveled** (`RoundedBoxGeometry`) box rendered with the
 * shared holographic node material. The beveled edges + vertex-glitch
 * displacement together read as a glitchy energy **orb-cube hybrid** rather
 * than a flat sharp cube: light jitter warps the rounded rim band so the
 * silhouette shimmers orb-like, while the cuboid body keeps collisions
 * readable. Per-kind BRIGHT colors (sampled from `.temp/colors.png`) give
 * each obstacle kind its own hue so the field reads as a colorful rainbow.
 *
 * `RoundedBoxGeometry` is drei's wrapper over `ExtrudeGeometry` +
 * `toCreasedNormals` (preserves per-vertex normals → the holographic fresnel
 * reads smoothly across the rounded corners, not faceted). The bevel radius
 * is a fraction of the obstacle's SMALLEST dimension (floored) so a long
 * `angular_long` bar bevels proportionally and a tiny static obstacle still
 * shows a bevel.
 */
export function ObstacleEntity({ obstacle, resolution }: ObstacleEntityProps) {
	const visible = obstacle.exists && obstacle.alive

	const position = toWorldPosition(obstacle.position, resolution, 0)
	const width = toWorldSize(obstacle.width)
	const height = toWorldSize(obstacle.height)
	const depth = obstacle.kind === 'angular_long' ? 0.28 : 0.38
	const color = getObstacleColor(obstacle)
	const intensity = getObstacleIntensity(obstacle)

	// Bevel radius = the shared TUNED ABSOLUTE world radius (the value
	// dialed in `?holodebug=obstacle`'s lil-gui `Bevel` folder and copied
	// back into `OBSTACLE_BEVEL.radius`). Using an absolute radius — not a
	// per-size ratio — makes every game obstacle carry the SAME beveled
	// orb-like silhouette as the debug-default box, so the in-game look
	// matches `?holodebug=obstacle` 1:1. RoundedBoxGeometry clamps the
	// radius to half the smallest side internally, so a very thin
	// `angular_long` bar just bevels as much as geometry allows.
	const bevelRadius = OBSTACLE_BEVEL.radius

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
	const baseFill = getObstacleBaseFill(obstacle)
	const stripeFrequency = getObstacleStripeFrequency(obstacle)

	const material = useMemo(
		() =>
			createHolographicMaterial({
				color,
				// Light but visible glitch so obstacle beveled cubes shimmer /
				// wobble like glitchy energy orbs instead of crisp dead cubes.
				// Vertex displacement nudges in local XZ, jittering the rounded
				// rim band — combined with the beveled silhouette this reads
				// orb-like. Value comes from the shared `OBSTACLE` theme so the
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
			{/*
				Beveled (rounded-edge) cube — drei's `RoundedBoxGeometry` wraps
				`ExtrudeGeometry` + `toCreasedNormals`, preserving per-vertex
				normals so the holographic fresnel reads smoothly across the
				rounded corners. `bevelSegments`/`smoothness` (corner arc +
				curve segments) come from the shared `OBSTACLE_BEVEL` theme so
				the `?holodebug=obstacle` debug scene renders the SAME bevel.
				Higher segment density than a plain box would need is NOT
				required — the rounded corners carry their own arc subdivision.
			*/}
			<RoundedBoxGeometry
				args={[width, height, depth]}
				radius={bevelRadius}
				bevelSegments={OBSTACLE_BEVEL.bevelSegments}
				smoothness={OBSTACLE_BEVEL.smoothness}
			/>
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
/**
 * Per-obstacle color. NOT a fixed per-kind hue anymore — instead a STABLE
 * random pick from the `OBSTACLE.colors` palette, deterministic from the
 * obstacle's stable `id`:
 *   - the SAME obstacle keeps the SAME color across frames/ticks (no
 *     flicker — the color is a pure function of the id),
 *   - but DIFFERENT obstacles of the SAME kind get DIFFERENT colors → a
 *     varied, colorful field of glitchy orbs (not dominantly one hue).
 * Colliding obstacles flash to the shared bright collision color so the
 * collision highlight reads uniformly. The holographic uniforms (glitch /
 * intensity / baseFill / stripeFrequency / stripeSpeed) still come from the
 * shared `OBSTACLE` theme and `?holodebug=obstacle` — that debug scene is
 * the tuning surface for those; only the HUE is randomized per-obstacle here.
 */
function getObstacleColor(obstacle: ObstacleState): string {
	if (obstacle.collidingOrbSides.length > 0) {
		return OBSTACLE.collision.color
	}
	const palette = OBSTACLE.colors
	const index = hashStringToUint32(obstacle.id) % palette.length
	return palette[index]
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
