# Visual Redesign

Redesign the look of Dual Orbit: orbs and obstacles become energy/holographic
shader-driven meshes, and the background becomes an animated galaxy of points
that stays locked to the camera so it is always visible.

## Implementation choice: TSL, not raw GLSL

We will author shaders in **TSL** (`three/tsl`) instead of porting the GLSL
strings from the inspiration projects.

- Project is TS-first, R3F v9, `three@0.184` — TSL is the native, supported
  path in this stack; raw `ShaderMaterial` GLSL strings are the legacy path.
- **No build plugin needed.** Verified: `vite.config.ts` has only
  `@vitejs/plugin-react` + babel (react-compiler). TSL is plain TS — no
  `vite-plugin-glsl`, no `.glsl` imports, no `#include` resolution.
- TSL gives type-safe, editor-autocompleted, composable node functions
  (`vec3`, `float`, `smoothstep`, `mod`, `pow`, `mix`, `dot`, …) — much easier
  to **tune the look** (a stated goal) than editing GLSL strings.
- One shared `uniform(0)` for `time` can be reused across every holographic +
  galaxy material; bump its `.value` once per `useFrame` — no per-material ref
  juggling.
- `three/tsl` confirmed available on the installed version: exports `Fn`,
  `uniform`, `time`, `vec3`, `vec2`, `float`, `cameraPosition`, `positionLocal`,
  `positionWorld`, `normalLocal`, `modelWorldMatrix`, `uv`, `assign`, etc.
  (`fresnel` helper lives in `three/addons/tsl`; otherwise we build it inline
  from `cameraPosition`/`normalLocal` exactly like the GLSL reference — trivial.)

### What we keep from the references

The *algorithms*, not the GLSL syntax:

- **Holographic**: fresnel (from `cameraPosition` + `normalLocal`, flipped on
  back faces) → `pow` → `smoothstep` falloff; animated vertical stripes via
  `mod`/`pow` of `positionWorld.y` minus `time`; vertex glitch via a `random2D`
  Fn applied to `positionWorld.xz` scaled by a glitch-strength uniform.
- **Galaxy**: per-particle swirl around the center
  `angle += (1.0 / distanceToCenter) * uTime`; add `aRandomness`; size by
  perspective `1.0 / -viewPosition.z`; soft additive round points
  `pow(1.0 - distance(pointCoord, 0.5), 10.0)` over `vertexColor`.

## Goals

1. **Orbs** — keep the **original orb identity colors** (`#d84f3f` left /
   `#2f6fd8`). Each orb is an energy sphere with:
   - a brighter, **pulsing core** spot at the center (intensity driven by
     `sin(time)`); and
   - a **glowing disc/circle behind the sphere** (a billboarded ring/backplate
     additive layer).

   > Vibe reference only: `.temp/screenshot-001.png` (an original-game screenshot) sets
   > the **colors/mood** — energy orbs as bright cores with a soft circular
   > halo on a dark, contrasting background. It is **not** a pixel-spec to
   > reproduce 1:1; we keep original orb colors and aim for that look/feel.
   The holographic shader (fresnel + stripes + glitch) wraps the sphere; the
   core + back-disc add the "energy orb" identity on top.
2. **Orbit center** — holographic-but-dimmer anchor (muted blue-white), lower
   glitch, smaller/dimmer back-disc than the orbs so it reads as the anchor,
   not a player orb. No pulsing core (or a very slow, faint one).
3. **Obstacles** — holographic boxes (fresnel + stripes + glitch), per-kind
   color (see Step 3). Energy/jitter telegraphs danger.
4. **Background** — an animated galaxy points field inspired by
   `../threejs-journey/30-animated-galaxy` whose particles rotate and never
   leave the view (locked to camera movement). The background must
   **contrast** the gameplay objects (cool galaxy vs warm-ish orbs) but **not
   overwhelm** them: low particle brightness, mostly dim, sparse near the
   screen center / denser at the edges ("frame" the play field, not compete).
5. **HUD** — restyle from the current light/neutral "office" theme to match
   the **cyberpunk energy** of the new 3D scene (see Step 6b).

---

## Inspiration references (algorithms to port into TSL)

### Holographic shader (orbs & obstacles)

`quantum-digital/.../shaders/holographic/fragment.glsl` (== journey 33):

```glsl
uniform vec3 uColor;
uniform float uTime;
varying vec3 vPosition;
varying vec3 vNormal;

void main() {
  vec3 normal = normalize(vNormal);
  if(!gl_FrontFacing) normal *= -1.0;
  float stripes = mod((vPosition.y - uTime * 0.02) * 20.0, 1.0);
  stripes = pow(stripes, 3.0);
  vec3 viewDirection = normalize(vPosition - cameraPosition);
  float fresnel = dot(viewDirection, normal) + 1.0;
  fresnel = pow(fresnel, 2.0);
  float falloff = smoothstep(0.8, 0.2, fresnel);
  float holographic = stripes * fresnel;
  holographic += fresnel * 1.25;
  holographic *= falloff;
  gl_FragColor = vec4(uColor, holographic);
}
```

Vertex shader applies a time-based glitch using `random2D`:

```glsl
float random2D(vec2 value) {
  return fract(sin(dot(value.xy, vec2(12.9898,78.233))) * 43758.5453123);
}
// glitchStrength ~ 0.25; nudge modelPosition.x/z by (random2D-0.5)*glitchStrength
```

Material flags used in both references:
`transparent: true`, `depthWrite: false`, `blending: AdditiveBlending`,
`side: DoubleSide`.

### Galaxy background (journey 30)

`threejs-journey/30-animated-galaxy/src/script.js` builds a `THREE.Points`
galaxy with attributes `position`, `aRandomness`, `color`, `aScale` and a
`ShaderMaterial` (`depthWrite: false`, `blending: AdditiveBlending`,
`vertexColors: true`, uniforms `uTime`, `uSize`). Per-branch spiral geometry
generated in JS; shader rotates each point around the center.

Key galaxy vertex rotation snippet:

```glsl
float angle = atan(modelPosition.x, modelPosition.z);
float distanceToCenter = length(modelPosition.xz);
float angleOffset = (1.0 / distanceToCenter) * uTime;
angle += angleOffset;
modelPosition.x = cos(angle) * distanceToCenter;
modelPosition.z = sin(angle) * distanceToCenter;
modelPosition.xyz += aRandomness;
```

Fragment soft point: `strength = pow(1.0 - distance(gl_PointCoord, vec2(0.5)), 10.0)`
over `vColor`, additive.

---

## Current state in Dual Orbit

- `src/scene/GameScene.tsx` — `<color attach="background">` flat light grey
  (`#f6f7f2`), plus ambient + directional lights.
- `src/entities/OrbitEntity.tsx` — orbit center sphere `meshStandardMaterial`
  (`#243044`); orbs `meshStandardMaterial` (`#d84f3f` left / `#2f6fd8` right).
- `src/entities/ObstacleEntity.tsx` — `boxGeometry` mesh per obstacle with
  `meshStandardMaterial`, per-kind flat color via `getObstacleColor`.
- `src/scene/CameraController.tsx` — camera lerps to follow orbit center,
  looks at a fixed offset above it.
- `package.json` — `three@0.184`, `@react-three/fiber@9`, `@react-three/drei`,
  `@react-three/postprocessing` installed; **no GLSL plugin** (not needed for
  TSL).

No custom shaders exist yet.

---

## Plan

### Step 0 — Shared time uniform + clock ✅

Create `src/three/shaders/shared.ts`:

```ts
import { uniform } from 'three/tsl'
export const time = uniform(0)
```

Add a tiny `<ShaderClock>` R3F component (placed once in the scene) that bumps
`time.value += delta` each `useFrame`. Every TSL material that references
`time` animates for free — no per-material refs, no `Set` registry.

### Step 1 — Port the holographic material to TSL ✅

Create `src/three/materials/holographic.ts` exporting a factory
`createHolographicMaterial({ color, glitchStrength = 0.25 })`.

Build with `three/tsl` nodes and `Fn`:

- `random2D = Fn(([v]) => fract(sin(dot(v, vec2(12.9898, 78.233))) * 43758.5453123))`
- Vertex displacement (glitch): operate on `positionLocal`, reassign
  `positionLocal`'s x/z by `(random2D(..) - 0.5) * glitchFn`, where
  `glitchFn` derives from `time` and `positionWorld.y` exactly like the GLSL
  reference. Expose `glitchStrength` as a `uniform(0.25)` so callers tune per
  kind/state.
- Fragment: `normal` = `normalize(normalLocal)`; flip sign when
  `FrontFace` is false (use `frontFacing`/`FrontFace` node). `stripes` =
  `mod((positionWorld.y - time.mul(0.02)).mul(20.0), 1.0).pow(3.0)`.
  `viewDir = normalize(positionWorld.sub(cameraPosition))`.
  `fresnel = dot(viewDir, normal).add(1.0).pow(2.0)`.
  `falloff = smoothstep(0.8, 0.2, fresnel)`.
  `holographic = stripes.mul(fresnel).add(fresnel.mul(1.25)).mul(falloff)`.
  Output `assign(material.color, uColor)` and `assign(material.opacity,
  holographic)` (or feed via `MeshBasicNodeMaterial` color/opacity/alpha nodes).
- Wrap as a `MeshBasicNodeMaterial` (or `MeshStandardNodeMaterial` with
  emissive) with flags
  `transparent:true, depthWrite:false, blending:Additive, side:DoubleSide`.
- The factory returns the node material instance; reuse the global `time`
  uniform from Step 0 (do **not** create a second one).

> Note: `fresnel` helper exists in `three/addons/tsl`; we build it inline to
> match the reference exactly and avoid an addon import.
>
> **Coordinate-space gotcha (hit during impl):** `material.positionNode` is
> assigned back to `positionLocal` by `NodeMaterial.setupPosition` and then
> transformed into world space by `modelWorldMatrix`. So `positionNode` MUST
> be an **object-space** expression. The GLSL reference's `vPosition` (a
> world-space `modelPosition` varying) is misleading as a guide — porting it
> verbatim into `positionNode` makes the renderer double-transform the
> vertices via `modelWorldMatrix`, exploding the mesh away from its group's
> translation (the orbs visibly flew off their cores). In TSL we displace in
> `positionLocal` for the assigned `positionNode`, and the fragment reads
> `positionWorld` (which the renderer derives from the updated local
> position) for the stripe coordinate.

### Step 1.5 — Switch the R3F renderer to `WebGPURenderer` ✅

TSL `NodeMaterial`s are only renderable through `three/webgpu`'s
`WebGPURenderer` — the stock `THREE.WebGLRenderer` cannot compile node
materials, so R3F's default renderer must be replaced before Step 2.

- Create `src/three/WebGPUCanvas.tsx` exporting:
  - `createWebGPURenderer(params)` — async factory passed to `<Canvas
    gl={createWebGPURenderer}>`. R3F calls it with `{ canvas, antialias,
    alpha, ... }` and installs the returned renderer as `state.gl`. We pass
    `forceWebGL: true` to keep the WebGL2 backend (no WebGPU device needed,
    maximum compatibility) while still gaining TSL `NodeMaterial` support. The
    factory `await`s `renderer.init()` before returning.
  - `<RenderLoop />` — a single component mounted inside the `<Canvas>`. It
    registers a `useFrame` with `priority={1}`. R3F treats any priority > 0 as
    "rendering is the subscriber's responsibility" and skips its own
    synchronous `gl.render(scene, camera)`; we then call
    `gl.renderAsync(scene, camera)` (the async drive path for `WebGPURenderer`).
    All other `useFrame` subscribers (ShaderClock, CameraController,
    SimulationTicker) still run every frame as usual at priority 0.
- In `App.tsx`, set `gl={createWebGPURenderer}` and add `<RenderLoop />` as
  the last child of `<Canvas>`.

- TS note: R3F's `DefaultGLProps.canvas` (= `HTMLCanvasElement | OffscreenCanvas`)
  resolves to the DOM lib `OffscreenCanvas`, while `@types/three`'s
  `WebGPURendererParameters.canvas` resolves to the `@types/offscreencanvas`-
  augmented `OffscreenCanvas` — TS cannot reconcile the two stubs. We narrow
  the canvas to `HTMLCanvasElement` (R3F always passes a real DOM `<canvas>`),
  which sidesteps the interface mismatch without `any`.

### Step 2 — Render orbs as holographic energy spheres ✅

Edit `src/entities/OrbitEntity.tsx`. Each orb becomes a **group** of up to
three layers, stacked additively:

1. **Holographic sphere** — the existing `sphereGeometry` with the holographic
   node material from Step 1, `color` = original identity color:
   - left orb **red** `#d84f3f`
   - right orb **blue** (e.g. `#2f6fd8`) — replaces the current green
     `#2f8f83`.
   - subtle self-rotation (`rotation.y += delta * 0.3`).
2. **Pulsing core** — a smaller bright sphere (or a billboarded point) at the
   orb center whose brightness pulses with `time`:
   - `coreSize` ≈ 0.35× orb radius.
   - intensity = `0.6 + 0.4 * sin(time * speed + phase)`, `speed` tuned per
     orb (or shared; offset phases so the two orbs don't beat in sync).
   - color = a near-white tint of the orb identity color (lerp toward white by
     ~0.5) so the core reads as the bright hotspot from the reference image.
   - additive, `depthWrite:false`.
3. **Back-disc / halo ring** — a flat circle placed behind the sphere facing
   the camera (billboarded), slightly larger than the orb, additive, with a
   soft radial falloff (bright at the rim or soft disc, TBD against the
   reference). This is the "circle behind the orb" from the screenshot.
   - Implement as a `planeGeometry` with a radial-falloff TSL fragment (e.g.
     `strength = pow(1.0 - distance(uv, 0.5)*2, k)`) or a `ringGeometry`,
     parented to the orb and rotated to face the camera each frame (or use a
     `Billboard` from `@react-three/drei`).
   - color = orb identity color, lower opacity so it glow-halos without
     washing out the sphere.

Orbit center: layer 1 (holographic, dimmer blue-white) + a faint optional
back-disc, **no** pulsing core (or a very slow faint one).

**Orbit-path ring (NEW — make the orb rotation visually obvious).** Add a
bright line ring that traces the actual circle the orbs travel along, so the
orbit/rotation is immediately readable:

- Geometry: a `ringGeometry` (or a thin torus / line loop) of radius
  `toWorldSize(orbit.radius)` centered at `toWorldPosition(orbit.center)` in
  the XY plane the orbs live in (same plane as the play field, so it reads as
  the path the two orbs ride).
- Drawn with a **bright** additive node material — bright enough to clearly
  stand out against the dim galaxy background (this is the readability anchor,
  so it should be one of the brighter on-screen elements, like the orb cores).
- Color: a neutral/white or faint dual-tint accent — pick a single bright
  accent (e.g. near-white `#dce6ff`) so it doesn't compete with the red/blue
  orb identity. Keep stroke thin (small ring/torus thickness) so it's a crisp
  line, not a fat band.
- Because `orbit.radius` can change with progression/states, regenerate or
  rescale the ring each frame from the live `orbit.radius`/`orbit.center`
  (cheap: just update the mesh `scale`/`position`).
- This is a gameplay-readability element first; decorative glow second. Tune
  brightness so it frames the orbit without overwhelming the orbs.

Mount TSL node materials via `<primitive object={material} attach="material" />`
(or inline `<meshBasicNodeMaterial>`), one consistent pattern across
orbs/obstacles.

> TSL note: the back-disc billboard can read `cameraPosition` to face the
camera, or simply use drei's `<Billboard>` wrapper — keep it simple.

**Implementation (Step 2).** Done with two helper files plus the reworked
orb component:

- `src/three/materials/energy.ts` — three factories:
  - `createPulsingCoreMaterial({ color, speed=2.5, phase=0 })` — additive
    `MeshBasicNodeMaterial` whose `opacityNode` pulses
    `0.6 + 0.4 * sin(time*speed + phase)` from the shared `time` uniform.
    `speed`/`phase` are exposed `UniformNumber`s for live tuning; the two orbs
    get offsets `0` and `π/2` so they don't beat in sync.
  - `createBackDiscMaterial({ color, intensity=0.5 })` — additive plane whose
    `opacityNode = pow(1.0 - distance(uv,0.5)*2, 4) * intensity`. Caller
    billboards the mesh by copying `state.camera.quaternion` each frame.
  - `createOrbitRingMaterial(color='#dce6ff')` — bright additive constant for
    the thin `ringGeometry` that traces the orb path. The geometry
    (`RingGeometry(inner=R-thick, outer=R+thick, 128)`) is rebuilt from the
    live `orbit.radius` via `useMemo`, disposed on swap.
- `src/entities/OrbitEntity.tsx` — renders a parent `<group>` with:
  - the orbit-path ring (**no rotation** — keep the `ringGeometry` in its
    native XY plane so it faces the camera; the orbs live in that XY play
    plane, the camera looks down -Z. The earlier `rotation=[-π/2,0,0]` tilted
    it into the XZ floor and made it read edge-on / face-down.)
  - the orbit-center holographic anchor sphere (dim `#3a5a78`, low
    `glitchStrength=0.05`, **no** pulsing core)
  - each orb as an `<Orb />` subcomponent with three children: billboarded
    back-disc halo (`discScale = orbRadius * 2.4`), holographic sphere
    (self-rotating, `glitchStrength=0.06` — low because orbs are ~0.3 world
    units in radius; the GLSL reference's 0.25 is fully half the sphere for a
    ball this small and would visibly bulge the silhouette), pulsing core.
  - Materials are `useMemo`-created and disposed in `useEffect` cleanup to
    avoid leaks on game reset.
- Colors live in `ORB_COLOR = { left:'#d84f3f', right:'#2f6fd8' }` as the
  project's single source of truth (the HUD accent system, Step 6b, mirrors
  these).
- `src/scene/GameScene.tsx` — backgrounds now `#05060d` (dark) so additive
  holographic layers read; `<ShaderClock />` mounted so the shared `time`
  uniform advances each frame before any orb fragment is evaluated.

### Step 3 — Render obstacles as holographic boxes

Edit `src/entities/ObstacleEntity.tsx`:

- Replace `meshStandardMaterial` with the holographic node material.
- Per-kind `color` (reuse `getObstacleColor` palette):
  - `static` → `#242935`
  - `moving` → `#7f5ab6`
  - `angular` → `#394c79`
  - `angular_long` → `#c46d3a`
  - colliding → `#f5c84b` (and/or boost `glitchStrength`)
- Boost `glitchStrength` for `moving` and colliding obstacles to telegraph
  energy; keep it low for `static`. Because it's a uniform, tuning is a prop.
- Obstacles use `boxGeometry`; the holographic shader reads `position`/`normal`
  attributes generically — no geometry change needed.
- These meshes are additive/emissive; orbital lights become optional (see
  Step 6).

### Step 4 — Galaxy background points (TSL)

Create `src/scene/GalaxyBackground.tsx`:

1. Geometry generator modeled on journey 30's `generateGalaxy`, filling typed
   arrays for attributes `position`, `aRandomness` (vec3), `color` (vec3),
   `aScale` (float). Parameters:
   - `count` (start ~20k–60k, tune for perf)
   - `radius`, `branches`, `spin`, `randomness`, `randomnessPower`
   - `insideColor` / `outsideColor` (energy palette pairing with the holographic
     orbs — e.g. cool blue→cyan, or magenta→blue)
2. TSL `PointsNodeMaterial` (`depthWrite:false, blending:AdditiveBlending,
   vertexColors:true`), uniforms `uSize` (sized by `gl.getPixelRatio()`),
   global `time` from Step 0.
3. Vertex nodes: read `positionWorld`/`positionLocal`;
   `angle = atan(pos.x, pos.z)`; `dist = length(pos.xz)`;
   `angle += (1.0/dist).mul(time)`; reassign `pos.x`/`pos.z`;
   add `attribute('aRandomness','vec3')`; size =
   `uSize.mul(aScale).mul(clamp(modelViewPosition.z.negate().reciprocal()))`
   (i.e. the `1.0 / -viewPosition.z` perspective term).
4. Fragment nodes: `strength = pow(1.0 - distance(pointCoord, vec2(0.5)), 10.0)`;
   `rgb = mix(vec3(0), vertexColor, strength)`; additive.
5. Update nothing per-frame except the global `time` uniform (Step 0).

### Step 5 — Lock the galaxy to the camera

Requirement: galaxy "always in the background, locked to camera movement" —
i.e. visible regardless of where the camera pans.

Approach (pick one, recommend A):

- **A. Parent the galaxy `Points` to the camera.** Add the points object as a
  child of the camera so they move with it. Place the galaxy large and centered
  at a fixed offset in camera space (e.g. `[0, 0, -bigZ]`) so it sits behind the
  play field; `camera.far` is already `1000`. Galaxy swirls around its own
  center, giving a clean "always behind / parallax" effect.
- **B. Follow script.** Each `useFrame`, `galaxy.position.copy(camera.position)`
  plus a fixed look-axis offset. Equivalent to A but matrix-updated manually.

Either way: galaxy radius comfortably larger than the play field extent (so the
camera never reaches the edge), `depthWrite:false` + additive so it never
occludes orbs/obstacles.

Implementation detail: with R3F, parenting to the camera can be done by
grabbing the camera via `useThree` and `camera.add(points)` in an effect, or by
rendering `primitive` inside a camera-attached group — confirm the cleanest
R3F pattern during impl.

### Step 6 — Integration & lighting cleanup

In `src/scene/GameScene.tsx`:

- Set a dark clear/background color (e.g.
  `<color attach="background" args={['#05060a']} />`) so additive holographic +
  galaxy pop.
- Insert `<GalaxyBackground />` before the gameplay `<group>`.
- Insert `<ShaderClock />` (Step 0) once.
- Keep a low `ambientLight` only if any non-holographic elements remain (HUD is
  DOM, so lights can likely be dropped entirely once orbs/obstacles are
  holographic). Decide after Step 2/3.

### Step 6b — Cyberpunk HUD

Restyle `src/App.css` (and `src/index.css` root colors) to match the new
energy scene. The HUD is DOM, so this is pure CSS — no scene changes. Goals:

- Dark, near-black translucent panels with a faint neon stroke + soft glow
  instead of the current white/translucent "office" cards.
- Accent color(s) drawn from the orb palette: warm `#d84f3f` (red) left
  accent, cool `#2f6fd8` (blue) right accent; one shared accent for buttons.
  Add a CSS custom-prop accent palette (`--hud-accent`, `--hud-accent-warm`,
  `--hud-accent-cool`, `--hud-bg`, `--hud-stroke`).
- Labels: keep uppercase, bump to a mono/techno font feel via `font-family`,
  letter-spacing, and a subtle neon text-shadow on the value.
- `.hud` panels: dark translucent (`rgba(8,10,18,0.55)`), 1px neon stroke,
  rounded corners smaller (or angular clipped corners via `clip-path` for a
  cyberpunk cut-corner look), backdrop `blur(10px)`.
- Buttons (`.actions button`, `.start-overlay button`): dark fill, neon stroke,
  neon text, hover = glow (`box-shadow` accent + `text-shadow`). `Start` overlay
  backdrop darkened (`rgba(5,6,10,0.55)`) with blur.
- Keep the existing layout/positions and the responsive `@media (max-width:
  560px)` block; only restyle colors/strokes/typography/glow, not the grid.
- All accent colors defined once as CSS custom properties on `:root` /
  `.game-shell` so the 3D palette and HUD palette can be tuned together later.

### Step 7 — Visual tuning

- **Background vs gameplay contrast**: galaxy palette cool/dim; orbs (red/blue)
  bright cores + halos so they read first. The orbit-path ring is bright so
  the rotation path stands out against the galaxy. Tune galaxy
  `insideColor`/`outsideColor` brightness *down* and `uSize`/`count` so the
  background frames the action without competing. Aim: orbs + orbit ring are
  the brightest things on screen.
- Pulse parameters: core brightness range and `speed`, back-disc radius /
  falloff — tune until orbs feel alive but not seizure-inducing.
- Tune glitch strength and stripe frequency so obstacles/jitter read as
  "energy" but stay legible for gameplay.
- Verify orbs remain clearly distinguishable by color and the orbit center
  reads as distinct from orbs.
- Confirm HUD accent colors harmonize with the on-screen orb/obstacle colors
  (warm/cool pairing) and panels don't fight the galaxy.

### Step 8 — Tests / smoke checks

- No simulation-logic changes; existing bot golden scenarios stay valid.
- Manual smoke: start game, confirm orbs/obstacles glow holographically and
  galaxy is visible behind, never occluding gameplay, following the camera as
  the orbit center moves across the field.
- `npm run build` still passes (no new build plugin; TSL is part of `three`).
- `npm test` and `npm run screenshots` (Playwright) still pass.

---

## Out of scope

- Game logic, collision, rewind, scoring, level generation — unchanged.
