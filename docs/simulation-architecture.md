# Simulation Architecture

Phase 0 reverse-engineering notes for porting `/Users/rudolfspukitis/Code/duet-game` from Phaser to a renderer-independent TypeScript simulation.

## Source Gameplay Map

The original game is split across these Phaser modules:

* `src/state/Game.js`: lifecycle, input, update modes, collision reactions, rollback/rewind, checkpoints, scoring counters.
* `src/entities/Orbit.js`: dual-orb angular motion, orbit constants, stability checks, rewind and rollback counters.
* `src/entities/Obstacles.js`: obstacle construction, per-kind movement, collision dispatch, shrink, rewind hiding, rollback restore.
* `src/data/Generator.js`: obstacle archetypes, chance curves, wave counts, vertical spacing, mirrored/moving/angular placement.
* `src/utils/Utils.js`: collision math, interpolation, easing helpers, random selection.

Rendering, audio, tweens, camera, HUD, and particles are side effects around the gameplay state. The port should keep these outside the authoritative simulation.

## Simulation State

Core state should be plain TypeScript data:

* `mode`: `running`, `rewinding`, `stabilizing`, `rollingBack`, `checkpoint`, `gameOver`, or `paused`.
* `tick`: fixed-step frame counter.
* `orbit`: center position, start position, radius, vertical speed, orb radius, angular speed, rollback tick count, rewind tick count, rewind speed, rewind target Y, stabilize direction.
* `orbs`: two local orbiting bodies with side, angle, local position, and collision flag. Initial left angle is `Math.PI`; initial right angle is `0`.
* `input`: current left/right state plus direction memory entries `{ state: -1 | 0 | 1, enterTick, exitTick }`.
* `obstacles`: ordered obstacle list with id, archetype alias/name, kind, position, size, rotation, speed, alive/exists/shrunken flags.
* `generator`: level, group, level-per-group, wave parameters, chance values, random source state once determinism is tightened.
* `stats`: obstacle count, encounters, score, total collisions, safe collisions.

Use small value objects such as `{ x, y }`, rectangles, and obstacle discriminated unions instead of Phaser groups or sprites.

## Original Constants To Preserve

The source uses resolution-scaled gameplay constants:

* Orbit radius: `160 * scale / 2` at runtime sprites; generator uses `640 * scale / 2` for authored data.
* Orbit vertical speed: `Math.floor(4 * orbitRadius / 90)`.
* Orb angular speed: `2 * Math.PI / 90`.
* Rewind speed: `2`.
* Rewind reset speed: `2`.
* Rollback speed: `4`.
* Rewind booster rewinds two previous obstacles; shrink rewinds two and shrinks one.

The TypeScript simulation should define these explicitly and document any normalization between original Phaser pixels and the R3F world scale.

## Authoritative Update Order

The default Phaser `updateUp` order is:

1. Check whether the level/checkpoint is complete.
2. Check collisions against current positions.
3. If a collision exists, resolve booster/life/game-over behavior and switch update mode.
4. Increment `rollbackTicks`.
5. Convert left/right input into a direction memory state.
6. Extend the current direction memory entry, or append a new entry when input changes.
7. Update obstacles forward with direction `1`.
8. Update orbit angular position from current input.
9. Move the orbit center upward by `orbitSpeed`.
10. Update camera/backdrop/HUD counters.

For the port, camera/backdrop/HUD become render/UI subscribers. Steps 1 through 9 stay in simulation modules.

## Rewind And Rollback

The original rewinds by replaying direction memory backward rather than storing full world snapshots.

`updateBack` performs one reverse step:

1. Read the latest direction memento.
2. Update obstacles with direction `-1`.
3. Update orbit angles using the recorded memento and scale `-1`.
4. Move orbit center downward by `orbitSpeed`.
5. Decrement `rollbackTicks`.
6. Pop direction mementos whose entered range has been passed.
7. If memory is exhausted, reset rollback ticks and seed neutral memory.

`updateRollback` runs `rollbackSpeed` reverse steps per rendered frame until history is exhausted, then restores hidden/shrunken obstacles unless the active booster is rollback.

`updateRewind` runs `rewindSpeed` reverse steps per frame and decrements `rewindTicks`. When rewind ends, it either returns to running if stable or enters stabilization.

`updateStabilize` rotates forward using `stabilizeDirection` until the left orb is near `0` or `Math.PI`.

## Collision

Collision is math-driven and independent of Phaser physics:

* Static and moving obstacles use circle vs axis-aligned rectangle.
* Angular obstacles rotate the orb point into obstacle-local space, then use circle vs axis-aligned rectangle.
* Each obstacle checks both orbs and returns the first colliding obstacle in ordered obstacle list traversal.

The port should preserve strict comparison `distanceSquared < radius * radius` from `Utils.circleVsRect`.

## Obstacle Movement

Obstacle kinds:

* `static`: fixed position.
* `moving`: vertical interpolation between neighboring obstacles based on orbit position and obstacle speed.
* `angular`: rotation changes by `speed * direction * scale`; initial rotation is derived from time until encounter.
* `angular_long`: same as angular, with a different initial rotation formula.

Obstacle order matters because moving obstacles inspect previous and next siblings, collision returns the first hit, encounter counting walks from the end, and rewind selects obstacles by index around the collision.

## Generator

The generator builds obstacle archetypes, sorts available archetypes by current chance, chooses weighted random entries, then expands entries into actual entities with spacing offsets.

Key concepts to port:

* `Wave` controls the number of selected obstacle definitions per level/group.
* `Chance` controls when each archetype enters progression and how its weight changes.
* `mirror` entries can create paired obstacles.
* `moving` entries create a previous mirror, the moving obstacle, then a following mirror.
* `angular` and `angular_long` compute initial rotation so rotation lines up with the orbit encounter timing.

For deterministic tests, replace `Math.random()` with an injected seeded random function before relying on generator parity.

## Proposed Module Boundaries

Initial simulation modules:

* `game/types`: shared state types and discriminated unions.
* `game/constants`: preserved gameplay constants and world normalization.
* `game/math`: clamp, normalize, lerp, easing, collision geometry.
* `game/simulation/orbit`: create orbit, rotate orbs, stability checks.
* `game/simulation/obstacles`: update obstacle motion, collision checks, shrink/rollback helpers.
* `game/simulation/rewind`: direction memory and reverse stepping.
* `game/simulation/generator`: archetypes, chance, wave, entity expansion.
* `game/simulation/tick`: authoritative fixed-step update orchestration.

React, Zustand, and R3F should consume snapshots from these modules but should not own gameplay rules.
