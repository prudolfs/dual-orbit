# Sample Capture: Deterministic Gameplay GIF

Plan for producing the animated GIF used as the README header. Unlike the
sibling `robotics-lab` project, the goal here is **not** E2E code coverage.
The goal is to capture readable gameplay highlights — gauntlets, near-misses,
rewinds — from a **deterministic** run of the simulation and stitch them into
a looping GIF.

The inspiration is the `robotics-lab` layout: a `/scripts` wrapper that
assembles a GIF from PNG frames captured by Playwright, plus a small
`screenshots/` test dir living under the app. We adapt that shape so the
**game** drives the capture instead of a behavioral test suite.

---

## Why an automated bot driver works

The simulation is the key enabler. From
[`simulation-architecture.md`](./simulation-architecture.md) and
[`mvp.md`](./mvp.md):

- Gameplay is **independent of rendering**. `tickSimulation(state, options)`
  is a pure function of `(state, input)` with no React, no Three.js and no
  browser APIs.
- Updates are **deterministic** with a fixed timestep
  (`FIXED_TIMESTEP_MS`). The same inputs always produce the same orbit
  angles, obstacle positions and collisions.
- Orbit motion is exact math: angular speed `2π / 90`, vertical speed
  `floor(4·radius / 90)`, clock/counterclockwise rotation from left/right
  input (`-1 | 0 | 1`).
- Obstacle spacing and rotation are computed from orbit position and speed,
  not from random jitter, so distances and orientations between orbs and
  obstacles are well-defined.
- The generator uses weighted chance curves and sealed randomness, so a
  seeded run reproduces obstacle layouts bit-for-bit.
- Rewind replays recorded input history backward — a deterministic replay of
  prior ticks, ideal for a "near-miss then rewind" highlight.

Because everything is computed from exact numbers, a **bot driver** can decide
"rotate right for `N` ticks then release" and *know* the resulting orb angles
and obstacle gaps ahead of time. It does not need vision or heuristics. It can
precompute a scenario, hand it to the real UI, and Playwright screenshots the
deterministic result. The screenshots are not of a fake renderer — they are of
the actual game running the actual simulation with the exact inputs.

---

## Layout

We mirror the `robotics-lab` shape but slim it down — no `apps/e2e` coverage
suite, just the screenshot capture harness:

```
scripts/
  build-readme-header.sh      capture frames with Playwright, assemble GIF with ffmpeg
screenshots/
  playwright.config.ts        capture-only Playwright config (separate from future test runs)
  readme-header.spec.ts        boots preview build, drives the bot, screenshots frames
src/
  game/
    bot/
      driver.ts               advance the pure simulation tick-by-tick with a scripted input timeline
      scenarios.ts            scripted input timelines that produce curated highlights
```

The `screenshots/` directory is not part of regular `pnpm test`. It is invoked
only by `scripts/build-readme-header.sh`, just like in `robotics-lab`.

---

## Implementation phases

### Phase 1 — Pure-simulation bot driver (`src/game/bot/driver.ts`) ✅

The simulation already exposes `createInitialSimulation` and
`tickSimulation`. The bot driver wraps them to step the simulation with a
scripted, deterministic input timeline — no DOM, no rendering. Output is a
sequence of `(tick, SimulationState, SimulationInput)` snapshots that the
browser side will replay.

Inputs are expressed as `DirectionState` (`-1 | 0 | 1`) per tick, built from
the exact rotation math in `game/simulation/orbit` and the collision math in
`game/math/collision`:

```ts
type BotStep = {
  readonly tick: number
  readonly direction: DirectionState // -1 left, 0 neutral, 1 right
  readonly collisionAction: 'rollback' | 'rewind'
}
type BotScenario = {
  readonly seed: number
  readonly steps: readonly BotStep[]
  readonly captureTicks: readonly number[] // ticks at which a frame should be grabbed
}
```

The driver reproduces a scenario by:

1. Creating a seeded initial simulation.
2. For each tick, applying `directionToInput(step.direction)` to `tickSimulation`.
3. Emitting each `(tick, state)` pair, marking `captureTicks`.

Done when a driver can step a scenario offline in Node and return every
snapshot, with output identical across runs (golden-snapshot in a Vitest test).

### Phase 2 — Curated highlight scenarios (`src/game/bot/scenarios.ts`) ✅

Hand-authored timelines producing readable highlights, chosen *because* the
numbers behind them are known. Examples:

- **Gauntlet** — a sequence of timed rotates that thread several obstacles in
  a row. Angles are computed from `angularSpeed` × tick count, so
  the scenario picks `N` ticks per rotate to land each orb in a specific gap.
- **Near-miss then rewind** — rotate to glance an obstacle, trigger a
  collision, and let the rewind replay produce a clean pass on the corrected
  side. The rewind path is deterministic input-replay, so the "clean pass" is a
  known follow-up.
- **Angular obstacle dodge** — for `angular` obstacles whose rotation is
  computed from encounter timing, the scenario times its rotate so an orb
  passes just as the bar sweeps out of the way.

Scenarios are authored against the pure simulation first, simulated offline,
and validated by assertions on the output (e.g. "a collision occurred at tick
T", "rewind count == 1 at the end"). A Vitest test pins each scenario's
golden snapshot so gameplay drift breaks the test, not the GIF.

Done when at least two scenarios exist as exported `BotScenario` values with
 Vitest golden-snapshot coverage for the full tick sequence.

### Phase 3 — Replay bridge into the browser ✅

The bot timeline must drive the *real* running game so Playwright screenshots
the actual R3F scene, not a second renderer. Two viable shapes:

- **A. Backdoor input timeline (preferred).** Expose `window.__BOT__` in the
  preview build (gated to non-production at runtime, mirroring `robotics-lab`'s
  `window.__E2E__` bridge): `window.__BOT__.playScenario(scenario)` injects
  the scenario into the input layer in place of the keyboard hook and steps
  the identical `useFrame` loop. The screenshot is of the real UI + real sim.
- **B. Keyboard synthesis fallback.** If the input bridge is undesirable,
  Playwright synthesizes keydown/keyup for left/right at the right wall-clock
  timestamps derived from `tick * FIXED_TIMESTEP_MS`. Less precise (depends on
  the render loop's accumulator), but adequate for a 6-frame GIF.

The bridge must reuse the same `tickSimulation` module the player uses — no
parallel simulation — so the screenshot and the offline golden snapshot are
governed by the same code path.

Done when the preview build exposes a bot replay path and a tiny unit test
confirms the browser-driven state at a capture tick matches the offline
golden snapshot to within the fixed-timestep.

### Phase 4 — Playwright capture spec (`screenshots/`)

A capture-only Playwright config and spec, adapted from `robotics-lab`:

```
screenshots/
  playwright.config.ts   testDir: '.', own webServer (Vite preview on a port),
                          separate from any future regular test run
  readme-header.spec.ts      boots build, plays the scenario via the bridge,
                          screenshots at the scenario's captureTicks
```

The spec:

1. Reads `E2E_FRAMES_DIR` (set by the wrapper) for PNG output.
2. Loads the scenario (`import` from `src/game/bot/scenarios`), or receives it
   over the `window.__BOT__` bridge.
3. Calls `window.__BOT__.playScenario(scenario)` and screenshots at each
   `captureTick`, writing `frame-0001.png`, `frame-0002.png`, … (zero-padded for
   ffmpeg's sequence input).
4. Asserts the expected number of frames were written.

Because the timeline is deterministic, capture ticks can be chosen to land on
*peak moments* — the instant an orb slips through a gap, the start of the
rewind, the stabilized state after rewind — rather than guessing at
wall-clock delays (which is what `robotics-lab` does).

Done when `pnpm exec playwright test --config screenshots/playwright.config.ts`
writes a clean frame sequence from the preview build.

### Phase 5 — GIF assembly wrapper (`scripts/build-readme-header.sh`)

Port the `robotics-lab` script almost verbatim, dropping the workspace
references and pointing at the single Vite app:

```
scripts/build-readme-header.sh [output.gif]
  # Env knobs (same idea as robotics-lab):
  #   SCENARIO        scenario name from src/game/bot/scenarios (default: gauntlet)
  #   FRAME_COUNT     frames to capture (overridden by scenario.captureTicks when set)
  #   FRAME_MS        wall-clock ms between frames (fallback cadence)
  #   WIDTH           output GIF width (default 1200, height kept even)
  #   FRAMERATE        GIF playback fps (defaults to 1000/FRAME_MS)
```

Steps:

1. Verify repo root and `ffmpeg` on PATH.
2. Build the app (`pnpm build`) once if the preview build is stale.
3. `mktemp -d`, set `E2E_FRAMES_DIR`, run the Playwright capture spec with the
   `chromium` project via the `screenshots/playwright.config.ts`.
4. Two-pass palette GIF with ffmpeg (palettegen + paletteuse, `sierra2_4a`
   dither, `scale=${width}:-2:flags=lanczos`), exactly like the parent project.
5. Write `docs/readme-header.gif`.

Done when the script runs end-to-end from the repo root and emits a looping
GIF referenced by the root `README.md` header.

### Phase 6 — Golden-snapshot test + README wiring

- Add a `pnpm test:snapshot` (Vitest) workflow that runs the bot driver offline
  for all scenarios and compares the tick sequence against golden JSON. Update
  goldens deliberately when gameplay intentionally changes. This makes the GIF
  a *test artifact*: gameplay drift breaks CI before the GIF goes stale.
- Wire a root npm script:
  ```json
  "readme:header": "scripts/build-readme-header.sh"
  ```
- Ensure `docs/readme-header.gif` is committed (or built in CI) so the README
  displays correctly out of the box.

Done when `pnpm readme:header` regenerates the GIF and
`pnpm test:snapshot` keeps the scenarios honest.

---

## Non-goals

This pipeline is **not**:

- An E2E coverage suite. It does not assert scores, beat levels, or cover UI
  edge cases. That belongs in a future `e2e/` suite if/when added, mirroring
  `robotics-lab` only once parity regression becomes a concern.
- A renderer test. It screenshots the real R3F canvas, but visual fidelity
  (e.g. exact colors) is out of scope for MVP.
- A human-playability benchmark. The bot driver plays mechanically; whether
  a scenario is "fun" is decided at author time in `scenarios.ts`.

The single deliverable is the looping GIF in `docs/readme-header.gif`, shown
in the root `README.md`, produced from a deterministic run so it never gets
out of sync with the simulation.
