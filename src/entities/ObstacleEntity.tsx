import { useEffect, useMemo } from 'react'
import type { GeneratorState, ObstacleState } from '../game/types'
import { toWorldPosition, toWorldSize } from '../scene/coordinates'
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
				glitchStrength: 0,
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
 * Per-kind color feeding the holographic (additive) material. Additive
 * blending contributes `color.rgb * holographic_alpha`. The alpha is a thin
 * fresnel *band* (0 at face-on, 0 at the silhouette, bright mid-surface),
 * so a box face is mostly invisible except its angled rim band. To make
 * that band read against the dark `#05060d` backdrop, colors are kept bright
 * / saturated (mirroring the reference demo's bright `#70c1ff`); `static` is
 * the dimmest cool slate so it reads as a quiet hull, but still bright
 * enough for the rim band to show. (Bumping `intensity` alone can't brighten
 * a dim color — the color itself must be luminous under additive.)
 */
function getObstacleColor(obstacle: ObstacleState): string {
	if (obstacle.collidingOrbSides.length > 0) {
		return '#fff5a0'
	}

	// Gold-yellow hologram obstacles, inspired by the target reference's
	// accent (`#ffce4d`). Variations stay in the same warm-yellow family so
	// the whole scene reads as one gold hologram identity; per-kind nuance
	// (slightly deeper for sturdier `static`, brighter for `moving`) lets
	// gameplay semantics still read. All are additive-bright so the
	// hologram rim band reads against the dark backdrop.
	switch (obstacle.kind) {
		case 'moving':
			return '#ffd23d'
		case 'angular':
			return '#ffce4d'
		case 'angular_long':
			return '#ffc833'
		case 'static':
			return '#e3b333'
	}
}

/**
 * Per-kind overall brightness of the holographic material. Scales both
 * the scanline body fill and the fresnel rim band. Obstacles read as the
 * SAME holographic-shell look as the orbs (fresnel rim band + scrolling
 * stripes + glitch), just in different colors — so they sit at orb-level
 * brightness (orb spheres use 2.4). Collisions get a bright pop.
 */
function getObstacleIntensity(obstacle: ObstacleState): number {
	if (obstacle.collidingOrbSides.length > 0) {
		return 2.2 // collision highlight pops above normal obstacle brightness
	}

	// Edge-only hologram: kept at a moderate brightness so only the fresnel
	// rim band + scanlines read — the body stays transparent. Higher values
	// made the boxes read as solid bright panels.
	switch (obstacle.kind) {
		case 'moving':
			return 1.5
		case 'angular':
			return 1.2
		case 'angular_long':
			return 1.3
		case 'static':
			return 1.1
	}
}

/**
 * Per-kind scanline body fill (see HolographicOptions.baseFill). For the
 * true hologram look (bright edges, transparent middle) this is now kept
 * LOW — just enough so a flat face facing the camera isn't pure empty,
 * letting the fresnel rim band dominate. The plain `baseFill=0` reference
 * is 0 face-on, so a totally empty face can read as "invisible box"; a touch
 * (~0.15–0.25) gives a faint moving scanline field that reads as holographic
 * panel texture without filling the body solid.
 */
function getObstacleBaseFill(obstacle: ObstacleState): number {
	if (obstacle.collidingOrbSides.length > 0) {
		return 0.4
	}

	switch (obstacle.kind) {
		case 'static':
			return 0.15
		case 'angular':
			return 0.18
		case 'angular_long':
			return 0.2
		case 'moving':
			return 0.22
	}
}

/**
 * Per-kind scanline frequency along world Y (higher = tighter stripes). The
 * holographic reference demo reads as tight crisp scanlines; bigger boxes can
 * carry more stripes without smearing, so the long angular bar gets the
 * densest field.
 */
function getObstacleStripeFrequency(obstacle: ObstacleState): number {
	if (obstacle.collidingOrbSides.length > 0) {
		return 36
	}

	switch (obstacle.kind) {
		case 'angular_long':
			return 34
		case 'angular':
			return 30
		case 'moving':
			return 32
		case 'static':
			return 26
	}
}
