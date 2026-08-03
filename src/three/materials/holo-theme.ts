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

export const OBSTACLE = {
	/** Disabled in production for crisp collisions; debug default enables a
	 *  light surface shimmer. Kept here so both share the contract. */
	glitchStrength: 0.08,
	collision: {
		intensity: 3.0,
		baseFill: 0.22,
		stripeFrequency: 44,
		color: '#fff5a0',
	},
	byKind: {
		moving: {
			intensity: 2.4,
			baseFill: 0.09,
			stripeFrequency: 40,
			color: '#ffd23d',
		},
		angular: {
			intensity: 2.0,
			baseFill: 0.07,
			stripeFrequency: 38,
			color: '#ffce4d',
		},
		angular_long: {
			intensity: 2.2,
			baseFill: 0.08,
			stripeFrequency: 42,
			color: '#ffc833',
		},
		static: {
			intensity: 1.8,
			baseFill: 0.06,
			stripeFrequency: 34,
			color: '#e3b333',
		},
	} as const,
	/** Stripe scroll speed (world-y units/sec) — matches the holographic
	 *  material's default. */
	stripeSpeed: 0.05,
} as const
