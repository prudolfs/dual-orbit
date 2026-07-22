import type { SimulationState } from '../types'
import type { BotBridge, BotBridgeHost, BotCaptureEvent } from '.'
import { advanceBotFrame, createBotBridge } from '.'

/**
 * Type of the `window.__BOT__` backdoor installed in the preview build.
 */
export type BotWindow = Window & {
	__BOT__?: BotBridge
}

/**
 * Install `window.__BOT__` on this window, returning the bridge instance.
 *
 * Gated to non-production at runtime by the caller (see {@link
 * installBotIfDev}); this installer does not itself read `import.meta.env`
 * so it stays unit-testable in a plain Node environment.
 */
export function installBot(host: BotBridgeHost): BotBridge {
	const win = globalThis as unknown as BotWindow
	const existing = win.__BOT__

	if (existing) {
		return existing
	}

	const bridge = createBotBridge(host)

	if (typeof win !== 'undefined' && win) {
		win.__BOT__ = bridge
	}

	return bridge
}

/**
 * Install `window.__BOT__` only outside production. Returns the bridge (or
 * `null` in a production build, mirroring `robotics-lab`'s `window.__E2E__`
 * gating).
 */
export function installBotIfDev(host: BotBridgeHost): BotBridge | null {
	if (import.meta.env.PROD) {
		return null
	}

	return installBot(host)
}

/**
 * Run one ticker frame through the bot if installed & active.
 *
 * Returns the simulation to render: the bot-stepped state when the bot drives,
 * otherwise the `fallback` state produced by the normal keyboard path.
 */
export function driveFrame(fallback: SimulationState): SimulationState {
	const bridge = (globalThis as unknown as BotWindow).__BOT__

	if (!bridge) {
		return fallback
	}

	const result = advanceBotFrame(fallback, bridge)

	if (result.kind === 'idle') {
		return fallback
	}

	return result.state
}

/**
 * Subscribe a capture-tick handler to the installed bridge (no-op when no bot
 * is installed, e.g. in production). Returns an unsubscribe.
 */
export function onBotCapture(
	handler: (detail: BotCaptureEvent) => void,
): () => void {
	const bridge = (globalThis as unknown as BotWindow).__BOT__

	if (!bridge) {
		return () => {}
	}

	return bridge.onCapture(handler)
}
