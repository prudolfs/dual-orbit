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
// Invoke via the wrapper (`scripts/build-readme-header.sh`, Phase 5), not
// `playwright test` directly.
//
// Env knobs (set by the wrapper, overridable):
//   E2E_FRAMES_DIR   Where to write PNG frames (required).
//   BOT_SCENARIO     Scenario export name from src/game/bot/scenarios
//                    (default: 'rotatingFieldScenario').

import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import type { BotScenario } from '../src/game/bot/driver'
import {
	nearMissRewindScenario,
	rotatingFieldScenario,
} from '../src/game/bot/scenarios'

const SCENARIOS: Record<string, BotScenario> = {
	rotatingFieldScenario,
	nearMissRewindScenario,
}

async function screenshotFrame(
	page: Page,
	framesDir: string,
	index: number,
): Promise<void> {
	// Zero-padded so ffmpeg's sequence input picks them up in order.
	const name = `frame-${String(index).padStart(4, '0')}.png`
	const buf = await page.screenshot({ type: 'png', animations: 'disabled' })
	await writeFile(join(framesDir, name), buf)
}

test('capture README header frames at the scenario capture ticks', async ({
	page,
}) => {
	const framesDir = process.env.E2E_FRAMES_DIR
	if (!framesDir) {
		throw new Error('E2E_FRAMES_DIR must point at an output directory')
	}
	await mkdir(framesDir, { recursive: true })

	const scenarioName = process.env.BOT_SCENARIO ?? 'rotatingFieldScenario'
	const scenario = SCENARIOS[scenarioName]
	if (!scenario) {
		throw new Error(
			`Unknown BOT_SCENARIO '${scenarioName}'. Known: ${Object.keys(SCENARIOS).join(', ')}`,
		)
	}

	await page.goto('/')
	// Wait for the bot bridge. The webServer here runs the dev build, so
	// `import.meta.env.DEV === true` and `installBotIfDev` exposes
	// `window.__BOT__` (Phase 3 bridge).
	await page.waitForFunction(() => typeof window.__BOT__ !== 'undefined')

	// The bridge emits a capture event each time the live simulation's tick
	// crosses a scenario capture tick *during a bot step*. We bridge the
	// in-page event to Node by exposing a function the page can call; the
	// screenshot itself originates in Node (Playwright screenshots have no
	// in-browser counterpart).
	await page.exposeFunction('__botCapture', async (index: number) => {
		await screenshotFrame(page, framesDir, index)
	})

	// Register the capture handler before kicking off playback so no capture
	// event is missed. The 1-based index maps the scenario capture tick to a
	// zero-padded `frame-NNNN` filename ordered by the scenario timeline.
	const captureTicks = scenario.captureTicks
	await page.evaluate((ticks: readonly number[]) => {
		const b = window.__BOT__
		if (!b) throw new Error('window.__BOT__ is not installed')
		b.onCapture(({ tick }) => {
			const idx = ticks.indexOf(tick)
			if (idx < 0) return
			void window.__botCapture(idx + 1)
		})
	}, captureTicks)

	// Kick off playback — the ticker's bot path advances one deterministic
	// tick per rendered frame, emitting exactly the scenario capture ticks.
	await page.evaluate((s: BotScenario) => {
		const b = window.__BOT__
		if (!b) throw new Error('window.__BOT__ is not installed')
		b.playScenario(s)
	}, scenario)

	// Tick 0 is the seeded initial state, set by playScenario before any bot
	// step, so the capture handler does not fire for it. Grab it explicitly as
	// frame-0001 when 0 is a capture tick.
	const tick0Index = captureTicks.indexOf(0)
	if (tick0Index >= 0) {
		await screenshotFrame(page, framesDir, tick0Index + 1)
	}

	// Poll frames-on-disk until every scenario capture tick has been grabbed
	// (or the run completes). Playback advances at render-loop cadence
	// (R3F's requestAnimationFrame), so we poll rather than sleep a fixed
	// wall-clock duration.
	const expected = captureTicks.length
	const deadline = Date.now() + 120_000

	let written = await readdir(framesDir)
	while (written.length < expected && Date.now() < deadline) {
		await page.waitForTimeout(300)
		written = await readdir(framesDir)
	}

	// De-duplicate (poll may re-read the same files).
	const frameCount = written.filter(
		(file) => file.startsWith('frame-') && file.endsWith('.png'),
	).length

	expect(
		frameCount,
		`expected ${expected} frames in ${framesDir}, got ${frameCount}`,
	).toBeGreaterThanOrEqual(expected)

	// ffmpeg's sequence input expects a contiguous 1-based run; the first
	// capture must always land as frame-0001.png.
	expect(written).toContain('frame-0001.png')
})
