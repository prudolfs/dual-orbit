export type { CollisionResult, CreateObstacleStateOptions } from './obstacles'
export {
	checkObstacleCollisions,
	createObstacleState,
	getRewindObstacleIndices,
	hideRewindObstacles,
	markCollision,
	restoreObstaclesForRollback,
	updateObstacles,
} from './obstacles'
