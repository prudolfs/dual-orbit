import {
	DEFAULT_GROUPS,
	DEFAULT_LEVELS_PER_GROUP,
	DEFAULT_RANDOM_SEED,
	DEFAULT_RESOLUTION,
	ORB_DIAMETER,
	ORBIT_DIAMETER,
	ORBIT_VERTICAL_SPEED_FACTOR,
	ORIGINAL_AREA,
	ORIGINAL_SCALE,
} from '../../constants'
import { lerp, normalize } from '../../math'
import type {
	ChanceState,
	EasingName,
	GeneratorState,
	ObstacleArchetype,
	ObstacleState,
	OrbitState,
	WaveState,
} from '../../types'
import { createObstacleState } from '../obstacles'

export type CreateGeneratorOptions = {
	readonly resolution?: GeneratorState['resolution']
	readonly level?: number
	readonly group?: number
	readonly levelPerGroup?: number
	readonly levelsPerGroup?: number
	readonly groups?: number
	readonly seed?: number
}

export function createDefaultWave(
	levels: number = DEFAULT_LEVELS_PER_GROUP,
	groups: number = DEFAULT_GROUPS,
): WaveState {
	return {
		startMin: 5,
		startMax: 10,
		endMin: 10,
		endMax: 15,
		levels,
		levelEase: 'sinusoidalOut',
		groups,
		groupEase: 'sinusoidalOut',
	}
}

export function createGeneratorState(
	options: CreateGeneratorOptions = {},
): GeneratorState {
	const levelsPerGroup = options.levelsPerGroup ?? DEFAULT_LEVELS_PER_GROUP
	const groups = options.groups ?? DEFAULT_GROUPS
	const level = options.level ?? levelsPerGroup
	const group = options.group ?? 1

	const state = {
		resolution: options.resolution ?? DEFAULT_RESOLUTION,
		level,
		group,
		levelPerGroup:
			options.levelPerGroup ?? level - (group - 1) * levelsPerGroup,
		levelsPerGroup,
		groups,
		wave: createDefaultWave(levelsPerGroup, groups),
		archetypes: [],
		seed: options.seed ?? DEFAULT_RANDOM_SEED,
	}

	return {
		...state,
		archetypes: createObstacleArchetypes(state),
	}
}

export type GenerateObstacleLayoutResult = {
	readonly generator: GeneratorState
	readonly obstacles: readonly ObstacleState[]
}

type GeneratorMetrics = {
	readonly scale: number
	readonly area: (typeof ORIGINAL_AREA)[keyof typeof ORIGINAL_AREA]
	readonly orbit: {
		readonly radius: number
		readonly diameter: number
		readonly left: number
		readonly right: number
		readonly speed: number
		readonly orbWidth: number
		readonly orbSpeed: number
		readonly x: number
		readonly y: number
	}
}

type ArchetypeTemplate = {
	readonly name: readonly string[]
	readonly alias: string
	readonly kind:
		| ObstacleArchetype['kind']
		| readonly ObstacleArchetype['kind'][]
	readonly mirror: string | readonly (string | readonly string[])[]
	readonly width: number
	readonly height: number
	readonly offsetX: number | readonly number[]
	readonly offsetTop: number | readonly number[]
	readonly offsetBottom: number | readonly number[]
	readonly speed: number | readonly number[]
	readonly chance: {
		readonly level: number | readonly number[]
		readonly group: number | readonly number[]
		readonly start: number | readonly number[]
		readonly end: number | readonly number[]
		readonly ease: EasingName | readonly EasingName[]
	}
}

export function generateObstacleLayout(
	state: GeneratorState,
	orbit: OrbitState,
): GenerateObstacleLayoutResult {
	const archetypes =
		state.archetypes.length > 0
			? state.archetypes
			: createObstacleArchetypes(state)
	const selection = selectLevelArchetypes({ ...state, archetypes })
	const expanded = expandArchetypes(
		selection.archetypes,
		archetypes,
		orbit,
		selection.seed,
	)

	return {
		generator: {
			...state,
			archetypes,
			seed: expanded.seed,
		},
		obstacles: expanded.obstacles,
	}
}

export function createObstacleArchetypes(
	state: Pick<GeneratorState, 'resolution' | 'levelsPerGroup' | 'groups'>,
): readonly ObstacleArchetype[] {
	const metrics = createGeneratorMetrics(state.resolution)
	const templates = createObstacleTemplates(metrics)
	let id = 1

	return templates.flatMap((template) =>
		template.name.map((name, index) => {
			const level = Math.round(
				readVariant(template.chance.level, index) * state.levelsPerGroup,
			)
			const group = Math.round(
				readVariant(template.chance.group, index) * state.groups,
			)

			return {
				id: id++,
				name,
				alias: template.alias,
				kind: readVariant(template.kind, index),
				mirror: readVariant(template.mirror, index),
				width: template.width,
				height: template.height,
				offsetX: readNumberVariant(template.offsetX, index),
				offsetTop: readNumberVariant(template.offsetTop, index),
				offsetBottom: readNumberVariant(template.offsetBottom, index),
				speed: readNumberVariant(template.speed, index),
				chance: {
					min: (level || 1) + state.levelsPerGroup * ((group || 1) - 1),
					max: state.levelsPerGroup * state.groups,
					start: readVariant(template.chance.start, index),
					end: readVariant(template.chance.end, index),
					ease: readVariant(template.chance.ease, index),
					value: 0,
				},
			} satisfies ObstacleArchetype
		}),
	)
}

export function tweenWave(
	wave: WaveState,
	level: number,
	group: number,
): number {
	let t = applyEase(
		wave.groupEase,
		normalize(level + wave.levels * (group - 1), 1, wave.levels * wave.groups),
	)
	const min = Math.round(lerp(wave.startMin, wave.endMin, t))
	const max = Math.round(lerp(wave.startMax, wave.endMax, t))

	t = applyEase(wave.levelEase, normalize(level, 1, wave.levels))

	return Math.round(lerp(min, max, t))
}

export function tweenChance(
	chance: ChanceState,
	level: number,
	round = false,
): ChanceState {
	if (level < chance.min || level > chance.max) {
		return {
			...chance,
			value: 0,
		}
	}

	const t = applyEase(chance.ease, normalize(level, chance.min, chance.max))
	const value = lerp(chance.start, chance.end, t)

	return {
		...chance,
		value: round ? Math.round(value) : value,
	}
}

function selectLevelArchetypes(state: GeneratorState): {
	readonly archetypes: readonly ObstacleArchetype[]
	readonly seed: number
} {
	const absoluteLevel =
		state.levelPerGroup + state.levelsPerGroup * (state.group - 1)
	const available = state.archetypes
		.map((archetype) => ({
			...archetype,
			chance: tweenChance(archetype.chance, absoluteLevel, true),
		}))
		.filter((archetype) => archetype.chance.value > 0)
		.sort((a, b) => a.chance.value - b.chance.value)
	const total = tweenWave(state.wave, state.levelPerGroup, state.group)
	const archetypes: ObstacleArchetype[] = []
	let seed = state.seed

	for (let i = 0; i < total; i++) {
		const chosen = chooseWeighted(available, seed)
		seed = chosen.seed
		archetypes.push(chosen.archetype)
	}

	return {
		archetypes,
		seed,
	}
}

function expandArchetypes(
	archetypes: readonly ObstacleArchetype[],
	allArchetypes: readonly ObstacleArchetype[],
	orbit: OrbitState,
	seed: number,
): {
	readonly obstacles: readonly ObstacleState[]
	readonly seed: number
} {
	const archetypeByName = new Map(archetypesByName(allArchetypes))
	const offset = { y: 0, top: 0 }
	const obstacles: ObstacleState[] = []
	let currentSeed = seed
	let entityIndex = 0

	for (const archetype of archetypes) {
		if (archetype.kind === 'moving') {
			const mirror = chooseMirror(archetype.mirror, currentSeed)
			currentSeed = mirror.seed
			const mirrorArchetype = archetypeByName.get(mirror.name)

			if (mirrorArchetype) {
				obstacles.push(
					createEntity(orbit, mirrorArchetype, offset, false, entityIndex++),
				)
			}
		}

		obstacles.push(createEntity(orbit, archetype, offset, false, entityIndex++))

		if (archetype.kind === 'moving' || archetype.kind === 'mirror') {
			const mirror = chooseMirror(archetype.mirror, currentSeed)
			currentSeed = mirror.seed
			const mirrorArchetype = archetypeByName.get(mirror.name)

			if (mirrorArchetype) {
				obstacles.push(
					createEntity(
						orbit,
						mirrorArchetype,
						offset,
						archetype.kind === 'mirror',
						entityIndex++,
					),
				)
			}
		}
	}

	return {
		obstacles,
		seed: currentSeed,
	}
}

function createEntity(
	orbit: OrbitState,
	archetype: ObstacleArchetype,
	offset: { y: number; top: number },
	mirror: boolean,
	index: number,
): ObstacleState {
	const y = mirror
		? offset.y
		: offset.y - Math.max(archetype.offsetBottom, offset.top)
	let rotation = 0

	if (archetype.kind === 'angular') {
		rotation =
			archetype.speed >= 0
				? Math.PI / 2 -
					archetype.speed *
						((orbit.center.y - orbit.radius - y) / orbit.verticalSpeed)
				: -Math.PI / 2 +
					Math.abs(
						archetype.speed *
							((orbit.center.y - orbit.radius - y) / orbit.verticalSpeed),
					)
	} else if (archetype.kind === 'angular_long') {
		rotation =
			archetype.speed >= 0
				? -Math.PI / 12 -
					archetype.speed *
						((orbit.center.y - orbit.radius - archetype.height / 2 - y) /
							orbit.verticalSpeed)
				: Math.PI / 12 +
					Math.abs(
						archetype.speed *
							((orbit.center.y - orbit.radius - archetype.height / 2 - y) /
								orbit.verticalSpeed),
					)
	}

	offset.y = y
	offset.top = archetype.offsetTop

	return createObstacleState({
		id: `${archetype.name}-${index}`,
		name: archetype.name,
		alias: archetype.alias,
		kind: archetype.kind === 'mirror' ? 'static' : archetype.kind,
		position: {
			x: archetype.offsetX,
			y,
		},
		width: archetype.width,
		height: archetype.height,
		rotation,
		speed: archetype.speed,
	})
}

function chooseWeighted(
	archetypes: readonly ObstacleArchetype[],
	seed: number,
): {
	readonly archetype: ObstacleArchetype
	readonly seed: number
} {
	const totalChance = archetypes.reduce(
		(total, archetype) => total + archetype.chance.value,
		0,
	)
	const random = nextRandom(seed)
	let chance = 0

	for (const archetype of archetypes) {
		chance += archetype.chance.value

		if (chance >= random.value * totalChance) {
			return {
				archetype,
				seed: random.seed,
			}
		}
	}

	return {
		archetype: archetypes[0],
		seed: random.seed,
	}
}

function chooseMirror(
	mirror: ObstacleArchetype['mirror'],
	seed: number,
): {
	readonly name: string
	readonly seed: number
} {
	if (typeof mirror === 'string') {
		return {
			name: mirror,
			seed,
		}
	}

	const random = nextRandom(seed)

	return {
		name: mirror[Math.floor(random.value * mirror.length)] ?? mirror[0] ?? '',
		seed: random.seed,
	}
}

function archetypesByName(
	archetypes: readonly ObstacleArchetype[],
): readonly (readonly [string, ObstacleArchetype])[] {
	return archetypes.map((archetype) => [archetype.name, archetype] as const)
}

function nextRandom(seed: number): {
	readonly seed: number
	readonly value: number
} {
	const nextSeed = (seed * 1664525 + 1013904223) >>> 0

	return {
		seed: nextSeed,
		value: nextSeed / 0x100000000,
	}
}

function applyEase(name: EasingName, t: number): number {
	switch (name) {
		case 'sinusoidalOut':
			return Math.sin((t * Math.PI) / 2)
		case 'quarticIn':
			return t ** 4
		case 'quarticOut':
			return 1 - (1 - t) ** 4
		case 'exponentialOut':
			return t === 1 ? 1 : 1 - 2 ** (-10 * t)
		case 'linear':
			return t
	}
}

function createGeneratorMetrics(
	resolution: keyof typeof ORIGINAL_SCALE,
): GeneratorMetrics {
	const scale = ORIGINAL_SCALE[resolution]
	const area = ORIGINAL_AREA[resolution]
	const radius = Math.round((ORBIT_DIAMETER * scale) / 2)
	const orbWidth = Math.round(ORB_DIAMETER * scale)

	return {
		scale,
		area,
		orbit: {
			radius,
			diameter: Math.round(ORBIT_DIAMETER * scale),
			left: area.centerX - radius,
			right: area.centerX + radius,
			speed: Math.floor(ORBIT_VERTICAL_SPEED_FACTOR * radius),
			orbWidth,
			orbSpeed: (2 * Math.PI) / 90,
			x: area.centerX,
			y: area.height - radius - orbWidth / 2,
		},
	}
}

function createObstacleTemplates(
	metrics: GeneratorMetrics,
): readonly ArchetypeTemplate[] {
	const { scale, area, orbit } = metrics
	const round = Math.round
	const templates: ArchetypeTemplate[] = []
	const add = (template: ArchetypeTemplate) => templates.push(template)

	add({
		name: ['rect110', 'rect111', 'rect112'],
		alias: 'rect1',
		kind: ['static', 'moving', 'moving'],
		mirror: ['', ['rect110', 'rect120'], ['rect110', 'rect120']],
		width: round(640 * scale),
		height: round(160 * scale),
		offsetX: orbit.left,
		offsetTop: orbit.diameter,
		offsetBottom: orbit.diameter,
		speed: [0, orbit.speed / 2, orbit.speed],
		chance: baseChance(
			[0, 0.5, 0.5],
			[0, 0.3, 0.5],
			[70, 15, 10],
			[50, 10, 25],
		),
	})
	add({
		name: ['rect120', 'rect121', 'rect122'],
		alias: 'rect1',
		kind: ['static', 'moving', 'moving'],
		mirror: ['', ['rect120', 'rect110'], ['rect120', 'rect110']],
		width: round(640 * scale),
		height: round(160 * scale),
		offsetX: orbit.right,
		offsetTop: orbit.diameter,
		offsetBottom: orbit.diameter,
		speed: [0, orbit.speed / 2, orbit.speed],
		chance: baseChance(
			[0, 0.5, 0.5],
			[0, 0.3, 0.5],
			[70, 15, 10],
			[50, 10, 25],
		),
	})

	addAngular(
		['rect210', 'rect211'],
		'rect2',
		[orbit.left, orbit.left + orbit.radius / 2],
		-orbit.orbSpeed,
		[0, 0.5],
		[0.5, 0.5],
		[80, 80],
		[120, 120],
		['quarticIn', 'quarticIn'],
	)
	addAngular(
		['rect220', 'rect221'],
		'rect2',
		area.centerX,
		[-orbit.orbSpeed, orbit.orbSpeed],
		[0.5, 0.5],
		[0.3, 0.3],
		[90, 90],
		[120, 120],
	)
	addAngular(
		['rect230', 'rect231'],
		'rect2',
		[orbit.right, orbit.right - orbit.radius / 2],
		orbit.orbSpeed,
		[0, 0.5],
		[0.5, 0.5],
		[80, 80],
		[120, 120],
		['quarticIn', 'quarticIn'],
	)

	addTriplet(
		3,
		round(490 * scale),
		round(245 * scale),
		[round(245 * scale), area.centerX, area.width - round(245 * scale)],
		orbit.diameter,
		[0, 0.3, 0.5],
		[80, 15, 15],
		[60, 10, 30],
		undefined,
		['linear', 'linear', 'linear'],
	)
	addMirrorPair(
		['rect340', 'rect350'],
		'rect3',
		[round(245 * scale), area.width - round(245 * scale)],
		orbit.diameter * 2,
		[0.4, 0.4],
		['quarticIn', 'quarticIn'],
	)
	addTripleFamily(
		4,
		'rect4',
		round(440 * scale),
		round(320 * scale),
		[orbit.left, area.centerX, orbit.right],
		orbit.diameter,
		orbit.radius * 3,
		[0.5, 0.6],
		[0.3, 0.4],
		[20, 15, 15],
		[40, 10, 25],
		round(220 * scale),
	)
	addTripleFamily(
		5,
		'rect5',
		round(490 * scale),
		round(320 * scale),
		[round(245 * scale), area.centerX, area.width - round(245 * scale)],
		orbit.diameter,
		orbit.radius * 3,
		[0.7, 0.8],
		[0.5, 0.6],
		[20, 15, 15],
		[40, 10, 20],
		round(245 * scale),
	)
	addTriplet(
		6,
		round(440 * scale),
		round(440 * scale),
		[round(220 * scale), area.centerX, area.width - round(220 * scale)],
		orbit.radius * 3,
		[0.7, 0.8, 0.8],
		[20, 15, 15],
		[40, 10, 20],
		[0.7, 0.8, 0.8],
	)
	addMirrorPair(
		['rect640', 'rect650'],
		'rect6',
		[round(220 * scale), area.width - round(220 * scale)],
		orbit.diameter * 2,
		[0.9, 0.9],
		['exponentialOut', 'exponentialOut'],
	)
	addTriplet(
		7,
		round(490 * scale),
		round(490 * scale),
		[round(245 * scale), area.centerX, area.width - round(245 * scale)],
		orbit.radius * 3,
		[0.7, 0.8, 0.8],
		[20, 15, 15],
		[40, 10, 20],
		[0.7, 0.8, 0.8],
	)
	addMirrorPair(
		['rect740', 'rect750'],
		'rect7',
		[round(245 * scale), area.width - round(245 * scale)],
		orbit.diameter * 2,
		[0.9, 0.9],
		['exponentialOut', 'exponentialOut'],
	)
	add({
		name: ['rect810', 'rect820'],
		alias: 'rect8',
		kind: 'angular_long',
		mirror: '',
		width: 1280 * scale,
		height: 160 * scale,
		offsetX: [
			orbit.radius / 2 - orbit.orbWidth,
			area.width - orbit.radius / 2 + orbit.orbWidth,
		],
		offsetTop: orbit.diameter * 2,
		offsetBottom: orbit.diameter * 2,
		speed: [orbit.orbSpeed / 4, -orbit.orbSpeed / 4],
		chance: baseChance(
			[0, 0],
			[0.5, 0.5],
			[100, 100],
			[150, 150],
			['quarticOut', 'quarticOut'],
		),
	})

	function addAngular(
		name: readonly string[],
		alias: string,
		offsetX: number | readonly number[],
		speed: number | readonly number[],
		level: readonly number[],
		group: readonly number[],
		start: readonly number[],
		end: readonly number[],
		ease: EasingName | readonly EasingName[] = ['linear', 'linear'],
	): void {
		add({
			name,
			alias,
			kind: 'angular',
			mirror: '',
			width: round(740 * scale),
			height: round(160 * scale),
			offsetX,
			offsetTop: orbit.diameter * 2,
			offsetBottom: orbit.diameter * 2,
			speed,
			chance: baseChance(level, group, start, end, ease),
		})
	}

	function addTriplet(
		family: number,
		width: number,
		height: number,
		x: readonly number[],
		offset: number,
		group: readonly number[],
		start: readonly number[],
		end: readonly number[],
		movingGroup: readonly number[] = group,
		ease: readonly EasingName[] = ['linear', 'quarticIn', 'quarticIn'],
	): void {
		const names = [`rect${family}10`, `rect${family}20`, `rect${family}30`]
		for (let i = 0; i < names.length; i++) {
			const name = names[i]
			const mirrors = [name, ...names.filter((candidate) => candidate !== name)]
			add({
				name: [`${name}`, `rect${family}${i + 1}1`, `rect${family}${i + 1}2`],
				alias: `rect${family}`,
				kind: ['static', 'moving', 'moving'],
				mirror: ['', mirrors, mirrors],
				width,
				height,
				offsetX: x[i],
				offsetTop: offset,
				offsetBottom: offset,
				speed: [0, orbit.speed / 2, orbit.speed],
				chance: baseChance(
					[0, 0.5, 0.5],
					[group[0], movingGroup[1], movingGroup[2]],
					start,
					end,
					ease,
				),
			})
		}
	}

	function addTripleFamily(
		family: number,
		alias: string,
		width: number,
		height: number,
		x: readonly number[],
		wideOffset: number,
		tightOffset: number,
		wideGroup: readonly number[],
		tightGroup: readonly number[],
		start: readonly number[],
		end: readonly number[],
		mirrorInset: number,
	): void {
		addTriplet(
			family,
			width,
			height,
			x,
			wideOffset,
			[wideGroup[0], wideGroup[1], wideGroup[1]],
			start,
			end,
		)
		const bases = [`rect${family}15`, `rect${family}25`, `rect${family}35`]
		for (let i = 0; i < bases.length; i++) {
			const base = bases[i]
			const mirrorBases = [
				base,
				...bases.filter((candidate) => candidate !== base),
			]
			add({
				name: [base, `rect${family}${i + 1}6`, `rect${family}${i + 1}7`],
				alias,
				kind: ['static', 'moving', 'moving'],
				mirror: ['', mirrorBases, mirrorBases],
				width,
				height,
				offsetX: x[i],
				offsetTop: tightOffset,
				offsetBottom: tightOffset,
				speed: [0, orbit.speed / 2, orbit.speed],
				chance: baseChance(
					[0, 0.5, 0.5],
					[tightGroup[0], tightGroup[1], tightGroup[1]],
					start,
					end,
					['linear', 'quarticIn', 'quarticIn'],
				),
			})
		}
		addMirrorPair(
			[`rect${family}40`, `rect${family}50`],
			alias,
			[mirrorInset, area.width - mirrorInset],
			orbit.diameter * 2,
			[family === 5 ? 0.7 : 0.4, family === 5 ? 0.7 : 0.4],
			['quarticIn', 'quarticIn'],
		)
	}

	function addMirrorPair(
		name: readonly [string, string],
		alias: string,
		offsetX: readonly [number, number],
		offset: number,
		group: readonly [number, number],
		ease: readonly [EasingName, EasingName],
	): void {
		add({
			name,
			alias,
			kind: ['mirror', 'mirror'],
			mirror: [name[1], name[0]],
			width:
				alias === 'rect4' || alias === 'rect6'
					? round(440 * scale)
					: round(490 * scale),
			height:
				alias === 'rect3'
					? round(245 * scale)
					: alias === 'rect7'
						? round(490 * scale)
						: alias === 'rect6'
							? round(440 * scale)
							: round(320 * scale),
			offsetX,
			offsetTop: offset,
			offsetBottom: offset,
			speed: 0,
			chance: baseChance([0, 0], group, [10, 10], [20, 20], ease),
		})
	}

	return templates
}

function baseChance(
	level: number | readonly number[],
	group: number | readonly number[],
	start: number | readonly number[],
	end: number | readonly number[],
	ease: EasingName | readonly EasingName[] = 'linear',
): ArchetypeTemplate['chance'] {
	return {
		level,
		group,
		start,
		end,
		ease,
	}
}

function readNumberVariant(
	value: number | readonly number[],
	index: number,
): number {
	if (typeof value === 'number') {
		return value
	}

	return value[index] ?? value[0] ?? 0
}

function readVariant<T>(value: T | readonly T[], index: number): T {
	if (!Array.isArray(value)) {
		return value as T
	}

	const selected = value[index] ?? value[0]

	if (selected === undefined) {
		throw new Error('Generator variant array cannot be empty')
	}

	return selected
}
