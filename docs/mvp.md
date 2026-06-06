# React Three Fiber Port Plan (MVP)

## Goal

Port the original Phaser game to React Three Fiber while preserving gameplay behavior.

The MVP goal is **mechanical parity**, not visual parity.

Graphics should use simple primitives:

* spheres
* cubes
* boxes
* capsules

No textures, models, shaders, particles, or advanced visual effects in MVP.

The original game's value comes from deterministic gameplay based on:

* rotation
* angular velocity
* obstacle spacing
* orbital motion
* rewind mechanics
* procedural generation

These systems must be preserved before any visual redesign.

---

# Core Principles

## Simulation First

Gameplay must be completely independent from rendering.

React Three Fiber should render simulation state only.

The simulation must be able to run without Three.js.

---

## Deterministic Updates

Use a fixed timestep simulation.

Avoid frame-rate dependent gameplay.

Simulation tick should be authoritative.

Rendering interpolates simulation state.

---

## Preserve Original Behavior

The following systems should be ported with minimal gameplay changes:

* Orbit system
* Obstacle system
* Collision system
* Rewind system
* Endless generator
* Progression and difficulty scaling

---

## Modern Code Style

### TypeScript

Use:

* `type` instead of `interface`
* discriminated unions where appropriate
* readonly data structures where practical

### Functional Architecture

Avoid classes.

Prefer:

* module functions
* pure functions
* immutable state transitions where possible

Example philosophy:

```ts
function updateOrbit(...)
function updateObstacles(...)
function checkCollisions(...)
function processGenerator(...)
```

not

```ts
class Orbit {}
class Obstacle {}
```

### State Management

Use Zustand for global game state.

Simulation logic should remain outside Zustand.

Zustand stores:

* game mode
* ui state
* progression
* settings
* simulation snapshots

Simulation modules perform calculations.

---

# Technology Stack

* React
* TypeScript
* @react-three/fiber
* @react-three/drei
* Zustand

---

# UI Architecture

Game UI should be implemented using standard React components and HTML/CSS rendered above the 3D canvas.

Examples:

* score display
* menus
* HUD
* buttons
* settings
* pause screen
* game over screen
* rewind indicators

Avoid building UI inside the 3D scene whenever possible.

Recommended structure:

* React Three Fiber for gameplay visualization
* React + HTML/CSS for all interface elements

The 3D scene should focus exclusively on gameplay rendering.

---

# Proposed Folder Structure

```text
src/

game/
  simulation/
    orbit/
    obstacles/
    generator/
    rewind/
    collision/
    progression/

  types/
  constants/
  math/

state/
  game-store.ts

scene/
  GameScene.tsx
  CameraController.tsx

entities/
  OrbitEntity.tsx
  ObstacleEntity.tsx

ui/
  hud/
  menus/
  overlays/

hooks/

app/
```

---

# Phase 0 — Reverse Engineering (done)

## Goal

Understand the original gameplay before writing code.

Tasks:

* Map all gameplay systems
* Remove Phaser concepts from mental model
* Identify simulation state
* Document update order

Deliverable:

Simulation architecture document.

---

# Phase 1 — Simulation Core (done)

## Goal

Build renderer-independent game simulation.

No R3F visuals yet.

Create:

### Orbit State

Contains:

* center position
* orbit radius
* angular position
* angular speed
* rollback state
* rewind state

### Orb State

Contains:

* local angle
* local position
* collision state

### Obstacle State

Contains:

* position
* rotation
* speed
* type

### Generator State

Contains:

* level progression
* group progression
* difficulty values

### Rewind State

Contains:

* input history
* rollback ticks
* rewind ticks

Deliverable:

Simulation runs entirely in TypeScript.

---

# Phase 2 — Deterministic Update Loop (done)

## Goal

Replace Phaser update loop.

Create:

```ts
tickSimulation()
```

Update order:

1. Process input
2. Record input history
3. Update orbit
4. Update obstacles
5. Resolve collisions
6. Handle rewind / rollback
7. Update progression

Requirements:

* fixed timestep
* deterministic behavior
* no React dependencies

Deliverable:

Simulation can run in console tests.

---

# Phase 3 — Collision System

## Goal

Port collision behavior.

Preserve original logic.

Important:

Current game uses geometry calculations.

Collision must remain deterministic and math-driven.

Implement:

* circle vs rectangle
* circle vs rotated rectangle

Equivalent to:

* circleVsRect
* circleVsRect2

Deliverable:

Collision parity with Phaser.

---

# Phase 4 — Orbit Mechanics

## Goal

Port dual-orb system.

Preserve:

* orbital radius
* angular velocity
* clockwise rotation
* counterclockwise rotation

Player controls:

* rotate left
* rotate right

Important:

This is not a spaceship movement game.

The core mechanic is:

rotation vs rotation.

Deliverable:

Orbit simulation matches original rhythm.

---

# Phase 5 — Rewind System

## Goal

Port the most important gameplay feature.

Preserve:

* input history recording
* rollback behavior
* rewind behavior
* stabilization logic

The original design rewinds through recorded inputs rather than storing full world snapshots.

Maintain this philosophy.

Deliverable:

Rewind behaves identically to Phaser version.

---

# Phase 6 — Generator Port

## Goal

Port procedural content system.

Preserve:

* Wave
* Chance
* Obstacle definitions
* Difficulty curves

Remove:

* texture references
* sprite names

Replace with:

* obstacle archetypes

Deliverable:

Generated obstacle layouts match original progression.

---

# Phase 7 — R3F Visualization

## Goal

Visualize simulation.

Create:

### Orbit

* center sphere
* two orbiting spheres

### Obstacles

* cubes
* thin boxes
* rotating bars

### Camera

Simple follow camera.

No effects.

No polish.

Deliverable:

Entire game playable in 3D primitives.

---

# Phase 8 — Input Layer

## Goal

Connect player controls.

Desktop:

* Arrow Left
* Arrow Right

Optional:

* A / D

Mobile can be deferred until later.

Deliverable:

Input drives simulation.

---

# Phase 9 — MVP Gameplay Loop

## Goal

Complete playable prototype.

Implement:

* start game
* obstacle generation
* collisions
* rewind
* endless mode
* checkpoint progression

Simple UI only:

* score
* collision count
* rewind count

UI should be implemented using React components and HTML overlays, not 3D scene objects.

Deliverable:

Playable MVP.

---

# Explicit Non-Goals For MVP

Do NOT implement:

* models
* textures
* particles
* shaders
* postprocessing
* audio
* shop
* achievements
* save system
* monetization
* tutorials

Focus entirely on:

simulation + gameplay parity.

---

# Future Phases (Post MVP)

After gameplay parity is achieved:

1. Visual redesign
2. VFX
3. Audio
4. Camera polish
5. Mobile controls
6. Performance optimization
7. Advanced postprocessing
8. Procedural environments

Only after gameplay parity is verified.
