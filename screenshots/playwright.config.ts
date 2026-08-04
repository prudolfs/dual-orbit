import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright config used *only* by `scripts/build-readme-header.sh` (Phase 5)
 * to capture the README header GIF. Adapted from `robotics-lab`'s
 * `screenshots/playwright.config.ts`: `testDir: '.'`, its own `webServer`
 * (Vite preview on :8090), separate from the regular Vitest test run.
 *
 * The webServer builds the production bundle with `VITE_BOT_BRIDGE=1` and
 * serves it via `vite preview`, so the Phase 3 bot bridge is installed at
 * runtime (`installBotIfDev` opts in on the flag) and the spec drives the
 * *real* running game with a deterministic scenario. Plain production builds
 * (without the flag) never ship the bridge.
 *
 * Invoke through the wrapper, never `playwright test` directly.
 */
export default defineConfig({
	testDir: '.',
	outputDir: '.results',
	timeout: 1200_000,
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
		command:
			'VITE_BOT_BRIDGE=1 pnpm build && VITE_BOT_BRIDGE=1 pnpm preview --port 8090 --strictPort',
		url: 'http://localhost:8090',
		reuseExistingServer: !process.env.CI,
		timeout: 180_000,
	},
})
