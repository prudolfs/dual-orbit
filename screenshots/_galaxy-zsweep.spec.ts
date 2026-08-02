// Z-thickness sweep for true 3D depth — find the `zSpread` that makes the
// tilted galaxy disc read as a 3D volumetric blob ("cube-like" per the
// reference) instead of a paper-thin slice. Runs against `?galaxydebug`
// so the only bright pixels in the screenshot belong to the galaxy
// itself (no gameplay HUD/orbs polluting the metrics).
//
// Discriminant metrics on the isolated galaxy:
//   - `bboxRatio = bboxHeight / bboxWidth` of all bright pixels (the
//     disc tilted on its X axis should compress height by cos(tilt),
//     so a flat slice sits at a near-constant ratio; a thick 3D blob
//     adds vertical pixels from the projected Z puff widening the
//     vertical extent further than cos(tilt) alone would).
//   - `extentRatio = verticalFWHM / horizontalFWHM` of the bright core
//     (resists dim HUD pixels near the frame edges).
import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import { type Page, test } from '@playwright/test'

const OUT = '.temp/zsweep'

type Combo = { label: string; query: string; notes: string }

const COMBOS: Combo[] = [
	{
		label: 'z1',
		query: '?galaxydebug&gx_z=1.0',
		notes: 'reference matched axes',
	},
	{ label: 'z2', query: '?galaxydebug&gx_z=2.0', notes: '2x Z' },
	{ label: 'z3', query: '?galaxydebug&gx_z=3.0', notes: 'current default 3x' },
	{ label: 'z5', query: '?galaxydebug&gx_z=5.0', notes: '5x Z' },
	{
		label: 'z8',
		query: '?galaxydebug&gx_z=8.0',
		notes: '8x Z — heavy thickening',
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
		let minX = w
		let maxX = -1
		let minY = h
		let maxY = -1
		const colBright = new Array(w).fill(0)
		const rowBright = new Array(h).fill(0)
		for (let y = 0; y < h; y += 1) {
			for (let x = 0; x < w; x += 1) {
				const i = (w * y + x) * 4
				const lum = (d[i] + d[i + 1] + d[i + 2]) / 3
				if (lum < 40) continue
				totalBright++
				if (x < minX) minX = x
				if (x > maxX) maxX = x
				if (y < minY) minY = y
				if (y > maxY) maxY = y
				colBright[x]++
				rowBright[y]++
			}
		}
		const halfCol = Math.max(...colBright) / 2
		const halfRow = Math.max(...rowBright) / 2
		const colExtent = colBright.filter((c) => c >= halfCol).length
		const rowExtent = rowBright.filter((c) => c >= halfRow).length
		return {
			totalBright,
			bbox: { w: maxX - minX + 1, h: maxY - minY + 1 },
			bboxRatio:
				maxX >= 0 ? +((maxY - minY + 1) / (maxX - minX + 1)).toFixed(3) : 0,
			colExtent,
			rowExtent,
			extentRatio: colExtent > 0 ? +(rowExtent / colExtent).toFixed(3) : 0,
		}
	}, base64)
}

test('z-spread sweep (galaxydebug)', async ({ page }) => {
	await mkdir(OUT, { recursive: true })
	await writeFile(
		`${OUT}/sweep.csv`,
		'label,query,totalBright,bboxW,bboxH,bboxRatio,colExtent,rowExtent,extentRatio\n',
	)
	const errors: string[] = []
	page.on('console', (m) => {
		if (m.type() === 'error') errors.push(m.text())
	})
	page.on('pageerror', (e) => errors.push(String(e)))

	for (const c of COMBOS) {
		errors.length = 0
		await page.goto(`/${c.query}`)
		// hide lil-gui so the panel itself isn't a bright-pixel pollution
		// source. (The panel renders over part of the canvas and its grey
		// background is significantly brighter than 40.)
		await page.evaluate(() => {
			const el = document.querySelector('.lil-gui')
			if (el && el instanceof HTMLElement) el.style.display = 'none'
		})
		await page.waitForTimeout(800)
		const shot = await page.screenshot({ type: 'png' })
		await writeFile(`${OUT}/${c.label}.png`, shot)
		const s = await stats(page, shot.toString('base64'))
		const row = `${c.label},"${c.query}",${s.totalBright},${s.bbox.w},${s.bbox.h},${s.bboxRatio},${s.colExtent},${s.rowExtent},${s.extentRatio}`
		await appendFile(`${OUT}/sweep.csv`, `${row}\n`)
		// biome-ignore lint/suspicious/noConsole: probe diagnostic logging
		console.log(`ZSWEEP ${row} err=${errors.length}`)
		if (errors.length > 0) {
			// biome-ignore lint/suspicious/noConsole: probe diagnostic logging
			console.log(`  FIRST ERR: ${errors[0].slice(0, 200)}`)
		}
	}
})
