export const ORIGINAL_AREA = {
	xd: { width: 1280, height: 1920, centerX: 640, centerY: 960 },
	sd: { width: 640, height: 960, centerX: 320, centerY: 480 },
	ld: { width: 320, height: 480, centerX: 160, centerY: 240 },
} as const

export const ORIGINAL_SCALE = {
	xd: 1,
	sd: 0.5,
	ld: 0.25,
} as const

export const DEFAULT_RESOLUTION: keyof typeof ORIGINAL_SCALE = 'xd'
export const DEFAULT_LEVELS_PER_GROUP = 25
export const DEFAULT_GROUPS = 6

export const ORBIT_DIAMETER = 640
export const ORB_DIAMETER = 100
export const ORBIT_VERTICAL_SPEED_FACTOR = 4 / 90
export const ORB_ANGULAR_SPEED = (2 * Math.PI) / 90

export const REWIND_SPEED = 2
export const REWIND_RESET_SPEED = 2
export const ROLLBACK_SPEED = 4

export const DEFAULT_RANDOM_SEED = 1

export const FIXED_TIMESTEP_HZ = 60
export const FIXED_TIMESTEP_MS = 1000 / FIXED_TIMESTEP_HZ
