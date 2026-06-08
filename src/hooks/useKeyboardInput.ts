import { useEffect, useRef } from 'react'
import type { SimulationInput } from '../game/types'

const LEFT_KEYS = new Set(['ArrowLeft', 'KeyA'])
const RIGHT_KEYS = new Set(['ArrowRight', 'KeyD'])
const CONTROL_KEYS = new Set([...LEFT_KEYS, ...RIGHT_KEYS])

const EMPTY_INPUT: SimulationInput = {
	left: false,
	right: false,
}

export function useKeyboardInput() {
	const inputRef = useRef<SimulationInput>(EMPTY_INPUT)
	const pressedKeysRef = useRef(new Set<string>())

	useEffect(() => {
		function syncInput() {
			const pressedKeys = pressedKeysRef.current

			inputRef.current = {
				left: hasAnyPressed(pressedKeys, LEFT_KEYS),
				right: hasAnyPressed(pressedKeys, RIGHT_KEYS),
			}
		}

		function handleKeyDown(event: KeyboardEvent) {
			if (!CONTROL_KEYS.has(event.code)) {
				return
			}

			event.preventDefault()
			pressedKeysRef.current.add(event.code)
			syncInput()
		}

		function handleKeyUp(event: KeyboardEvent) {
			if (!CONTROL_KEYS.has(event.code)) {
				return
			}

			event.preventDefault()
			pressedKeysRef.current.delete(event.code)
			syncInput()
		}

		function handleBlur() {
			pressedKeysRef.current.clear()
			inputRef.current = EMPTY_INPUT
		}

		window.addEventListener('keydown', handleKeyDown)
		window.addEventListener('keyup', handleKeyUp)
		window.addEventListener('blur', handleBlur)

		return () => {
			window.removeEventListener('keydown', handleKeyDown)
			window.removeEventListener('keyup', handleKeyUp)
			window.removeEventListener('blur', handleBlur)
		}
	}, [])

	return inputRef
}

function hasAnyPressed(
	pressedKeys: ReadonlySet<string>,
	keys: ReadonlySet<string>,
) {
	for (const key of keys) {
		if (pressedKeys.has(key)) {
			return true
		}
	}

	return false
}
