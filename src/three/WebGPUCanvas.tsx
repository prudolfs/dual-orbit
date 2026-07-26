import { useFrame, useThree } from '@react-three/fiber'
import type { DefaultGLProps } from '@react-three/fiber/dist/declarations/src/core/renderer.js'
import { WebGPURenderer } from 'three/webgpu'

/**
 * R3F → WebGPU renderer integration.
 *
 * R3F's `<Canvas>` defaults to a `THREE.WebGLRenderer` and its built-in render
 * loop calls `gl.render(scene, camera)` synchronously. `WebGPURenderer.render`
 * is async (and the backend must be `await renderer.init()`ed first), so we:
 *
 *  1. Pass this `gl` factory to `<Canvas gl={createWebGPURenderer}>` — R3F calls
 *     it with the default renderer params (`{ canvas, antialias, alpha, ... }`)
 *     and installs the returned renderer as `state.gl`. We use `forceWebGL:
 *     true` so the renderer stays on a WebGL2 backend (no WebGPU device needed,
 *     max compatibility) while still gaining TSL `NodeMaterial` support.
 *  2. Mount `<RenderLoop />` once in the scene. It registers a `useFrame`
 *     with `priority={1}`. R3F treats any priority > 0 as "rendering is the
 *     subscriber's responsibility" and skips its synchronous
 *     `gl.render(scene, camera)`. We then call `gl.renderAsync(scene, camera)`,
 *     which is the async drive path for `WebGPURenderer`.
 *
 * Net effect: all `useFrame` subscribers run as usual each frame
 * (`ShaderClock`, `CameraController`, `SimulationTicker` priority 0), then we
 * render asynchronously once per frame.
 *
 * See docs/visual-redesign.md Step 2 (WebGPURenderer switch).
 */

export async function createWebGPURenderer(
	params: DefaultGLProps,
): Promise<WebGPURenderer> {
	// R3F always passes the <Canvas>'s own DOM <canvas> here, so we narrow from
	// `HTMLCanvasElement | OffscreenCanvas` to the concrete `HTMLCanvasElement`
	// (the `OffscreenCanvas` member is an interface-splitting artifact between
	// the DOM lib and @types/offscreencanvas that TS can't reconcile).
	const canvas = params.canvas as HTMLCanvasElement
	const renderer = new WebGPURenderer({
		canvas,
		antialias: params.antialias,
		alpha: params.alpha,
		forceWebGL: true,
	})
	await renderer.init()
	return renderer
}

export function RenderLoop() {
	const gl = useThree((state) => state.gl) as unknown as WebGPURenderer
	const scene = useThree((state) => state.scene)
	const camera = useThree((state) => state.camera)

	useFrame(async () => {
		await gl.renderAsync(scene, camera)
	}, 1)

	return null
}
