import { Canvas, useFrame } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import { DEFAULT_TUNING, GalaxyDebug } from './debug/GalaxyDebug'
import { driveFrame, installBotIfDev } from './game/bot/installer'
import {
	advanceFixedSimulation,
	createInitialSimulation,
} from './game/simulation'
import type { SimulationState } from './game/types'
import { useKeyboardInput } from './hooks/useKeyboardInput'
import { GameScene } from './scene/GameScene'
import { createWebGPURenderer, RenderLoop } from './three/WebGPUCanvas'
import './App.css'

function App() {
	const galaxyDebug =
		typeof window !== 'undefined'
			? new URLSearchParams(window.location.search).has('galaxydebug')
			: false

	if (galaxyDebug) {
		return (
			<main className="game-shell" style={{ padding: 0 }}>
				<section
					className="game-stage"
					aria-label="Galaxy tuning debug"
					style={{ position: 'relative' }}
				>
					<GalaxyDebug tuning={DEFAULT_TUNING} />
				</section>
			</main>
		)
	}
	return <Game />
}

function Game() {
	const [simulation, setSimulation] = useState<SimulationState>(() =>
		createMenuSimulation(),
	)
	const accumulatorRef = useRef(0)
	const inputRef = useKeyboardInput()
	const hasStarted = simulation.tick > 0 || simulation.mode !== 'paused'

	// Install the `window.__BOT__` replay bridge in non-production builds so
	// Playwright can drive the real game with a deterministic scenario (see
	// docs/sample.md Phase 3). The bridge returns the seeded initial state via
	// `playScenario` and the ticker consumes bot frames via `driveFrame`.
	// Installed once on mount; the bridge's `setSimulation` is stable across
	// renders (React's state setter identity is constant for this component).
	useEffect(() => {
		installBotIfDev({
			setSimulation,
		})
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [])

	function startGame() {
		accumulatorRef.current = 0
		setSimulation(createInitialSimulation())
	}

	return (
		<main className="game-shell">
			<section
				className="game-stage"
				aria-label="Dual Orbit simulation preview"
			>
				<Canvas
					camera={{ position: [0, 2.5, 12], fov: 48, near: 0.1, far: 1000 }}
					gl={createWebGPURenderer}
					dpr={[1, 2]}
				>
					<SimulationTicker
						simulation={simulation}
						accumulatorRef={accumulatorRef}
						inputRef={inputRef}
						onSimulationChange={setSimulation}
					/>
					<GameScene simulation={simulation} />
					<RenderLoop />
				</Canvas>
				<div className="hud">
					<div>
						<span>Score</span>
						<strong>{simulation.stats.score}</strong>
					</div>
					<div>
						<span>Collisions</span>
						<strong>{simulation.stats.collisions.total}</strong>
					</div>
					<div>
						<span>Rewinds</span>
						<strong>{simulation.stats.rewinds}</strong>
					</div>
					<div>
						<span>Checkpoint</span>
						<strong>
							{simulation.generator.group}.{simulation.generator.levelPerGroup}
						</strong>
					</div>
				</div>
				<div className="actions">
					<button type="button" onClick={startGame}>
						{hasStarted ? 'Restart' : 'Start'}
					</button>
				</div>
				{simulation.mode === 'paused' ? (
					<div className="start-overlay">
						<button type="button" onClick={startGame}>
							Start
						</button>
					</div>
				) : null}
			</section>
		</main>
	)
}

function createMenuSimulation(): SimulationState {
	return {
		...createInitialSimulation(),
		mode: 'paused',
	}
}

type SimulationTickerProps = {
	readonly simulation: SimulationState
	readonly accumulatorRef: React.MutableRefObject<number>
	readonly inputRef: React.MutableRefObject<SimulationState['input']>
	readonly onSimulationChange: React.Dispatch<
		React.SetStateAction<SimulationState>
	>
}

function SimulationTicker({
	accumulatorRef,
	inputRef,
	onSimulationChange,
}: SimulationTickerProps) {
	useFrame((_, delta) => {
		onSimulationChange((current) => {
			// When the bot bridge is driving playback, step exactly one
			// deterministic tick per frame (bypassing the wall-clock
			// accumulator) so the live run matches the offline golden snapshot
			// to within the fixed timestep. `driveFrame` returns `current`
			// unchanged when the bot is idle, in which case we fall through to
			// the normal keyboard-driven fixed-timestep path.
			const botStepped = driveFrame(current)

			if (botStepped !== current) {
				return botStepped
			}

			const fixed = advanceFixedSimulation(current, delta * 1000, {
				accumulatorMs: accumulatorRef.current,
				collisionAction: 'rewind',
				input: inputRef.current,
			})
			accumulatorRef.current = fixed.accumulatorMs

			return fixed.simulation
		})
	})

	return null
}

export default App
