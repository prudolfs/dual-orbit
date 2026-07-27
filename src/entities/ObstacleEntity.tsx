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

	const material = useMemo(
		() =>
			createHolographicMaterial({
				color,
				glitchStrength,
				intensity,
				baseFill,
			}),
		[color, glitchStrength, intensity, baseFill],
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
			return '#a070e0'
		case 'angular':
			return '#7090c8'
		case 'angular_long':
			return '#e09040'
		case 'static':
			return '#5a7090'
	}
}

/**
 * Per-kind overall brightness of the holographic material. Scales both the
 * scanline body fill and the fresnel rim band. Obstacles need to read as
 * energy panels against the dark `#05060d` backdrop but stay clearly dimmer
 * than the player orbs (orb spheres use 1.4). Collisions get a bright pop.
 */
function getObstacleIntensity(obstacle: ObstacleState): number {
	if (obstacle.collidingOrbSides.length > 0) {
		return 2.0 // collision highlight pops close to orb brightness
	}

	switch (obstacle.kind) {
		case 'moving':
			return 1.5
		case 'angular':
			return 1.2
		case 'angular_long':
			return 1.3
		case 'static':
			return 1.0
	}
}

/**
 * Per-kind scanline body fill (see HolographicOptions.baseFill). Flat box
 * faces facing the camera are transparent under the reference fresnel alpha,
 * so without a body fill obstacles become invisible except a thin rim.
 * Higher-fill kinds read as denser energy panels; the collision highlight
 * uses the strongest fill so the warning reads across the whole frame.
 */
function getObstacleBaseFill(obstacle: ObstacleState): number {
	if (obstacle.collidingOrbSides.length > 0) {
		return 2.0
	}

	switch (obstacle.kind) {
		case 'static':
			return 0.7
		case 'angular':
			return 0.9
		case 'angular_long':
			return 1.0
		case 'moving':
			return 1.2
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
		return 0.7
	}

	switch (obstacle.kind) {
		case 'moving':
			return 0.45
		case 'angular':
			return 0.32
		case 'angular_long':
			return 0.38
		case 'static':
			return 0.15
	}
}
