const fullTurn = Math.PI * 2

export function normalizeAngle(angle: number): number {
	const normalized = angle % fullTurn

	if (normalized < 0) {
		return normalized + fullTurn
	}

	return normalized
}
