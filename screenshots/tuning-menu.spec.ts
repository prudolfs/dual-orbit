import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from '@playwright/test'

const OUT = '.temp/tuning-menu'

test('menu state', async ({ page }) => {
	await mkdir(OUT, { recursive: true })
	// Grab a sequence of menu frames spaced apart so the shared `time`
	// uniform advances and the orb core pulse sweeps across its range. Lets
	// the probe measure how the red vs blue orb brightness varies with the
	// pulse phase — separating pulse-timing effects from a genuine render bug.
	await page.goto('/?nogalaxy')
	await page.waitForTimeout(1500)
	for (let i = 0; i < 6; i++) {
		const buf = await page.screenshot({ type: 'png' })
		await writeFile(join(OUT, `menu-nogalaxy-${i}.png`), buf)
		await page.waitForTimeout(450)
	}
})
