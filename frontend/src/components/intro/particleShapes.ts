/**
 * 소개 화면 입자의 목표 모양 세 가지를 만듭니다.
 * 각 함수는 count개의 점을 [x, y, z] 순서로 담은 배열을 돌려줍니다.
 * 모든 모양은 대략 가로 70, 세로 30 단위 안에 들어가게 맞춥니다.
 */

type Rand = () => number;

/** 같은 결과를 내는 간단한 난수. 새로고침해도 모양이 같습니다. */
export function seeded(seed: number): Rand {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const gaussian = (rand: Rand) => {
  const u = Math.max(rand(), 1e-6);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
};

function insidePolygon(x: number, y: number, points: number[][]) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 흩어진 시작 위치: 화면을 넓게 감싸는 구 껍질 */
export function scatterPoints(count: number, rand: Rand) {
  const out = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const theta = rand() * Math.PI * 2;
    const phi = Math.acos(rand() * 2 - 1);
    const radius = 55 + rand() * 45;
    out[index * 3] = Math.sin(phi) * Math.cos(theta) * radius * 1.4;
    out[index * 3 + 1] = Math.sin(phi) * Math.sin(theta) * radius * 0.8;
    out[index * 3 + 2] = Math.cos(phi) * radius * 0.6;
  }
  return out;
}

/** 1) 측면 항공기 실루엣: 동체 곡선, 꼬리날개, 주날개, 엔진을 도형으로 정의하고 그 안에 점을 뿌립니다. */
export function airplanePoints(count: number, rand: Rand) {
  // 동체 위·아래 경계. 기수는 오른쪽(+x)입니다.
  const body = (x: number) => {
    if (x < -30 || x > 31) return null;
    let top = 3.2;
    let bottom = -3.2;
    let center = 0;
    if (x > 22) {
      // 둥근 기수: 아래로 살짝 처진 타원
      const k = (x - 22) / 9;
      const r = 3.2 * Math.sqrt(Math.max(0, 1 - k * k));
      center = -0.9 * k;
      top = center + r;
      bottom = center - r * 0.92;
    } else if (x < -16) {
      // 꼬리 쪽: 아래가 올라가며 가늘어집니다.
      const k = (-16 - x) / 14;
      bottom = -3.2 + k * 4.6;
      top = 3.2 - k * 0.6;
    }
    return { top, bottom, center: (top + bottom) / 2, radius: (top - bottom) / 2 };
  };
  const fin = [[-30, 2.4], [-19, 3.1], [-25.5, 14], [-30.5, 14.2]];
  const stabilizer = [[-31, 1.2], [-21, 1.5], [-23.5, 2.6], [-31.5, 2.4]];
  const wing = [[7, -1.4], [-3, -1.6], [-15, -4.6], [-11, -5.1], [3, -2.6]];
  const engine = { x: 1.5, y: -5.2, rx: 5.2, ry: 1.9 };

  const out = new Float32Array(count * 3);
  let filled = 0;
  while (filled < count) {
    const x = -32 + rand() * 64;
    const y = -8 + rand() * 23;
    let z: number | null = null;
    const b = body(x);
    if (b && y <= b.top && y >= b.bottom) {
      // 둥근 동체: 단면 원을 따라 깊이를 줍니다.
      const dy = (y - b.center) / b.radius;
      const half = Math.sqrt(Math.max(0, 1 - dy * dy)) * b.radius;
      // 겉면에 더 많이 모이도록 바깥쪽으로 치우치게 뽑습니다.
      z = (rand() < 0.5 ? -1 : 1) * half * (0.7 + 0.3 * Math.sqrt(rand()));
    } else if (insidePolygon(x, y, fin)) {
      z = gaussian(rand) * 0.25;
    } else if (insidePolygon(x, y, stabilizer)) {
      z = gaussian(rand) * 2.4;
    } else if (insidePolygon(x, y, wing)) {
      z = gaussian(rand) * 4;
    } else {
      const ex = (x - engine.x) / engine.rx;
      const ey = (y - engine.y) / engine.ry;
      if (ex * ex + ey * ey <= 1) z = 4.5 + gaussian(rand) * 0.9;
    }
    if (z === null) continue;
    out[filled * 3] = x * 1.08;
    out[filled * 3 + 1] = y * 1.08 - 3;
    out[filled * 3 + 2] = z;
    filled += 1;
  }
  return out;
}

/** 2) ICN 글자: 화면 밖 canvas에 글자를 그리고 칠해진 픽셀을 뽑습니다. */
export function textPoints(count: number, rand: Rand, text = 'ICN') {
  const width = 640;
  const height = 240;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  const pixels: number[] = [];
  if (context) {
    context.fillStyle = '#fff';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = `800 ${Math.round(height * 0.86)}px 'Pretendard Variable', Pretendard, Arial, sans-serif`;
    context.fillText(text, width / 2, height / 2 + 6, width * 0.96);
    const data = context.getImageData(0, 0, width, height).data;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (data[(y * width + x) * 4 + 3] > 140) pixels.push(x, y);
      }
    }
  }
  const out = new Float32Array(count * 3);
  const total = pixels.length / 2;
  const scale = 72 / width;
  for (let index = 0; index < count; index += 1) {
    if (!total) {
      out.set([(rand() - 0.5) * 60, (rand() - 0.5) * 20, 0], index * 3);
      continue;
    }
    const pick = Math.floor(rand() * total);
    const px = pixels[pick * 2] + rand();
    const py = pixels[pick * 2 + 1] + rand();
    out[index * 3] = (px - width / 2) * scale;
    out[index * 3 + 1] = -(py - height / 2) * scale + 1;
    out[index * 3 + 2] = gaussian(rand) * 1.1;
  }
  return out;
}

/** 3) 인천공항 터미널: 완만한 곡선 지붕의 본관과 뒤로 휘어지는 양쪽 날개 */
export function terminalPoints(count: number, rand: Rand) {
  const out = new Float32Array(count * 3);
  const roofHeight = (x: number, z: number) => 5 + 6.5 * Math.cos((x / 21) * (Math.PI / 2)) * (1 - 0.35 * (z / 8) ** 2);
  for (let index = 0; index < count; index += 1) {
    const kind = rand();
    let x: number;
    let y: number;
    let z: number;
    if (kind < 0.42) {
      // 곡선 지붕 면
      x = (rand() * 2 - 1) * 21;
      z = (rand() * 2 - 1) * 8;
      y = roofHeight(x, z);
    } else if (kind < 0.62) {
      // 앞면 유리벽: 세로 창살 줄무늬
      x = (rand() * 2 - 1) * 21;
      if (rand() < 0.55) x = Math.round(x / 1.75) * 1.75;
      z = 8;
      y = rand() * roofHeight(x, 8);
    } else if (kind < 0.94) {
      // 양쪽 날개: 본관 끝에서 바깥으로 뻗으며 뒤로 휘어집니다.
      const side = rand() < 0.5 ? -1 : 1;
      const t = rand();
      const along = 21 + t * 21;
      const back = -t * t * 16;
      const across = (rand() * 2 - 1) * 2.4;
      const top = rand() < 0.45;
      x = side * along + side * across * 0.25;
      z = back + across;
      y = top ? 3.4 + 0.6 * Math.cos(t * Math.PI) : rand() * 3.4;
    } else {
      // 앞 도로와 바닥선
      x = (rand() * 2 - 1) * 40;
      z = 10 + rand() * 3;
      y = 0;
    }
    out[index * 3] = x * 0.88;
    out[index * 3 + 1] = y * 1.1 - 7;
    out[index * 3 + 2] = z;
  }
  return out;
}
