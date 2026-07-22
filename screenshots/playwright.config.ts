import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright config used *only* by `scripts/build-readme-header.sh` (Phase 5)
 * to capture the README header GIF. Adapted from `robotics-lab`'s
 * `screenshots/playwright.config.ts`: `testDir: '.'`, its own `webServer`
 * (Vite dev server on :8090 here), separate from the regular Vitest test run.
 *
 * The webServer launches the dev build (`pnpm dev`) so `import.meta.env.DEV`
 * is `true` and `installBotIfDev` exposes `window.__BOT__` (Phase 3 bridge),
 * letting the spec drive the real game with a deterministic bot scenario.
 * Phase 5 will swap this for a `VITE_BOT_BRIDGE=1 pnpm preview` of the
 * production build once it is wired up.
 *
 * Invoke through the wrapper, never `playwright test` directly.
 */
export default defineConfig({
	testDir: '.',
	outputDir: '.results',
	timeout: 120_000,
	expect: { timeout: 15_000 },
	retries: 0,
	workers: 1,
	reporter: [['list']],
	use: {
		baseURL: 'http://localhost:8090',
		headless: true,
		viewport: { width: 1280, height: 720 },
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		video: 'retain-on-failure',
		launchOptions: {
			args: ['--js-flags=--expose-gc'],
		},
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
		},
	],
	webServer: {
		command: 'pnpm dev --port 8090 --strictPort',
		url: 'http://localhost:8090',
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
})
