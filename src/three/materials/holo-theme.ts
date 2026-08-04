/**
 * Canonical holographic visual tuning — the SINGLE source of truth for the
 * hologram look, shared by the production entities (`OrbitEntity`,
 * `ObstacleEntity`) and the `?holodebug` tuning scenes (`HologramDebug`).
 *
 * Why this exists: the debug scene (`?holodebug=obstacle` / `?holodebug=orbit`)
 * and the live game were originally tuned by hand in two places and drifted
 * out of sync. Now both import these constants, so whatever you dial in the
 * debug GUI (whose defaults are these very constants) is what ships in the
 * game. Edit a value here → both update together.
 *
 * See `docs/visual-redesign.md` for the design narrative.
 */

// --- shared backdrop -------------------------------------------------------

/** Dark violet clear/background color (debug + production match). */
export const HOLO_BACKDROP = '#0a0814'

// --- orbit: ring (TORUS — real donut with 3D volume) ------------------------

export const RING = {
	color: '#ffce4d',
	/** Torus tube radius (real 3D depth, NOT a flat annulus). Scaled relative
	 * to `orbitRadiusWorld` in production (ring tube ≈ 2.5% of orbit radius,
	 * floored at 0.012); the debug scene uses an absolute world size. */
	tubeRatio: 0.025,
	tubeFloor: 0.012,
	intensity: 2.2,
	baseFill: 0.08,
	glitchStrength: 0.18,
	stripeFrequency: 48,
	tubularSegments: 220,
	radialSegments: 12,
} as const

// --- orbit: center anchor sphere ------------------------------------------

export const CENTER = {
	color: '#ffce4d',
	radius: 14, // game grid units → toWorldSize in OrbitEntity
	intensity: 1.4,
	glitchStrength: 0.16,
} as const

// --- orbs (shell + pulsing core + back-disc halo) -------------------------

export const ORB_COLORS = {
	left: '#d84f3f',
	right: '#2f6fd8',
} as const

export const ORB_SHELL = {
	intensity: 2.4,
	glitchStrength: 0.14,
	stripeFrequency: 28,
	widthSegments: 32,
	heightSegments: 18,
	/** Spin rates for the orb shell (rad/sec) — kept here so the debug scene
	 *  (which mirrors production animation) stays in lock-step. */
	spinX: -1.2,
	spinY: 2.0,
} as const

export const ORB_CORE = {
	/** Core radius as a fraction of the orb shell radius. */
	radiusRatio: 0.3,
	intensity: 2.0,
	glitchStrength: 0.08,
	stripeFrequency: 40,
	pulse: {
		speed: 1.8,
		/** Per-orb phase offset (right=0, left=π/2) is applied at the call
		 *  site, NOT here — this is the base phase. */
		phase: 0,
		floor: 0.5,
		amp: 0.5,
	},
	/** Counter-rotation rates (rad/sec) vs the shell. */
	spinX: 1.6,
	spinY: -2.4,
} as const

export const ORB_CORE_GEOMETRY = {
	widthSegments: 20,
	heightSegments: 14,
} as const

export const ORB_HALO = {
	/** Default back-disc intensity (createBackDiscMaterial default). */
	intensity: 0.7,
	/** Halo plane scale as a multiple of the orb shell radius. */
	scaleRatio: 2.8,
} as const

// --- obstacles -------------------------------------------------------------

/** Bevel (rounded-edge) config shared by production `ObstacleEntity` and the
 *  `?holodebug=obstacle` debug scene so both render the SAME beveled,
 *  orb-like silhouette. Rounded edges soften the box into something closer
 *  to an energy orb while the glitch displacement wobbles the beveled rim
 *  — the combination reads as a glitchy orb-cube hybrid, not a flat cube.
 *
 *  - `radius`: corner radius as a fraction of the SMALLEST box dimension
 *    (so a long `angular_long` bar bevels proportionally, not by absolute
 *    world units). Floored so even tiny obstacles keep a visible bevel.
 *  - `bevelSegments`: per-corner subdivision (more = smoother rim arc;
 *    keep moderate so the holographic scanline grid stays crisp).
 *  - `smoothness`: extrude `curveSegments` along the rounded corner curve.
 */
export const OBSTACLE_BEVEL = {
	/** Tuned ABSOLUTE world-space corner radius — the SINGLE value both
	 *  production `ObstacleEntity` and the `?holodebug=obstacle` debug scene
	 *  read, so the game obstacle bevel matches the debug-default bevel
	 *  exactly (this is the value dialed in the debug lil-gui `Bevel` folder
	 *  that "looks good", copied back here). Using an absolute radius — not a
	 *  per-size ratio — means EVERY obstacle, regardless of width/height,
	 *  carries the same beveled orb-like silhouette you see in the debug
	 *  scene; a per-size ratio previously made tiny obstacles too sharp and
	 *  large ones too round, diverging from the tuned debug look.
	 *
	 *  `RoundedBoxGeometry` internally clamps the radius to half the
	 *  smallest box dimension, so a very thin obstacle won't blow past its
	 *  real edge — it just bevels as much as geometry allows.
	 *
	 *  Debug-scene representative box is 0.6 × 0.45 × 0.38; the dialed-good
	 *  radius below is the `Bevel` slider value on that box. */
	radius: 0.07,
	bevelSegments: 4,
	smoothness: 4,
	/** Kept for backward reference / nothing in production reads this now. */
	radiusRatio: 0.18,
} as const

export const OBSTACLE = {
	/** Light-but-present glitch so obstacle beveled cubes shimmer / wobble
	 *  like glitchy energy orbs — vertices nudge in local XZ, jittering the
	 *  rounded rim band. Tuned in the `?holodebug=obstacle` lil-gui scene
	 *  (the tuning surface) and copied back here so the game matches the
	 *  debug look 1:1. Bumped from 0.14 → 0.22 so the orb-like jitter reads
	 *  on the beveled rim while collisions still read. The
	 *  `?holodebug=obstacle` debug scene stays in sync via this constant.
	 *
	 *  NOTE: the holographic uniforms (glitch / intensity / baseFill /
	 *  stripeFrequency / stripeSpeed) below are the values dialed in the
	 *  `?holodebug=obstacle` lil-gui scene — that scene is the tuning
	 *  surface, these constants are the single source production mirrors
	 *  (glitch/lines/scanlines verified to look good there). */
	glitchStrength: 0.22,
	/** Bright, saturated POOL of obstacle colors sampled from
	 *  `.temp/colors.png` (a bright/neon palette image). PRODUCTION
	 *  `ObstacleEntity` does NOT pick a fixed per-kind hue from
	 *  `byKind.<kind>.color` anymore — instead it picks a STABLE random
	 *  color PER OBSTACLE from this pool (deterministic from the obstacle
	 *  `id`) so:
	 *    - same obstacle keeps its color across frames (stable),
	 *    - but different obstacles of the SAME kind get different colors,
	 *    - the field reads as a varied colorful rainbow of glitchy orbs,
	 *      not dominantly red/orange.
	 *  All entries are high-luminosity + high-saturation (additive blending
	 *  can only brighten, so colors are already luminous). `byKind.<kind>.color`
	 *  is kept as the single representative used by the `?holodebug=obstacle`
	 *  debug scene (which renders ONE box — no randomization). */
	colors: [
		'#fb3b06', // red-orange (hue ~15°)
		'#fc2579', // pink-rose (hue ~330°)
		'#e706f4', // hot magenta (hue ~285°)
		'#9810e1', // purple (hue ~270°)
		'#0230f9', // blue (hue ~225°)
		'#02cefd', // sky-blue (hue ~180°)
		'#0ee1d1', // cyan (hue ~165°)
		'#03d007', // green (hue ~120°)
		'#cbfd05', // lime-green (hue ~60°)
	] as const,
	collision: {
		intensity: 3.0,
		baseFill: 0.22,
		stripeFrequency: 44,
		color: '#fff5a0',
	},
	byKind: {
		/** Per-kind NON-COLOR tuning (intensity / baseFill / stripeFrequency)
		 *  — these DO vary by kind (more dangerous kinds read as denser
		 *  energy panels). The `.color` field is only used by the
		 *  `?holodebug=obstacle` debug scene as the representative hue for
		 *  the single rendered box; production selects from `OBSTACLE.colors`
		 *  instead (above) for per-obstacle variety. */
		moving: {
			intensity: 2.4,
			baseFill: 0.09,
			stripeFrequency: 40,
			// bright cyan (hue ~180°)
			color: '#02cefd',
		},
		angular: {
			intensity: 2.0,
			baseFill: 0.07,
			stripeFrequency: 38,
			// bright hot-magenta (hue ~285°)
			color: '#e706f4',
		},
		angular_long: {
			intensity: 2.2,
			baseFill: 0.08,
			stripeFrequency: 42,
			// bright lime-green (hue ~60°)
			color: '#cbfd05',
		},
		static: {
			intensity: 1.8,
			baseFill: 0.06,
			stripeFrequency: 34,
			// bright red-orange (hue ~15°)
			color: '#fb3b06',
		},
	} as const,
	/** Stripe scroll speed (world-y units/sec) — matches the holographic
	 *  material's default. */
	stripeSpeed: 0.05,
} as const

/**
 * Stable string → uint32 hash (FNV-1a). Used by `ObstacleEntity` to pick a
 * deterministic per-obstacle color from `OBSTACLE.colors` so:
 *   - the SAME obstacle keeps the SAME color across frames/ticks (the color
 *     is a function of the obstacle's stable `id`, NOT of wall-clock time
 *     or render order — no flicker), while
 *   - DIFFERENT obstacles of the same kind get DIFFERENT colors → variety.
 * Mirrors the deterministic-by-id principle the generator already uses for
 * obstacle placement.
 */
export function hashStringToUint32(str: string): number {
	let hash = 2166136261
	for (let i = 0; i < str.length; i++) {
		hash ^= str.charCodeAt(i)
		hash = Math.imul(hash, 16777619)
	}
	// force unsigned
	return hash >>> 0
}
