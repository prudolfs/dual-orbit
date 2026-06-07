import { Canvas, useFrame } from '@react-three/fiber'
import { useRef, useState } from 'react'
import {
	advanceFixedSimulation,
	createInitialSimulation,
} from './game/simulation'
import type { SimulationState } from './game/types'
import { GameScene } from './scene/GameScene'
import './App.css'

function App() {
	const [simulation, setSimulation] = useState<SimulationState>(() =>
		createInitialSimulation(),
	)
	const accumulatorRef = useRef(0)

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
						<span>Mode</span>
						<strong>{simulation.mode}</strong>
					</div>
					<div>
						<span>Obstacles</span>
						<strong>{simulation.stats.obstacles}</strong>
					</div>
				</div>
			</section>
		</main>
	)
}

type SimulationTickerProps = {
	readonly simulation: SimulationState
	readonly accumulatorRef: React.MutableRefObject<number>
	readonly onSimulationChange: React.Dispatch<
		React.SetStateAction<SimulationState>
	>
}

function SimulationTicker({
	accumulatorRef,
	onSimulationChange,
}: SimulationTickerProps) {
	useFrame((_, delta) => {
		onSimulationChange((current) => {
			const fixed = advanceFixedSimulation(current, delta * 1000, {
				accumulatorMs: accumulatorRef.current,
			})
			accumulatorRef.current = fixed.accumulatorMs

			return fixed.simulation
		})
	})

	return null
}

export default App
