import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { floorLayout, MAP_FLOORS, PLANS } from './facilityMap';
import type { FloorMap, MapTerminal, MapUnit, Piece } from './facilityMap';

type Props = {
  terminal: MapTerminal;
  floor: string;
  map: FloorMap;
  activeZone?: string | null;
  selectedId: string | null;
  onPickZone?: (key: string) => void;
  onPickPlace: (id: string, zoneKey: string) => void;
};
type Overlay = { key: string; point: THREE.Vector3; area?: string };
type PinScreen = { element: HTMLElement; x: number; y: number };

const PIN_MIN_DISTANCE = 28;          // 숫자 마커 중심끼리 이 거리(px)보다 가까우면 서로 밀어냄
const PIN_MAX_SHIFT = 26;             // 마커가 원래 위치에서 밀려나는 최대 거리(px)

/** 겹치는 숫자 마커를 서로 살짝 밀어내 모두 보이게 합니다. 거리에 따라 연속적으로 변해 튀지 않습니다. */
function spreadPins(pins: PinScreen[]) {
  if (pins.length < 2) return;
  const origin = pins.map(pin => ({ x: pin.x, y: pin.y }));
  for (let pass = 0; pass < 4; pass += 1) {
    for (let i = 0; i < pins.length; i += 1) {
      for (let j = i + 1; j < pins.length; j += 1) {
        let dx = pins[j].x - pins[i].x;
        let dy = pins[j].y - pins[i].y;
        let distance = Math.hypot(dx, dy);
        if (distance >= PIN_MIN_DISTANCE) continue;
        if (distance < .01) {
          // 완전히 겹치면 짝마다 고정된 방향으로 벌립니다.
          const angle = i * 1.7 + j * .9;
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          distance = 1;
        }
        const push = (PIN_MIN_DISTANCE - Math.min(distance, PIN_MIN_DISTANCE)) / 2;
        const ux = dx / distance;
        const uy = dy / distance;
        pins[i].x -= ux * push;
        pins[i].y -= uy * push;
        pins[j].x += ux * push;
        pins[j].y += uy * push;
      }
    }
    pins.forEach((pin, index) => {
      const moveX = pin.x - origin[index].x;
      const moveY = pin.y - origin[index].y;
      const moved = Math.hypot(moveX, moveY);
      if (moved > PIN_MAX_SHIFT) {
        pin.x = origin[index].x + (moveX / moved) * PIN_MAX_SHIFT;
        pin.y = origin[index].y + (moveY / moved) * PIN_MAX_SHIFT;
      }
    });
  }
}
type Rig = {
  group: THREE.Group;
  detail: THREE.Group;
  shellMats: THREE.Material[];
  detailMats: THREE.Material[];
  plates: THREE.Mesh[];
  fade: number;
  alpha: number;
  y: number;
};

const FLOOR_GAP = 5;
const SLAB = .5;
const TOP = .6;
const PLATE_HEIGHT = .07;
const UNIT_BASE = TOP + PLATE_HEIGHT;
const UNIT_HEIGHT = .85;
const UNIT_DEPTH = 1.5;
const GHOST_ALPHA = [0.24, 0.14, 0.08];
const STACK_PAD = 4;
const SETTLE_RATE = 6.5;
const ZOOM_SHOW = 1.8;
const CLICK_TOLERANCE = 5;
const SELECTED_COLOR = 0xff6a4d;
const MUTED_COLOR = 0xe6ecf2;

// ── 공항 조감도 비주얼 조절용 상수 (남색 #0b1f45, 노랑 #ffc726 톤과 맞춤) ──
// 구조: 터미널(흰색) → 넓은 계류장 한 겹(밝은 청회색) → 유도로 1줄(짙은 청회색) → 바깥 잔디 큰 조각
const BACKDROP_COLOR = 0xe8f0f8;      // 지도 카드 배경색 (Facilities 페이지 CSS의 .fac-map 배경과 같게)
const APRON_COLOR = 0xc3cfdc;         // 계류장 콘크리트
const TAXI_COLOR = 0x8294ab;          // 유도로 아스팔트
const GRASS_COLOR = 0xaec3a4;         // 잔디(채도 낮은 세이지 그린)
const TAXI_LINE_COLOR = 0xffc726;     // 유도로 중심선(노랑, 유도로에만)
const APRON_MARGIN = 12;              // 건물 바깥으로 계류장이 퍼지는 거리 (볼록 윤곽 기준, 탑승동 사이도 채움)
const TAXI_WIDTH = 3.2;               // 유도로 폭
const GRASS_WIDTH = 9;                // 유도로 바깥 잔디 폭
const SPOKE_COUNT = 6;                // 잔디를 큰 조각으로 나누는 연결 유도로 수
const SPOKE_WIDTH = 4.4;
const SPOKE_PHASE = .5;               // 연결 유도로 시작 각도(rad)
const FADE_RADIUS_SCALE = 1.7;        // 바닥 페이드 반지름 = 지도 크기 × 이 값
const FADE_START = .5;                // 이 비율 안쪽은 선명, 바깥으로 갈수록 배경색으로 페이드
const SLAB_COLOR = 0x8ea6c3;          // 층판 옆면
const OUTLINE_COLOR = 0x14305e;       // 건물 외곽선(남색)
const OUTLINE_WIDTH = 1.6;            // 외곽선 두께(px)
const OUTLINE_OPACITY = .85;
const GHOST_OUTLINE_SCALE = .4;       // 선택하지 않은 층 외곽선 투명도 배율 (낮을수록 옆면이 단순해짐)
const SHADOW_COLOR = 0x0b1f45;        // 컨택트 섀도
const SHADOW_OPACITY = .14;           // 그림자 가장 진한 곳
const SHADOW_OFFSET = { x: 1.8, z: -1.4 };
const SHADOW_LAYERS = [{ grow: .5, weight: 1 }, { grow: 1.8, weight: .55 }, { grow: 3.4, weight: .3 }];
// ── 지상 비행기: 눈에 띄지 않는 배경 장식 ──
const SHOW_AIRCRAFT = true;           // false로 바꾸면 비행기와 주기장 유도선이 모두 사라집니다
const AIRCRAFT_MAX = 8;               // 터미널당 비행기 최대 수 (6~8대)
const AIRCRAFT_SCALE = 1.95;          // 크기 (탑승동 폭보다 작게)
const AIRCRAFT_COLOR = 0xe2e9f2;      // 계류장보다 조금 밝은 청회색
const AIRCRAFT_SHADOW_OPACITY = .16;  // 그림자 진하기
const AIRCRAFT_GAP = .2;              // 기수 끝과 건물 벽 사이 간격
const AIRCRAFT_KEEP_OUT = 8;          // 구역 라벨·시설 구역 중심에서 이 거리(월드 단위) 안에는 놓지 않음
const STAND_PITCH = 9;                // 같은 쪽 게이트 사이 간격
const STAND_MIN_GAP = 8;              // 비행기 중심끼리 최소 거리
const STAND_LINE_OPACITY = .45;       // 주기장 유도선(노랑) 진하기
const GROUND_Y = -1.06;               // 바닥 맨 아래 층 높이
const LAYER_GAP = .006;               // 바닥 층 사이 높이 간격
const CATEGORY_COLOR: Record<string, number> = {
  FOOD_CAFE: 0xffd2ad,
  SHOPPING: 0xb5d9fb,
  LOUNGE: 0xd9cdfb,
  PHARMACY: 0xb4ebd5,
  ETC: 0xd8e0e8,
};

function lit(color: number, opacity = 1) {
  const material = new THREE.MeshStandardMaterial({ color, roughness: .7, metalness: .05, transparent: opacity < 1, opacity });
  return material;
}

/** 외곽선을 그립니다. hole이 있으면 같은 모양의 안쪽을 비운 띠(벽) 모양이 됩니다. */
function outline(path: THREE.Path, piece: Piece, grow: number) {
  if (piece.kind === 'arc') {
    const toRad = (degree: number) => ((90 - degree) * Math.PI) / 180;
    path.absarc(0, 0, piece.outer + grow, toRad(piece.to + .6), toRad(piece.from - .6), false);
    path.absarc(0, 0, Math.max(.1, piece.inner - grow), toRad(piece.from - .6), toRad(piece.to + .6), true);
    path.closePath();
  } else if (piece.kind === 'circle') {
    path.absarc(0, 0, piece.radius + grow, 0, Math.PI * 2, false);
  } else {
    const half = Math.hypot(piece.to.x - piece.from.x, piece.to.z - piece.from.z) / 2;
    const radius = piece.width / 2 + grow;
    path.moveTo(-half, -radius);
    path.lineTo(half, -radius);
    path.absarc(half, 0, radius, -Math.PI / 2, Math.PI / 2, false);
    path.lineTo(-half, radius);
    path.absarc(-half, 0, radius, Math.PI / 2, Math.PI * 1.5, false);
  }
}

function pieceMesh(piece: Piece, grow: number, height: number, material: THREE.Material, y: number, holeGrow?: number) {
  const shape = new THREE.Shape();
  outline(shape, piece, grow);
  if (holeGrow !== undefined) {
    const hole = new THREE.Path();
    outline(hole, piece, holeGrow);
    shape.holes.push(hole);
  }
  let position = { x: 0, z: 0 };
  let rotation = 0;
  if (piece.kind === 'arc' || piece.kind === 'circle') {
    position = piece.center;
  } else {
    position = { x: (piece.from.x + piece.to.x) / 2, z: (piece.from.z + piece.to.z) / 2 };
    rotation = -Math.atan2(piece.to.z - piece.from.z, piece.to.x - piece.from.x);
  }
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 48 });
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(position.x, y, position.z);
  mesh.rotation.y = rotation;
  return mesh;
}

/** 지상 비행기 윤곽(납작한 도형)입니다. 몸체와 외곽선이 같은 점을 씁니다. */
const AIRCRAFT_OUTLINE: [number, number][] = [[0, 1.5], [.12, .55], [1.05, -.1], [1.05, -.3], [.12, -.1], [.09, -.9], [.38, -1.2],
  [.38, -1.32], [0, -1.2], [-.38, -1.32], [-.38, -1.2], [-.09, -.9], [-.12, -.1], [-1.05, -.3], [-1.05, -.1], [-.12, .55]];

function airplaneGeometry() {
  const shape = new THREE.Shape();
  AIRCRAFT_OUTLINE.forEach(([x, y], index) => (index ? shape.lineTo(x, y) : shape.moveTo(x, y)));
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

/** 두 점 사이를 잇는 낮은 막대(복도·칸막이)입니다. */
function strip(from: { x: number; z: number }, to: { x: number; z: number }, width: number, height: number, material: THREE.Material, y: number) {
  const length = Math.hypot(to.x - from.x, to.z - from.z) || .01;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(length, height, width), material);
  mesh.position.set((from.x + to.x) / 2, y + height / 2, (from.z + to.z) / 2);
  mesh.rotation.y = -Math.atan2(to.z - from.z, to.x - from.x);
  return mesh;
}

/** 가운데는 투명하고 가장자리로 갈수록 배경색이 되는 원형 알파 맵입니다. ratio는 판 크기 대비 페이드가 끝나는 반지름입니다. */
function fadeAlphaMap(ratio: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d')!;
  const gradient = context.createRadialGradient(128, 128, 0, 128, 128, 128);
  gradient.addColorStop(0, '#000');
  gradient.addColorStop(FADE_START * ratio, '#000');
  gradient.addColorStop(ratio, '#fff');
  gradient.addColorStop(1, '#fff');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(canvas);
}

type Pt = { x: number; z: number };

/** 조각 윤곽의 점들을 월드 좌표로 바꿉니다(pieceMesh와 같은 규칙). */
function footprintPoints(plan: { floors: Piece[]; landside: Piece[] }): Pt[] {
  const points: Pt[] = [];
  for (const piece of [...plan.floors, ...plan.landside]) {
    const shape = new THREE.Shape();
    outline(shape, piece, 0);
    for (const point of shape.getPoints(32)) {
      if (piece.kind === 'arc' || piece.kind === 'circle') {
        points.push({ x: piece.center.x + point.x, z: piece.center.z - point.y });
      } else {
        const rotation = -Math.atan2(piece.to.z - piece.from.z, piece.to.x - piece.from.x);
        const mid = { x: (piece.from.x + piece.to.x) / 2, z: (piece.from.z + piece.to.z) / 2 };
        const lz = -point.y;
        points.push({
          x: mid.x + point.x * Math.cos(rotation) + lz * Math.sin(rotation),
          z: mid.z - point.x * Math.sin(rotation) + lz * Math.cos(rotation),
        });
      }
    }
  }
  return points;
}

/** 볼록 윤곽(monotone chain). 반시계 방향으로 돌려줍니다. */
function convexHull(points: Pt[]): Pt[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.z - b.z);
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const build = (list: Pt[]) => {
    const out: Pt[] = [];
    for (const point of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], point) <= 0) out.pop();
      out.push(point);
    }
    out.pop();
    return out;
  };
  return [...build(sorted), ...build(sorted.reverse())];
}

/** 볼록 윤곽을 margin만큼 둥글게 부풀립니다: 직선 + 완만한 곡선이 됩니다. */
function offsetHull(points: Pt[], margin: number): Pt[] {
  const round: Pt[] = [];
  for (const point of points) {
    for (let step = 0; step < 16; step += 1) {
      const angle = (step / 16) * Math.PI * 2;
      round.push({ x: point.x + Math.cos(angle) * margin, z: point.z + Math.sin(angle) * margin });
    }
  }
  return convexHull(round);
}

function insideHull(hull: Pt[], point: Pt) {
  return hull.every((a, index) => {
    const b = hull[(index + 1) % hull.length];
    return (b.x - a.x) * (point.z - a.z) - (b.z - a.z) * (point.x - a.x) >= 0;
  });
}

function hullMesh(hull: Pt[], material: THREE.Material, y: number) {
  const shape = new THREE.Shape(hull.map(point => new THREE.Vector2(point.x, -point.z)));
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = y;
  return mesh;
}

/**
 * 조감도 바닥. 모두 정적이라 터미널을 열 때 한 번만 만듭니다.
 * 아래 층부터: 잔디 → 연결 유도로 → 유도로 → 계류장(한 겹, 탑승동 사이 안쪽까지 채움).
 */
function addGround(world: THREE.Group, terminal: MapTerminal) {
  const plan = PLANS[terminal];
  const base = footprintPoints(plan);
  const flat = (color: number) => new THREE.MeshBasicMaterial({ color });
  const taxi = flat(TAXI_COLOR);
  const dash = new THREE.LineDashedMaterial({ color: TAXI_LINE_COLOR, dashSize: 1.4, gapSize: 1 });
  const layer = (index: number) => GROUND_Y + index * LAYER_GAP;
  const thin = .004;
  const taxiEdge = APRON_MARGIN + TAXI_WIDTH;
  const grassHull = offsetHull(base, taxiEdge + GRASS_WIDTH);
  const taxiHull = offsetHull(base, taxiEdge);
  const apronHull = offsetHull(base, APRON_MARGIN);
  const midHull = offsetHull(base, APRON_MARGIN + TAXI_WIDTH / 2);

  world.add(hullMesh(grassHull, flat(GRASS_COLOR), layer(0)));

  // 연결 유도로: 잔디를 큰 조각 몇 개로 나눕니다. 중심에서 바깥 경계까지 뻗고, 안쪽은 계류장이 덮습니다.
  const center = base.reduce((sum, point) => ({ x: sum.x + point.x / base.length, z: sum.z + point.z / base.length }), { x: 0, z: 0 });
  for (let index = 0; index < SPOKE_COUNT; index += 1) {
    const angle = SPOKE_PHASE + (index / SPOKE_COUNT) * Math.PI * 2;
    const dir = { x: Math.cos(angle), z: Math.sin(angle) };
    let reach = 0;
    while (reach < 220 && insideHull(grassHull, { x: center.x + dir.x * reach, z: center.z + dir.z * reach })) reach += .5;
    const end = { x: center.x + dir.x * (reach - .6), z: center.z + dir.z * (reach - .6) };
    world.add(strip(center, end, SPOKE_WIDTH, thin, taxi, layer(1)));
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(center.x, layer(2), center.z), new THREE.Vector3(end.x, layer(2), end.z)]),
      dash,
    );
    line.computeLineDistances();
    world.add(line);
  }

  world.add(hullMesh(taxiHull, taxi, layer(3)));
  const loop = midHull.map(point => new THREE.Vector3(point.x, layer(4), point.z));
  loop.push(loop[0].clone());
  const loopLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(loop), dash);
  loopLine.computeLineDistances();
  world.add(loopLine);
  world.add(hullMesh(apronHull, flat(APRON_COLOR), layer(5)));

  // 컨택트 섀도: 건물 윤곽을 키운 반투명 판을 겹쳐 부드러운 가장자리를 만듭니다(실시간 shadow map 없음).
  for (const piece of [...plan.floors, ...plan.landside]) {
    for (const shade of SHADOW_LAYERS) {
      const material = new THREE.MeshBasicMaterial({
        color: SHADOW_COLOR, transparent: true, opacity: SHADOW_OPACITY * shade.weight * .6, depthWrite: false,
      });
      const shadow = pieceMesh(piece, shade.grow, .01, material, layer(6));
      shadow.position.x += SHADOW_OFFSET.x;
      shadow.position.z += SHADOW_OFFSET.z;
      shadow.renderOrder = -3;
      world.add(shadow);
    }
  }

  // 가장자리 페이드: 바닥이 배경색에 녹아 지도가 카드 안에 떠 있는 느낌을 줍니다.
  const radius = plan.viewHalf * FADE_RADIUS_SCALE;
  const span = radius * 3;  // 바닥 전체를 덮는 큰 판(모서리에 바닥이 남지 않게)
  const fadeGeometry = new THREE.PlaneGeometry(span * 2, span * 2);
  fadeGeometry.rotateX(-Math.PI / 2);
  const fade = new THREE.Mesh(fadeGeometry, new THREE.MeshBasicMaterial({
    color: BACKDROP_COLOR, alphaMap: fadeAlphaMap(radius / span), transparent: true, depthWrite: false,
  }));
  fade.position.y = layer(7);
  fade.renderOrder = -2;
  world.add(fade);
}

/** 점이 건물 조각(margin만큼 키운) 안에 있는지 확인합니다. */
function nearPiece(piece: Piece, point: Pt, margin: number) {
  if (piece.kind === 'circle') return Math.hypot(point.x - piece.center.x, point.z - piece.center.z) <= piece.radius + margin;
  if (piece.kind === 'arc') {
    const dx = point.x - piece.center.x;
    const dz = point.z - piece.center.z;
    const radius = Math.hypot(dx, dz);
    const angle = (Math.atan2(dx, -dz) * 180) / Math.PI;
    const slack = ((margin / Math.max(radius, 1)) * 180) / Math.PI;
    return radius >= piece.inner - margin && radius <= piece.outer + margin && angle >= piece.from - slack && angle <= piece.to + slack;
  }
  const lx = piece.to.x - piece.from.x;
  const lz = piece.to.z - piece.from.z;
  const ratio = Math.max(0, Math.min(1, ((point.x - piece.from.x) * lx + (point.z - piece.from.z) * lz) / (lx * lx + lz * lz || 1)));
  return Math.hypot(point.x - (piece.from.x + lx * ratio), point.z - (piece.from.z + lz * ratio)) <= piece.width / 2 + margin;
}

type Stand = { edge: Pt; normal: Pt };

/** 숫자 마커·구역 라벨이 놓이는 월드 좌표(모든 층)입니다. 비행기를 이 근처에는 두지 않습니다. */
function keepOutPoints(terminal: MapTerminal): Pt[] {
  const points: Pt[] = [];
  for (const floor of MAP_FLOORS) {
    const layout = floorLayout(terminal, floor);
    for (const label of layout.labels) points.push({ x: label.x, z: label.z });
    for (const patch of layout.patches) {
      const piece = patch.piece;
      if (piece.kind === 'bar') points.push({ x: (piece.from.x + piece.to.x) / 2, z: (piece.from.z + piece.to.z) / 2 });
      else if (piece.kind === 'circle') points.push(piece.center);
      else {
        const radians = (((piece.from + piece.to) / 2) * Math.PI) / 180;
        const radius = (piece.inner + piece.outer) / 2;
        points.push({ x: piece.center.x + radius * Math.sin(radians), z: piece.center.z - radius * Math.cos(radians) });
      }
    }
  }
  return points;
}

/** 탑승동 양옆(그리고 T1 본동 바깥쪽)에 일정 간격으로 놓을 게이트 후보입니다. normal은 건물에서 바깥쪽입니다. */
function standCandidates(plan: { floors: Piece[]; landside: Piece[] }): Stand[] {
  const stands: Stand[] = [];
  for (const piece of plan.floors) {
    if (piece.kind === 'bar') {
      const length = Math.hypot(piece.to.x - piece.from.x, piece.to.z - piece.from.z);
      const tangent = { x: (piece.to.x - piece.from.x) / length, z: (piece.to.z - piece.from.z) / length };
      const inset = piece.width / 2 + AIRCRAFT_SCALE * 1.4;
      const count = Math.floor((length - inset * 2) / STAND_PITCH) + 1;
      if (count < 1) continue;
      const used = (count - 1) * STAND_PITCH;
      for (let index = 0; index < count; index += 1) {
        const along = (length - used) / 2 + index * STAND_PITCH;
        const base = { x: piece.from.x + tangent.x * along, z: piece.from.z + tangent.z * along };
        for (const side of [1, -1]) {
          const normal = { x: tangent.z * side, z: -tangent.x * side };
          stands.push({ edge: { x: base.x + normal.x * piece.width / 2, z: base.z + normal.z * piece.width / 2 }, normal });
        }
      }
    } else if (piece.kind === 'arc' && piece.to - piece.from > 100) {
      // 본동 원호: 양 끝 쪽 바깥면에 게이트를 둡니다.
      const step = (STAND_PITCH / piece.outer) * (180 / Math.PI);
      for (const sign of [-1, 1]) {
        for (let angle = 40; angle <= 64; angle += step) {
          const radians = (sign * angle * Math.PI) / 180;
          const normal = { x: Math.sin(radians), z: -Math.cos(radians) };
          stands.push({
            edge: { x: piece.center.x + normal.x * piece.outer, z: piece.center.z + normal.z * piece.outer },
            normal,
          });
        }
      }
    }
  }
  return stands;
}

/**
 * 비행기를 탑승동 벽에 수직으로 붙여 조용한 배경 장식으로 세웁니다. 기수 끝이 벽에 거의 닿고,
 * 크기와 그림자 방향은 모두 같습니다. 건물과 겹치거나 계류장 밖으로 나가는 자리, 라벨 근처는
 * 월드 좌표로 배치할 때 한 번만 걸러냅니다.
 */
function addApron(world: THREE.Group, terminal: MapTerminal) {
  if (!SHOW_AIRCRAFT) return;
  const plan = PLANS[terminal];
  const pieces = [...plan.floors, ...plan.landside];
  const apron = offsetHull(footprintPoints(plan), APRON_MARGIN - 1);
  const keepOut = keepOutPoints(terminal);
  const reach = AIRCRAFT_GAP + AIRCRAFT_SCALE * 1.5;
  // 비행기 윤곽 위의 주요 점(기수, 꼬리, 날개 끝, 중심)을 로컬 좌표로 둡니다. 로컬 z는 기수가 -입니다.
  const probes = [[0, -1.5], [0, 1.32], [1.05, .3], [-1.05, .3], [0, 0]].map(([x, z]) => ({ x: x * AIRCRAFT_SCALE, z: z * AIRCRAFT_SCALE }));

  const placed: { stand: Stand; x: number; z: number; turn: number }[] = [];
  for (const stand of standCandidates(plan)) {
    const x = stand.edge.x + stand.normal.x * reach;
    const z = stand.edge.z + stand.normal.z * reach;
    const turn = Math.atan2(stand.normal.x, stand.normal.z);
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    const fits = probes.every(probe => {
      const point = { x: x + probe.x * cos + probe.z * sin, z: z - probe.x * sin + probe.z * cos };
      return insideHull(apron, point) && !pieces.some(piece => nearPiece(piece, point, 0));
    });
    if (!fits) continue;
    // 기수 끝이 건물 벽에 닿아 있지 않으면(계류장에 떠 있으면) 제외합니다.
    const nose = { x: x + probes[0].x * cos + probes[0].z * sin, z: z - probes[0].x * sin + probes[0].z * cos };
    if (!pieces.some(piece => nearPiece(piece, nose, AIRCRAFT_GAP + .4))) continue;
    if (keepOut.some(point => Math.hypot(point.x - x, point.z - z) < AIRCRAFT_KEEP_OUT)) continue;
    if (placed.some(other => Math.hypot(other.x - x, other.z - z) < STAND_MIN_GAP)) continue;
    placed.push({ stand, x, z, turn });
  }
  // 너무 많으면 고르게 덜어냅니다.
  const chosen = placed.length > AIRCRAFT_MAX
    ? Array.from({ length: AIRCRAFT_MAX }, (_, index) => placed[Math.floor(((index + .5) * placed.length) / AIRCRAFT_MAX)])
    : placed;

  const geometry = airplaneGeometry();
  const body = new THREE.MeshBasicMaterial({ color: AIRCRAFT_COLOR, side: THREE.DoubleSide });
  const shade = new THREE.MeshBasicMaterial({
    color: SHADOW_COLOR, transparent: true, opacity: AIRCRAFT_SHADOW_OPACITY, depthWrite: false, side: THREE.DoubleSide,
  });
  const standLine = new THREE.LineBasicMaterial({ color: TAXI_LINE_COLOR, transparent: true, opacity: STAND_LINE_OPACITY });
  const planeY = -.9;
  const lineY = GROUND_Y + 6 * LAYER_GAP;
  const tail = reach + AIRCRAFT_SCALE * 1.32;
  for (const { stand, x, z, turn } of chosen) {
    const group = new THREE.Group();
    group.position.set(x, planeY, z);
    group.rotation.y = turn;
    group.scale.setScalar(AIRCRAFT_SCALE);
    const plane = new THREE.Mesh(geometry, body);
    plane.renderOrder = 1;
    // 그림자: 월드 기준 (1, -.8) 방향으로 모두 같게 아주 옅게 떨어뜨립니다.
    const shadow = new THREE.Mesh(geometry, shade);
    const ox = 1 / AIRCRAFT_SCALE;
    const oz = -.8 / AIRCRAFT_SCALE;
    shadow.position.set(
      Math.cos(turn) * ox - Math.sin(turn) * oz,
      (GROUND_Y + 6.5 * LAYER_GAP - planeY) / AIRCRAFT_SCALE,
      Math.sin(turn) * ox + Math.cos(turn) * oz,
    );
    shadow.renderOrder = -3;
    group.add(shadow, plane);
    world.add(group);

    // 주기장 유도선: 건물 벽에서 시작해 비행기 아래를 지나 꼬리 쪽까지 한 줄(기수 앞으로는 나오지 않음).
    world.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(stand.edge.x, lineY, stand.edge.z),
        new THREE.Vector3(stand.edge.x + stand.normal.x * tail, lineY, stand.edge.z + stand.normal.z * tail),
      ]),
      standLine,
    ));
  }
}

/** 선택 층에서 가장 아래 표시 층까지 잇는 기둥입니다. 길이는 프레임마다 맞춥니다. */
function addColumns(world: THREE.Group, terminal: MapTerminal) {
  const plan = PLANS[terminal];
  const points: { x: number; z: number }[] = [];
  for (const piece of [...plan.floors, ...plan.landside]) {
    if (piece.kind === 'arc') {
      const radius = (piece.outer + piece.inner) / 2;
      for (let index = 0; index < 5; index += 1) {
        const angle = ((piece.from + ((piece.to - piece.from) * (index + .5)) / 5) * Math.PI) / 180;
        points.push({ x: piece.center.x + radius * Math.sin(angle), z: piece.center.z - radius * Math.cos(angle) });
      }
    } else if (piece.kind === 'bar') {
      points.push(piece.from, piece.to, { x: (piece.from.x + piece.to.x) / 2, z: (piece.from.z + piece.to.z) / 2 });
    } else {
      points.push(piece.center);
    }
  }
  const group = new THREE.Group();
  const material = lit(0xb9cde2, .45);
  const geometry = new THREE.CylinderGeometry(.32, .32, 1, 12);
  geometry.translate(0, -.5, 0);
  for (const point of points) {
    const column = new THREE.Mesh(geometry, material);
    column.position.set(point.x, 0, point.z);
    group.add(column);
  }
  world.add(group);
  return group;
}

/** 층판 하나: 두께 있는 바닥, 구역 판, 얕은 벽과 복도 선, 출국장·체크인 구조. */
function buildFloor(terminal: MapTerminal, name: string, selected: boolean): Rig {
  const plan = PLANS[terminal];
  const layout = floorLayout(terminal, name);
  const rig: Rig = {
    group: new THREE.Group(),
    detail: new THREE.Group(),
    shellMats: [],
    detailMats: [],
    plates: [],
    fade: selected ? 1 : 0,
    alpha: selected ? 1 : 0,
    y: 0,
  };
  // 바닥은 층 전체 투명도(alpha)로, 구역 판·벽 같은 상세는 선택 여부(fade)로 흐려집니다.
  const shell = <T extends THREE.Material>(material: T, base = 1) => {
    material.userData.base = base;
    material.transparent = true;
    material.opacity = base;
    rig.shellMats.push(material);
    return material;
  };
  const track = <T extends THREE.Material>(material: T, base = 1) => {
    material.userData.base = base;
    material.transparent = true;
    material.opacity = base;
    rig.detailMats.push(material);
    return material;
  };
  const shapes = [...plan.floors, ...plan.landside];
  rig.group.add(rig.detail);

  // 두께 있는 층판(아래층에서도 입체감을 줍니다)
  const edgeMaterial = shell(new LineMaterial({ color: OUTLINE_COLOR, linewidth: OUTLINE_WIDTH }), OUTLINE_OPACITY);
  for (const piece of shapes) {
    const slab = pieceMesh(piece, .55, SLAB, shell(lit(SLAB_COLOR, .95), .95), 0);
    rig.group.add(slab);
    const edges = new LineSegments2(new LineSegmentsGeometry().fromEdgesGeometry(new THREE.EdgesGeometry(slab.geometry, 30)), edgeMaterial);
    edges.position.copy(slab.position);
    edges.rotation.copy(slab.rotation);
    rig.group.add(edges);
  }
  for (const piece of plan.landside) rig.group.add(pieceMesh(piece, 0, .08, shell(lit(0xf1f6fb)), .5));
  for (const piece of plan.floors) rig.group.add(pieceMesh(piece, 0, .08, shell(lit(0xfbfdff)), .52));

  // 얕은 벽: 원호는 구멍의 끝면이 바깥 윤곽과 겹쳐 넓은 면이 생기므로 안팎 두 줄의 띠로 만듭니다.
  const wall = track(lit(0xb9cde2, .8), .8);
  for (const piece of shapes) {
    if (piece.kind === 'arc') {
      rig.detail.add(pieceMesh({ ...piece, inner: piece.outer + .3 }, .25, .4, wall, TOP));
      rig.detail.add(pieceMesh({ ...piece, outer: piece.inner - .3 }, .25, .4, wall, TOP));
    } else {
      rig.detail.add(pieceMesh(piece, .55, .4, wall, TOP, .38));
    }
  }

  // 게이트 복도와 중앙선
  if (layout.gates) {
    const corridor = track(lit(0xe9f1f9));
    const lineMaterial = track(new THREE.LineBasicMaterial({ color: 0xaec4da }), .8);
    for (const section of plan.sections) {
      if (section.points.length < 2 || section.points[0] === section.points[1]) continue;
      section.points.slice(1).forEach((point, i) => {
        rig.detail.add(strip(section.points[i], point, 2.4, .04, corridor, TOP));
      });
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(section.points.map(point => new THREE.Vector3(point.x, TOP + .06, point.z))),
        lineMaterial,
      );
      rig.detail.add(line);
    }
  }

  // 출국장 구조: 출입문, 칸막이, 체크인 카운터
  if (layout.halls) {
    const gateMaterial = track(lit(0x7ba7d3));
    const divider = track(lit(0xb9cde2));
    for (const hall of plan.halls) {
      const gate = new THREE.Mesh(new THREE.BoxGeometry(3.4, .7, .8), gateMaterial);
      gate.position.set(hall.x, TOP + .35, hall.z - 1.4);
      rig.detail.add(gate);
    }
    const halls = plan.halls;
    if (halls.length > 1) {
      const step = { x: halls[1].x - halls[0].x, z: halls[1].z - halls[0].z };
      const marks = [
        { x: halls[0].x - step.x / 2, z: halls[0].z - step.z / 2 },
        ...halls.slice(1).map((hall, i) => ({ x: (hall.x + halls[i].x) / 2, z: (hall.z + halls[i].z) / 2 })),
        { x: halls[halls.length - 1].x + step.x / 2, z: halls[halls.length - 1].z + step.z / 2 },
      ];
      for (const mark of marks) {
        const wallPart = new THREE.Mesh(new THREE.BoxGeometry(.3, .5, 3.2), divider);
        wallPart.position.set(mark.x, TOP + .25, mark.z);
        wallPart.rotation.y = -Math.atan2(step.z, step.x);
        rig.detail.add(wallPart);
      }
    }
    rig.detail.add(pieceMesh(plan.desk, 0, .3, track(lit(0xcbd9ea)), TOP));
  }

  // 구역 판: 바닥보다 아주 조금 높은 은은한 색 판
  for (const patch of layout.patches) {
    const plate = pieceMesh(patch.piece, 0, PLATE_HEIGHT, track(lit(patch.color)), TOP);
    plate.userData.labelKey = patch.key;
    rig.detail.add(plate);
    rig.plates.push(plate);
  }
  rig.detail.visible = selected;
  return rig;
}

function disposeTree(root: THREE.Object3D) {
  root.traverse(object => {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach(item => {
      const textured = item as THREE.MeshBasicMaterial | undefined;
      textured?.map?.dispose();
      textured?.alphaMap?.dispose();
      item?.dispose();
    });
  });
}

export default function AirportScene({ terminal, floor, map, activeZone = null, selectedId, onPickZone, onPickPlace }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const unitGroupRef = useRef<THREE.Group | null>(null);
  const overlayRefs = useRef(new Map<string, HTMLElement>());
  const overlaysRef = useRef<Overlay[]>([]);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const pickRef = useRef(onPickPlace);
  const floorIndexRef = useRef(Math.max(0, MAP_FLOORS.indexOf(floor)));
  const reducedRef = useRef(false);
  const hoveredAreaRef = useRef<string | null>(null);
  const [failed, setFailed] = useState(false);

  // 숫자 핀(구역별 시설 수)에 마우스를 올리면 시설 이름 툴팁과 같은 스타일로 바로 보여줍니다.
  const showPinTip = (event: ReactPointerEvent, text: string) => {
    const tooltip = tooltipRef.current;
    const host = hostRef.current;
    if (!tooltip || !host) return;
    const rect = host.getBoundingClientRect();
    tooltip.textContent = text;
    tooltip.hidden = false;
    tooltip.style.transform = `translate(${event.clientX - rect.left + 12}px, ${event.clientY - rect.top - 34}px)`;
  };
  const hidePinTip = () => {
    if (tooltipRef.current) tooltipRef.current.hidden = true;
  };

  useEffect(() => { pickRef.current = onPickPlace; }, [onPickPlace]);

  // 선택 층이 바뀌면 애니메이션 목표만 바꿉니다. 카메라 각도는 그대로 둡니다.
  useEffect(() => {
    floorIndexRef.current = Math.max(0, MAP_FLOORS.indexOf(floor));
    reducedRef.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    hoveredAreaRef.current = null;
  }, [floor]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.className = 'airport-scene__canvas';
    host.prepend(renderer.domElement);

    const scene = new THREE.Scene();
    const world = new THREE.Group();
    world.position.z = PLANS[terminal].shiftZ;
    scene.add(world);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x6f8fb0, 2.4));
    scene.add(new THREE.AmbientLight(0xffffff, .35));
    const sun = new THREE.DirectionalLight(0xffffff, 1.9);
    sun.position.set(-18, 60, 22);
    scene.add(sun);

    const groundGroup = new THREE.Group();
    world.add(groundGroup);
    addGround(groundGroup, terminal);
    addApron(groundGroup, terminal);
    const columns = addColumns(world, terminal);
    const rigs = MAP_FLOORS.map((name, index) => buildFloor(terminal, name, index === floorIndexRef.current));
    rigs.forEach(rig => world.add(rig.group));

    const units = new THREE.Group();
    world.add(units);
    unitGroupRef.current = units;

    // 선택 층은 항상 같은 높이에 고정하므로 카메라는 층과 관계없이 그대로입니다.
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 400);
    camera.position.set(0, 70, 26);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0);
    Object.assign(controls, {
      enableDamping: true,
      dampingFactor: .08,
      enablePan: true,
      screenSpacePanning: false,
      minZoom: .8,
      maxZoom: 4,
      minPolarAngle: .2,
      maxPolarAngle: 1.15,
      minAzimuthAngle: -.8,
      maxAzimuthAngle: .8,
    });

    const resize = () => {
      const width = host.clientWidth || 1;
      const height = host.clientHeight || 1;
      const aspect = width / height;
      // 4F 아래로 내려가는 층까지 잘리지 않도록 모든 층에 같은 여유를 둡니다.
      const base = PLANS[terminal].viewHalf + STACK_PAD;
      const half = Math.max(base, (base * 1.05) / aspect);
      camera.left = -half * aspect;
      camera.right = half * aspect;
      camera.top = half;
      camera.bottom = -half;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      // 굵은 외곽선은 화면 크기를 알아야 두께가 일정하게 유지됩니다.
      for (const rig of rigs) {
        for (const material of rig.shellMats) if (material instanceof LineMaterial) material.resolution.set(width, height);
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    const pointer = new THREE.Vector2();
    const raycaster = new THREE.Raycaster();
    const aim = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
    };
    // 클릭 대상은 현재 층의 시설 칸뿐입니다.
    const hitUnit = (event: PointerEvent) => {
      aim(event);
      return raycaster.intersectObjects(units.children, false)[0]?.object as THREE.Mesh | undefined;
    };
    // 구역 이름 표시용 호버입니다. 현재 층의 구역 판만 검사합니다.
    const hitPlate = (event: PointerEvent) => {
      aim(event);
      const plates = rigs[floorIndexRef.current]?.plates ?? [];
      return raycaster.intersectObjects(plates, false)[0]?.object as THREE.Mesh | undefined;
    };

    const onLeave = () => {
      if (tooltipRef.current) tooltipRef.current.hidden = true;
      hoveredAreaRef.current = null;
    };

    let downX = 0;
    let downY = 0;
    const onDown = (event: PointerEvent) => {
      downX = event.clientX;
      downY = event.clientY;
    };
    const onUp = (event: PointerEvent) => {
      if (Math.hypot(event.clientX - downX, event.clientY - downY) > CLICK_TOLERANCE) return;
      const unit = hitUnit(event)?.userData.unit as MapUnit | undefined;
      if (!unit) return;
      onLeave();
      pickRef.current(unit.place.facilityId, unit.zoneKey);
    };
    const onMove = (event: PointerEvent) => {
      const unit = hitUnit(event)?.userData.unit as MapUnit | undefined;
      renderer.domElement.style.cursor = unit ? 'pointer' : 'grab';
      hoveredAreaRef.current = unit ? null : (hitPlate(event)?.userData.labelKey as string | undefined) ?? null;
      const tooltip = tooltipRef.current;
      if (!tooltip) return;
      tooltip.hidden = !unit;
      if (unit) {
        const rect = host.getBoundingClientRect();
        tooltip.textContent = unit.place.name;
        tooltip.style.transform = `translate(${event.clientX - rect.left + 12}px, ${event.clientY - rect.top - 30}px)`;
      }
    };
    const canvas = renderer.domElement;
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointermove', onMove);

    const projected = new THREE.Vector3();
    const pinScreens: PinScreen[] = [];
    const clock = new THREE.Clock();
    let frame = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      const delta = Math.min(clock.getDelta(), .05);
      const ease = reducedRef.current ? 1 : 1 - Math.exp(-delta * SETTLE_RATE);
      const selectedIndex = floorIndexRef.current;

      // 선택 층은 같은 높이에 두고 아래층만 일정 간격으로 내려 그립니다. 위층은 사라집니다.
      rigs.forEach((rig, index) => {
        const depth = selectedIndex - index;
        const goalAlpha = depth < 0 ? 0 : depth === 0 ? 1 : GHOST_ALPHA[Math.min(depth, GHOST_ALPHA.length) - 1];
        const goalY = depth > 0 ? -depth * FLOOR_GAP : 0;
        rig.alpha += (goalAlpha - rig.alpha) * ease;
        rig.fade += ((depth === 0 ? 1 : 0) - rig.fade) * ease;
        rig.y += (goalY - rig.y) * ease;
        rig.group.position.y = rig.y;
        for (const material of rig.shellMats) {
          // 선택하지 않은 층의 외곽선은 더 옅게 해서 옆면이 덜 복잡하게 보이게 합니다.
          const ghost = material instanceof LineMaterial ? GHOST_OUTLINE_SCALE + (1 - GHOST_OUTLINE_SCALE) * rig.fade : 1;
          material.opacity = (material.userData.base as number) * rig.alpha * ghost;
          material.depthWrite = rig.alpha > .85;
        }
        for (const material of rig.detailMats) {
          material.opacity = (material.userData.base as number) * rig.fade;
          material.depthWrite = rig.fade > .85;
        }
        rig.group.visible = rig.alpha > .01;
        rig.detail.visible = rig.fade > .35;
      });
      units.position.y = rigs[selectedIndex]?.group.position.y ?? 0;
      groundGroup.position.y = rigs[0]?.group.position.y ?? 0;

      // 기둥은 선택 층 아래에서 가장 아래 표시 층(B1)까지 이어집니다. B1을 고르면 없습니다.
      const columnLength = Math.max(0, -(rigs[0]?.group.position.y ?? 0));
      columns.scale.y = Math.max(.001, columnLength);
      columns.visible = columnLength > .05 && selectedIndex > 0;

      controls.update();
      renderer.render(scene, camera);

      const zoomed = camera.zoom >= ZOOM_SHOW;
      pinScreens.length = 0;
      for (const { key, point, area } of overlaysRef.current) {
        const element = overlayRefs.current.get(key);
        if (!element) continue;
        projected.set(point.x, point.y + units.position.y, point.z).project(camera);
        const screenX = ((projected.x + 1) / 2) * host.clientWidth;
        const screenY = ((1 - projected.y) / 2) * host.clientHeight;
        // 숫자 마커(구역 핀)는 아래에서 겹침을 풀고 한꺼번에 배치합니다.
        if (key.startsWith('zone:')) {
          pinScreens.push({ element, x: screenX, y: screenY });
          continue;
        }
        element.style.transform = `translate(${screenX}px, ${screenY}px) translate(-50%, -50%)`;
        // 구역 이름은 줌인했거나 그 구역에 마우스를 올렸을 때만 보입니다.
        if (area) element.classList.toggle('is-shown', zoomed || hoveredAreaRef.current === area);
      }
      spreadPins(pinScreens);
      for (const pin of pinScreens) pin.element.style.transform = `translate(${pin.x}px, ${pin.y}px) translate(-50%, -50%)`;

    };
    animate();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      onLeave();
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointermove', onMove);
      controls.dispose();
      disposeTree(scene);
      renderer.dispose();
      canvas.remove();
      unitGroupRef.current = null;
    };
  }, [terminal]);

  const layout = useMemo(() => floorLayout(terminal, floor), [terminal, floor]);

  useEffect(() => {
    const group = unitGroupRef.current;
    if (!group) return;
    group.children.slice().forEach(child => {
      group.remove(child);
      disposeTree(child);
    });
    for (const unit of map.units) {
      const selected = unit.place.facilityId === selectedId;
      const dimmed = activeZone !== null && unit.zoneKey !== activeZone;
      const base = CATEGORY_COLOR[unit.place.category] ?? CATEGORY_COLOR.ETC;
      const color = selected ? SELECTED_COLOR : dimmed ? MUTED_COLOR : base;
      const height = selected ? UNIT_HEIGHT * 3.4 : UNIT_HEIGHT;
      const material = lit(color);
      material.transparent = true;
      material.opacity = !selected && unit.place.isOpen === false ? .5 : 1;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(unit.width, height, UNIT_DEPTH), material);
      mesh.position.set(unit.x, UNIT_BASE + height / 2, unit.z);
      mesh.rotation.y = unit.rotation;
      mesh.userData.unit = unit;
      group.add(mesh);
    }
    const shiftZ = PLANS[terminal].shiftZ;
    const zones = map.zones.map(zone => ({
      key: `zone:${zone.key}`,
      point: new THREE.Vector3(zone.x, UNIT_BASE + .4, zone.z + shiftZ),
    }));
    const labels = layout.labels.map(label => ({
      key: `label:${label.key}`,
      area: label.kind === 'area' ? label.key : undefined,
      point: new THREE.Vector3(label.x, UNIT_BASE + .3, label.z + shiftZ),
    }));
    const picked = map.units.find(unit => unit.place.facilityId === selectedId);
    const marker = picked
      ? [{ key: 'marker', point: new THREE.Vector3(picked.x, UNIT_BASE + UNIT_HEIGHT * 3.4 + 2.2, picked.z + shiftZ) }]
      : [];
    overlaysRef.current = [...zones, ...labels, ...marker];
  }, [map, activeZone, selectedId, terminal, layout]);

  const picked = map.units.find(unit => unit.place.facilityId === selectedId);

  return <div className="airport-scene" ref={hostRef}>
    {failed && <p className="airport-scene__fallback">이 브라우저에서는 3D 지도를 표시할 수 없습니다. 왼쪽 목록을 이용해 주세요.</p>}
    <div className="airport-scene__labels">
      {layout.labels.map(label => <span
        key={label.key}
        className={label.kind === 'hall' ? 'airport-hall' : 'airport-hall airport-tag'}
        ref={element => {
          if (element) overlayRefs.current.set(`label:${label.key}`, element);
          else overlayRefs.current.delete(`label:${label.key}`);
        }}>
        {label.text}
      </span>)}
      {map.zones.filter(zone => !zone.key.startsWith('C:')).map(zone => <button
        type="button"
        key={zone.key}
        ref={element => {
          if (element) overlayRefs.current.set(`zone:${zone.key}`, element);
          else overlayRefs.current.delete(`zone:${zone.key}`);
        }}
        className={`airport-pin${zone.key === activeZone ? ' is-active' : ''}`}
        aria-label={`${zone.label} 시설 ${zone.places.length}곳`}
        onPointerEnter={event => showPinTip(event, `${zone.label} · 시설 ${zone.places.length}곳`)}
        onPointerMove={event => showPinTip(event, `${zone.label} · 시설 ${zone.places.length}곳`)}
        onPointerLeave={hidePinTip}
        onBlur={hidePinTip}
        onClick={() => onPickZone?.(zone.key)}>
        {zone.places.length}
      </button>)}
      {picked && <span
        className="airport-marker"
        ref={element => {
          if (element) overlayRefs.current.set('marker', element);
          else overlayRefs.current.delete('marker');
        }}>
        {picked.place.name}
      </span>}
    </div>
    <div className="airport-scene__tooltip" ref={tooltipRef} hidden />
  </div>;
}
