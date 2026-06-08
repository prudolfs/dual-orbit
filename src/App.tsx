import { Canvas, useFrame } from '@react-three/fiber'
import { useRef, useState } from 'react'
import {
	advanceFixedSimulation,
	createInitialSimulation,
} from './game/simulation'
import type { SimulationState } from './game/types'
import { useKeyboardInput } from './hooks/useKeyboardInput'
import { GameScene } from './scene/GameScene'
import './App.css'

function App() {
	const [simulation, setSimulation] = useState<SimulationState>(() =>
		createMenuSimulation(),
	)
	const accumulatorRef = useRef(0)
	const inputRef = useKeyboardInput()
	const hasStarted = simulation.tick > 0 || simulation.mode !== 'paused'

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
					gl={{ antialias: true }}
					dpr={[1, 2]}
				>
					<SimulationTicker
						simulation={simulation}
						accumulatorRef={accumulatorRef}
						inputRef={inputRef}
						onSimulationChange={setSimulation}
					/>
					<GameScene simulation={simulation} />
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
