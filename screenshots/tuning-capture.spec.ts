// Temporary tuning spec for docs/visual-redesign.md Step 7.
// Runs a few bot scenarios and grabs one frame per capture tick straight into
// .temp/tuning/, so we can probe pixel brightness (`probe-screenshot.mjs`)
// to verify orbs+ring out-brighten the galaxy background.
//
// Invoked via the screenshots playwright config (same webServer as the README
// header capture, which builds with VITE_BOT_BRIDGE=1).

import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type Page, test } from '@playwright/test'
import type { BotScenario } from '../src/game/bot/driver'
import {
	nearMissRewindScenario,
	rotatingFieldScenario,
	showcaseSequence,
} from '../src/game/bot/scenarios'

const OUT = '.temp/tuning'

async function playAndGrab(
	page: Page,
	scenario: BotScenario,
	label: string,
): Promise<void> {
	const ticks = scenario.captureTicks
	// Map tick -> filename; with Dir funcs written from the page.
	const tickToName = new Map<number, string>()
	for (let i = 0; i < ticks.length; i++) {
		tickToName.set(
			ticks[i] as number,
			`${label}-${String(i).padStart(2, '0')}.png`,
		)
	}
	await page.evaluate(
		async (p: {
			scenario: BotScenario
			entries: ReadonlyArray<readonly [number, string]>
			tickList: readonly number[]
		}) => {
			const w = window as unknown as { __botTickToName?: Map<number, string> }
			w.__botTickToName = new Map(p.entries)
			const b = window.__BOT__
			if (!b) throw new Error('window.__BOT__ is not installed')
			const handler = ({ tick }: { tick: number }) => {
				if (p.tickList.includes(tick)) void window.__botCaptureName(tick)
			}
			b.onCapture(handler)
			b.playScenario(p.scenario)
		},
		{
			scenario,
			entries: [...tickToName.entries()],
			tickList: [...ticks.keys()].map((k) => ticks[k] as number),
		},
	)

	// tick 0 capture doesn't fire during playback (it's the seeded state)
	if (tickToName.has(0)) {
		const buf = await page.screenshot({ type: 'png', animations: 'disabled' })
		await writeFile(join(OUT, tickToName.get(0) as string), buf)
	}

	// Wait until playback wraps / remaining ticks land.
	const expected = ticks.length
	const deadline = Date.now() + 30_000
	let written = await readdir(OUT)
	let count = written.filter((f) => f.startsWith(`${label}-`)).length
	while (count < expected && Date.now() < deadline) {
		await page.waitForTimeout(200)
		written = await readdir(OUT)
		count = written.filter((f) => f.startsWith(`${label}-`)).length
	}

	await page.evaluate(() => {
		window.__BOT__?.stop()
	})
}

test('capture tuning frames', async ({ page }) => {
	await mkdir(OUT, { recursive: true })
	await page.goto('/')
	await page.waitForFunction(() => typeof window.__BOT__ !== 'undefined')

	await page.exposeFunction('__botCaptureName', async (tick: number) => {
		const name = await page.evaluate((t: number) => {
			const w = window as unknown as { __botTickToName?: Map<number, string> }
			return w.__botTickToName?.get(t) ?? null
		}, tick)
		if (name === null) return
		const buf = await page.screenshot({ type: 'png', animations: 'disabled' })
		await writeFile(join(OUT, name), buf)
	})

	// Grab a couple of busy frames from different scenarios for variety.
	await playAndGrab(page, rotatingFieldScenario, 'rot')
	await playAndGrab(page, nearMissRewindScenario, 'nearmiss')
	for (const entry of showcaseSequence.slice(0, 2)) {
		await playAndGrab(page, entry.scenario, 'show')
	}
})
