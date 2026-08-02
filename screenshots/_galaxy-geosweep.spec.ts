// Geometry sweep — find the `(radius, count, behind)` that gives us
// the reference's "cube-like 3D branches" instead of "paper sheets". The
// fix is geometry-scale, not post-hoc: the reference's density is
// ~2500 stars/unit² at perspective strength 0.2 (close camera); our
// current `radius=26, count=300k, behind=14` is 141 stars/unit² (~18×
// sparser) at perspective 0.07 (~2.8× weaker). Both starve the eye of
// the additive-stack reading that makes each branch arm a 3D blob.
//
// Sweep tests denser combos, holding `behind=14` (camera-safe render
// order — galaxy stays clearly behind gameplay). Reports per combo:
//   - `totalBright`, `midRatio` (luminance histogram, see _galaxy-probe)
//   - `bboxRatio`    (vertical/horizontal bright extent)
//   - `corePct`      (fraction of bright pixels in the inner-half
//     bounding box — a real 3D blob has soft halo, a sheet has hard
//     edges that concentrate brightness in the core)
import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import { type Page, test } from '@playwright/test'

const OUT = '.temp/geosweep'

type Combo = { label: string; query: string; notes: string }

const COMBOS: Combo[] = [
	{ label: 'baseline', query: '', notes: 'current r26 n300k' },
	{
		label: 'r14_n500k',
		query: '?gx_radius=14&gx_count=500000',
		notes: 'dense mid-size',
	},
	{
		label: 'r12_n500k',
		query: '?gx_radius=12&gx_count=500000',
		notes: 'denser mid-size',
	},
	{
		label: 'r10_n500k',
		query: '?gx_radius=10&gx_count=500000',
		notes: 'even denser',
	},
	{
		label: 'r12_n700k',
		query: '?gx_radius=12&gx_count=700000',
		notes: 'max density',
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
		let minX = w
		let maxX = -1
		let minY = h
		let maxY = -1
		// Bright-pixel centroid to compute corePct (inner-half bbox).
		let _bx = 0
		let _by = 0
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
				_bx += x
				_by += y
				if (x < minX) minX = x
				if (x > maxX) maxX = x
				if (y < minY) minY = y
				if (y > maxY) maxY = y
			}
		}
		// corePct: count of bright pixels within inner 50% of bbox area
		const bw = maxX - minX + 1
		const bh = maxY - minY + 1
		const cxL = minX + bw * 0.25
		const cxR = minX + bw * 0.75
		const cyT = minY + bh * 0.25
		const cyB = minY + bh * 0.75
		let core = 0
		for (let y = Math.floor(cyT); y < cyB; y += 1) {
			for (let x = Math.floor(cxL); x < cxR; x += 1) {
				const i = (w * y + x) * 4
				const lum = (d[i] + d[i + 1] + d[i + 2]) / 3
				if (lum >= 20) core++
			}
		}
		return {
			totalBright,
			histogram: { veryDim, mid, brightpx, veryBright },
			midRatio: totalBright ? +(mid / totalBright).toFixed(3) : 0,
			bbox: { w: bw, h: bh },
			bboxRatio: bw > 0 ? +(bh / bw).toFixed(3) : 0,
			corePct: totalBright ? +(core / totalBright).toFixed(3) : 0,
		}
	}, base64)
}

test('geometry sweep', async ({ page }) => {
	await mkdir(OUT, { recursive: true })
	await writeFile(
		`${OUT}/sweep.csv`,
		'label,query,totalBright,midRatio,bboxW,bboxH,bboxRatio,corePct\n',
	)
	const errors: string[] = []
	page.on('console', (m) => {
		if (m.type() === 'error') errors.push(m.text())
	})
	page.on('pageerror', (e) => errors.push(String(e)))

	for (const c of COMBOS) {
		errors.length = 0
		await page.goto(`/${c.query}`)
		// hide the start overlay + HUD so they don't pollute the metrics
		await page.evaluate(() => {
			const hide = (sel: string) => {
				const el = document.querySelector(sel)
				if (el && el instanceof HTMLElement) el.style.display = 'none'
			}
			hide('.hud')
			hide('.start-overlay')
			hide('.actions')
		})
		await page.waitForTimeout(900)
		const shot = await page.screenshot({ type: 'png' })
		await writeFile(`${OUT}/${c.label}.png`, shot)
		const s = await stats(page, shot.toString('base64'))
		const row = `${c.label},"${c.query}",${s.totalBright},${s.midRatio},${s.bbox.w},${s.bbox.h},${s.bboxRatio},${s.corePct}`
		await appendFile(`${OUT}/sweep.csv`, `${row}\n`)
		// biome-ignore lint/suspicious/noConsole: probe diagnostic logging
		console.log(`GEOSWEEP ${row} err=${errors.length}`)
		if (errors.length > 0) {
			// biome-ignore lint/suspicious/noConsole: probe diagnostic logging
			console.log(`  ERR: ${errors[0].slice(0, 200)}`)
		}
	}
})
