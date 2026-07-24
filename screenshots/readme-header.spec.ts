// Capture frames for the README header GIF.
//
// Phase 4 capture spec (adapted from `robotics-lab`'s
// `readme-header.spec.ts`). Unlike the parent project which keypress-waits a
// wall-clock `FRAME_MS` and grabs frames, this spec leans on the Phase 3 bot
// bridge (`window.__BOT__`) to drive the *real* running game with a
// deterministic scenario, then screenshots at the scenario's `captureTicks`
// — landing the grabs on peak moments (the instant an orb slips a gap, the
// start of a rewind, the stabilized-after-rewind state) rather than guessing
// at wall-clock delays.
//
// #### Gameplay diversity across the GIF
//
// Rather than driving a *single* long-run scenario whose capture ticks all
// share the same obstacle neighbourhood, this spec plays the ordered entries
// of {@link showcaseSequence} in turn, grabbing the (one) capture tick of
// each and accumulating them into a single frame sequence. Each entry
// teleports to a *different* gameplay place (static pair, rotating bar,
// mirror pair gap-thread, slow sweep, mixed), so consecutive GIF frames show
// distinct obstacle kinds — gameplay diversity — instead of the same row
// repeated at different orb angles.
//
// Invoke via the wrapper (`scripts/build-readme-header.sh`, Phase 5), not
// `playwright test` directly.
//
// Env knobs (set by the wrapper, overridable):
//   E2E_FRAMES_DIR   Where to write PNG frames (required).
//   BOT_SCENARIO     Single-scenario override: a scenario export name from
//                    src/game/bot/scenarios. When set, the spec plays *only*
//                    that scenario instead of the showcase sequence — handy
//                    for debugging a single entry in isolation.

import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import type { BotScenario } from '../src/game/bot/driver'
import {
	nearMissRewindScenario,
	rotatingFieldScenario,
	showcaseSequence,
} from '../src/game/bot/scenarios'

/** Single-scenario overrides accepted via `BOT_SCENARIO`. */
const SCENARIOS: Record<string, BotScenario> = {
	rotatingFieldScenario,
	nearMissRewindScenario,
}

async function screenshotFrame(
	page: Page,
	framesDir: string,
	index: number,
): Promise<void> {
	// Zero-padded (4) so ffmpeg's sequence input picks them up in order.
	const name = `frame-${String(index).padStart(4, '0')}.png`
	const buf = await page.screenshot({ type: 'png', animations: 'disabled' })
	await writeFile(join(framesDir, name), buf)
}

/**
 * Play a single scenario through the bot bridge and grab one frame at each of
 * its capture ticks, writing `frame-NNNN.png` files whose numbering continues
 * from `startFrame`. Returns the next free frame index after the run so the
 * caller can chain multiple scenarios into a single sequence.
 *
 * The bridge emits a capture event each time the live simulation's tick
 * crosses a scenario capture tick *during a bot step*; tick 0 (the seeded
 * initial state set by `playScenario` before any bot step) is grabbed
 * explicitly when it is itself a capture tick.
 */
async function playAndCapture(
	page: Page,
	framesDir: string,
	scenario: BotScenario,
	startFrame: number,
): Promise<number> {
	const captureTicks = scenario.captureTicks
	let nextFrame = startFrame
	const tickToFrame = new Map<number, number>()
	for (let i = 0; i < captureTicks.length; i++) {
		tickToFrame.set(captureTicks[i] as number, nextFrame)
		nextFrame += 1
	}

	// Push the per-scenario tick→frame map onto the page so the
	// already-exposed `__botCapture` Node function resolves the right frame
	// number when this scenario's capture event fires.
	await page.evaluate(
		async (params: {
			scenario: BotScenario
			mapEntries: ReadonlyArray<readonly [number, number]>
			mapEntryTicks: readonly number[]
		}) => {
			const w = window as unknown as {
				__botTickToFrame?: Map<number, number>
			}
			w.__botTickToFrame = new Map(params.mapEntries)
			const b = window.__BOT__
			if (!b) throw new Error('window.__BOT__ is not installed')
			const ticks = params.mapEntryTicks
			const handler = ({ tick }: { tick: number; state: unknown }) => {
				if (ticks.includes(tick)) void window.__botCapture(tick)
			}
			b.onCapture(handler)
			b.playScenario(params.scenario)
		},
		{
			scenario,
			mapEntries: [...tickToFrame.entries()],
			mapEntryTicks: [...tickToFrame.keys()],
		},
	)

	// Tick 0 is the seeded initial state, set by playScenario before any bot
	// step, so the capture handler does not fire for it. Grab it explicitly
	// when 0 is a capture tick of this scenario.
	if (tickToFrame.has(0)) {
		await screenshotFrame(page, framesDir, tickToFrame.get(0) as number)
	}

	// Wait for every scenario capture tick either to land (during playback)
	// or for playback to complete (the bridge stops driving once the
	// scenario's last tick emits). Playback advances at render-loop cadence
	// (R3F's requestAnimationFrame), so we poll rather than sleeping a fixed
	// wall-clock duration.
	//
	// `startFrame - 1` frames were written by earlier scenarios; we want
	// exactly `expected` more for this one, i.e. a total of
	// `(startFrame - 1) + expected` frames on disk.
	const expected = captureTicks.length
	const target = startFrame - 1 + expected
	const deadline = Date.now() + 30_000
	let written = await readdir(framesDir)
	let writtenCount = written.filter(
		(f) => f.startsWith('frame-') && f.endsWith('.png'),
	).length
	while (writtenCount < target && Date.now() < deadline) {
		await page.waitForTimeout(200)
		written = await readdir(framesDir)
		writtenCount = written.filter(
			(f) => f.startsWith('frame-') && f.endsWith('.png'),
		).length
	}

	// Stop the bridge before the next scenario so a straggling bot frame can
	// not bleed into the subsequent teleport's seeded initial state.
	await page.evaluate(() => {
		window.__BOT__?.stop()
	})

	return nextFrame
}

test('capture README header frames across the showcase sequence', async ({
	page,
}) => {
	const framesDir = process.env.E2E_FRAMES_DIR
	if (!framesDir) {
		throw new Error('E2E_FRAMES_DIR must point at an output directory')
	}
	await mkdir(framesDir, { recursive: true })

	await page.goto('/')
	// Wait for the bot bridge. The webServer here runs the build with
	// `VITE_BOT_BRIDGE=1` (see playwright.config.ts) so `installBotIfDev`
	// exposes `window.__BOT__` regardless of `import.meta.env.DEV`.
	await page.waitForFunction(() => typeof window.__BOT__ !== 'undefined')

	// One Node-side screenshot sink bridged to the page. The page calls it
	// with a *tick*; an in-page tick→frame map (registered per scenario)
	// decides whether that tick maps to a frame and, if so, which frame
	// number to write. Expose once per page (re-exposing throws).
	await page.exposeFunction('__botCapture', async (tick: number) => {
		const frame = await page.evaluate((t: number) => {
			const w = window as unknown as {
				__botTickToFrame?: Map<number, number>
			}
			return w.__botTickToFrame?.get(t) ?? null
		}, tick)
		if (frame === null) return
		await screenshotFrame(page, framesDir, frame)
	})

	const singleOverride = process.env.BOT_SCENARIO
	let expectedTotal: number
	let nextFrame: number

	if (singleOverride) {
		const scenario = SCENARIOS[singleOverride]
		if (!scenario) {
			throw new Error(
				`Unknown BOT_SCENARIO '${singleOverride}'. Known: ${Object.keys(SCENARIOS).join(', ')}`,
			)
		}
		nextFrame = await playAndCapture(page, framesDir, scenario, 1)
		expectedTotal = scenario.captureTicks.length
	} else {
		nextFrame = 1
		for (const entry of showcaseSequence) {
			nextFrame = await playAndCapture(
				page,
				framesDir,
				entry.scenario,
				nextFrame,
			)
		}
		expectedTotal = nextFrame - 1
	}

	// Poll until every expected frame has landed on disk (one more sweep
	// after the per-scenario waits cover any hiccups landing the final
	// screenshot to disk).
	const deadline = Date.now() + 30_000
	let written = await readdir(framesDir)
	let frameCount = written.filter(
		(file) => file.startsWith('frame-') && file.endsWith('.png'),
	).length
	while (frameCount < expectedTotal && Date.now() < deadline) {
		await page.waitForTimeout(200)
		written = await readdir(framesDir)
		frameCount = written.filter(
			(file) => file.startsWith('frame-') && file.endsWith('.png'),
		).length
	}

	expect(
		frameCount,
		`expected ${expectedTotal} frames in ${framesDir}, got ${frameCount}`,
	).toBeGreaterThanOrEqual(expectedTotal)

	// ffmpeg's sequence input expects a contiguous 1-based run; the first
	// capture must always land as frame-0001.png.
	expect(written).toContain('frame-0001.png')
})
