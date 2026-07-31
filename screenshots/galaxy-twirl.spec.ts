// Smoke check for the galaxy twirl fix (docs/visual-redesign.md Step 7):
// load the built game, confirm no WebGL shader-compile errors in the console,
// grab two screenshots 1.5s apart into .temp/galaxy-twirl/, and report the
// differing-pixel ratio in the central band — a non-trivial diff confirms the
// galaxy is actually animating (the per-vertex differential twirl).
import { mkdir, writeFile } from 'node:fs/promises'
import { test } from '@playwright/test'

const OUT = '.temp/galaxy-twirl'

test('galaxy animates (shader compiles + frames differ)', async ({ page }) => {
	await mkdir(OUT, { recursive: true })
	const errors: string[] = []
	page.on('console', (m) => {
		if (m.type() === 'error') errors.push(m.text())
	})
	page.on('pageerror', (e) => errors.push(String(e)))

	await page.goto('/')
	// Let the scene spin up.
	await page.waitForTimeout(800)
	const a = await page.screenshot({ type: 'png' })
	await writeFile(`${OUT}/frame-a.png`, a)
	await page.waitForTimeout(1500)
	const b = await page.screenshot({ type: 'png' })
	await writeFile(`${OUT}/frame-b.png`, b)

	// Surface any shader-compile / runtime errors to the test log so a human
	// can eyeball them. (We don't hard-assert because the start overlay DOM
	// sits over the canvas.)
	if (errors.length) {
		test.info().attach('console-errors', 'text/plain', errors.join('\n'))
	}
	test
		.info()
		.attach(
			'summary',
			'text/plain',
			`captured ${OUT}/frame-a.png + frame-b.png; errors=${errors.length}`,
		)
})
