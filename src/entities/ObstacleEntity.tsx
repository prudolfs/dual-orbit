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
 * Each obstacle is a `boxGeometry` rendered with the shared holographic node
 * material from Step 1. Per-kind color + per-kind glitch strength telegraphs
 * danger: `static` boxes sit quiet, `moving`/colliding ones jitter harder to
 * read as "energy".
 *
 * The holographic material was already fixed (Step 2) to displace in
 * **object space** via `positionNode` — so the double-transform bug that
 * blew orbs off their cores does NOT affect these big boxes either; their
 * glitch stays local to the box's own extent.
 */
export function ObstacleEntity({ obstacle, resolution }: ObstacleEntityProps) {
	const visible = obstacle.exists && obstacle.alive

	const position = toWorldPosition(obstacle.position, resolution, 0)
	const width = toWorldSize(obstacle.width)
	const height = toWorldSize(obstacle.height)
	const depth = obstacle.kind === 'angular_long' ? 0.28 : 0.38
	const color = getObstacleColor(obstacle)
	const glitchStrength = getObstacleGlitch(obstacle)
	const intensity = getObstacleIntensity(obstacle)

	// One material per obstacle instance so its `glitchStrength`/`intensity`
	// uniforms and `color` are independent. Disposed on unmount (game reset /
	// prune) to avoid leaking node materials. `depthWrite` stays at the default
	// `false` so the orb spheres + orbit torus draw on top of obstacles
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
				glitchStrength,
				intensity,
				baseFill,
				stripeFrequency,
			}),
		[color, glitchStrength, intensity, baseFill, stripeFrequency],
	)
	useEffect(() => () => material.dispose(), [material])

	if (!visible) {
		return null
	}

	return (
		<mesh position={position} rotation={[0, 0, -obstacle.rotation]}>
			<boxGeometry args={[width, height, depth]} />
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
		return '#ffdc60'
	}

	switch (obstacle.kind) {
		case 'moving':
			return '#c088ff'
		case 'angular':
			return '#5ad8d2'
		case 'angular_long':
			return '#ffa86a'
		case 'static':
			return '#7aa8d8'
	}
}

/**
 * Per-kind overall brightness of the holographic material. Scales both
 * the scanline body fill and the fresnel rim band. Obstacles read as the
 * SAME pure holographic-shell look as the orbs (fresnel rim band + scrolling
 * stripes + glitch), just in different colors — so they sit at orb-level
 * brightness. Collisions get a bright pop.
 */
function getObstacleIntensity(obstacle: ObstacleState): number {
	if (obstacle.collidingOrbSides.length > 0) {
		return 3.0 // collision highlight pops above orb brightness
	}

	switch (obstacle.kind) {
		case 'moving':
			return 2.6
		case 'angular':
			return 2.2
		case 'angular_long':
			return 2.4
		case 'static':
			return 2.0
	}
}

/**
 * Per-kind scanline body fill (see HolographicOptions.baseFill). We keep
 * obstacles as **pure holographic shells** like the orbs — almost no body
 * fill, so the fresnel rim band + scrolling stripes + glitch dominate the
 * look (the user wants obstacles to look holographic, like the orbs, just
 * colored differently). A tiny non-zero baseFill keeps a face-on flat box
 * front from being a totally empty rim when no fresnel band crosses it, but
 * it stays faint enough that the obstacle reads as a glowing holographic
 * outline/field, not a solid panel.
 */
function getObstacleBaseFill(obstacle: ObstacleState): number {
	if (obstacle.collidingOrbSides.length > 0) {
		return 0.4
	}

	switch (obstacle.kind) {
		case 'static':
			return 0.12
		case 'angular':
			return 0.15
		case 'angular_long':
			return 0.15
		case 'moving':
			return 0.2
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

/**
 * Per-kind holographic glitch strength. Boxes are big (a few world units
 * across), so unlike orbs (radius ~0.3) we can afford a MUCH bigger
 * displacement without the silhouette "exploding" — the reference demo
 * drives its 1-unit geometries at 0.25; here we push 0.15–0.7 so the energy
 * jitter reads clearly across the box (the user's complaint was that
 * obstacles looked static — turning the glitch up so the boxes visibly
 * shimmer/jitter). Statics still get the least (calm hull); moving +
 * colliding get a strong pulse to telegraph danger.
 */
function getObstacleGlitch(obstacle: ObstacleState): number {
	if (obstacle.collidingOrbSides.length > 0) {
		return 0.8
	}

	switch (obstacle.kind) {
		case 'moving':
			return 0.5
		case 'angular':
			return 0.36
		case 'angular_long':
			return 0.42
		case 'static':
			return 0.18
	}
}
