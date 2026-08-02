// Volumetric-glow A/B sweep: try several `(count, pointSize, randomness)`
// combinations on a production build and print a comparison table of
// (totalBright, midRatio, histogram) so we can pick the combo that best
// reads as a true volumetric glow (high `midRatio` = lots of additive
// overlap → blended volume, vs the prior "duck-tape" sheet of isolated
// stars which sits at low `midRatio`).
//
// Writes the CSV row-by-row so a partial run (test timeout on a slow combo)
// still leaves all completed rows on disk for inspection.
import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import { type Page, test } from '@playwright/test'

const OUT = '.temp/volsweep'

type Combo = {
	label: string
	query: string
	notes: string
}

const COMBOS: Combo[] = [
	{ label: 'baseline', query: '', notes: 'current defaults' },
	{ label: 'ps0.25', query: '?gx_ps=0.25', notes: '40% bigger stars' },
	{
		label: 'count300k',
		query: '?gx_count=300000',
		notes: '1.5x density',
	},
	{
		label: 'count300k+ps0.25',
		query: '?gx_count=300000&gx_ps=0.25',
		notes: '1.5x density + bigger stars',
	},
	{
		label: 'count400k+ps0.22',
		query: '?gx_count=400000&gx_ps=0.22',
		notes: '2x density + mild size bump',
	},
]

async function stats(page: Page, base64: string) {
	return page.evaluate(async (b64: string) => {
		const buf = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer
		const bmp = await createImageBitmap(new Blob([buf], { type: 'image/png' }))
		const canvas = document.createElement('canvas')
		canvas.width = bmp.width
		canvas.height = bmp.height
		// biome-ignore lint/style/noNonNullAssertion: probe helper
		const ctx = canvas.getContext('2d')!
		ctx.drawImage(bmp, 0, 0)
		const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
		const { data: d, width: w, height: h } = img
		let totalBright = 0
		let veryDim = 0
		let mid = 0
		let brightpx = 0
		let veryBright = 0
		for (let y = 0; y < h; y += 1) {
			for (let x = 0; x < w; x += 1) {
				const i = (w * y + x) * 4
				const lum = (d[i] + d[i + 1] + d[i + 2]) / 3
				if (lum < 20) continue
				totalBright++
				if (lum < 65) veryDim++
				else if (lum < 130) mid++
				else if (lum < 200) brightpx++
				else veryBright++
			}
		}
		return {
			totalBright,
			histogram: { veryDim, mid, brightpx, veryBright },
			midRatio: totalBright ? +(mid / totalBright).toFixed(3) : 0,
		}
	}, base64)
}

test('volumetric glow sweep', async ({ page }) => {
	await mkdir(OUT, { recursive: true })
	await writeFile(
		`${OUT}/sweep.csv`,
		'label,query,totalBright,midRatio,veryDim,mid,bright,veryBright\n',
	)
	const errors: string[] = []
	page.on('console', (m) => {
		if (m.type() === 'error') errors.push(m.text())
	})
	page.on('pageerror', (e) => errors.push(String(e)))

	for (const c of COMBOS) {
		errors.length = 0
		// Fresh page per combo so the in-memory count/size overrides reset.
		await page.goto(`/${c.query}`)
		await page.waitForTimeout(800)
		const shot = await page.screenshot({ type: 'png' })
		await writeFile(`${OUT}/${c.label}.png`, shot)
		const s = await stats(page, shot.toString('base64'))
		const row = `${c.label},"${c.query}",${s.totalBright},${s.midRatio},${s.histogram.veryDim},${s.histogram.mid},${s.histogram.brightpx},${s.histogram.veryBright}`
		await appendFile(`${OUT}/sweep.csv`, `${row}\n`)
		// biome-ignore lint/suspicious/noConsole: probe diagnostic logging
		console.log(`VOLSWEEP ${row} err=${errors.length}`)
	}
})
