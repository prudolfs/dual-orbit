// Visual tuning baseline (docs/visual-redesign.md Step 7).
// Captures the SAME scenarios as tuning-capture.spec.ts but with `?nogalaxy`
// so orb/obstacle/ring brightness can be probed in isolation against the
// dark clear color — establishes what the gameplay objects actually emit
// before the galaxy is dimmed to not outshine them.

import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type Page, test } from '@playwright/test'
import type { BotScenario } from '../src/game/bot/driver'
import {
	rotatingFieldScenario,
	showcaseSequence,
} from '../src/game/bot/scenarios'

const OUT = '.temp/tuning-nogalaxy'
const LABEL = 'g'

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
				if (p.tickList.includes(tick)) void window.__botCaptureNameG(tick)
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
	await page.evaluate(() => {
		window.__BOT__?.stop()
	})
}

test('capture tuning frames (galaxy OFF)', async ({ page }) => {
	await mkdir(OUT, { recursive: true })
	await page.goto('/?nogalaxy')
	await page.waitForFunction(() => typeof window.__BOT__ !== 'undefined')
	await page.exposeFunction('__botCaptureNameG', async (tick: number) => {
		const name = await page.evaluate((t: number) => {
			const w = window as unknown as { __botTickToName?: Map<number, string> }
			return w.__botTickToName?.get(t) ?? null
		}, tick)
		if (name === null) return
		const buf = await page.screenshot({ type: 'png', animations: 'disabled' })
		await writeFile(join(OUT, name), buf)
	})
	await playAndGrab(page, rotatingFieldScenario, LABEL)
	for (const entry of showcaseSequence.slice(0, 1)) {
		await playAndGrab(page, entry.scenario, 'show')
	}
})
