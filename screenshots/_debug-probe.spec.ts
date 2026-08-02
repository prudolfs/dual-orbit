import { mkdir, writeFile } from 'node:fs/promises'
import { type Page, test } from '@playwright/test'

async function profile(page: Page, b64: string) {
	return page.evaluate(async (b: string) => {
		const buf = Uint8Array.from(atob(b), (c) => c.charCodeAt(0)).buffer
		const bmp = await createImageBitmap(new Blob([buf], { type: 'image/png' }))
		const canvas = document.createElement('canvas')
		canvas.width = bmp.width
		canvas.height = bmp.height
		const ctx = canvas.getContext('2d')!
		ctx.drawImage(bmp, 0, 0)
		const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
		const { data: d, width: w, height: h } = img
		let totalBright = 0
		let cx = 0,
			cy = 0,
			minX = w,
			maxX = -1,
			minY = h,
			maxY = -1
		for (let y = 0; y < h; y += 1) {
			for (let x = 0; x < w; x += 1) {
				const i = (w * y + x) * 4
				const lum = (d[i] + d[i + 1] + d[i + 2]) / 3
				if (lum < 30) continue
				totalBright++
				cx += x
				cy += y
				if (x < minX) minX = x
				if (x > maxX) maxX = x
				if (y < minY) minY = y
				if (y > maxY) maxY = y
			}
		}
		cx /= totalBright
		cy /= totalBright
		const bw = maxX - minX + 1,
			bh = maxY - minY + 1
		// pick brightest column near center
		let bestCol = Math.floor(cx),
			bestSum = 0
		for (
			let x = Math.max(0, Math.floor(cx) - 40);
			x < Math.min(w, Math.floor(cx) + 40);
			x++
		) {
			let s = 0
			for (let y = minY; y <= maxY; y++) {
				const i = (w * y + x) * 4
				const l = (d[i] + d[i + 1] + d[i + 2]) / 3
				if (l >= 30) s += l
			}
			if (s > bestSum) {
				bestSum = s
				bestCol = x
			}
		}
		const vert: number[] = []
		for (let y = minY; y <= maxY; y++) {
			const i = (w * y + bestCol) * 4
			vert.push((d[i] + d[i + 1] + d[i + 2]) / 3)
		}
		const horiz: number[] = []
		for (let x = minX; x <= maxX; x++) {
			const i = (w * Math.floor(cy) + x) * 4
			horiz.push((d[i] + d[i + 1] + d[i + 2]) / 3)
		}
		const fwhm = (arr: number[], k: number) => {
			const max = Math.max(...arr)
			let first = -1,
				last = -1
			for (let i = 0; i < arr.length; i++)
				if (arr[i] >= max * k) {
					first = i
					break
				}
			for (let i = arr.length - 1; i >= 0; i--)
				if (arr[i] >= max * k) {
					last = i
					break
				}
			return { width: last - first + 1, max }
		}
		const vq = fwhm(vert, 0.25)
		const vh = fwhm(vert, 0.5)
		const hq = fwhm(horiz, 0.25)
		const hh = fwhm(horiz, 0.5)
		return {
			size: `${w}x${h}`,
			totalBright,
			bbox: `${bw}x${bh}`,
			thicknessRatioQtr: +(vq.width / hq.width).toFixed(4),
			thicknessRatioHalf: +(vh.width / hh.width).toFixed(4),
			vertMax: vq.max,
			vertHalfFW: vh.width,
			vertQtrFW: vq.width,
			horizMax: hh.max,
			horizHalfFW: hh.width,
			horizQtrFW: hq.width,
		}
	}, b64)
}

test('debug-scene volume probe', async ({ page }) => {
	await mkdir('.temp/debug-probe', { recursive: true })
	await page.goto('http://localhost:8090/?galaxydebug&gx_z=1.0')
	// Wait for shader compile + first frames to settle
	await page.waitForTimeout(2500)
	// Trigger an orbit-view angle that exposes the disc thickness (similar
	// to reference (10,6,10) camera) — already the default camera pos.
	const b64 = (await page.screenshot({ type: 'png' }))?.toString('base64')
	const r = await profile(page, b64)

	await writeFile('.temp/debug-probe/result.json', JSON.stringify(r, null, 2))
	await writeFile(
		'.temp/screenshot-031.png',
		Buffer.from(b64.slice(0, b64.length), 'base64'),
	)
	await page.screenshot({ path: '.temp/screenshot-031.png' })
})
