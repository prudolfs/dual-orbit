// Comparison probe: load the reference screenshot-014.png (the actual
// reference image from the user) and our current `.temp/screenshot-025.png`,
// then compute perpendicular-axis thickness profiles for each. The point
// is to objectively distinguish "paper sheet" (sharp vertical falloff of
// brightness perpendicular to the disc plane) from "3D volume" (slow,
// bulky perpendicular falloff with a wide bright plateau).

import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { type Page, test } from '@playwright/test'

async function profile(page: Page, b64: string) {
	return page.evaluate(async (b: string) => {
		const buf = Uint8Array.from(atob(b), (c) => c.charCodeAt(0)).buffer
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
		let cx = 0
		let cy = 0
		let minX = w
		let maxX = -1
		let minY = h
		let maxY = -1
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
		const bw = maxX - minX + 1
		const bh = maxY - minY + 1
		// pick brightest column near centre
		let bestCol = Math.floor(cx)
		let bestSum = 0
		for (
			let x = Math.max(0, Math.floor(cx) - 40);
			x < Math.min(w, Math.floor(cx) + 40);
			x += 1
		) {
			let s = 0
			for (let y = minY; y <= maxY; y += 1) {
				const i = (w * y + x) * 4
				const lum = (d[i] + d[i + 1] + d[i + 2]) / 3
				if (lum >= 30) s += lum
			}
			if (s > bestSum) {
				bestSum = s
				bestCol = x
			}
		}
		// Vertical profile (perpendicular-to-disc-plane brightness)
		const vert: number[] = []
		for (let y = minY; y <= maxY; y += 1) {
			const i = (w * y + bestCol) * 4
			const lum = (d[i] + d[i + 1] + d[i + 2]) / 3
			vert.push(lum)
		}
		// Horizontal profile (along disc plane)
		const horiz: number[] = []
		for (let x = minX; x <= maxX; x += 1) {
			const i = (w * Math.floor(cy) + x) * 4
			const lum = (d[i] + d[i + 1] + d[i + 2]) / 3
			horiz.push(lum)
		}
		// Find FWHM indices where lum > threshold * max for both axes
		const fwhm = (arr: number[], k: number) => {
			const max = Math.max(...arr)
			let first = -1
			let last = -1
			for (let i = 0; i < arr.length; i += 1)
				if (arr[i] >= max * k) {
					first = i
					break
				}
			for (let i = arr.length - 1; i >= 0; i -= 1)
				if (arr[i] >= max * k) {
					last = i
					break
				}
			return { first, last, width: last - first + 1, max }
		}
		const vhalf = fwhm(vert, 0.5)
		const vqtr = fwhm(vert, 0.25)
		const hhalf = fwhm(horiz, 0.5)
		const hqtr = fwhm(horiz, 0.25)
		// Perpendicular peak-centered tail mean luminance
		// (high = slow rolloff = volume; low = sharp = sheet)
		const peakIdx = vert.indexOf(vhalf.max)
		const rightTail = vert.slice(peakIdx + 1)
		const leftTail = vert.slice(0, peakIdx).reverse()
		const tailMaxLen = Math.min(50, rightTail.length, leftTail.length) || 0
		const take =
			tailMaxLen > 0
				? (t: number[]) =>
						t.slice(0, tailMaxLen).reduce((s, v) => s + v, 0) / tailMaxLen
				: () => 0
		const rtMean = take(rightTail)
		const ltMean = take(leftTail)
		return {
			size: `${w}x${h}`,
			totalBright,
			bbox: `${bw}x${bh}`,
			ratio: +(bh / bw).toFixed(3),
			centroid: `(${Math.round(cx)},${Math.round(cy)})`,
			bestCol,
			vertHalfFW: `${vhalf.width}px @ max=${vhalf.max}`,
			vertQtrFW: `${vqtr.width}px`,
			horizHalfFW: `${hhalf.width}px @ max=${hhalf.max}`,
			horizQtrFW: `${hqtr.width}px`,
			thicknessRatio: +(vhalf.width / hhalf.width).toFixed(4),
			thicknessRatioQtr: +(vqtr.width / hqtr.width).toFixed(4),
			rightTailMean: Math.round(rtMean),
			leftTailMean: Math.round(ltMean),
			tailRatio: +((rtMean + ltMean) / (2 * vhalf.max)).toFixed(3),
			vertDownsample: vert.filter(
				(_, i) => i % Math.max(1, Math.floor(vert.length / 60)) === 0,
			),
			horizDownsample: horiz.filter(
				(_, i) => i % Math.max(1, Math.floor(horiz.length / 60)) === 0,
			),
		}
	}, b64)
}

test('reference-vs-ours depth profile', async ({ page }) => {
	await mkdir('.temp/refcmp', { recursive: true })
	const ref = readFileSync('.temp/screenshot-014.png').toString('base64')
	const ours = readFileSync('.temp/screenshot-029.png').toString('base64')
	await page.goto('about:blank')
	const r = await profile(page, ref)
	const o = await profile(page, ours)
	// biome-ignore lint/suspicious/noConsole: probe diagnostic logging
	console.log('REF ', JSON.stringify(r, null, 2))
	// biome-ignore lint/suspicious/noConsole: probe diagnostic logging
	console.log('OURS', JSON.stringify(o, null, 2))
	await writeFile(
		'.temp/refcmp/result.json',
		JSON.stringify({ ref: r, ours: o }, null, 2),
	)
})
