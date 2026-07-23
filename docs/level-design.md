# Level Design

How the obstacle field is placed, why its spacing is what it is, and what
math guarantees every obstacle is _reachable_ by the orbit's speed and
rotation. This is the design rationale for
`src/game/simulation/generator/generator.ts`; the runtime contract lives in
[`simulation-architecture.md`](./simulation-architecture.md).

## The two invariants the design hangs on

The whole field is tuned against two exact numbers — both expressions of the
fixed timestep, so everything is closed-form:

1. **Orbit vertical speed** — `verticalSpeed =
floor(ORBIT_VERTICAL_SPEED_FACTOR · radius) = floor(4/90 · radius)`.
   With the default resolution `sd` (`radius = ORBIT_DIAMETER · scale / 2 =
640 · 0.5 / 2 = 160`), `verticalSpeed = 7` sim units/tick. The orbit
   _descends exactly 7 units per tick_, forever.
2. **Orb angular speed** — `angularSpeed = ORB_ANGULAR_SPEED = 2π / 90`
   rad/tick. One full orb lap is **90 ticks**; each orb therefore rotates
   `4°/tick`, and after 45 ticks it is on the _opposite_ side of the orbit.

Both speeds are derived from the same denominator `90`, so a tick count is
also an angle, an angular distance, and a height. This is the lever the
generator uses to make every spawn a _solvable_ puzzle.

## The orbit shape

`createOrbitState` (`game/simulation/orbit/orbit.ts`) places the orbit at
`center = (area.centerX, area.height - radius - orbRadius)` — top of the play
area, centred horizontally — with two orbs at the orbit's `π` (left) and `0`
(right) shoulders:

- `positionOnOrbit(angle, radius) = (cos·radius, sin·radius)`, i.e. world
  position is `center + localPosition`.
- `rotateOrb` advances `angle` by `angularSpeed · direction · scale`; `direction ∈ {-1, 0, 1}` from
  `inputToDirection(left/right)`.`direction = 1` swings both orbs **clockwise**
  (decreasing y on the right orb), `direction = -1` swings them counter-clockwise.
- `moveOrbitVertically(orbit, ±1)` shifts `center.y` by `∓verticalSpeed`. The
  running tick always passes `direction = 1` (down, decreasing y).

So at any tick `t` from start we know, _without simulating_:

- orbit `center.y = start.y − 7·t`
- left orb angle `= π + (2π/90)·A_left`
- right orb angle `= 0 + (2π/90)·A_right`

where `A` is the _signed_ tick-count of rotation accumulated so far. The orbs'
world `x`, `y` follow directly: `center + (cos·r, sin·r)`. This is the closed
form behind "the bot knows where every orb will be at tick `t`".

## How an obstacle row is placed

`generateObstacleLayout(state, orbit)` produces one "level's worth" of
obstacles. The pipeline:

1. **`selectLevelArchetypes`** — pick how many archetypes this level spawns
   and which ones, weighted by `chance.value`.
2. **`expandArchetypes`** — walk the chosen list and stamp out concrete
   `ObstacleState`s, threading a running `offset.y` cursor down the field
   (obstacles always sit _below_ the orbit; `y` decreases).

### Spacing: the `offset` cursor

`createEntity` does:

```
y        = offset.y − max(archetype.offsetBottom, offset.top)
offset.y = y
offset.top = archetype.offsetTop
```

So each obstacle is placed `max(offsetBottom, prevTop)` below the previous
one, and exposes its own `offsetTop` for the next obstacle to clear. Two
shapes dominate the templates:

- `offset = orbit.diameter` (≈ 320 sim units at `sd`): tight rows close
  enough that the orbit _(radius 160)_ is never more than one row away.
- `offset = orbit.radius · 3` or `orbit.diameter · 2`: breathers.

Either way, the spacing is **a multiple of the orbit's geometric envelope**,
never an arbitrary pixel count. That keeps "the next row is exactly
`verticalSpeed · ticks` away" — a countable, solvable distance.

### The closed form for "time to reach the next row"

Because the orbit descends at `verticalSpeed` and a row is `Δy` below,
the ticks until the orbit's leading edge meets the row's centre is

```
t_reach = (orbit.center.y − orbit.radius − row.y) / orbit.verticalSpeed
```

This is the same expression the generator uses to _pre-compute angular
bar rotations_ (see below) — it is also the expression the bot uses to know
"rotate for `Δt` ticks starting `t_reach − Δt` to be mid-rotation when the
orbit arrives".

## Kinds and how each is reached

`ObstacleKind = 'static' | 'moving' | 'angular' | 'angular_long'`. The
rendered `kind` of a `mirror` template is `static`; mirrors render as a
paired sprite but collide as a normal rect.

### `static` — thread the gap

An axis-aligned rectangle of `width × height` centred at `(offsetX, y)`. The
two orbs must be on the side(s) of the orbit _not_ covered by the bar.
`offsetX` in the templates is one of `orbit.left`, `orbit.right`, or
`area.centerX` — i.e. the bar covers _one shoulder_ of the orbit. To pass:

- if the bar is on the right (`offsetX = orbit.right`), the right orb must be
  swung up to the top (`angle → 3π/2 ≈ 270°`, reachable in `~45` ticks of
  rotation)
- if the bar is on the left, the left orb must swing down to the bottom (`0°
→ 90°`, also `~45` ticks)
- if the bar is centred (`offsetX = area.centerX`), both orbs must clear it
  together — they sit at top/bottom corners. This is the "duet" beat the game
  is built around.

Because `45` ticks at `verticalSpeed 7` is `~315` sim units — exactly the
order of `offset = orbit.diameter ·~2` breathers — a centred bar can always be
cleared _within the breathing room before the bar reaches the orbit_.

### `moving` — timed oscillation

`updateMovingObstacle` (`game/simulation/obstacles/obstacles.ts`) slides the
bar between its two neighbours' `y` positions, hanging around the midpoint
`c = a + (b − a)/2` and biasing toward the further neighbour as the orbit
approaches. Its placement is interleaved with the static bar it mirrors, so a
"static right, moving left" pair forces the player to _time_ the swing rather
than park the orbs. `speed = orbit.speed/2 | orbit.speed` keeps the bar's
travel inside the same fixed-timestep envelope as the orbit itself.

### `angular` — the signature rotating bar

`width ≈ 740·scale`, `height ≈ 160·scale`, `speed ± orbSpeed` (i.e.
`± 2π/90`). `_long` is `width ≈ 1280·scale`, `speed = ± orbSpeed/4` (slow
structure).

`updateObstacles` advances rotation as `rotation += speed · direction · scale`
each tick — so an `angular` bar completes a half-turn in **45 ticks**, the
same 45 ticks an orb needs to swing from one shoulder to the opposite
shoulder. **That is the deliberate coupling**: the bar sweeps at the _same
angular cadence as the orbs_, so the gap in the bar orbits in lockstep with the
orbs' ability to relocate. The puzzle is to _synchronise_, not to outrun.

The crucial kicker is the **spawn-time pre-rotation**, computed in
`createEntity`:

```ts
// angular, speed >= 0
rotation =  π/2 − speed · ((orbit.center.y − orbit.radius − y) / orbit.verticalSpeed)
// angular, speed < 0
rotation = −π/2 + |speed · ((orbit.center.y − orbit.radius − y) / orbit.verticalSpeed)|

// angular_long, speed >= 0
rotation = −π/12 − speed · ((orbit.center.y − orbit.radius − h/2 − y) / orbit.verticalSpeed)
// angular_long, speed < 0
rotation =  π/12 + |speed · ((orbit.center.y − orbit.radius − h/2 − y) / orbit.verticalSpeed)|
```

The fraction `(orbit.center.y − orbit.radius − y) / verticalSpeed` is exactly
**`t_reach`**, the tick count from spawn until the orbit's leading edge
meets the bar's `y`. Multiplying by `speed` (`2π/90` rad/tick) yields _the
angle the bar would have swept in that time_. The bar is therefore **born at
the phase it will be in when the orbit actually gets there**: at encounter the
bar's rotation equals `spawnPhase − |speed|·t_reach`.

This is the design contract:

> An `angular` bar at distance `Δy` below the orbit, rotating at `±orbSpeed`,
> is placed at the rotation that makes its encounter-time orientation a pure
> function of `Δy`. If you know `Δy`, you know the gap's orientation when the
> orbit arrives — and you know how many ticks of pre-rotation the orbs need
> to **be** in that gap.

`π/2` / `−π/2` (and the `π/12` bias on `_long`) is the bar's orientation at
_tick 0 of a fresh run_ (vertical bar, gap on the right for `+speed`, on the
left for `−speed`); the formula only rolls that forward by `t_reach`.

## Weighted choice and the "wave"

### `selectLevelArchetypes`

The number of archetypes spawned at a level is `tweenWave(...)`, easing from
`startMin=5 / startMax=10` at the start of a group to `endMin=10 / endMax=15`
at the end of all groups (`WaveState`), so density grows smoothly across the
whole run. Within that count, each archetype's weight is its `chance.value`
at the **absolute level**

```
absoluteLevel = levelPerGroup + levelsPerGroup · (group − 1)
            ∈ [1, levelsPerGroup · groups]   (= [1, 48] by default)
```

`createObstacleArchetypes` converts each template's chance arrays into a
window:

```
min = (level_factor · levelsPerGroup) || 1   + levelsPerGroup · ((group_factor · groups) − 1)
max = levelsPerGroup · groups
```

`tweenChance` zeroes an archetype outside `[min, max]` and eases its weight
from `start` to `end` inside it. So a `chance.level = 0.5, chance.group = 0.5`
archetype at default `levelsPerGroup=8, groups=6` resolves to
`min = 4 + 8·2 = 20`, `max = 48` — i.e. **appears from absolute level 20
onward**. The `angular` `rect2` triplets resolve to chance windows at absolute levels
**12, 17, and 20**→48 (their per-variant `level_factor ∈ {0, 0.5}` and
`group_factor ∈ {0.3, 0.5}` plug into the formula above). The
`angular_long` `rect8` template uses `level 0.5 / group 0.5` (window 17→48)
with a **`quarticOut` chance ramp**, so it only carries weight deep in the
back half of the run.

`chooseWeighted` then picks an archetype via the seeded LCG
`nextRandom(seed) = ((seed · 1664525 + 1013904223) >>> 0) / 2³²` — bit-for-bit
reproducible for a given `seed`, which is what makes a scripted run reproduce
obstacle layouts exactly.

### Reachable level window

Default `levelsPerGroup = 8`, `groups = 6` → `absoluteLevel ∈ [1, 48]`. The
templates' chance windows land in three readable bands:

- **1 – 11** — `static` and `mirror` `rect1`, `moving` triplets (`rect3..7`).
  Pure gap-threading and timing.
- **12 – 30** — `angular` `rect2` triplets come online (chance windows at
  absolute level 12, 17, and 20) alongside `moving` rect4/5/6/7; rotating
  bars timed to encounter.
- **17 – 48** — `angular_long` `rect8` adds the slow, full-width sweeping
  bar (chance window from level 17, `quarticOut` weight ramp so it lords
  the back half of the run).

By design, the harder kinds only appear once the orbit's _complexity budget_
(rotation count per row) has grown enough to commit to them.

## Progression: how the field extends downward

`continueEndlessProgression` (`simulation/progression/progression.ts`) appends
the _next_ level's layout below the current field when
`stats.encounters ≤ NEXT_LEVEL_TRIGGER_REMAINING (4)`. `countEncounters`
counts alive obstacles with `position.y ≤ orbit.center.y + orbit.radius`
(i.e. obstacles the orbit has either reached or is about to reach). So
progression fires once the player has _passed enough of the current field_
that only ~4 obstacles remain in the encounter zone — the generator then
tops up the bottom, raising the level by one. Each append:

- steps the generator to the next `levelPerGroup / group` via `getNextGenerator`,
- generates the layout at that generator (which recomputes the bars'
  pre-rotations against the _current_ orbit center — the alignment math is
  re-applied at every append, so new rows are always correctly phased for the
  orbit that is actually arriving),
- shifts the new obstacles down by `getAppendShift = currentMinY − 2·radius −
nextMaxY` so they sit exactly one orbit-diameter gap below the existing field.

`stats.encounters` only decreases as the orbit `center.y` drops past obstacle
rows (the encounter-zone bound tracks the orbit). That is why a run that
keeps colliding and rolling back stalls at a low level: the orbit never
descends past enough rows to drain `encounters` below 4, so progression stops
firing.

## Teleporting to a featured spot

Because `createInitialSimulation` accepts a `Partial<GeneratorState>`, a bot
scenario can spawn _directly at a chosen level/group_ — e.g. `{
levelPerGroup: 4, group: 3, level: 20 }` drops the orbit into the early
rotating-field band, with `angular` bars already correctly pre-phased by
`createEntity`'s `t_reach` formula for the spawned orbit center. No fake
state: the obstacles are the same shapes the live generator would have
emitted at that level.

This is how we capture "deep into gameplay" frames without spending the
opening minutes climbing through the static-only cold open:

1. Pick a target `level`/`group` in the rotating band (17+ for `angular`,
   25+ for `angular_long`).
2. Build the scenario with that `generator` override so `seed` + level
   produce a known obstacle layout.
3. Drive forward a short scripted prefix (a few hundred ticks) so the orbit
   descends from its top-of-area spawn into the thicket, picking capture
   ticks at the moments when rows are in view and the orbs are mid-arc.

Because both vertical speed (`7 u/tick`) and angular speed (`4°/tick`) are
fixed, "a few hundred ticks" is `~300·7 ≈ 2100` sim units of descent —
enough to clear the cold-open gap and enter the dense band while the orbit
is still surrounded by rotating bars. The `t_reach` formula guarantees the
bars _are_ the right phase when the orbit arrives, so a scenario that simply
sets its rotation count `A` to land each orb in a known gap at the encounter
tick will thread it — the same closed-form alignment the generator used to
phase the bars in the first place.

### Alignment worked example

Goal: be in a `static`-centred bar's gap at tick `T`, where the bar sits at
`Δy` below the spawn orbit's leading edge so `t_reach = Δy / 7`.

- The orbit must have descended `7·T` units by `T` → place the bar at
  `y = spawnY − 7·T` (or just let progression append it and compute
  `t_reach` from its emitted `y`).
- The orbs need to be at the gap's orbit-shoulders at `T`. Each orb's angle is
  `start_angle + (2π/90)·A_i`. Solve
  `A_i = ((target_angle_i − start_angle_i) / (2π/90)) mod 90` ticks of
  rotation, distribute them across the pre-`T` ticks via `direction`, and the
  orbs are exactly on the target shoulders at `T`.
- For an `angular` bar, the bar's _own_ orientation at `T` is
  `spawnRotation + (2π/90)·direction·T`. Pick the target gap orientation
  (`0`, `π/2`, `π`, `3π/2` …) and solve backwards for `T` modulo `90`; or, the
  other way, pre-rotate by choosing the spawn phase the generator would have
  produced for the encounter you want.

Either direction is "pure arithmetic on the two `90`-denominator speeds" —
no simulation step needed to author the scenario, only to verify it.

## One-line summary

> Every obstacle is placed a multiple of `orbit.diameter` below the previous
> one and pre-phased by `(orbit_y − obstacle_y) / verticalSpeed` so its
> encounter-time orientation is closed-form. Both the orbit descent (`7
u/tick`) and the orb angular speed (`4 °/tick`) share the denominator `90`,
> so "distance → ticks → angle" is the same equation for player and field —
> which is the whole reason the layout is designed-to-be-solvable.
