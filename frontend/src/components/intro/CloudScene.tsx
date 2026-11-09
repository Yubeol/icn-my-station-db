import { useEffect, useRef } from 'react';
import * as THREE from 'three';

type Props = {
  /** 시작 버튼을 누르면 true. 구름이 밝아지며 전환됩니다. */
  leaving: boolean;
  /** WebGL을 쓸 수 없을 때 부모가 CSS 그라디언트로 바꾸도록 알립니다. */
  onUnavailable: () => void;
};

const MAX_PIXEL_RATIO = 1.5;
const LEAVE_SECONDS = 0.7;
const STILL_TIME = 42;

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// 외부 이미지 없이 fbm 노이즈로 구름층을 그립니다.
const fragmentShader = /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec2 uResolution;
uniform vec2 uMouse;
uniform float uBright;
varying vec2 vUv;

const vec3 TOP = vec3(0.039, 0.133, 0.263);      // #0a2243
const vec3 MID = vec3(0.169, 0.322, 0.498);      // #2b527f
const vec3 HORIZON = vec3(0.910, 0.678, 0.518);  // #e8ad84
const vec3 HIGHLIGHT = vec3(0.969, 0.831, 0.659);// #f7d4a8

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  mat2 rotate = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) {
    value += amplitude * noise(p);
    p = rotate * p;
    amplitude *= 0.5;
  }
  return value;
}

void main() {
  vec2 uv = vUv;
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 p = vec2((uv.x - 0.5) * aspect, uv.y);
  p.x += uMouse.x * 0.06;

  float horizon = 0.40 + uMouse.y * 0.025;
  float h = uv.y - horizon;

  // 하늘: 위 네이비 → 중간 블루 → 지평선 노을
  float s = clamp(h / (1.0 - horizon), 0.0, 1.0);
  vec3 sky = mix(HORIZON, MID, smoothstep(0.0, 0.32, s));
  sky = mix(sky, TOP, smoothstep(0.28, 1.0, s));

  // 지평선 쪽만 은은한 빛. 오른쪽으로 조금 치우친 해 질 녘 빛입니다.
  float sunOffset = (p.x - 0.32 * aspect) * 1.4;
  float sunSpot = exp(-sunOffset * sunOffset);
  float glow = exp(-abs(h) * 10.0) * (0.35 + 0.45 * sunSpot);

  vec3 color = sky;

  // 높은 하늘의 옅은 새털구름
  if (h > 0.0) {
    float depth = 0.22 / (h + 0.035);
    vec2 world = vec2(p.x * depth * 0.55, depth * 1.4 + uTime * 0.012);
    float wisp = smoothstep(0.56, 0.86, fbm(world * 0.9));
    color = mix(color, mix(color, HIGHLIGHT, 0.4), wisp * smoothstep(0.42, 0.0, h) * 0.55);
  }

  // 발아래 구름층: 원근에 따라 앞으로 흘러옵니다.
  if (h < 0.0) {
    float d = -h;
    float depth = 0.32 / (d + 0.012);
    vec2 world = vec2(p.x * depth * 0.85, depth + uTime * 0.06);
    float base = fbm(world * 0.5);
    float detail = fbm(world * 1.25 + base * 1.6 - vec2(uTime * 0.008, 0.0));
    float density = smoothstep(0.32, 0.82, base * 0.6 + detail * 0.55);
    float light = clamp(1.0 - d * 2.4, 0.0, 1.0);
    vec3 shade = mix(MID * 0.62, MID, 0.35 + 0.4 * light);
    vec3 lit = mix(HORIZON, HIGHLIGHT, detail);
    vec3 cloud = mix(shade, lit, clamp(density * (0.3 + 0.7 * light) + light * 0.3 * sunSpot, 0.0, 1.0));
    // 멀수록 노을빛 안개에 묻힙니다.
    float haze = smoothstep(0.0, 0.22, d);
    color = mix(mix(HORIZON, HIGHLIGHT, 0.25), cloud, haze);
  }

  color += HORIZON * glow * 0.35;

  // 가장자리를 살짝 어둡게
  float vignette = 1.0 - 0.28 * smoothstep(0.35, 0.95, length((uv - 0.5) * vec2(1.0, 0.9)));
  color *= vignette;

  // 전환할 때 구름이 밝아집니다.
  color = mix(color, vec3(1.0, 0.96, 0.9), uBright);
  gl_FragColor = vec4(color, 1.0);
}
`;

function webglAvailable() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(window.WebGLRenderingContext && (canvas.getContext('webgl2') || canvas.getContext('webgl')));
  } catch {
    return false;
  }
}

/** 구름 위를 나는 듯한 소개 화면 배경. 화면 전체 평면에 셰이더를 입힙니다. */
export default function CloudScene({ leaving, onUnavailable }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const leavingRef = useRef(leaving);
  const unavailableRef = useRef(onUnavailable);
  const startRef = useRef<(() => void) | null>(null);
  leavingRef.current = leaving;
  unavailableRef.current = onUnavailable;

  useEffect(() => {
    if (leaving) startRef.current?.();
  }, [leaving]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (!webglAvailable()) {
      unavailableRef.current();
      return;
    }

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'low-power' });
    } catch {
      unavailableRef.current();
      return;
    }

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    renderer.domElement.setAttribute('aria-hidden', 'true');
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const geometry = new THREE.PlaneGeometry(2, 2);
    const uniforms = {
      uTime: { value: reduceMotion ? STILL_TIME : 0 },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uMouse: { value: new THREE.Vector2(0, 0) },
      uBright: { value: 0 },
    };
    const material = new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms, depthTest: false, depthWrite: false });
    scene.add(new THREE.Mesh(geometry, material));

    const render = () => renderer.render(scene, camera);

    const resize = () => {
      const width = host.clientWidth || 1;
      const height = host.clientHeight || 1;
      renderer.setSize(width, height, false);
      uniforms.uResolution.value.set(width, height);
      if (reduceMotion) render();
    };

    // 마우스를 따라 구름 시점이 살짝 움직입니다.
    const target = new THREE.Vector2(0, 0);
    const onPointerMove = (event: PointerEvent) => {
      target.set((event.clientX / window.innerWidth) * 2 - 1, -((event.clientY / window.innerHeight) * 2 - 1));
    };

    const clock = new THREE.Clock(false);
    let frame = 0;
    let running = false;
    const animate = () => {
      frame = window.requestAnimationFrame(animate);
      // 탭을 다시 열었을 때 시간이 튀지 않도록 간격을 제한합니다.
      const delta = Math.min(clock.getDelta(), 0.05);
      if (!reduceMotion) {
        uniforms.uTime.value += delta;
        uniforms.uMouse.value.lerp(target, 0.035);
      }
      if (leavingRef.current) uniforms.uBright.value = Math.min(1, uniforms.uBright.value + delta / LEAVE_SECONDS);
      render();
    };
    const start = () => {
      if (running) return;
      running = true;
      clock.start();
      animate();
    };
    const stop = () => {
      running = false;
      clock.stop();
      window.cancelAnimationFrame(frame);
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else if (!reduceMotion || leavingRef.current) start();
    };

    const observer = new ResizeObserver(resize);
    observer.observe(host);
    window.addEventListener('pointermove', onPointerMove);
    document.addEventListener('visibilitychange', onVisibility);
    resize();
    render();
    if (!reduceMotion && !document.hidden) start();

    // 움직임 줄이기 설정이어도 전환할 때는 밝아지는 장면을 그립니다.
    startRef.current = () => {
      if (!document.hidden) start();
    };

    return () => {
      startRef.current = null;
      stop();
      observer.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('visibilitychange', onVisibility);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, []);

  return <div className="intro-clouds" ref={hostRef} />;
}
