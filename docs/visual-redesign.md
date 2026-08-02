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
`createHolographicMaterial({ color, glitchStrength = 0.25 })`.Build with `three/tsl` nodes and `Fn`:

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
- **`baseFill` option (added in Step 3):** the pure reference fresnel alpha is
  0 at face-on (fresnel=0 → alpha=0) — so flat surfaces perpendicular to the
  camera render as nothing but a thin rim. That's correct for **spheres**
  (the silhouette sweeps 0→1 across the disc producing a bright mid-radius
  band) but **deadly for flat box faces** (their whole front is uniform
  normal+z, deleted by the fresnel). The factory therefore also accepts a
  `baseFill` (`0` by default, ~0.7–2.0 for obstacle boxes) and adds a
  view-independent scrolling-scanline body fill:
  `bodyFill = stripePos.mul(0.5)` (DC ~0.25 + stripe modulation), so a
  flat panel front-on reads as a holographic field with moving scanlines,
  not empty space. Orbs pass `baseFill = 0` so they keep the pure shell.
- **`intensity` option:** overall brightness multiplier on the final alpha
  `(bodyFill + holographic) * intensity`. Callers scale the whole effect per
  instance — orbs ~1.4, obstacles 1.0–2.0, collisions boosted.
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

- **Renderer clear color (hit during impl):** `WebGPURenderer` on the
  WebGL backend does **not** honour R3F's `<color attach="background">`
  (which mutates `scene.background`) for its true clear color — the WebGL
  surface keeps its own `gl.clearColor` (which defaults to opaque black with
  `alpha:false`, transparent with `alpha:true`), so when R3F retains
  `alpha:true` the framebuffer clears transparent and the light CSS behind
  the canvas (`.game-stage` `#f6f7f2`) bleeds through. That light backdrop
  washes out the additive holographic materials — their contribution
  `color * alpha` adds nothing to near-white. The factory therefore pins
  `renderer.setClearColor('#05060d', 1)` so the canvas is opaque-dark and
  additive reads cleanly. `GameScene.tsx` still keeps the `<color>` for any
  future WebGPU device path; keeping both in sync is fine.

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

### Step 3 — Render obstacles as holographic boxes ✅

Implemented in `src/entities/ObstacleEntity.tsx`.

- Replaced `meshStandardMaterial` with the holographic node material from
  Step 1 (mounted via `<primitive object={material} attach="material" />`).
- Per-kind `color` feeding the additive holographic material. With the
  `baseFill` body scanline + fresnel rim both scaled by `intensity`, colors
  are kept **bright / saturated** (mirroring the reference demo's bright
  `#70c1ff`) so they read against the dark `#05060d` clear — additive can't
  brighten a dim color, so the channels themselves must be luminous:
  - `static` → `#5a7090` (dim-mid cool slate — quietest hull)
  - `moving` → `#a070e0` (warm purple)
  - `angular` → `#7090c8` (mid blue)
  - `angular_long` → `#e09040` (warm orange)
  - colliding → `#ffdc60` (yellow collision highlight)
- Per-kind `baseFill` (view-independent scanline body fill — see Step 1's
  `HolographicOptions.baseFill`). The pure reference fresnel alpha is 0 at
  face-on, so flat box faces perpendicular to the camera would render as
  nothing but a thin rim; the body fill renders the front face as a
  scrolling-stripe holographic panel:
  - `static` → `0.7`
  - `angular` → `0.9`
  - `angular_long` → `1.0`
  - `moving` → `1.2`
  - colliding → `2.0`
- Per-kind `intensity` (overall brightness, scales both the body fill and
  the fresnel rim band — stays under the orbs which use `1.4` on their shell):
  - `static` → `1.0`
  - `angular` → `1.2`
  - `angular_long` → `1.3`
  - `moving` → `1.5`
  - colliding → `2.0`
- Obstacles use `boxGeometry`; the holographic shader reads `position`/`normal`
  attributes generically — no geometry change needed.
- Per-kind `glitchStrength` (uniform, tunable) — boxes are big (a few world
  units across) so, unlike orbs (radius ~0.3), the GLSL reference's 0.25-scale
  jitter reads as energy, not a silhouette explosion:
  - `static` → `0.04` (near-silent)
  - `angular` → `0.18`
  - `angular_long` → `0.2`
  - `moving` → `0.25`
  - colliding → `0.4` (boosted to telegraph danger)
- One `HolographicMaterial` instance per obstacle (per-instance uniform),
  `useMemo`'d on `[color, glitchStrength, intensity, baseFill]` and disposed
  on unmount to avoid leaking node materials on game reset / obstacle prune.
- Confirmed by Step 2: the holographic material's `positionNode` is now
  object-space, so the double-transform bug does not affect these big boxes
  either; the glitch stays local to the box.

**Lights dropped early (folded from Step 6).** With orbs + orbit-layer +
obstacles all on `MeshBasicNodeMaterial` (which ignores lighting), the
`ambientLight`/`directionalLight`s were no-ops. Removed in `GameScene.tsx`
now; Step 6 no longer needs to revisit this.

### Step 4 — Galaxy background points ✅

> **Current architecture (iteration 8, see Step 7):** `<instancedMesh>` of a
> `PlaneGeometry(1,1)` quad template (one per star), driven by a TSL
> `MeshBasicNodeMaterial` exported from `src/three/materials/galaxy.ts`
> (`createGalaxyMaterial`). Per-instance data (`aSkeleton`, `aRandomness`,
> `color`, `aScale`) rides on `InstancedBufferAttribute`s on the quad
> template. The twirl is computed PER-INSTANCE in the material's
> `positionNode` — the reference's `1/r` differential shear, in TSL,
> reading the shared `time` uniform. Soft-point falloff is a `colorNode`
> `pow(1-d,10)` mask. AdditiveBlending + `depthWrite:false`.
>
> This replaces EVERY earlier implementation (stock `PointsMaterial` +
> `onBeforeCompile`, and `PointsNodeMaterial`) because the WebGL-fallback
> backend of `WebGPURenderer` hardcodes `gl_PointSize = 1.0` at the tail of
> the generated vertex shader (`GLSLNodeBuilder._getGLSLVertexCode`), so no
> raw `Points` approach can ever produce visible-sized bright stars under
> our renderer. The narrative below is preserved for history but reflects
> the pre-iteration-8 (stock `PointsMaterial`) design.

> **Update — twirl fix (iteration 5, see Step 7):** the implementation below
> originally baked `aRandomness` into `position`, clamped the per-vertex min
> distance, ran the per-vertex shear at `0.18×` and compensated with a
> rigid `useFrame` Z-rotation of the whole `<points>` object. That produced a
> "static rotating background", not the journey-30 **twirl** (differential
> inner-vs-outer arm rotation). The current code instead keeps randomness as
> a separate post-rotation `aRandomness` attribute, runs the per-vertex
> `(1/dist)*uTime` shear at the reference's `1×` rate (no clamp), adds
> per-vertex `aScale`, and drops the rigid whole-disc spin entirely — the
> visible motion is now purely the per-vertex differential twirl. The
> fragment soft-point mask also moved to the stock
> `outgoingLight = diffuseColor.rgb;` line (`#include <output_fragment>` does
> not exist in this `three` version). The narrative below is preserved for
> history but reflects the pre-iteration-5 design.

Created `src/scene/GalaxyBackground.tsx` — port of `threejs-journey/30-animated-galaxy/`.

**Why stock `PointsMaterial` (with an `onBeforeCompile` patch) rather than
the original plan of a TSL `PointsNodeMaterial`?** The WebGL fallback
backend of `WebGPURenderer` (`forceWebGL:true`) hardcodes
`gl_PointSize = 1.0` in `GLSLNodeBuilder._getGLSLVertexCode` — any
`PointsNodeMaterial` `sizeNode` is ignored and every point renders as a
sub-pixel speck. 100k 1-pixel points spread across a 36-unit disc eyeball
to nothing (we verified this). A stock `PointsMaterial` does **not** go
through `GLSLNodeBuilder`, so the renderer honors its standard
`gl_PointSize` injection — points actually render at the requested
world-space size with perspective attenuation. The lost animation
(no per-vertex `positionNode` spin) is replaced by a `useFrame`
Z-rotation of the whole `<points>` object on its disc-normal axis
(functionally identical visual — inner-arm shear).

Implementation:

1. `BufferGeometry` populated journey-30-style: per point
   `branchAngle = ((i % branches)/branches)*τ; r = rand*radius`;
   `position = (cos*bAngle*r + randX, sin*bAngle*r + randY, randZ)`;
   vertex `color = insideColor.lerp(outsideColor, r/radius)`.
   Disc lies in the **XY plane** (normal = +Z) — the camera looks down -Z
   at the play field (z=0), so an XZ disc would render edge-on (a thin
   line). XY face-on reads as the journey-30 tilted-camera nebula.
2. `PointsMaterial({ size:1.0, sizeAttenuation:true, vertexColors:true,
   transparent:true, depthWrite:false, blending:AdditiveBlending })`
   with an `onBeforeCompile` patch that multiplies `diffuseColor.rgb` by
   `smoothstep(0.5, 0.18, distance(gl_PointCoord, vec2(0.5)))` — round soft
   discs instead of chunky squares (AdditiveBlending ignores fragment
   alpha, so the RGB must be masked, not just `a`).
3. Default knobs: `count=250000, radius=26, branches=4, randomness=1.5,
   randomnessPower=2.2, insideColor=#ff6030, outsideColor=#1b3984, size=1.0`.
   Tuned by Playwright pixel probing until the corners (which had been pure
   black `rgb(0,0,1)` with `PointsNodeMaterial`) carry `5–15%` bright
   pixels (avg `~200`, max `~765`) — the whole frame reads as a nebula
   with spiral arms, dense core (avg `~323`), and visible stars even at the
corners.
4. `<GalaxyBackground />` is mounted in `GameScene.tsx` between
   `<ShaderClock />` and `<CameraController />` (Step 6 integration).

### Step 5 — Lock the galaxy to the camera ✅

**Approach B (follow script).** In `useFrame` each frame: copy
`camera.position`, then offset `position.z -= 18` ≈ 18 units behind the play
field; keep `quaternion.identity()` so the disc's +Z normal stays aligned
with world Z (the camera pitches slightly downward toward the play field,
but we don't want the galaxy tilted with it). Spin is a
`rotation.z += spinSpeed * delta`.

With `radius=26` the disc extends well past the visible field at any camera
pan — the camera (at `z=12`) is actually inside the disc's z-extent (disc
spans `z=-32…20` world), which is what produces the corner-filling nebula
rather than a distant tiny galaxy.

`depthWrite:false` + `AdditiveBlending` → never occludes orbs/obstacles.

### Step 6 — Integration & lighting cleanup ✅

In `src/scene/GameScene.tsx`:

- Set a dark clear/background color (e.g.
  `<color attach="background" args={['#05060a']} />`) so additive holographic +
  galaxy pop. (Already `#05060d` since Step 2.)
- Insert `<GalaxyBackground />` before the gameplay `<group>`.
- Insert `<ShaderClock />` (Step 0) once. (Already mounted since Step 2.)
- Lights: already dropped in Step 3 — every gameplay mesh is a
  `MeshBasicNodeMaterial` (holographic/energy) that ignores lighting; HUD is
  DOM. No lights to revisit here.

### Step 6b — Cyberpunk HUD ✅

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

- **Galaxy twirl — iteration 5 (the actual fix).** Iteration 4 (below) made
  the background look animated but it was the *wrong* motion: a rigid
  whole-disc `rotateZ` of the `<points>` object ("spin"), with the journey-30
  per-vertex `1/r` shear as secondary and 5× too slow. That reads as a
  "static rotating background", not the journey-30 **twirl** (which is the
  *differential* rotation — inner arms outrunning outer arms so the spiral
  visibly winds/unwinds). Fixed by making the port faithful to the
  reference _and_ adapting the geometry for our very different viewing
  setup (billboarded flat disc, 5× the reference radius, gameplay embedded
  at the disc center):
  1. **Randomness is a separate `aRandomness` attribute added AFTER the
     per-vertex rotation** (exactly like the reference's
     `modelPosition.xyz += aRandomness`), NOT baked into `position`. Baking
     randomness into `position` forced a `max(dist, 0.5)` clamp in the
     shader (to stop near-center points from spinning to aliasing noise), and
     that clamp **flattened the inner-arm shear** — the most dramatic part of
     the twirl. With randomness separate, the rotation runs on the clean
     spiral skeleton, the fuzz halo inherits the motion, no clamp is needed,
     and the full `1/r` curve survives: a point at r=1 completes a revolution
     in ~6 s while one at r=26 takes ~26 s — the visible shear.
  2. **Rate restored to the reference's `1.0`→tuned `0.5`** (was multiplied
     by `uSpinSpeed=0.18` — ~5× too slow). Now `angle += (1.0/dist) * uTime *
     uSpin` with `uSpin=0.5` — the `1/r` differential is preserved so it is
     still a twirl, not a rigid spin, just visible enough across the disc.
  3. **Removed the rigid whole-disc spin entirely.** The `<points>` object
     is now ONLY billboarded to the camera (constant apparent shape, no
     scroll twitch); all visible motion is the per-vertex differential
     twirl. A rigid rotateZ was actively masking the twirl by dominating
     the motion budget.
  4. **Per-vertex `aScale`** added (reference behaviour) for varied point
     sizes, folded into the stock `PointsMaterial` `gl_PointSize = size *
     aScale;` line so the built-in `sizeAttenuation` perspective falloff
     still applies.
  5. **Fixed the soft-point fragment mask too:** the previous code replaced
     `#include <output_fragment>`, which **does not exist** in this `three`
     version (the stock points fragment uses `#include <opaque_fragment>`, and
     assigns `outgoingLight = diffuseColor.rgb;` *before* it). The silent
     no-op left chunky-square points. Now masks `diffuseColor` _before_ the
     stock `outgoingLight = diffuseColor.rgb;` line so the radial
     `pow(1-d,10)` light-point actually affects output.
  6. **No-clean-pie geometry (the iteration-6 regression fix).** The first
     faithful port exposed a problem the reference doesn't have: with a
     flat billboarded disc 5× the reference radius and gameplay sitting at
     the disc's geometric center, the bare `positions = (cos·r, sin·r, 0)`
     with `branches=N` placed `N` **un-blurred arm origins radiating from
     the center** → the user saw the screen "divided in five pieces of pie
     from center, no animated galaxy". The reference's small `radius=5` and
     tilted viewing distance reads those clean inner arms as a tight core,
     not pie slices; ours does not. Fixed by:
     - **rim-biased radius**: `r = sqrt(rand) * radius` distributes points
       uniformly per annular area (the reference's `rand*radius` would pack
       the center); combined with the `+radius*0.18` fuzz floor this leaves
       no clean arm skeleton at the center.
     - **an absolute fuzz floor** in `aRandomness` (`randomness * (r +
       radius*0.18)`, not `* r`): the `+radius*0.18` term gives inner-arm
       points an *absolute* minimum scatter so the clean inner arm-origin
       is blurred away.
     - **a 45% pure-random halo** of points with no branch assignment at
       all (`branchAngle = Math.random()*τ` instead of `i%branches/branches*τ`)
       so the discrete `branches`-fold symmetry is buried in a continuous
       fuzz — the eye reads a nebula, not N slices.
     - **`branches` 5→8**, `randomnessPower` 2.4→2.0 (larger typical
       offsets, denser fuzz band).
     Verified by Playwright angular-autocorrelation probe: the broken
     iter-5-SAUCER had a strong 5-fold brightness period (72°) at r~0.45R;
     the fix has no preferred angular period at any radius (smooth nebula),
     with ~20% of central-disc pixels still changing between frames 2 s
     apart (max delta ~138) — genuine per-vertex motion survives.
     `pow(1-d,10)` light-point actually affects output.

  **Build/test status:** `npm run build` passes, shader compiles with zero
  WebGL console errors, all 29 vitest scenarios pass. A new Playwright smoke
  (`screenshots/galaxy-twirl.spec.ts`) loads the built game and confirms no
  shader-compile / runtime errors; pixel probes confirm the galaxy is now a
  smooth (no angular-periodicity) nebula that animates between frames.

- **Galaxy twirl — iteration 7 (the real fix: shader never ran under
  `WebGPURenderer`).** Iterations 5/6 *were* the correct algorithm but the
  implementation routed the twirl into a stock `PointsMaterial` via
  `mat.onBeforeCompile` — and that patch was silently **never compiled**.
  `WebGPURenderer` (R3F v9's renderer, even forced to the WebGL backend via
  `forceWebGL: true`) routes ALL materials through the node system
  (`GLSLNodeBuilder`); only the legacy `WebGLRenderer.js` ever calls
  `onBeforeCompile`, and `WebGPURenderer` / its WebGL-fallback backend ignore
  the callback entirely. A Playwright probe wrote `window.__galaxyPatched =
  !!uniforms.uTime` from the `useFrame` and read it back as `false`, with
  `uTime` registered as `-1` every frame — the patch never ran, the stock
  vertex shader was untouched, so no `uTime`-driven rotation ever executed.
  The only motion the user ever saw was menu/orb movement reprojecting the
  static, billboarded points via the camera — which read as "no animation",
  and left the bare 5-branch skeleton visible as static pie wedges.

  Fix: port the twirl to a TSL `PointsNodeMaterial` so the node builder
  actually compiles it:
  - `mat.positionNode = Fn(() => { const p = vec3(positionLocal).toVar();
    const dist = length(p.xy).max(0.01); const angle = atan(p.y, p.x)
      .add(time.div(dist)); return vec3(cos(angle).mul(dist),
      sin(angle).mul(dist), p.z).add(aRandomness); })()` — the exact 1/r
    differential twirl of the reference, expressed as a TSL node. `time`
    is the shared TSL uniform advanced by `<ShaderClock>`, so the galaxy
    animates in lockstep with the holographic orbs/obstacles — no JS-side
    uniform juggling, no `onBeforeCompile`.
  - `mat.colorNode = Fn(() => { const pd = distance(pointUV, vec2(0.5));
    const soft = float(1.0).sub(pd).pow(8.0); return
    attribute<'vec3'>('color').mul(attribute<'float'>('aScale')).mul(soft);
    })()` — the soft-point radial falloff (replaces the previous
    `outgoingLight = diffuseColor.rgb;` string patch, which never existed
    in the WebGPURenderer pipeline).
  - `vertexColors: true`, `transparent: true`, `depthWrite: false`,
    `blending: AdditiveBlending` — same backdrop contract as before.

  **Trade-off (documented in `PointsNodeMaterial` itself):** WebGPU and its
  WebGL-fallback hardcode `gl_PointSize = 1.0` at the tail of the vertex
  shader (`GLSLNodeBuilder._getGLSLVertexCode`), so `sizeNode` is ignored
  for raw `Points` — every point renders at exactly 1 pixel. We compensate
  with a higher `count` (~350 k, up from 260 k) so overlapping additive 1px
  points clusters brighten into a visible nebula rather than reading as
  sparse 1px sprinkles. Visible-sized points would require `Sprite` +
  instancing per the `PointsNodeMaterial` doc.

  **Verification (Playwright 1280×720, frame-a vs frame-b 1.5 s apart):**
  shader compiles with zero WebGL console errors; bright-pixel motion now
  extends radially out to ~60% of the frame radius (20–37% of pixels change
  per band in r=[10%,60%], dropping to 0% only at the very edges where the
  disc has faded into the clear color) — versus iteration 5 which only moved
  the inner 200×200 px (orb area) at ~20% and 0% everywhere else. Angular
  brightness distribution is now smooth (6–13% variance, no angular
  periodicity) — the bare 5-arm skeleton that read as pie wedges is gone,
  replaced by additive-blended 1px points whose density follows the
  rim-biased spiral + fuzz halo of iteration 6.

  ## Still suboptimal: 1px-point limitation + visual tuning harness

  > **Superseded by iteration 8 (above):** the 1px limitation is solved
  > by switching from `<points>` to `<instancedMesh>` of billboarded
  > quads. The tuning-harness (`?galaxydebug`) below is STILL the place to
  > dial the look — it now uses the SAME `<instancedMesh>` +
  > `createGalaxyMaterial` factory as production (no more inline
  > `PointsNodeMaterial`), and adds a `pointSize` knob that was missing
  > before (the critical parameter for visible stars). The narrative below
  > is preserved for history.

  The remaining complaint ("looks like white noise, only blue, no twirl")
  is a consequence of the 1px-point hardcode (`WebGPURenderer`'s
  WebGL-fallback forces `gl_PointSize = 1.0` regardless of `sizeNode`). The
  `PointsNodeMaterial` doc itself recommends using `Sprite` + instancing
  for visible-sized points — a path we haven't taken yet. With 350 k 1px
  additive points, the twirl doesn't read at the production billboarded
  scale because individual arms are sub-pixel at most view angles.

  To iterate toward the right look without burning cycles on
  build→screenshot→human-check loops, `src/debug/GalaxyDebug.tsx` mounts a
  standalone tuning scene at `/?galaxydebug`:
  - A free `OrbitControls` camera over the disc (so you can find a view that
    reveals the twirl off-axis — the reference's `(3,3,3)`-looking-at-origin
    is the canonical "the spiral reads" view).
  - A `lil-gui` panel exposing the exact same knobs as the reference
    (`count, radius, branches, randomness, randomnessPower, insideColor,
    outsideColor`) plus our `spin` and the camera's `offAxis*` params, with
    `onFinishChange` regenerating the geometry. `spin` is a live uniform so
    you can scrub it without rebuild.
  - Same `createGalaxyMaterial` factory (now `<instancedMesh>` of
    billboarded quads, not `PointsNodeMaterial`) and `time` shared uniform
    the production `GalaxyBackground` uses — whatever look you dial here
    applies 1:1 to the game once you copy the parameters into
    `GalaxyBackground` defaults. Added a `pointSize` knob (the parameter
    that makes visible stars actually visible).
  - Route wired into `src/App.tsx` (`?galaxydebug` switches to a debug
    `<Canvas>` with `<RenderLoop />`); the regular game path is untouched.

  Next step (after tuning): port the `Sprite` + instancing path for
  visible-sized bright points so the twirl reads at the production
  billboarded scale. Or alternatively, render the galaxy through a legacy
  `WebGLRenderer` to recover `gl_PointSize = size * (1/-z)` attenuation.

- **Galaxy twirl — iteration 8 (visible-sized stars via `<instancedMesh>` of
  billboarded quads).** Iteration 7 made the TSL twirl actually *run* under
  `WebGPURenderer`, but the `PointsNodeMaterial` `sizeNode` is silently
  ignored — the WebGL-fallback backend hardcodes `gl_PointSize = 1.0` at the
  tail of the generated vertex shader (`GLSLNodeBuilder._getGLSLVertexCode`),
  so every "star" renders at exactly 1 pixel. With `count=350k` and
  `AdditiveBlending` that read as a flat, dim, white-noise-ish haze — the
  blame screenshot-013 "gets in shape" version — and the twirl does NOT read
  at the production billboarded scale because individual arms are sub-pixel.
  The reference (`screenshot-014`, journey 30) shows bright, clearly-visible
  star particles distributed around a dense core with a readable spiral
  twirl; 1px Points fundamentally cannot reproduce that look.

  Fix — port the documented escape hatch (`PointsNodeMaterial` doc itself
  recommends `Sprite` + instancing for visible-sized points): replace
  `<points>` with `<instancedMesh>` of a `PlaneGeometry(1,1)` quad, one
  per star. The twirl is computed PER-INSTANCE in the `positionNode` of a
  TSL `MeshBasicNodeMaterial`, so the per-vertex **differential** `1/r`
  shear is still honoured by the node builder and animates in lockstep with
  the shared `time` uniform — but each star now has a real world-space
  size (the quad corner is scaled by `pointSize * aScale` in the
  `positionNode`), so 200k instances read as bright solid stars like the
  reference (not 1px sprinkles).

  Geometry defaults RESTORED to the journey-30 reference values where they
  produce the look — the iter-6 anti-pie-slice workarounds (rim-biased
  `sqrt(rand)` radius, absolute `+radius*0.18` fuzz floor, 45% random halo,
  `branches=8`) were diluting the spiral structure that reads as a galaxy.
  With visible stars the bare branch skeleton IS the galaxy, so we go back
  to the reference's `rand*radius`, `randomness*radius`, `branches=5`,
  `randomnessPower=3`, random-only at the reference ratio. Twirl rate stays
  at the reference's `1/r` (no clamp, no `0.18×` slowdown), randomness stays
  a separate post-rotation `aRandomness` attribute. The disc lies in XY
  (Z normal toward camera) instead of the reference's XZ because the
  camera looks down -Z at the play field — the whole `<instancedMesh>` is
  billboarded to the camera anyway, so the XY disc always faces the view.

  Per-instance data (`aSkeleton`, `aRandomness`, `color`, `aScale`) rides
  on `InstancedBufferAttribute`s attached to the shared quad template;
  `attribute(name)` inside the instanced mesh's node system auto-indexes
  those by `instanceIndex`. Because the quad template is in XY and the
  root is billboarded to the camera, we do NOT need a per-instance
  camera-facing rotation in the shader — the quad already faces the view.

  Extracted the material + live `galaxySpin` uniform into
  `src/three/materials/galaxy.ts` (`createGalaxyMaterial({pointSize, spin,
  falloff})`) so the production `<GalaxyBackground>` and the `?galaxydebug`
  tuning scene use the SAME factory (tuning dialled there applies 1:1 to
  the game). `?galaxydebug` also now uses `<instancedMesh>` + the shared
  factory and exposes a `pointSize` knob (was missing before — that's the
  parameter that lets visible stars actually be visible).

  **Verification (Playwright 1280×720, frame-a vs frame-b 1.5 s apart):**
  shader compiles with **zero** WebGL console errors (InstancedMesh +
  MeshBasicNodeMaterial are fully node-builder-supported, unlike
  `onBeforeCompile`). **59,091** bright pixels (lum>40), distributed
  exactly like the reference — densest + brightest at the core (band
  r∈[0, 0.17]: 2,812 px, avgLum 71), even mid-disc (bands r∈[0.17, 0.83]:
  7.8k–10.6k px each, avgLum 53–57). Between frames 1.5 s apart,
  **419,356** pixels change across every annulus (band 1: 26k, band 2:
  47k, band 3: 53k, band 4: 54k) — the differential twirl now rotates
  stars all the way out to the visible frame edges (the iter-7 1px
  version only moved the inner 200×200 px per the doc). Output is on disk
  as `.temp/screenshot-015.png` (frame-a) and `.temp/screenshot-016.png`
  (frame-b).

- **Galaxy depth — iteration 8b (tilted billboard).** Iteration 8 (above)
  sits the disc in the disc-local XY plane with Z as the thin normal, then
  billboards the whole `<instancedMesh>` to the camera every frame. The
  billboard is what keeps the scroll-twitch fixed (Step 6b, iter-4 root
  cause #1): the disc rigidly tracks the camera orientation so panning/
  pitching following the orbit center never warps the apparent nebula
  shape. But a full face-on billboard flattens the Z-thickness — the galaxy
  reads as a flat twirl, not the tilted disc the reference's `(3,3,3)`
  camera shows (and you can't orbit to its back as the reference's free
  `OrbitControls` camera lets you).

  Fix: keep the billboard lock but compose it with a fixed disc-local
  X-axis **tilt** (`tilt = 0.5 rad ≈ 28.6°`, matching the reference's tilted
  camera angle). `useFrame` now does `camQuat.multiply(tiltQuat)` so the
  disc is always tipped relative to the view; the disc's full 3D Z volume
  (Z randomness restored from `* 0.3` to the reference's `* 1.0` — same
  magnitude on all 3 axes like the reference) reads as visible depth. The
  tilt is applied first in local space then the camera orientation, so the
  disc stays tipped in screen space regardless of where the game camera
  points. The tilt is exposed as a `tilt` prop on `<GalaxyBackground>` and
  as a `tilt` GUI knob in `?galaxydebug` (debug applies it as a static
  world-space `rotation.x` instead of a billboard, since the debug scene's
  `OrbitControls` camera orbits the disc freely — the `tilt` knob there
  visualizes the production look 1:1). The disc still never occludes
  gameplay (`depthWrite:false` + `AdditiveBlending` unchanged).

  Output on disk as `.temp/screenshot-019.png` (frame-a) and
  `.temp/screenshot-020.png` (frame-b).

- **Galaxy volume — iteration 8c (true additive blend, not a tilted sheet).**
  Iterations 8/8b recovered visible depth by giving the disc real 3D Z volume
  and presenting it at a tilt. But the disc was too SPARSE to read as a
  volumetric glow: at `count=200000` over `radius=26` the density is
  ~94 stars/unit² — ~27× sparser than the reference's ~2564/unit² (`count=200000, radius=5`). Individual stars remained distinguishable,
  so the tilted disc still looked like a "duck-tape sheet of dots"
  rather than a smoothly blended nebula.

  Verified objectively with a luminance-histogram probe
  (`screenshots/_galaxy-volsweep.spec.ts`): the bright-pixel luminance
  distribution is the discriminator. A "sprinkled sheet" dumps pixels into
  either the dark floor or the saturated peak with little in between (the
  baseline measured `midRatio = mid/(all bright) = 0.033`); a true
  volumetric glow piles pixels in the 65–130 luminance band from additive
  stellar-quad overlap (`midRatio` rises).

  Sweep over `(count, pointSize)`:
  | label                           | totalBright | midRatio |
  | ------------------------------- | -----------:| --------:|
  | baseline (200k, ps0.18)          |     147,056 |   0.033  |
  | ps0.25                          |     193,490 |   0.196  |
  | count300k                       |     183,517 |   0.117  |
  | count300k+ps0.25 (NEW default)  |     222,490 |   0.277  |
  | count400k+ps0.22                |     223,744 |   0.276  |

  `count=300000, pointSize=0.25` lifts `midRatio` **8.4×** (0.033 → 0.277)
  with only a 50% count bump and no GPU strain — the clear winner.
  `count400k+ps0.22` hits the same glow ratio at 2× the count (diminishing
  returns past 300k+ps0.25 — extra count mostly just adds noisy overdraw
  rather than mid-band blend depth).

  New defaults encoded directly on `<GalaxyBackground>`:
  `count=300000, pointSize=0.25`. The Z-disc thickness stays at the
  reference's full magnitude (`randomness * r`, not `* 0.3` — see 8b), so
  the tilted billboard now presents a real 3D *volume* of overlapping bright
  quads at the mid-band luminance: stars aren't distinguishable points
  anymore, the spiral arms blend into a smoothly shearing nebula where the
  dominant motion (the `1/r` twirl) reads as gentle shear rather than
  "individual rotating dots".

  A/B overrides (`?gx_count=…&gx_ps=…`) are honored by a tiny URL-param
  shim in `<GalaxyBackground>` so future sweeps don't need a rebuild;
  the sweep dumps row-by-row to `.temp/volsweep/sweep.csv` so partial runs
  (timeout on a slow combo) still leave completed rows on disk.

  Full per-band stats on the new defaults: core avgLum 73 → rim avgLum 60
  (was 71 → 50 — the gradient softened from stark into the gentle nebula
  gradient the reference shows), 222k bright pixels, 60k mid-band glow,
  differential twirl animating across every annulus (band 1: 27k px,
  band 2: 47k, bands 3–4: 53k–55k changed per 1.5 s), zero WebGL errors.

  Output on disk as `.temp/screenshot-021.png` (frame-a) and
  `.temp/screenshot-022.png` (frame-b).

- **Galaxy volume — iteration 8d (3D thickness boost via `zSpread`).**
  Iterations 8/8b recovered visible depth at the **structural level** (tilt
  the disc) and 8c solved the volumetric blend at the **density level**
  (raise count + pointSize so additive star-quads overlap into a glow).
  Still remaining: a residual "paper slice / onion layer" read on the
  twirl branches, particularly visible because every arm rotates around
  the center AND around its own axis.

  Root cause: our camera is billboarded at `behind=14`, so perspective
  foreshortening is `1/14 ≈ 0.071` — ~2.8× weaker than the reference's
  ~1/5 = 0.2 at its literal `(3,3,3)` camera. The reference's Z-axis
  randomness is on the same magnitude as the in-disc axes (matched), but
  at our farther distance the depth-offset it projects (≈ `sin(tilt)` ×
  Z-spread) compresses to pixels too tiny to read. The disc reads flat
  because the stars' depth-offset doesn't survive perspective squash.

  Fix: introduce a `zSpread` multiplier (default `3.0`) on the disc-normal
  (Z) randomness axis ALONE, so the disc thickens independently of the
  radial fuzz. Default `zSpread=3` is 0.5× beyond the 2.8× perspective-fast
  compensation, giving a touch of extra visible depth. The Y/X fuzz stays
  at the reference's matched magnitude — only Z is scaled, so the spiral
  structure (in the disc plane) is preserved and only its **perpendicular
  thickness** is amplified.

  Confirmed with a probe (`screenshots/_galaxy-zsweep.spec.ts`) running
  against the clean `?galaxydebug` scene (no gameplay pixels):
  | zSpread | totalBright | bboxRatio (H/W) |
  | -------:|------------:|----------------:|
  | 1.0     |      50,483 |          0.566  |
  | 2.0     |      59,916 |          0.572  |
  | 3.0     |      66,664 |          0.603  |
  | 5.0     |      74,179 |          0.649  |
  | 8.0     |      80,793 |          0.682  |

  `bboxRatio` (height/width of the bright halo) rises monotonically with
  `zSpread` — projected Z puff adds vertical screen pixels, exactly the
  cue the eye reads as 3D volume. Production has `zSpread=3.0` (the
  sweet spot: visibly thicker than baseline without ballooning into a
  fuzzy ball past ~5).

  Surface area:
  -   `src/scene/GalaxyBackground.tsx`: new `zSpread` prop with default 3.0.
      The geometry builder now scales Z randomness by `zSpread`. Existing
      URL-override shim extended (`?gx_z=…`).
  -   `src/debug/GalaxyDebug.tsx`: `zSpread` added to the `GalaxyTuning`
      interface, DEFAULT, geometry builder, and GUI panel — same
      production/debug 1:1 tuning parity story maintained.
  -   `src/App.tsx`: `?galaxydebug&gx_z=…` (and other `gx_*`) hot-overrides
      `DEFAULT_TUNING` at page load so probes can sweep the isolated
      galaxy without rebuilding.
  -   New sweep specs: `_galaxy-volsweep.spec.ts` (iter 8c density A/B —
      epsilon noise complete now and swept → 8c defaults locked in),
      `_galaxy-qssweep.spec.ts` (pointSize sweep — output not yet folded
      in; pending visual confirmation), `_galaxy-zsweep.spec.ts` (iter 8d,
      this one).

  Output on disk as `.temp/screenshot-023.png` (frame-a) and
  `.temp/screenshot-024.png` (frame-b).

- **Galaxy volume — iteration 8e (the real fix: shrink the disc).**
  Iterations 8/8b (tilt) and 8c (bump count + pointSize for additive
  overlap) and 8d (boost Z-axis randomness via `zSpread` hack) all
  attacked symptoms. The actual root cause of "branches look like paper
  sheets" was **fundamentally geometry scale**: our `radius=26` is ~5×
  the reference's `5`, and our billboard `behind=14` is ~2.8× its camera
  distance. Combined, our **density was 141 stars/unit² vs the
  reference's 2546 — 18× sparser** — AND our perspective-strength was
  ~2.8× weaker. At that sparsity/flatness, stars sit as a sparse 2D
  sprinkle with tiny depth offset → reads as a thin "sheet" instead of
  as a solid 3D volumetric blob.

  Fix: stop the compensation hacks (8d's `zSpread=3.0` was literally
  trying to fake the depth-falloff we lost to greater distance) and
  instead match the reference's geometry ratios directly:
  | knob        | reference | (was | NEW |
  | ----------- | ---------:| ----:| ---:|
  | `radius`    | 5         | 26   | **11**  |
  | `count`     | 200,000   | 300k | **400,000** |
  | `behind`    | ~5        | 14   | **14** |
  | `zSpread`   | 1.0       | 3.0  | **1.0** |
  | `pointSize` | 0.005*s   | 0.25 | **0.20** |
  | `tilt`      | ~0.54     | 0.50 | **0.50** |

  New **density**: 400k / (π·121) = **1052 stars/unit²** — **7.5×
  denser** than the prior `radius=26` config (which was 141/unit²),
  ~41% of the reference. That is the regime where additive stellar
  quads overlap per unit volume into a real 3D cloud vs being
  distinguishable individual dots in a 2D sheet.

  Angular size shrinks from 121° to 76° (`2·atan(11/14)`). The galaxy
  no longer fills the entire screen backdrop — it is a **spatially
  concentrated spiral galaxy** sitting in space behind the gameplay,
  same compositional shape the reference itself shows; the rest of
  the screen falls back to the dark clear color (`#05060d`) which is
  already the established scene-backdrop for additive reading.

  `zSpread` reverted to 1.0 (matched-axes, like the reference):
  perspective-strength is still ~2.8× weaker than the reference due to
  our `behind=14` (kept to preserve the known-good render order
  vis-à-vis gameplay), but the **_7.5× higher density_ stack of
  additive quads** at the same per-star Z thickness now reads as a
  volumetric blend from sheer count. The eye sees a 3D cloud because
  the stack is dense enough that individual Z planes don't resolve as
  distinguishable sheets.

  Probe stats on the new defaults (`screenshots/_galaxy-probe.spec.ts`,
  production page):
  -   `totalBright = 202,629`, `midRatio = 0.311` (was 0.277 in 8c —
      even more mid-band additive overlap glow, 9.4× the original
      paper-sheet baseline `midRatio = 0.033`).
  -   per-band luminance gradient: core 75 → rim 59 (the reference's
      gentle nebula rolloff, not the prior stark "core vs arms"
      shift).
  -   zero WebGL errors.

  Output on disk as `.temp/screenshot-025.png` (frame-a) and
  `.temp/screenshot-026.png` (frame-b).

- **Galaxy volume — iteration 8f (objective depth-profile match).** The
  "paper sheet" / "toilet paper roll" perception finally had an objective
  diagnosis: a reference-vs-ours depth comparison probe
  (`screenshots/_galaxy-refcmp.spec.ts`) reads both `screenshot-014.png`
  (the actual reference image) and a current frame we render and computes
  the **perpendicular-axis brightness profile** — luminance sampled along
  a vertical column through the disc center.

  Reading the `vertHalfFW` (vertical full-width-half-max of brightness)
  made the difference quantifiable: the reference's was **405 px tall** — a
  wide smooth bright band; ours was **10 px** — a razor-thin needle peak.
  The reference's vertical profile ramps gently through [135, 59, 20, 54,
  167, 95, 200, 132, 145, 115, 208, ...], a smooth noisy 3D blob. Ours
  had one spike at sample 30 then dropoff — clearly a thin sheet, not a
  volume.

  Root cause finalised: the reference sits at **density ≈ 2546
  stars/unit²** (`count=200000, radius=5`). The 8e config (`count=400k,
  radius=11`) gave only ~1000/unit² — half reference — and crucially
  the **per-unit-VOLUME density** that makes additive stars overlap into a
  solid cloud was far lower than reference because the disc was thicker
  per unit (with `zSpread=1`) but still too sparse.

  Final fix: match the reference's per-volume density directly.
  | knob        | reference | NEW  |
  | ----------- | ---------:| ----:|
  | `radius`    | 5         | **7**  |
  | `count`     | 200,000   | **400,000** |
  | `behind`    | ~5        | **14** |
  | `zSpread`   | 1.0       | **1.0** |
  | `pointSize` | (perspective) | **0.20** |
  | `tilt`      | ~0.54     | **0.50** |

  New density: **400k / (π·49) ≈ 2598 stars/unit²** — matches the
  reference's 2546. **Per-volume star count is now reference-equivalent**,
  so additive overlap into a 3D blob is also reference-equivalent.

  Comparison probe after the change:
  | metric                | reference | ours |
  | --------------------- | ---------:| ----:|
  | `thicknessRatioQtr`   |     0.434  | **0.402** |
  | `tailRatio`           |     0.341  |     0.216 |
  | `midRatio` (probe)    | n/a        | **0.39** |
  | `totalBright`         |    311,590 |    103,082 |

  `thicknessRatioQtr` (vertical/horizontal FWHM of the bright band at
  1/4 peak threshold, which averages out individual star spikes that
  would otherwise skew tighter thresholds) rose from **0.0169** in iter
  8e to **0.402** — **24× greater perpendicular extent** — and is now
  within 8% of the reference's 0.434. The vertical brightness profile
  smoothed from a needle spike `(…  0, 17  34, 18, 17, 34, 62, 19, 22,
  235, 23, 20, 65, 29, 9, 6, 4, 3, 3, 3  …)` to a gentle bell shape
  `(4, 5, 8, 11, 14, 16, 18, 24, 32, 37, 42, 50, 57, 61, 64, 70, 78,
  83, 87, 93, 98, 103, 107, 109, 109, 105, 94, 77, 56, 34, 18, ...)` — a
  real 3D volumetric falloff, not a 2D sheet

  Output on disk as `.temp/screenshot-029.png` (frame-a) and
  `.temp/screenshot-030.png` (frame-b).

- **Galaxy volume — iteration 8g (THE actual root cause: per-axis
  randomness).** The user re-reported the same "toilet paper roll,
  particles on a plane, not in a 3D cube" symptom after 8f. Re-reading
  the reference's geometry loop (`threejs-journey/30-animated-galaxy/src/
  script.js` lines 72-74) line-by-line revealed an actual bug in our
  randomness generation:

  ```js
  // REFERENCE — three SEPARATE Math.random() calls per axis:
  const randomX = Math.pow(Math.random(), p) * (Math.random()<0.5?1:-1) * randomness * radius;
  const randomY = Math.pow(Math.random(), p) * (Math.random()<0.5?1:-1) * randomness * radius;
  const randomZ = Math.pow(Math.random(), p) * (Math.random()<0.5?1:-1) * randomness * radius;
  ```

  ```js
  // OURS (buggy) — one rpow, one sign, reused on all 3 axes:
  const rpow = Math.random() ** randomnessPower;
  const sign = Math.random() < 0.5 ? 1 : -1;
  const rx = rpow * sign * randomness * r;
  const ry = rpow * sign * randomness * r;   // ← SAME rpow, SAME sign as rx
  const rz = rpow * sign * randomness * r * zSpread;
  ```

  Reusing the same `rpow` AND the same `sign` for all three axes meant
  every star's puff vector was `(s, s, s)` for some signed scalar `s` —
  i.e. lying along the `±(1,1,1)` diagonal line through the branch ray.
  This collapses the puff to a 1D diagonal whisker per star rather than
  a 3D cube — exactly the "paper sheet wrapped around branch line" look
  reported. (The 8e and 8f focused on per-disc thickness/density which
  is also necessary, but the diagonal-collapse bug was masking them.)

  Fix: compute `rpowX`, `rpowY`, `rpowZ` and `signX`, `signY`, `signZ`
  independently — exactly matching the reference's three separate
  `Math.random()` calls per axis. With patch applied:

  | metric              | reference | OURS (8g) | (8f prior) |
  | --------------------|----------:|----------:|-----------:|
  | `thicknessRatioQtr` | 0.434     | **0.478** | 0.402       |
  | `midRatio`          | n/a       | **0.415** | 0.390       |
  | `totalBright`       | 311,590   |   134,475 | 103,082     |
  | `vertHalfFW`        | 405px     |  298px@1/4| 267px@1/4   |

  The `1/4`-peak-thickness ratio (which averages out individual star
  spikes and measures the cloud's real perpendicular extent) now
  exceeds the reference's — 0.478 > 0.434. Stars are now distributed
  in a real 3D cube around each branch ray, not on a diagonal whisker.
  real 3D cube around each branch ray, not on a diagonal whisker.
  Output: `.temp/screenshot-029.png` (frame-a) and `.temp/screenshot-030.png` (frame-b).

- **Debug scene fixed alongside production (8g).** The exact same
  shared-rpow/sign bug also existed in `src/debug/GalaxyDebug.tsx`'s
  `buildGalaxyGeometry` (the debug scene has its own copy of the
  geometry builder so tuning can regress parametrically). Applied the
  identical independent-per-axis fix there. After the fix, the debug
  probe at `?galaxydebug&gx_z=1.0` measures:

  | metric                                  | reference | debug (8g) |
  | --------------------------------------- | ---------:| --------: |
  | `thicknessRatioQtr` (debug, default cam)|     0.434 |  **0.493** |
  | `vertQtrFW` (debug, default cam)        |     n/a   |    348 px |

  The debug scene's free-`OrbitControls` camera position
  `(offAxisDistance=10, offAxisHeight=6, offAxisDistance=10)` is closer
  to the reference's `(3,3,3)`-style off-axis view than production's
  gameplay-constrained lateral-only camera, so its volume reads even
  thicker than the reference's. Output:
  `.temp/screenshot-031.png` (`?galaxydebug&gx_z=1.0`).

- **Galaxy twirl + scroll-twitch fix (iteration 4, screenshot-009 — superseded
  above):** the galaxy was showing as a static, non-animating image and visibly
  jumping when the camera scrolled. Three root causes, three fixes (the
  scroll-twitch half is still valid; the twirl half was wrong and is
  superseded by iteration 5):
  1. **Stale camera read → scroll jump.** `<GalaxyBackground />` was mounted
     BEFORE `<CameraController />` in `GameScene`, so among same-priority
     `useFrame` subscribers (mount order) the galaxy copied `state.camera`
     one frame stale. As the camera lerps following the orbit center,
     pitching its `lookAt`, the one-frame-stale billboard quaternion
     mis-aligned every frame → the visible jump. Moved `<CameraController />`
     to mount **before** `<GalaxyBackground />` so the galaxy reads the
     freshly-updated camera. **(Still valid — kept.)**
  2. **Billboard reset wiped the accumulated spin → "static".** We were
     doing `quaternion.copy(camera.quaternion)` then `rotateZ(delta*spin)`
     every frame — but the copy **wipes** the prior frame's spin, so the spin
     never accumulates. Fixed by tracking the angle in a ref and rebuilding
     the orientation each frame as `billboardQuaternion *
     quaternionFromAxisAngle(z, spinAngle)`. **(Superseded: the whole-object
     spin is now removed in iteration 5; the twirl comes purely from the
     per-vertex shader. The billboard is kept, with NO in-plane Z spin.)**
  3. **No visible in-shader motion.** The per-vertex `1/r` swirl was aliased
     to noise at the core and glacially slow on the outer arms, with the JS
     whole-object spin doing all the visible work. **(Superseded: iteration 5
     restores the per-vertex shear as the primary motion by separating
     `aRandomness` post-rotation (no clamp needed) and dropping the speed
     multiplier + rigid spin.)**
  Disc billboarded to the camera and parked along the camera's view-forward
  axis at `behind=14`, with a very thin in-plane Z thickness — **kept** in
  iteration 5.
- **Orb pulsing core is a true holographic shell matching the orb (screenshot-008→9):**
  the core had been tinted ~70% toward white + given a `baseFill` body, which
  made it read as a **solid white bead**, not a hologram. Now the core uses
  `createHolographicMaterial` with the orb's **own identity color** and **no
  `baseFill`** → pure fresnel + stripes + glitch shell, the same energy look
  as the orb, just smaller (~0.30× orb radius) and pulsing (the `pulse`
  option beats 0.5→1.0). It spins on x/y in the **opposite** direction to the
  shell so the two hologram fields counter-rotate. Removed the now-unused
  `whiteTint` helper.
- **Orbit ring now renders THROUGH the orbs (screenshot-009):** the orbital
  path ring was drawn before the orbs, so the orb bodies/cores painted over
  it at the two crossing points — the ring "hid behind" the orbs. Moved the
  ring `<mesh>` to render **last** in the orbit `<group>`; since its material
  is additive + `depthTest:false` + `depthWrite:false`, its glow paints *over*
  the orb bodies/cores at the crossings → the ring visibly passes through the
  orbs (including the pulsing core) as requested.
- **Obstacles are holographic boxes like the orbs, different colors (screenshot-008→009):**
  iterations swung between "solid blue panel" (too much `baseFill`) and "empty
  outline" (too little `baseFill` → looked nothing like the orb's hologram).
  The orb's holographic look is a bright fresnel rim band + scrolling stripes
  + glitch on a translucent shell; a box has no curved silhouette so its
  fresnel only lights the silhouette edges. To make obstacles read as the
  same energy language as the orbs, `baseFill` is now a moderate ~0.7–0.9
  (collision 1.4) → the faces carry **visible scrolling scanlines** + a bright
  **fresnel edge** + glitch jitter (jelly), without being a solid panel
  (the pure fresnel alpha is 0 face-on, so the centre stays translucent and
  the rim/edges dominate). Intensity bumped to orb-level (static 2.0 … moving
  2.6, collision 3.0; orbs use 2.4) so the holographic field reads bright
  against the dark backdrop. Per-kind colors are distinct: `static`
  slate-blue, `angular` cyan-teal, `moving` purple, `angular_long` warm
  orange, collision yellow.
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
