import { useEffect, useRef } from "react";

const MAX_DEVICE_PIXEL_RATIO = 1.25;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const FINE_POINTER_QUERY = "(pointer: fine)";
const STATIC_FRAME_TIME = 18;

type Rgb = [number, number, number];

const VERTEX_SHADER = `
attribute vec2 position;
attribute vec2 uv;
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

// Adapted for this portal from https://reactbits.dev/backgrounds/lightfall.
// The shader is fixed to three low-density streak layers so authentication stays primary.
const FRAGMENT_SHADER = `
precision highp float;

uniform vec3 iResolution;
uniform vec2 iMouse;
uniform float iTime;
uniform vec3 uColor0;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uBackground;
uniform float uMouseEnabled;

varying vec2 vUv;

vec3 palette(float h) {
  if (h < 0.333333) return uColor0;
  if (h < 0.666666) return uColor1;
  return uColor2;
}

vec3 tanhVector(vec3 value) {
  vec3 exponent = exp(-2.0 * value);
  return (1.0 - exponent) / (1.0 + exponent);
}

vec2 tunnelCoordinates(vec2 fragment, vec2 resolution) {
  vec2 point = (fragment + fragment - resolution) / resolution.x;
  float depth = 0.0;
  float distanceToSurface = 1e3;
  vec4 tunnelPoint = vec4(0.0);

  for (int step = 0; step < 34; step++) {
    if (distanceToSurface <= 1e-4) break;
    tunnelPoint = depth * normalize(vec4(point, 2.85, 0.0))
      - vec4(0.0, 4.0, 1.0, 0.0) / 4.5;
    distanceToSurface = 1.0 - sqrt(length(tunnelPoint * tunnelPoint));
    depth += distanceToSurface;
  }

  return vec2(tunnelPoint.x, atan(tunnelPoint.z, tunnelPoint.y));
}

void renderLightfall(out vec4 outputColor, vec2 fragment) {
  vec2 resolution = iResolution.xy;
  vec2 normalized = (fragment + fragment - resolution) / resolution.x;
  float time = 0.038 * iTime + 9.0;
  vec2 cell = vec2(5e-3, 6.28318530718 / 4.0);
  vec2 coordinate = tunnelCoordinates(fragment, resolution);
  vec2 coordinateDx = tunnelCoordinates(fragment + vec2(1.0, 0.0), resolution);
  vec2 coordinateDy = tunnelCoordinates(fragment + vec2(0.0, 1.0), resolution);
  vec2 derivativeX = coordinateDx - coordinate;
  vec2 derivativeY = coordinateDy - coordinate;
  derivativeX.y -= 6.28318530718 * floor(derivativeX.y / 6.28318530718 + 0.5);
  derivativeY.y -= 6.28318530718 * floor(derivativeY.y / 6.28318530718 + 0.5);
  vec2 filterWidth = abs(derivativeX) + abs(derivativeY);

  vec2 glowPoint = vec2(2.0, 1.0) * normalized
    - (resolution / resolution.x) * vec2(0.0, 1.0);
  vec4 light = vec4(uBackground * 24.0 / (1e3 * dot(glowPoint, glowPoint) + 6.0), 0.0);

  float mouseGlow = 0.0;
  if (uMouseEnabled > 0.5) {
    vec2 mouse = (iMouse + iMouse - resolution) / resolution.x;
    float mouseDistance = length(normalized - mouse);
    mouseGlow = exp(-mouseDistance * mouseDistance / 0.72);
    light.rgb += (uColor0 + uColor1 + uColor2) / 3.0 * mouseGlow * 0.08;
  }

  float radius = 5e-4 * 0.82;
  vec2 smoothing = vec2(max(length(filterWidth), 1e-5));

  for (int streak = 0; streak < 3; streak++) {
    float streakNumber = float(streak) + 1.0;
    float randomCell = fract(sin(dot(
      vec2(streakNumber, floor(coordinate.x / cell.x + 0.5)),
      vec2(7.0, 11.0)
    )) * 73.0);
    vec2 streakPoint = coordinate - (time + time * randomCell) * vec2(0.0, 1.0);
    streakPoint -= floor(streakPoint / cell + 0.5) * cell;
    float hue = fract(8663.0 * randomCell);
    vec3 color = palette(hue);
    float shimmer = 1.12 + 0.34 * sin(time + 7.0 * hue + 4.0);
    shimmer *= 1.0 + mouseGlow * 0.45;
    vec2 inner = vec2(
      length(max(streakPoint, vec2(-1.0, 0.0))),
      length(streakPoint) - radius
    ) - radius;
    vec2 shape = vec2(1.0) - smoothstep(-smoothing, smoothing, inner);
    light.rgb += dot(shape, vec2(exp(20.5 * streakPoint.y), 2.45)) * color * shimmer;
    coordinate.x += cell.x / 8.0;
  }

  vec3 finalColor = sqrt(tanhVector(max(
    light.rgb * 0.72 - vec3(0.04, 0.08, 0.02),
    0.0
  )));
  outputColor = vec4(finalColor, 1.0);
}

void main() {
  vec4 color;
  renderLightfall(color, vUv * iResolution.xy);
  gl_FragColor = color;
}
`;

function resolveCssRgb(container: HTMLElement, token: string): Rgb {
  const probe = document.createElement("span");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.color = `var(${token})`;
  container.appendChild(probe);
  const computedColor = getComputedStyle(probe).color;
  probe.remove();

  const channels = computedColor.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  if (!channels || channels.length !== 3 || channels.some((channel) => !Number.isFinite(channel))) {
    throw new TypeError(`Unable to resolve ${token} as an RGB color`);
  }

  return [channels[0]! / 255, channels[1]! / 255, channels[2]! / 255];
}

export function AuthLightfall() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let disposeRenderer = () => {};

    void (async () => {
      try {
        const { Mesh, Program, Renderer, Triangle } = await import("ogl");
        if (disposed) return;

        const reducedMotion = window.matchMedia(REDUCED_MOTION_QUERY).matches;
        const finePointer = window.matchMedia(FINE_POINTER_QUERY).matches;
        const renderer = new Renderer({
          alpha: true,
          antialias: false,
          dpr: Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO),
        });
        const gl = renderer.gl;
        const canvas = gl.canvas as HTMLCanvasElement;
        const colors = [
          resolveCssRgb(container, "--auth-lightfall-streak-primary"),
          resolveCssRgb(container, "--auth-lightfall-streak-secondary"),
          resolveCssRgb(container, "--auth-lightfall-streak-tertiary"),
        ] as const;
        const background = resolveCssRgb(container, "--auth-lightfall-background");
        const uniforms = {
          iResolution: { value: [1, 1, 1] },
          iMouse: { value: [0, 0] as [number, number] },
          iTime: { value: STATIC_FRAME_TIME },
          uColor0: { value: colors[0] },
          uColor1: { value: colors[1] },
          uColor2: { value: colors[2] },
          uBackground: { value: background },
          uMouseEnabled: { value: !reducedMotion && finePointer ? 1 : 0 },
        };
        const program = new Program(gl, {
          vertex: VERTEX_SHADER,
          fragment: FRAGMENT_SHADER,
          uniforms,
        });
        const geometry = new Triangle(gl);
        const mesh = new Mesh(gl, { geometry, program });
        let animationFrame: number | null = null;
        let lastFrameTime = 0;
        const mouseTarget: [number, number] = [0, 0];

        canvas.className = "login-page__lightfall-canvas";
        container.appendChild(canvas);
        container.dataset.state = "ready";

        const resize = () => {
          const { width, height } = container.getBoundingClientRect();
          renderer.setSize(Math.max(1, width), Math.max(1, height));
          uniforms.iResolution.value = [gl.drawingBufferWidth, gl.drawingBufferHeight, 1];
        };
        const resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(container);
        resize();

        const render = (timestamp: number) => {
          animationFrame = null;
          uniforms.iTime.value = timestamp * 0.001;
          if (finePointer && !reducedMotion) {
            const elapsed = lastFrameTime === 0 ? 0 : (timestamp - lastFrameTime) / 1000;
            const dampening = 1 - Math.exp(-elapsed / 0.18);
            uniforms.iMouse.value[0] += (mouseTarget[0] - uniforms.iMouse.value[0]) * dampening;
            uniforms.iMouse.value[1] += (mouseTarget[1] - uniforms.iMouse.value[1]) * dampening;
          }
          lastFrameTime = timestamp;
          renderer.render({ scene: mesh });
          if (!reducedMotion && document.visibilityState === "visible") {
            animationFrame = requestAnimationFrame(render);
          }
        };

        const start = () => {
          if (animationFrame !== null || reducedMotion || document.visibilityState !== "visible") return;
          lastFrameTime = 0;
          animationFrame = requestAnimationFrame(render);
        };
        const stop = () => {
          if (animationFrame === null) return;
          cancelAnimationFrame(animationFrame);
          animationFrame = null;
        };
        const handleVisibilityChange = () => {
          if (document.visibilityState === "visible") start();
          else stop();
        };
        const handlePointerMove = (event: PointerEvent) => {
          const rect = container.getBoundingClientRect();
          const dpr = renderer.dpr;
          mouseTarget[0] = (event.clientX - rect.left) * dpr;
          mouseTarget[1] = (rect.height - (event.clientY - rect.top)) * dpr;
        };

        document.addEventListener("visibilitychange", handleVisibilityChange);
        if (finePointer && !reducedMotion) window.addEventListener("pointermove", handlePointerMove);

        renderer.render({ scene: mesh });
        start();

        disposeRenderer = () => {
          stop();
          document.removeEventListener("visibilitychange", handleVisibilityChange);
          window.removeEventListener("pointermove", handlePointerMove);
          resizeObserver.disconnect();
          if (canvas.parentElement === container) canvas.remove();
          geometry.remove();
          program.remove();
          gl.getExtension("WEBGL_lose_context")?.loseContext();
        };
      } catch {
        container.dataset.state = "fallback";
      }
    })();

    return () => {
      disposed = true;
      disposeRenderer();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="login-page__lightfall"
      data-state="loading"
      aria-hidden="true"
    />
  );
}
