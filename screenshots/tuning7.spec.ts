// Visual tuning spec for docs/visual-redesign.md Step 7. Captures:
//   - menu state with & without galaxy (clean A/B of gameplay brightness)
//   - a busy gameplay frame from a bot scenario
// so the probe scripts can verify orbs+ring out-brighten the (cool) galaxy
// and that the galaxy swirls (per-vertex rotation), ring never occludes orbs,
// and obstacles read as holographic panels.
//
// Invoked via the screenshots playwright config (webServer builds with
// VITE_BOT_BRIDGE=1).

import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type Page, test } from '@playwright/test'
import type { BotScenario } from '../src/game/bot/driver'
import {
	nearMissRewindScenario,
	rotatingFieldScenario,
} from '../src/game/bot/scenarios'

const OUT = '.temp/tuning7'
const SLEEP = 1400 // ms for the renderer to settle + pulse to move

async function grabMenu(page: Page, label: string, url: string) {
	await page.goto(url)
	await page.waitForTimeout(SLEEP)
	const buf = await page.screenshot({ type: 'png', animations: 'disabled' })
	await writeFile(join(OUT, `${label}.png`), buf)
	// also grab 6 frames 400ms apart so the orb core pulse sweeps its range
	for (let i = 0; i < 6; i++) {
		await page.waitForTimeout(450)
		const f = await page.screenshot({ type: 'png' })
		await writeFile(join(OUT, `${label}-${i}.png`), f)
	}
}

async function playAndGrab(page: Page, scenario: BotScenario, label: string) {
	const ticks = scenario.captureTicks
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
				if (p.tickList.includes(tick)) void window.__botCapture7(tick)
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
	if (tickToName.has(0)) {
		const buf = await page.screenshot({ type: 'png', animations: 'disabled' })
		await writeFile(join(OUT, tickToName.get(0) as string), buf)
	}
	const expected = ticks.length
	const deadline = Date.now() + 30_000
	let written = await readdir(OUT)
	let count = written.filter((f) => f.startsWith(`${label}-`)).length
	while (count < expected && Date.now() < deadline) {
		await page.waitForTimeout(200)
		written = await readdir(OUT)
		count = written.filter((f) => f.startsWith(`${label}-`)).length
	}
	await page.evaluate(() => window.__BOT__?.stop())
}

test('capture tuning7 frames', async ({ page }) => {
	await mkdir(OUT, { recursive: true })
	await page.exposeFunction('__botCapture7', async (tick: number) => {
		const name = await page.evaluate((t: number) => {
			const w = window as unknown as { __botTickToName?: Map<number, string> }
			return w.__botTickToName?.get(t) ?? null
		}, tick)
		if (name === null) return
		const buf = await page.screenshot({ type: 'png', animations: 'disabled' })
		await writeFile(join(OUT, name), buf)
	})
	await grabMenu(page, 'menu-nogalaxy', '/?nogalaxy')
	await page.goto('/') // start on a running game for bot capture
	await page.waitForFunction(() => typeof window.__BOT__ !== 'undefined')
	await playAndGrab(page, rotatingFieldScenario, 'rot')
	await playAndGrab(page, nearMissRewindScenario, 'nearmiss')
})
