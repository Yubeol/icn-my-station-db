import { useEffect, useRef } from 'react';
import * as THREE from 'three';

type Props = {
  /** 시작 버튼을 누르면 true. 이륙 장면을 재생합니다. */
  takingOff: boolean;
  /** WebGL을 쓸 수 없을 때 부모가 CSS 그라디언트로 바꾸도록 알립니다. */
  onUnavailable: () => void;
};

const MAX_PIXEL_RATIO = 1.5;
const TAKEOFF_SECONDS = 1.4;
const CRUISE_SPEED = 16;
const TAKEOFF_SPEED = 520;
const EYE_HEIGHT = 2.4;
const RUNWAY_HALF = 22;
const LIGHT_SPACING = 20;
const LIGHT_ROWS = 130;
const DASH_SPACING = 30;
const DASH_LENGTH = 12;
const DASH_COUNT = 90;
const COLORS = {
  ground: 0x0a1930,
  runway: 0x13223a,
  fog: 0x37466a,
  edgeLight: 0xffe3b8,
  dash: 0xc9d6e6,
  stripe: 0x8ea3bf,
  silhouette: 0x0d1f3a,
  window: 0xf3c9a0,
};

const skyVertex = /* glsl */ `
varying vec3 vDirection;
void main() {
  vDirection = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// 위 #0a2243, 중간 #2b527f, 지평선 #e8ad84
const skyFragment = /* glsl */ `
uniform float uBright;
varying vec3 vDirection;
const vec3 TOP = vec3(0.039, 0.133, 0.263);
const vec3 MID = vec3(0.169, 0.322, 0.498);
const vec3 HORIZON = vec3(0.910, 0.678, 0.518);
const vec3 GROUND = vec3(0.039, 0.098, 0.188);
void main() {
  float h = vDirection.y;
  vec3 color = mix(HORIZON, MID, smoothstep(0.0, 0.16, h));
  color = mix(color, TOP, smoothstep(0.12, 0.6, h));
  // 지평선 위로 번지는 노을빛. 오른쪽 앞에 해가 진 자리처럼 조금 더 밝습니다.
  float side = max(dot(normalize(vDirection.xz), normalize(vec2(0.35, -1.0))), 0.0);
  color += HORIZON * exp(-max(h, 0.0) * 22.0) * (0.18 + 0.22 * pow(side, 6.0));
  color = mix(color, GROUND, smoothstep(0.0, -0.04, h));
  color = mix(color, vec3(1.0, 0.97, 0.93), uBright);
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

/** 조명 번짐용 원형 텍스처. 외부 이미지 없이 캔버스로 만듭니다. */
function glowTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.3, 'rgba(255,255,255,.5)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const easeIn = (t: number) => t * t * t;
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/** 해 질 무렵 활주로 위, 조종석 높이에서 앞을 바라보는 장면입니다. */
export default function RunwayScene({ takingOff, onUnavailable }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const takingRef = useRef(takingOff);
  const unavailableRef = useRef(onUnavailable);
  const startRef = useRef<(() => void) | null>(null);
  takingRef.current = takingOff;
  unavailableRef.current = onUnavailable;

  useEffect(() => {
    if (takingOff) startRef.current?.();
  }, [takingOff]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (!webglAvailable()) {
      unavailableRef.current();
      return;
    }

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
    } catch {
      unavailableRef.current();
      return;
    }

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    renderer.domElement.setAttribute('aria-hidden', 'true');
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(COLORS.fog, 80, 900);
    const camera = new THREE.PerspectiveCamera(56, 1, 0.1, 3000);
    const lookTarget = new THREE.Vector3(0, -3, -100);
    camera.position.set(0, EYE_HEIGHT, 0);

    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];
    const track = <T extends THREE.BufferGeometry>(geometry: T) => { geometries.push(geometry); return geometry; };
    const own = <T extends THREE.Material>(material: T) => { materials.push(material); return material; };

    // 하늘
    const skyUniforms = { uBright: { value: 0 } };
    const sky = new THREE.Mesh(
      track(new THREE.SphereGeometry(1500, 32, 24)),
      own(new THREE.ShaderMaterial({ vertexShader: skyVertex, fragmentShader: skyFragment, uniforms: skyUniforms, side: THREE.BackSide, depthWrite: false, fog: false })),
    );
    scene.add(sky);

    // 지면과 활주로
    const ground = new THREE.Mesh(track(new THREE.PlaneGeometry(6000, 6000)), own(new THREE.MeshBasicMaterial({ color: COLORS.ground })));
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);
    const runway = new THREE.Mesh(track(new THREE.PlaneGeometry(RUNWAY_HALF * 2, 4000)), own(new THREE.MeshBasicMaterial({ color: COLORS.runway })));
    runway.rotation.x = -Math.PI / 2;
    runway.position.set(0, 0.01, -1900);
    scene.add(runway);
    const stripeMaterial = own(new THREE.MeshBasicMaterial({ color: COLORS.stripe, transparent: true, opacity: 0.35 }));
    const stripeGeometry = track(new THREE.PlaneGeometry(0.35, 4000));
    [-1, 1].forEach(side => {
      const stripe = new THREE.Mesh(stripeGeometry, stripeMaterial);
      stripe.rotation.x = -Math.PI / 2;
      stripe.position.set(side * (RUNWAY_HALF - 1.2), 0.02, -1900);
      scene.add(stripe);
    });

    // 중앙선: 앞으로 흘러오는 점선
    const dashPositions = new Float32Array(DASH_COUNT * 6);
    const dashGeometry = track(new THREE.BufferGeometry());
    dashGeometry.setAttribute('position', new THREE.BufferAttribute(dashPositions, 3));
    const dashMaterial = own(new THREE.LineBasicMaterial({ color: COLORS.dash, transparent: true, opacity: 0.6 }));
    scene.add(new THREE.LineSegments(dashGeometry, dashMaterial));

    // 양쪽 활주로 조명과 속도에 따라 늘어나는 빛줄기
    const glow = glowTexture();
    const lightCount = LIGHT_ROWS * 2;
    const lightPositions = new Float32Array(lightCount * 3);
    const lightGeometry = track(new THREE.BufferGeometry());
    lightGeometry.setAttribute('position', new THREE.BufferAttribute(lightPositions, 3));
    const lightMaterial = own(new THREE.PointsMaterial({ color: COLORS.edgeLight, map: glow, size: 1.3, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    scene.add(new THREE.Points(lightGeometry, lightMaterial));
    const streakPositions = new Float32Array(lightCount * 6);
    const streakGeometry = track(new THREE.BufferGeometry());
    streakGeometry.setAttribute('position', new THREE.BufferAttribute(streakPositions, 3));
    const streakMaterial = own(new THREE.LineBasicMaterial({ color: COLORS.edgeLight, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    scene.add(new THREE.LineSegments(streakGeometry, streakMaterial));

    // 멀리 관제탑과 터미널 실루엣
    const silhouetteMaterial = own(new THREE.MeshBasicMaterial({ color: COLORS.silhouette }));
    const towerShaft = new THREE.Mesh(track(new THREE.CylinderGeometry(2.2, 3, 46, 12)), silhouetteMaterial);
    towerShaft.position.set(-150, 23, -720);
    const towerCab = new THREE.Mesh(track(new THREE.CylinderGeometry(7, 5, 7, 12)), silhouetteMaterial);
    towerCab.position.set(-150, 49, -720);
    const towerTop = new THREE.Mesh(track(new THREE.CylinderGeometry(1.2, 6, 3, 12)), silhouetteMaterial);
    towerTop.position.set(-150, 54, -720);
    const terminal = new THREE.Mesh(track(new THREE.BoxGeometry(300, 16, 50)), silhouetteMaterial);
    terminal.position.set(210, 8, -820);
    // 완만한 곡선 지붕
    const terminalRoof = new THREE.Mesh(track(new THREE.SphereGeometry(1, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2)), silhouetteMaterial);
    terminalRoof.scale.set(158, 9, 27);
    terminalRoof.position.set(210, 15, -820);
    scene.add(towerShaft, towerCab, towerTop, terminal, terminalRoof);
    // 터미널 창문 불빛 몇 개
    const windowPositions: number[] = [];
    for (let index = 0; index < 22; index += 1) windowPositions.push(70 + index * 13, 9 + (index % 3) * 2.5, -794);
    windowPositions.push(-150, 49, -712);
    const windowGeometry = track(new THREE.BufferGeometry());
    windowGeometry.setAttribute('position', new THREE.Float32BufferAttribute(windowPositions, 3));
    const windowMaterial = own(new THREE.PointsMaterial({ color: COLORS.window, map: glow, size: 3.2, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
    scene.add(new THREE.Points(windowGeometry, windowMaterial));

    // 진행 상태
    let travel = 0;
    let streak = 0;
    let takeoffTime = -1;

    const placeMovingParts = () => {
      const shiftLight = travel % LIGHT_SPACING;
      for (let row = 0; row < LIGHT_ROWS; row += 1) {
        const z = -row * LIGHT_SPACING + shiftLight;
        for (let side = 0; side < 2; side += 1) {
          const index = row * 2 + side;
          const x = side ? RUNWAY_HALF : -RUNWAY_HALF;
          lightPositions.set([x, 0.35, z], index * 3);
          streakPositions.set([x, 0.35, z, x, 0.35, z - streak], index * 6);
        }
      }
      const shiftDash = travel % DASH_SPACING;
      for (let index = 0; index < DASH_COUNT; index += 1) {
        const z = -index * DASH_SPACING + shiftDash;
        dashPositions.set([0, 0.03, z, 0, 0.03, z - DASH_LENGTH], index * 6);
      }
      lightGeometry.attributes.position.needsUpdate = true;
      streakGeometry.attributes.position.needsUpdate = true;
      dashGeometry.attributes.position.needsUpdate = true;
    };

    // 넓은 화면에서는 소실점을 오른쪽으로 옮겨 왼쪽 글과 겹치지 않게 합니다.
    const resize = () => {
      const width = host.clientWidth || 1;
      const height = host.clientHeight || 1;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.filmOffset = camera.aspect > 1.2 ? -camera.getFilmWidth() * 0.12 : 0;
      camera.updateProjectionMatrix();
      if (!running) render();
    };

    const pointer = { x: 0 };
    const onPointerMove = (event: PointerEvent) => {
      pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    };

    const render = () => {
      sky.position.copy(camera.position);
      camera.lookAt(lookTarget);
      renderer.render(scene, camera);
    };

    const clock = new THREE.Clock(false);
    let frame = 0;
    let running = false;
    const animate = () => {
      frame = window.requestAnimationFrame(animate);
      const delta = Math.min(clock.getDelta(), 0.05);
      let speed = CRUISE_SPEED;
      if (takingRef.current) {
        if (takeoffTime < 0) takeoffTime = 0;
        takeoffTime = Math.min(TAKEOFF_SECONDS, takeoffTime + delta);
        const progress = takeoffTime / TAKEOFF_SECONDS;
        speed = CRUISE_SPEED + easeIn(progress) * TAKEOFF_SPEED;
        // 이륙하듯 카메라가 들리고 시선이 하늘로 향합니다.
        const lift = easeInOut(Math.max(0, (progress - 0.35) / 0.65));
        camera.position.y = EYE_HEIGHT + lift * 38;
        lookTarget.y = -3 + lift * 70;
        streak = Math.min(60, speed * 0.11);
        streakMaterial.opacity = Math.min(0.75, progress * 1.4);
        skyUniforms.uBright.value = THREE.MathUtils.smoothstep(progress, 0.7, 1);
      }
      travel += speed * delta;
      camera.position.x += (pointer.x * 0.9 - camera.position.x) * 0.04;
      lookTarget.x = camera.position.x * 0.4;
      placeMovingParts();
      render();
    };
    const start = () => {
      if (running || document.hidden) return;
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
      else if (!reduceMotion || takingRef.current) start();
    };
    startRef.current = start;

    const observer = new ResizeObserver(resize);
    observer.observe(host);
    window.addEventListener('pointermove', onPointerMove);
    document.addEventListener('visibilitychange', onVisibility);
    placeMovingParts();
    resize();
    // 움직임 줄이기 설정이면 정지 화면 한 장만 그립니다.
    if (!reduceMotion) start();

    return () => {
      startRef.current = null;
      stop();
      observer.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('visibilitychange', onVisibility);
      geometries.forEach(geometry => geometry.dispose());
      materials.forEach(material => material.dispose());
      glow.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, []);

  return <div className="intro-runway__canvas" ref={hostRef} />;
}
