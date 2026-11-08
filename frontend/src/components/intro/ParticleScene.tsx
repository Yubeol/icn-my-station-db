import { useEffect, useRef } from 'react';
import * as THREE from 'three';

type Props = { exiting?: boolean };

const SHAPE_WIDTH = 720;
const SHAPE_HEIGHT = 450;
const WORLD_WIDTH = 8.4;
const AUTO_CHANGE_MS = 7000;
const SHAPE_COUNT = 3;

const VERTEX = /* glsl */ `
  attribute vec3 aPlane;
  attribute vec3 aText;
  attribute vec3 aTerminal;
  attribute float aSeed;
  uniform vec3 uWeights;
  uniform float uIntro;
  uniform float uExit;
  uniform float uTime;
  uniform float uSize;
  uniform vec2 uMouse;
  uniform vec2 uOffset;
  uniform float uScale;
  uniform vec2 uPulsePos;
  uniform float uPulseAge;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec3 target = aPlane * uWeights.x + aText * uWeights.y + aTerminal * uWeights.z;
    target.xy = target.xy * uScale + uOffset;
    float delay = aSeed * .35;
    float enter = smoothstep(delay, delay + .65, uIntro);
    vec3 p = mix(position, target, enter);

    p.x += sin(uTime * .7 + aSeed * 40.) * .012;
    p.y += cos(uTime * .6 + aSeed * 55.) * .012;

    vec2 away = p.xy - uMouse;
    float dist = length(away) + .0001;
    float touch = smoothstep(1.35, 0., dist);
    p.xy += away / dist * touch * touch * .85;
    p.z += touch * .9 * (aSeed - .3);

    if (uPulseAge >= 0.) {
      vec2 fromPulse = p.xy - uPulsePos;
      float pulseDist = length(fromPulse) + .0001;
      float front = uPulseAge * 7.;
      float wave = exp(-pow((pulseDist - front) * 2.4, 2.)) * exp(-uPulseAge * 2.2);
      p.xy += fromPulse / pulseDist * wave * .9;
      p.z += wave * .7;
    }

    p = mix(p, vec3(uOffset * (1. - uExit), 3. + aSeed * 5.), uExit * uExit);

    // 밝은 하늘 위에서 보이도록 남색 계열, 오른쪽 위는 노란빛 살짝, 마우스에 닿으면 버튼 노랑
    vec3 cool = mix(vec3(.071, .169, .38), vec3(.169, .349, .64), aSeed);
    float warm = smoothstep(1., 5., p.x + p.y);
    cool = mix(cool, vec3(.93, .76, .32), warm * .4);
    vColor = mix(cool, vec3(1., .78, .15), touch);
    vAlpha = (.55 + aSeed * .45) * (1. - uExit * uExit);

    vec4 view = modelViewMatrix * vec4(p, 1.);
    gl_PointSize = uSize * (1. + touch * .7) * (10. / -view.z);
    gl_Position = projectionMatrix * view;
  }
`;

const FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - .5);
    if (d > .5) discard;
    gl_FragColor = vec4(vColor, vAlpha * smoothstep(.5, .28, d));
  }
`;

const SKY_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 1., 1.);
  }
`;

// 구름 레이마칭 최대 스텝 수와 배경 렌더 타깃 비율. 노트북에서 버벅이면 낮춰서 쓰세요.
const CLOUD_STEPS = 48;
const SKY_SCALE = .5;
// 이전 프레임을 섞는 비율(시간 누적). 높을수록 매끈하지만 잔상이 번집니다. 0이면 누적 끔.
const SKY_ACCUM = .86;

const SKY_FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uTravel;
  uniform float uAspect;
  uniform vec2 uPointer;
  uniform float uExit;
  uniform float uPass;
  uniform float uPassX;
  uniform float uPassSide;
  uniform sampler2D tPrev;
  uniform float uFrame;
  uniform float uBlend;

  const vec3 SKY_HORIZON = vec3(.80, .90, .98);
  const vec3 SKY_TOP = vec3(.16, .42, .84);
  const vec3 CLOUD_LIT = vec3(1., 1., 1.);
  const vec3 CLOUD_SHADE = vec3(.55, .66, .82);
  const vec3 NAVY = vec3(.06, .13, .30);
  const vec3 SUN_DIR = vec3(.55, .35, 1.);

  // sin 없는 해시(Dave Hoskins hash13): 카메라가 멀리 가도 정밀도가 유지됩니다.
  float h31(vec3 p3) {
    p3 = fract(p3 * .1031);
    p3 += dot(p3, p3.zyx + 31.32);
    return fract((p3.x + p3.y) * p3.z);
  }
  // 프레임마다 바뀌는 인터리브드 그라디언트 노이즈(시작점 지터용)
  float ign(vec2 px, float frame) {
    px += 5.588238 * frame;
    return fract(52.9829189 * fract(dot(px, vec2(.06711056, .00583715))));
  }
  float vn(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3. - 2. * f);
    return mix(
      mix(mix(h31(i), h31(i + vec3(1., 0., 0.)), f.x), mix(h31(i + vec3(0., 1., 0.)), h31(i + vec3(1., 1., 0.)), f.x), f.y),
      mix(mix(h31(i + vec3(0., 0., 1.)), h31(i + vec3(1., 0., 1.)), f.x), mix(h31(i + vec3(0., 1., 1.)), h31(i + vec3(1., 1., 1.)), f.x), f.y),
      f.z);
  }
  // 거리(t) 기반 LOD: 멀수록 고주파 옥타브 가중치를 부드럽게 0으로 줄여 앨리어싱을 막습니다.
  float fbm3(vec3 p, float t) {
    float w2 = .25 * (1. - smoothstep(14., 34., t));
    float w3 = .125 * (1. - smoothstep(6., 18., t));
    float v = .5 * vn(p);
    p = p * 2.03 + vec3(1.7, 9.2, 4.1);
    v += w2 * vn(p);
    p = p * 2.01 + vec3(8.3, 2.8, 6.4);
    v += w3 * vn(p);
    return v / (.5 + w2 + w3);
  }

  // 구름 바다: 윗면은 fbm으로 출렁이고, 아래로 갈수록 빽빽해집니다.
  float dens(vec3 p, float t) {
    float surface = fbm3(vec3(p.x * .3, uTime * .04, p.z * .3), t) * 1.5;
    float bump = (vn(p * 2.2 + vec3(0., uTime * .05, 0.)) - .5) * (1. - smoothstep(10., 30., t));
    return clamp((surface + bump * .9 - p.y) * 1.8, 0., 1.);
  }

  vec3 skyColor(vec3 rd, vec3 sun) {
    float el = clamp(rd.y * 2.4, 0., 1.);
    vec3 c = mix(SKY_HORIZON, SKY_TOP, pow(el, .6));
    float s = max(dot(rd, sun), 0.);
    c += vec3(1., .95, .80) * (pow(s, 90.) * .7 + pow(s, 12.) * .14);
    return c;
  }

  void main() {
    vec2 uv = vUv * 2. - 1.;
    uv.x *= uAspect;
    float nx = uv.x / uAspect;
    float e = uExit;

    // 마우스: 시선이 그쪽으로 살짝 돌고, 선회하듯 약간 기울어집니다.
    float roll = uPointer.x * .09;
    vec2 q = uv - uPointer * vec2(.09, .06);
    q = mat2(cos(roll), -sin(roll), sin(roll), cos(roll)) * q;

    // 카메라는 구름 바다 윗면보다 약간 위에서 앞으로 전진. 시작 시 구름 속으로 하강합니다.
    vec3 ro = vec3(0., 1.9 - e * e * 2.7, uTravel);
    float pitch = .12 + e * .35;
    vec3 rd = normalize(vec3(q.x * .62, (q.y - pitch) * .62, 1.));
    vec3 sun = normalize(SUN_DIR);
    vec3 sky = skyColor(rd, sun);
    vec3 col = sky;

    if (rd.y < .02) {
      float t = rd.y < -.001 ? max((ro.y - 1.7) / -rd.y, 0.) : 80.;
      t += ign(gl_FragCoord.xy, uFrame) * (.07 + t * .035);
      vec3 acc = vec3(0.);
      float alpha = 0.;
      for (int i = 0; i < ${CLOUD_STEPS}; i++) {
        if (t > 80.) break;
        // 가까운 구간은 촘촘하게, 먼 구간만 넓게
        float dt = .07 + t * .035 + t * t * .0008;
        vec3 p = ro + rd * t;
        float d = dens(p, t);
        if (d > .01) {
          float dl = dens(p + sun * .5, t);
          float shade = clamp(.62 + (d - dl) * 1.8, 0., 1.);
          vec3 c = mix(CLOUD_SHADE, CLOUD_LIT, shade) * (1. - .12 * d);
          c = mix(c, SKY_HORIZON, 1. - exp(-t * .035));
          float a = 1. - exp(-d * dt * 2.4);
          acc += (1. - alpha) * c * a;
          alpha += (1. - alpha) * a;
          if (alpha > .97) break;
        }
        t += dt;
      }
      float fade = smoothstep(.02, -.04, rd.y);
      col = acc + (1. - alpha) * sky;
      col = mix(sky, col, fade);
    }

    // 시작 전환: 구름 속으로 내려가며 하얗게 밝아짐
    col = mix(col, vec3(1.), smoothstep(.45, 1., e));

    // 가장자리를 스치는 흰 구름 조각
    if (uPass >= 0.) {
      vec2 c = vec2(uPassX * uAspect, uPassSide * (1. + .5 * uPass));
      float rad = .32 + .32 * uPass;
      vec2 qq = (uv - c) / vec2(rad * 2., rad);
      float mm = smoothstep(1., .15, length(qq)) * (.45 + .8 * fbm3(vec3(qq * 1.6, uTime * .3), 0.));
      col = mix(col, vec3(1.), clamp(mm, 0., 1.) * .5 * sin(3.14159 * uPass));
    }

    // 왼쪽 문구 뒤만 남색으로 살짝 덮기
    float cover = pow(1. - smoothstep(-.9, .25, nx), .6) * .85 * (1. - smoothstep(.5, .9, e));
    col = mix(col, NAVY, cover);
    // 이전 프레임과 섞어 시간 누적 (시작 전환 중에는 잔상이 번지지 않도록 비율을 낮춤)
    vec3 prev = texture2D(tPrev, vUv).rgb;
    float blend = uBlend * (1. - smoothstep(0., .3, e));
    gl_FragColor = vec4(mix(col, prev, blend), 1.);
  }
`;

const BLIT_FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tMap;
  uniform float uFrame;
  void main() {
    // 하늘 그라데이션 밴딩 방지용 아주 약한 디더 (±0.5/255)
    float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy + 5.588238 * uFrame, vec2(.06711056, .00583715))));
    gl_FragColor = vec4(texture2D(tMap, vUv).rgb + (n - .5) / 255., 1.);
  }
`;

// 비행기 꼬리에서 뒤로 흩어지는 흰 입자 꼬리. 비행기 모양 가중치(uWeights.x)에만 보입니다.
const TRAIL_VERTEX = /* glsl */ `
  attribute float aSeed;
  uniform vec3 uWeights;
  uniform float uIntro;
  uniform float uExit;
  uniform float uTime;
  uniform float uSize;
  uniform vec2 uOffset;
  uniform float uScale;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    float u = fract(aSeed + uTime * .18);
    vec2 dir = vec2(-.581, -.814);
    vec2 perp = vec2(-dir.y, dir.x);
    float r = fract(aSeed * 91.7) - .5;
    vec2 p = vec2(-1.22, -1.72) + dir * u * 3.4 + perp * r * (.12 + u * 1.1);
    p = p * uScale + uOffset;
    vColor = vec3(.45, .66, .92);
    vAlpha = pow(1. - u, 1.3) * .6 * uWeights.x * smoothstep(.5, 1., uIntro) * (1. - uExit * uExit);
    vec4 view = modelViewMatrix * vec4(p, -.2, 1.);
    gl_PointSize = uSize * .9 * (10. / -view.z);
    gl_Position = projectionMatrix * view;
  }
`;

function drawPlane(c: CanvasRenderingContext2D) {
  c.translate(SHAPE_WIDTH / 2, SHAPE_HEIGHT / 2);
  c.rotate(.62);
  c.scale(.92, .92);
  c.beginPath();
  c.moveTo(0, -215);
  c.bezierCurveTo(19, -188, 24, -150, 24, -96);
  c.lineTo(24, -48);
  c.lineTo(205, 46);
  c.lineTo(205, 78);
  c.lineTo(24, 28);
  c.lineTo(20, 128);
  c.lineTo(84, 174);
  c.lineTo(84, 196);
  c.lineTo(11, 172);
  c.lineTo(0, 196);
  c.lineTo(-11, 172);
  c.lineTo(-84, 196);
  c.lineTo(-84, 174);
  c.lineTo(-20, 128);
  c.lineTo(-24, 28);
  c.lineTo(-205, 78);
  c.lineTo(-205, 46);
  c.lineTo(-24, -48);
  c.lineTo(-24, -96);
  c.bezierCurveTo(-24, -150, -19, -188, 0, -215);
  c.closePath();
  c.fill();
}

function drawText(c: CanvasRenderingContext2D) {
  c.font = '800 250px Pretendard, Arial, sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText('ICN', SHAPE_WIDTH / 2, SHAPE_HEIGHT / 2 + 8);
}

function drawTerminal(c: CanvasRenderingContext2D) {
  const cx = SHAPE_WIDTH / 2;
  const cy = 478;
  const toRad = (degree: number) => ((degree - 90) * Math.PI) / 180;
  c.lineCap = 'round';
  c.lineWidth = 62;
  c.beginPath();
  c.arc(cx, cy, 235, toRad(-62), toRad(62));
  c.stroke();
  for (const side of [-1, 1]) {
    const angle = (68 * side * Math.PI) / 180;
    c.beginPath();
    c.arc(cx + 235 * Math.sin(angle), cy - 235 * Math.cos(angle), 52, 0, Math.PI * 2);
    c.fill();
    c.lineWidth = 30;
    c.beginPath();
    c.moveTo(cx + 62 * side, 240);
    c.lineTo(cx + 170 * side, 34);
    c.stroke();
    c.lineWidth = 62;
  }
}

/** 2D 캔버스에 그린 모양에서 점을 뽑아 입자 목표 위치를 만듭니다. 형태가 뭉개지지 않습니다. */
function sample(draw: (context: CanvasRenderingContext2D) => void, count: number) {
  const canvas = document.createElement('canvas');
  canvas.width = SHAPE_WIDTH;
  canvas.height = SHAPE_HEIGHT;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.fillStyle = '#fff';
  context.strokeStyle = '#fff';
  draw(context);
  const { data } = context.getImageData(0, 0, SHAPE_WIDTH, SHAPE_HEIGHT);
  const filled: number[] = [];
  for (let y = 0; y < SHAPE_HEIGHT; y += 1) {
    for (let x = 0; x < SHAPE_WIDTH; x += 1) {
      if (data[(y * SHAPE_WIDTH + x) * 4 + 3] > 128) filled.push(x, y);
    }
  }
  const unit = WORLD_WIDTH / SHAPE_WIDTH;
  const points = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const pick = Math.floor(Math.random() * (filled.length / 2)) * 2;
    points[index * 3] = (filled[pick] + Math.random() - SHAPE_WIDTH / 2) * unit;
    points[index * 3 + 1] = (SHAPE_HEIGHT / 2 - filled[pick + 1] - Math.random()) * unit;
    points[index * 3 + 2] = (Math.random() - .5) * .12;
  }
  return points;
}

function ease(value: number) {
  return value * value * (3 - 2 * value);
}

/** 항공기, ICN 글자, 터미널로 바뀌고 마우스에 반응하는 입자 장면입니다. */
export default function ParticleScene({ exiting = false }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const exitingRef = useRef(exiting);

  useEffect(() => { exitingRef.current = exiting; }, [exiting]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
    } catch {
      return;
    }
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    host.appendChild(renderer.domElement);

    const count = window.innerWidth < 900 ? 16000 : 34000;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, .1, 100);
    camera.position.z = 10;

    const scatter = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
      scatter[index * 3] = (Math.random() - .5) * 16;
      scatter[index * 3 + 1] = (Math.random() - .5) * 10;
      scatter[index * 3 + 2] = (Math.random() - .5) * 6;
      seeds[index] = Math.random();
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(scatter, 3));
    geometry.setAttribute('aPlane', new THREE.BufferAttribute(sample(drawPlane, count), 3));
    geometry.setAttribute('aText', new THREE.BufferAttribute(sample(drawText, count), 3));
    geometry.setAttribute('aTerminal', new THREE.BufferAttribute(sample(drawTerminal, count), 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));

    const uniforms = {
      uWeights: { value: new THREE.Vector3(1, 0, 0) },
      uIntro: { value: still ? 1 : 0 },
      uExit: { value: 0 },
      uTime: { value: 0 },
      uSize: { value: 2 },
      uMouse: { value: new THREE.Vector2(99, 99) },
      uOffset: { value: new THREE.Vector2(0, 0) },
      uScale: { value: 1 },
      uPulsePos: { value: new THREE.Vector2() },
      uPulseAge: { value: -1 },
    };
    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    // 구름은 화면 절반 해상도 렌더 타깃에 그린 뒤 늘려서 표시합니다.
    const skyGeometry = new THREE.PlaneGeometry(2, 2);
    const skyMaterial = new THREE.ShaderMaterial({
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      uniforms: {
        uTime: { value: 0 },
        uTravel: { value: 0 },
        uAspect: { value: 1 },
        uPointer: { value: new THREE.Vector2() },
        uExit: { value: 0 },
        uPass: { value: -1 },
        uPassX: { value: 0 },
        uPassSide: { value: 1 },
        tPrev: { value: null as THREE.Texture | null },
        uFrame: { value: 0 },
        uBlend: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });
    const skyScene = new THREE.Scene();
    const sky = new THREE.Mesh(skyGeometry, skyMaterial);
    sky.frustumCulled = false;
    skyScene.add(sky);
    // 시간 누적을 위한 핑퐁 렌더 타깃 2개. 누적 때 8비트 양자화가 쌓이지 않도록 half float을 씁니다.
    const makeSkyTarget = () => new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.HalfFloatType,
      depthBuffer: false,
    });
    const skyTargets = [makeSkyTarget(), makeSkyTarget()];
    let skyIndex = 0;
    let skyFrames = 0;
    let skyLast = 0;
    const blitMaterial = new THREE.ShaderMaterial({
      vertexShader: SKY_VERTEX,
      fragmentShader: BLIT_FRAGMENT,
      uniforms: { tMap: { value: skyTargets[0].texture }, uFrame: { value: 0 } },
      depthTest: false,
      depthWrite: false,
    });
    const blit = new THREE.Mesh(skyGeometry, blitMaterial);
    blit.frustumCulled = false;
    blit.renderOrder = -1;
    scene.add(blit);

    const TRAIL_COUNT = 1600;
    const trailGeometry = new THREE.BufferGeometry();
    const trailSeeds = new Float32Array(TRAIL_COUNT);
    for (let index = 0; index < TRAIL_COUNT; index += 1) trailSeeds[index] = Math.random();
    trailGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_COUNT * 3), 3));
    trailGeometry.setAttribute('aSeed', new THREE.BufferAttribute(trailSeeds, 1));
    const trailMaterial = new THREE.ShaderMaterial({
      vertexShader: TRAIL_VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uWeights: uniforms.uWeights,
        uIntro: uniforms.uIntro,
        uExit: uniforms.uExit,
        uTime: uniforms.uTime,
        uSize: uniforms.uSize,
        uOffset: uniforms.uOffset,
        uScale: uniforms.uScale,
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    const trail = new THREE.Points(trailGeometry, trailMaterial);
    trail.frustumCulled = false;
    trail.renderOrder = 0;
    trail.visible = !still;
    scene.add(trail);
    const points = new THREE.Points(geometry, material);
    points.renderOrder = 1;
    scene.add(points);

    const resize = () => {
      const width = host.clientWidth || 1;
      const height = host.clientHeight || 1;
      const aspect = width / height;
      const viewHeight = 2 * Math.tan((camera.fov * Math.PI) / 360) * camera.position.z;
      const viewWidth = viewHeight * aspect;
      const wide = aspect > 1.25;
      camera.aspect = aspect;
      skyMaterial.uniforms.uAspect.value = aspect;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      const ratio = renderer.getPixelRatio();
      const skyWidth = Math.max(1, Math.round(width * ratio * SKY_SCALE));
      const skyHeight = Math.max(1, Math.round(height * ratio * SKY_SCALE));
      skyTargets.forEach(target => target.setSize(skyWidth, skyHeight));
      skyFrames = 0;
      uniforms.uScale.value = wide ? Math.min(.92, (viewWidth * .62) / WORLD_WIDTH) : Math.min(.9, viewWidth / WORLD_WIDTH);
      uniforms.uOffset.value.set(wide ? viewWidth * .17 : 0, wide ? .1 : viewHeight * .17);
      uniforms.uSize.value = Math.max(1.5, Math.min(2.5, height / 400)) * renderer.getPixelRatio();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const ray = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const hit = new THREE.Vector3();
    const smoothMouse = new THREE.Vector2(99, 99);
    const targetMouse = new THREE.Vector2(99, 99);
    const toWorld = (event: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(pointer, camera);
      return ray.ray.intersectPlane(plane, hit);
    };
    const onMove = (event: PointerEvent) => {
      const point = toWorld(event);
      if (!point) return;
      if (targetMouse.x === 99) smoothMouse.set(point.x, point.y);
      targetMouse.set(point.x, point.y);
    };
    const onLeave = () => targetMouse.set(99, 99);
    let pulseStart = -1;
    const onDown = (event: PointerEvent) => {
      if ((event.target as HTMLElement).closest('a, button')) return;
      const point = toWorld(event);
      if (!point) return;
      uniforms.uPulsePos.value.set(point.x, point.y);
      pulseStart = performance.now();
    };

    let shape = 0;
    let previous = 0;
    let changeAt = performance.now();
    let lastAuto = performance.now();
    const goTo = (next: number) => {
      previous = shape;
      shape = (next + SHAPE_COUNT) % SHAPE_COUNT;
      changeAt = performance.now();
      lastAuto = changeAt;
    };
    let wheelLock = 0;
    const onWheel = (event: WheelEvent) => {
      const now = performance.now();
      if (now < wheelLock) return;
      wheelLock = now + 900;
      goTo(shape + (event.deltaY > 0 ? 1 : -1));
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('wheel', onWheel, { passive: true });
    document.addEventListener('mouseleave', onLeave);

    const start = performance.now();
    let raf = 0;
    const weights = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
    let passAt = -1;
    let passStart = -1;
    const PASS_MS = 2200;
    const render = (now: number) => {
      raf = requestAnimationFrame(render);
      if (document.hidden) return;
      if (!still && now - lastAuto > AUTO_CHANGE_MS) goTo(shape + 1);
      uniforms.uTime.value = (now - start) / 1000;
      if (!still) uniforms.uIntro.value = Math.min(1, (now - start) / 2200);
      const morph = ease(Math.min(1, (now - changeAt) / 1300));
      uniforms.uWeights.value.copy(weights[previous]).lerp(weights[shape], morph);
      if (targetMouse.x !== 99) smoothMouse.lerp(targetMouse, .14);
      uniforms.uMouse.value.copy(targetMouse.x === 99 ? targetMouse : smoothMouse);
      uniforms.uPulseAge.value = pulseStart < 0 ? -1 : (now - pulseStart) / 1000;
      if (uniforms.uPulseAge.value > 2) pulseStart = -1;
      if (exitingRef.current) uniforms.uExit.value = Math.min(1, uniforms.uExit.value + .022);
      const exit = uniforms.uExit.value;
      skyMaterial.uniforms.uTime.value = still ? 8 : uniforms.uTime.value;
      // 카메라가 구름층 사이를 앞으로 천천히 날아갑니다 (움직임 줄이기에서는 정지).
      skyMaterial.uniforms.uTravel.value = still ? 6 : uniforms.uTime.value * 1.3 + exit * exit * 5;
      skyMaterial.uniforms.uExit.value = exit;
      skyMaterial.uniforms.uPointer.value.lerp(pointer, .05);
      // 8~12초마다 화면 위·아래 가장자리를 스치는 구름 조각
      if (!still) {
        if (passAt < 0) passAt = now + 3000 + Math.random() * 3000;
        if (passStart < 0 && now > passAt) {
          passStart = now;
          skyMaterial.uniforms.uPassX.value = (Math.random() * 1.4 - .5);
          skyMaterial.uniforms.uPassSide.value = Math.random() < .5 ? 1 : -1;
        }
        if (passStart >= 0) {
          const progress = (now - passStart) / PASS_MS;
          if (progress >= 1) {
            passStart = -1;
            passAt = now + 8000 + Math.random() * 4000;
            skyMaterial.uniforms.uPass.value = -1;
          } else {
            skyMaterial.uniforms.uPass.value = progress;
          }
        }
      }
      // 핑퐁: 이전 프레임 결과(read)를 읽어 섞고 새 결과(write)에 그림
      const frameId = skyFrames % 64;
      const readTarget = skyTargets[1 - skyIndex];
      const writeTarget = skyTargets[skyIndex];
      skyMaterial.uniforms.tPrev.value = readTarget.texture;
      skyMaterial.uniforms.uFrame.value = frameId;
      // 프레임이 느릴수록 한 프레임에 카메라가 더 움직이므로, 60fps 기준 비율을 경과 시간만큼 거듭제곱해 잔상 번짐을 막음
      const elapsed = Math.min((now - skyLast) / 1000 * 60, 12);
      skyMaterial.uniforms.uBlend.value = skyFrames === 0 ? 0 : Math.pow(SKY_ACCUM, elapsed);
      skyLast = now;
      renderer.setRenderTarget(writeTarget);
      renderer.render(skyScene, camera);
      renderer.setRenderTarget(null);
      blitMaterial.uniforms.tMap.value = writeTarget.texture;
      blitMaterial.uniforms.uFrame.value = frameId;
      skyIndex = 1 - skyIndex;
      skyFrames += 1;
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('wheel', onWheel);
      document.removeEventListener('mouseleave', onLeave);
      geometry.dispose();
      material.dispose();
      skyGeometry.dispose();
      skyMaterial.dispose();
      skyTargets.forEach(target => target.dispose());
      blitMaterial.dispose();
      trailGeometry.dispose();
      trailMaterial.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div className="intro-particles" ref={hostRef} aria-hidden="true" />;
}
