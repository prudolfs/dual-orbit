// One-shot probe: capture a production-built galaxy frame into
// `.temp/screenshot-015.png` and report pixel statistics across radii so we
// can confirm (a) the galaxy now reads as a nebula with bright stars
// distributed around the twirl (not flat 1px haze), and (b) it animates
// between frames (differential twirl reaches the outer arms).
import { mkdir, writeFile } from 'node:fs/promises'
import { test } from '@playwright/test'

const OUT = '.temp/probe'

async function stats(page: import('@playwright/test').Page, base64: string) {
	return page.evaluate(async (b64: string) => {
		const buf = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer
		const bmp = await createImageBitmap(new Blob([buf], { type: 'image/png' }))
		const canvas = document.createElement('canvas')
		canvas.width = bmp.width
		canvas.height = bmp.height
		// biome-ignore lint/style/noNonNullAssertion: probe helper, getContext always returns 2D here
		const ctx = canvas.getContext('2d')!
		ctx.drawImage(bmp, 0, 0)
		const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
		const cx = canvas.width / 2
		const cy = canvas.height / 2
		const maxR = Math.min(cx, cy)
		const bands = 6
		const bright = new Array(bands).fill(0)
		const lumSum = new Array(bands).fill(0)
		// Luminance histogram (4 buckets) — a true volumetric glow piles
		// pixels in the mid-bright range (65–192) from additive overlap
		// where stellar quads analytically overlap; a sparse "sprinkled
		// sheet" pushes pixels into either the dark floor or the saturated
		// peak (0 and 255), with little mid. Ratio mid/totalBright is a
		// objective "how blended does the cloud read" score.
		let totalBright = 0
		let veryDim = 0
		let mid = 0
		let brightpx = 0
		let veryBright = 0
		const { data: d, width: w, height: h } = img
		for (let y = 0; y < h; y += 1) {
			for (let x = 0; x < w; x += 1) {
				const i = (w * y + x) * 4
				const r = d[i]
				const g = d[i + 1]
				const b = d[i + 2]
				const lum = (r + g + b) / 3
				if (lum < 20) continue
				totalBright++
				if (lum < 65) veryDim++
				else if (lum < 130) mid++
				else if (lum < 200) brightpx++
				else veryBright++
				if (lum < 40) continue
				const dx = x - cx
				const dy = y - cy
				const dist = Math.sqrt(dx * dx + dy * dy) / maxR
				const band = Math.min(bands - 1, Math.floor(dist * bands))
				bright[band]++
				lumSum[band] += lum
			}
		}
		return {
			size: `${w}x${h}`,
			totalBright,
			histogram: { veryDim, mid, brightpx, veryBright },
			midRatio: totalBright ? +(mid / totalBright).toFixed(3) : 0,
			perBand: bright.map((c, i) => ({
				band: i,
				r: `${(i / bands).toFixed(2)}–${((i + 1) / bands).toFixed(2)}`,
				bright: c,
				avgLum: c ? Math.round(lumSum[i] / c) : 0,
			})),
		}
	}, base64)
}

async function diff(
	page: import('@playwright/test').Page,
	aB64: string,
	bB64: string,
) {
	return page.evaluate(
		async (b64s: { a: string; b: string }) => {
			const toImg = async (b64: string) => {
				const buf = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer
				const bmp = await createImageBitmap(
					new Blob([buf], { type: 'image/png' }),
				)
				const c = document.createElement('canvas')
				c.width = bmp.width
				c.height = bmp.height
				// biome-ignore lint/style/noNonNullAssertion: probe helper
				const ctx = c.getContext('2d')!
				ctx.drawImage(bmp, 0, 0)
				return ctx.getImageData(0, 0, c.width, c.height)
			}
			const A = await toImg(b64s.a)
			const B = await toImg(b64s.b)
			const w = Math.min(A.width, B.width)
			const h = Math.min(A.height, B.height)
			const cx = w / 2
			const cy = h / 2
			const maxR = Math.min(cx, cy)
			const bands = 6
			const changed = new Array(bands).fill(0)
			let total = 0
			for (let y = 0; y < h; y += 1) {
				for (let x = 0; x < w; x += 1) {
					const i = (w * y + x) * 4
					const d =
						Math.abs(A.data[i] - B.data[i]) +
						Math.abs(A.data[i + 1] - B.data[i + 1]) +
						Math.abs(A.data[i + 2] - B.data[i + 2])
					if (d <= 18) continue
					total++
					const dx = x - cx
					const dy = y - cy
					const dist = Math.sqrt(dx * dx + dy * dy) / maxR
					const band = Math.min(bands - 1, Math.floor(dist * bands))
					changed[band]++
				}
			}
			return {
				total,
				perBand: changed.map((c, i) => ({
					band: i,
					r: `${(i / bands).toFixed(2)}–${((i + 1) / bands).toFixed(2)}`,
					changed: c,
				})),
			}
		},
		{ a: aB64, b: bB64 },
	)
}

test('galaxy probe: pixel stats across radii + animation diff', async ({
	page,
}) => {
	await mkdir(OUT, { recursive: true })
	const errors: string[] = []
	page.on('console', (m) => {
		if (m.type() === 'error') errors.push(m.text())
	})
	page.on('pageerror', (e) => errors.push(String(e)))

	await page.goto('/')
	await page.waitForTimeout(1200)

	const a = await page.screenshot({ type: 'png' })
	await writeFile(`${OUT}/a.png`, a)
	// Persist a copy as the canonical "screenshot-015" so the user can eyeball.
	await writeFile('.temp/screenshot-015.png', a)

	const sA = await stats(page, a.toString('base64'))

	await page.waitForTimeout(1500)
	const b = await page.screenshot({ type: 'png' })
	await writeFile(`${OUT}/b.png`, b)

	const dAB = await diff(page, a.toString('base64'), b.toString('base64'))

	const summary = `ERRORS (${errors.length}):
${errors.join('\n')}

=== FRAME A STATS ===
${JSON.stringify(sA, null, 2)}

=== A vs B FRAME DIFF (1.5s apart) ===
${JSON.stringify(dAB, null, 2)}
`
	await writeFile(`${OUT}/summary.txt`, summary)
	// biome-ignore lint/suspicious/noConsole: probe diagnostic logging
	console.log(`PROBE SUMMARY:\n${summary}`)

	if (errors.length) {
		test.info().attach('console-errors', 'text/plain', errors.join('\n'))
	}
	test.info().attach('frame-a-stats', 'text/plain', JSON.stringify(sA, null, 2))
	test.info().attach('a-vs-b-diff', 'text/plain', JSON.stringify(dAB, null, 2))
})
