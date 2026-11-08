import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { floorLayout, gateSpots, MAP_FLOORS, PLANS } from './facilityMap';
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

// ── 에이프런 비주얼 조절용 상수 (색은 헤더 남색 #0b1f45, 노랑 #ffc726 톤과 맞춤) ──
const GROUND_COLOR = 0xaebccd;        // 아스팔트 톤 바닥
const GROUND_RADIUS = 80;             // 바닥 반지름
const GROUND_FADE_START = .5;         // 이 비율 바깥부터 배경색으로 페이드
const DOT_COLOR = '#2a4a7a';          // 점 격자 색
const DOT_OPACITY = .26;              // 점 격자 진하기 (0이면 없음)
const DOT_STEP = 6;                   // 점 간격
const SLAB_COLOR = 0x8ea6c3;          // 층판 옆면
const OUTLINE_COLOR = 0x14305e;       // 건물 외곽선(남색)
const OUTLINE_WIDTH = 1.6;            // 외곽선 두께(px)
const OUTLINE_OPACITY = .85;
const SHADOW_COLOR = 0x0b1f45;        // 컨택트 섀도
const SHADOW_OPACITY = .14;           // 그림자 가장 진한 곳
const SHADOW_OFFSET = { x: 1.8, z: -1.4 };
const SHADOW_LAYERS = [{ grow: .5, weight: 1 }, { grow: 1.8, weight: .55 }, { grow: 3.4, weight: .3 }];
const AIRCRAFT_COLOR = 0x0b2a63;      // 지상 비행기 실루엣
const AIRCRAFT_OPACITY = .38;
const AIRCRAFT_SCALE = 1.6;
const TAXI_COLOR = 0xffc726;          // 노란 유도로 선
const TAXI_OPACITY = .95;
const TAXI_DISTANCE = 9.5;            // 게이트에서 유도로까지 거리
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

/** 지상 비행기 실루엣: 납작한 단색 도형입니다. */
function airplane() {
  const shape = new THREE.Shape();
  [[0, 1.5], [.12, .55], [1.05, -.1], [1.05, -.3], [.12, -.1], [.09, -.9], [.38, -1.2], [.38, -1.32], [0, -1.2],
    [-.38, -1.32], [-.38, -1.2], [-.09, -.9], [-.12, -.1], [-1.05, -.3], [-1.05, -.1], [-.12, .55]]
    .forEach(([x, y], index) => (index ? shape.lineTo(x, y) : shape.moveTo(x, y)));
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshBasicMaterial({
    color: AIRCRAFT_COLOR, transparent: true, opacity: AIRCRAFT_OPACITY, depthWrite: false, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.scale.setScalar(AIRCRAFT_SCALE);
  mesh.renderOrder = 1;
  return mesh;
}

/** 두 점 사이를 잇는 낮은 막대(복도·칸막이)입니다. */
function strip(from: { x: number; z: number }, to: { x: number; z: number }, width: number, height: number, material: THREE.Material, y: number) {
  const length = Math.hypot(to.x - from.x, to.z - from.z) || .01;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(length, height, width), material);
  mesh.position.set((from.x + to.x) / 2, y + height / 2, (from.z + to.z) / 2);
  mesh.rotation.y = -Math.atan2(to.z - from.z, to.x - from.x);
  return mesh;
}

/** 가운데는 보이고 가장자리로 갈수록 투명해지는 원형 알파 맵입니다. */
function radialAlphaMap() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d')!;
  const gradient = context.createRadialGradient(128, 128, 0, 128, 128, 128);
  gradient.addColorStop(0, '#fff');
  gradient.addColorStop(GROUND_FADE_START, '#fff');
  gradient.addColorStop(1, '#000');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(canvas);
}

function dotTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d')!;
  context.fillStyle = DOT_COLOR;
  context.beginPath();
  context.arc(32, 32, 3.2, 0, Math.PI * 2);
  context.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set((GROUND_RADIUS * 2) / DOT_STEP, (GROUND_RADIUS * 2) / DOT_STEP);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** 바닥(아스팔트 톤, 가장자리 페이드), 점 격자, 건물 컨택트 섀도, 노란 유도로 선. */
function addGround(world: THREE.Group, terminal: MapTerminal) {
  const alphaMap = radialAlphaMap();
  const plane = (y: number, material: THREE.Material, order: number) => {
    const geometry = new THREE.PlaneGeometry(GROUND_RADIUS * 2, GROUND_RADIUS * 2);
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = y;
    mesh.renderOrder = order;
    world.add(mesh);
  };
  plane(-1.05, new THREE.MeshBasicMaterial({ color: GROUND_COLOR, alphaMap, transparent: true, depthWrite: false }), -4);
  if (DOT_OPACITY > 0) {
    plane(-1.04, new THREE.MeshBasicMaterial({ map: dotTexture(), alphaMap, transparent: true, opacity: DOT_OPACITY, depthWrite: false }), -3);
  }

  // 컨택트 섀도: 건물 윤곽을 키운 반투명 판을 겹쳐 부드러운 가장자리를 만듭니다(실시간 shadow map 없음).
  const plan = PLANS[terminal];
  for (const piece of [...plan.floors, ...plan.landside]) {
    for (const layer of SHADOW_LAYERS) {
      const material = new THREE.MeshBasicMaterial({
        color: SHADOW_COLOR, transparent: true, opacity: SHADOW_OPACITY * layer.weight * .6, depthWrite: false,
      });
      const shadow = pieceMesh(piece, layer.grow, .01, material, -1.03);
      shadow.position.x += SHADOW_OFFSET.x;
      shadow.position.z += SHADOW_OFFSET.z;
      shadow.renderOrder = -2;
      world.add(shadow);
    }
  }

  // 노란 점선 유도로: 게이트 앞 계류장을 따라 이어지는 선입니다.
  const spots = gateSpots(terminal, 3);
  const runs: THREE.Vector3[][] = [];
  spots.forEach((spot, index) => {
    const point = new THREE.Vector3(spot.x + spot.normalX * TAXI_DISTANCE, -.98, spot.z + spot.normalZ * TAXI_DISTANCE);
    const last = runs[runs.length - 1];
    const before = spots[index - 1];
    if (last && before && Math.hypot(spot.x - before.x, spot.z - before.z) < 12) last.push(point);
    else runs.push([point]);
  });
  const taxiMaterial = new THREE.LineDashedMaterial({
    color: TAXI_COLOR, dashSize: 1.2, gapSize: .9, transparent: true, opacity: TAXI_OPACITY, depthWrite: false,
  });
  for (const run of runs) {
    if (run.length < 2) continue;
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(run), taxiMaterial);
    line.computeLineDistances();
    line.renderOrder = -1;
    world.add(line);
  }
}

/** 항공기는 지상(계류장)에 둡니다. */
function addApron(world: THREE.Group, terminal: MapTerminal) {
  for (const spot of gateSpots(terminal, 3)) {
    const distance = terminal === 'T1' ? 6.4 : 7.4;
    const plane = airplane();
    plane.position.set(spot.x + spot.normalX * distance, -.9, spot.z + spot.normalZ * distance);
    plane.rotation.y = Math.atan2(spot.normalX, -spot.normalZ) * -1;
    world.add(plane);
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
          material.opacity = (material.userData.base as number) * rig.alpha;
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
      for (const { key, point, area } of overlaysRef.current) {
        const element = overlayRefs.current.get(key);
        if (!element) continue;
        projected.set(point.x, point.y + units.position.y, point.z).project(camera);
        element.style.transform = `translate(${((projected.x + 1) / 2) * host.clientWidth}px, ${((1 - projected.y) / 2) * host.clientHeight}px) translate(-50%, -50%)`;
        // 구역 이름은 줌인했거나 그 구역에 마우스를 올렸을 때만 보입니다.
        if (area) element.classList.toggle('is-shown', zoomed || hoveredAreaRef.current === area);
      }
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
        title={zone.label}
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
