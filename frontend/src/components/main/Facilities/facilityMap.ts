import type { Facility } from '../../../api/client';

export type Place = Facility & {
  crowdEstimate?: 'LOW' | 'MID' | 'HIGH' | null;
  crowdBasis?: string | null;
};
export type MapTerminal = 'T1' | 'T2';
export type Point = { x: number; z: number };
export type Span = Point & { tangentX: number; tangentZ: number; normalX: number; normalZ: number };
export type Piece =
  | { kind: 'arc'; center: Point; outer: number; inner: number; from: number; to: number }
  | { kind: 'circle'; center: Point; radius: number }
  | { kind: 'bar'; from: Point; to: Point; width: number };
export type MapUnit = {
  place: Place;
  zoneKey: string;
  x: number;
  z: number;
  rotation: number;
  width: number;
};
export type MapZone = Point & { key: string; label: string; places: Place[] };
export type FloorMap = { units: MapUnit[]; zones: MapZone[] };

type Section = {
  name: string;
  first: number;
  last: number;
  points: Point[];
  side: number;
  bucket: number;
  columns: number;
  rows: number;
  pitch: number;
};
type Plan = {
  shiftZ: number;
  viewHalf: number;
  floors: Piece[];
  landside: Piece[];
  sections: Section[];
  halls: Point[];
  counters: Point[];
  desk: Piece;
};

const CENTER: Point = { x: 0, z: 34 };
const COUNTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'N'];
const HALL_COUNTER_INDEX = [1, 3, 5, 7, 9, 11];
const GATE_RE = /(\d+)\s*번?\s*(?:게이트|탑승구|탑승교)/;
const HALL_RE = /(\d+)\s*번\s*출국장/;
const COUNTER_RE = /([A-N])(?:\s*[-~]\s*[A-N])?\s*(?:체크인|카운터)/;
const EXIT_RE = /(\d+)(?:\s*[-~]\s*(\d+))?\s*번\s*출입구/;
const ARRIVAL_HALL_RE = /([AB])\s*입국장/;
const SIDE_RE = /(동편|서편|중앙)/;
const RAIL_RE = /공항철도/;
const TRANSIT_RE = /교통센터/;

/** 지도에 그리는 층입니다. 2F, 5F, 층 정보가 없는 시설은 목록에만 남습니다. */
export const MAP_FLOORS = ['B1', '1F', '3F', '4F'];
export type Side = '서편' | '중앙' | '동편';

/** 'B1', '3F', '지하 1층', '3 층' 같은 표기를 'B1', '3F' 형식으로 맞춥니다. */
export function normalizeFloor(floor: string | null | undefined): string | null {
  const text = (floor ?? '').replace(/\s+/g, '');
  const code = /^(B)?(\d+)F?$/i.exec(text);
  if (code && /[BF]/i.test(text)) return `${code[1] ? 'B' : ''}${code[2]}${code[1] ? '' : 'F'}`;
  const korean = /^(지하)?(\d+)층$/.exec(text);
  if (korean) return korean[1] ? `B${korean[2]}` : `${korean[2]}F`;
  return null;
}

function polar(degree: number, radius: number, center = CENTER): Point {
  const angle = (degree * Math.PI) / 180;
  return { x: center.x + radius * Math.sin(angle), z: center.z - radius * Math.cos(angle) };
}

function arcPoints(from: number, to: number, radius: number) {
  return Array.from({ length: 13 }, (_, index) => polar(from + ((to - from) * index) / 12, radius));
}

const PIER_START = 14;
const pierLeft = { from: polar(-PIER_START, 34), to: { x: -24, z: -22 } };
const pierRight = { from: polar(PIER_START, 34), to: { x: 24, z: -22 } };
const CONCOURSE = { left: { x: -30, z: -52 }, apex: { x: 0, z: -32 }, right: { x: 30, z: -52 } };

/** 공항 안내도의 건물 윤곽과 게이트 순서를 참고해 단순화한 개략도입니다. 측량 좌표가 아닙니다. */
export const PLANS: Record<MapTerminal, Plan> = {
  T1: {
    shiftZ: 12,
    viewHalf: 49,
    floors: [
      { kind: 'arc', center: CENTER, outer: 37, inner: 28, from: -66, to: 66 },
      { kind: 'circle', center: polar(-68, 33), radius: 8 },
      { kind: 'circle', center: polar(68, 33), radius: 8 },
      { kind: 'bar', ...pierLeft, width: 6.4 },
      { kind: 'bar', ...pierRight, width: 6.4 },
      { kind: 'bar', from: CONCOURSE.left, to: CONCOURSE.apex, width: 6.4 },
      { kind: 'bar', from: CONCOURSE.apex, to: CONCOURSE.right, width: 6.4 },
    ],
    landside: [{ kind: 'arc', center: CENTER, outer: 28, inner: 20, from: -52, to: 52 }],
    sections: [
      { name: 'T1', first: 1, last: 10, points: arcPoints(-74, -36, 33), side: 0, bucket: 5, columns: 3, rows: 2, pitch: 2 },
      { name: 'T1', first: 11, last: 19, points: [pierLeft.from, pierLeft.to], side: -1, bucket: 3, columns: 3, rows: 1, pitch: 2.1 },
      { name: 'T1', first: 20, last: 22, points: [pierLeft.to, pierLeft.to], side: 0, bucket: 3, columns: 2, rows: 1, pitch: 1.7 },
      { name: 'T1', first: 23, last: 27, points: [pierLeft.to, pierLeft.from], side: -1, bucket: 3, columns: 3, rows: 1, pitch: 2.1 },
      { name: 'T1', first: 28, last: 33, points: [pierRight.from, pierRight.to], side: 1, bucket: 3, columns: 3, rows: 1, pitch: 2.1 },
      { name: 'T1', first: 34, last: 36, points: [pierRight.to, pierRight.to], side: 0, bucket: 3, columns: 2, rows: 1, pitch: 1.7 },
      { name: 'T1', first: 37, last: 42, points: [pierRight.to, pierRight.from], side: 1, bucket: 3, columns: 3, rows: 1, pitch: 2.1 },
      { name: 'T1', first: 43, last: 50, points: arcPoints(36, 74, 33), side: 0, bucket: 4, columns: 3, rows: 2, pitch: 2 },
      { name: '탑승동', first: 101, last: 116, points: [CONCOURSE.left, CONCOURSE.apex], side: 0, bucket: 4, columns: 3, rows: 2, pitch: 2.1 },
      { name: '탑승동', first: 117, last: 132, points: [CONCOURSE.apex, CONCOURSE.right], side: 0, bucket: 4, columns: 3, rows: 2, pitch: 2.1 },
    ],
    halls: HALL_COUNTER_INDEX.map(index => polar(-46 + (92 * index) / 12, 27.2)),
    counters: COUNTERS.map((_, index) => polar(-46 + (92 * index) / 12, 23.6)),
    desk: { kind: 'arc', center: CENTER, outer: 24.4, inner: 22.8, from: -48, to: 48 },
  },
  T2: {
    shiftZ: 7,
    viewHalf: 41,
    floors: [
      { kind: 'bar', from: { x: -38, z: -30 }, to: { x: -31, z: -8 }, width: 8 },
      { kind: 'bar', from: { x: -31, z: -8 }, to: { x: -16, z: 8 }, width: 8 },
      { kind: 'bar', from: { x: -16, z: 8 }, to: { x: 16, z: 8 }, width: 8 },
      { kind: 'bar', from: { x: 16, z: 8 }, to: { x: 31, z: -8 }, width: 8 },
      { kind: 'bar', from: { x: 31, z: -8 }, to: { x: 38, z: -30 }, width: 8 },
      { kind: 'circle', center: { x: -38, z: -32 }, radius: 8.5 },
      { kind: 'circle', center: { x: 38, z: -32 }, radius: 8.5 },
    ],
    landside: [{ kind: 'bar', from: { x: -20, z: 18 }, to: { x: 20, z: 18 }, width: 12 }],
    sections: [{
      name: 'T2',
      first: 225,
      last: 274,
      points: [{ x: -38, z: -34 }, { x: -38, z: -30 }, { x: -31, z: -8 }, { x: -16, z: 8 }, { x: 16, z: 8 }, { x: 31, z: -8 }, { x: 38, z: -30 }, { x: 38, z: -34 }],
      side: 0,
      bucket: 5,
      columns: 3,
      rows: 2,
      pitch: 2.2,
    }],
    halls: [{ x: -9, z: 14.6 }, { x: 9, z: 14.6 }],
    counters: COUNTERS.map((_, index) => ({ x: -18 + (36 * index) / 12, z: 20 })),
    desk: { kind: 'bar', from: { x: -19, z: 20 }, to: { x: 19, z: 20 }, width: 1.4 },
  },
};

function along(points: Point[], ratio: number): Span {
  const lengths = points.slice(1).map((point, index) => Math.hypot(point.x - points[index].x, point.z - points[index].z));
  const total = lengths.reduce((sum, value) => sum + value, 0);
  let remaining = Math.max(0, Math.min(1, ratio)) * total;
  for (let index = 0; index < lengths.length; index += 1) {
    if (remaining <= lengths[index] || index === lengths.length - 1) {
      const length = lengths[index] || 1;
      const start = points[index];
      const end = points[index + 1];
      const part = lengths[index] ? remaining / length : 0;
      const tangentX = lengths[index] ? (end.x - start.x) / length : 1;
      const tangentZ = lengths[index] ? (end.z - start.z) / length : 0;
      return {
        x: start.x + (end.x - start.x) * part,
        z: start.z + (end.z - start.z) * part,
        tangentX,
        tangentZ,
        normalX: tangentZ,
        normalZ: -tangentX,
      };
    }
    remaining -= lengths[index];
  }
  return { ...points[0], tangentX: 1, tangentZ: 0, normalX: 0, normalZ: -1 };
}

export function gateSpots(terminal: MapTerminal, step: number) {
  return PLANS[terminal].sections
    .filter(section => section.points.length > 2 || section.points[0] !== section.points[1])
    .flatMap(section => {
      const count = Math.max(2, Math.round((section.last - section.first + 1) / step));
      return Array.from({ length: count }, (_, index) => along(section.points, (index + .5) / count));
    });
}

const SIDES: Side[] = ['서편', '중앙', '동편'];
const T1_SIDE_ANGLE = {
  ground: { 서편: -30, 중앙: 0, 동편: 30 } as Record<Side, number>,
  deck: { 서편: -26, 중앙: 0, 동편: 26 } as Record<Side, number>,
};
const T2_SIDE_X = { ground: { 서편: -17, 중앙: 0, 동편: 17 } as Record<Side, number>, deck: { 서편: -15, 중앙: 0, 동편: 15 } as Record<Side, number> };
const PLATE = 7;
const isGround = (floor: string) => floor === 'B1' || floor === '1F';
const isDeck = (floor: string) => floor === '3F' || floor === '4F';
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/** 아래 위치는 모두 건물 윤곽 안쪽의 개략 위치입니다. 실제 좌표가 아닙니다. */
function sideAnchor(terminal: MapTerminal, floor: string, side: Side): Point {
  const kind = isGround(floor) ? 'ground' : 'deck';
  if (terminal === 'T1') return polar(T1_SIDE_ANGLE[kind][side], 32.5);
  return { x: T2_SIDE_X[kind][side], z: floor === '1F' ? 19.5 : 14 };
}

function exitAnchor(terminal: MapTerminal, exit: number): Point {
  if (terminal === 'T1') return polar(-50 + 100 * clamp01((exit - 1) / 13), 22);
  return { x: -20 + 40 * clamp01((exit - 1) / 7), z: 12.8 };
}

function arrivalAnchor(terminal: MapTerminal, hall: 'A' | 'B'): Point {
  if (terminal === 'T1') return polar(hall === 'A' ? -14 : 14, 32.5);
  return { x: hall === 'A' ? -8.5 : 8.5, z: 19.5 };
}

function transitAnchor(terminal: MapTerminal, kind: 'RAIL' | 'TRANS'): Point {
  if (terminal === 'T1') return polar(kind === 'RAIL' ? -11 : 11, 25);
  return { x: kind === 'RAIL' ? -8.5 : 8.5, z: 20 };
}

export type Patch = { key: string; piece: Piece; color: number };
export type FloorLabel = Point & { key: string; text: string; kind: 'hall' | 'area' };
export type FloorLayout = { patches: Patch[]; labels: FloorLabel[]; gates: boolean; halls: boolean };

/** 층마다 다르게 그리는 구역 판과 짧은 라벨입니다. 구역 판은 모두 건물 윤곽 안쪽에 둡니다. */
export function floorLayout(terminal: MapTerminal, floor: string): FloorLayout {
  const plan = PLANS[terminal];
  const patches: Patch[] = [];
  const labels: FloorLabel[] = [];
  const zone = (key: string, text: string, center: Point, color: number) => {
    patches.push({ key, color, piece: { kind: 'bar', from: { x: center.x - .4, z: center.z + 1.4 }, to: { x: center.x + .4, z: center.z + 1.4 }, width: PLATE } });
    labels.push({ key, text, kind: 'area', x: center.x, z: center.z - 1.2 });
  };

  for (const side of SIDES) zone(`side:${side}`, side, sideAnchor(terminal, floor, side), 0xdbe8f6);
  if (floor === 'B1') {
    zone('rail', '공항철도', transitAnchor(terminal, 'RAIL'), 0xc3efdc);
    zone('trans', '교통센터', transitAnchor(terminal, 'TRANS'), 0xffdcc0);
  }
  if (floor === '1F') {
    zone('arrival:A', '입국장 A', arrivalAnchor(terminal, 'A'), 0xe1d8fb);
    zone('arrival:B', '입국장 B', arrivalAnchor(terminal, 'B'), 0xe1d8fb);
    const exits = terminal === 'T1' ? 14 : 8;
    for (let exit = 1; exit <= exits; exit += 1) {
      const point = exitAnchor(terminal, exit);
      labels.push({ key: `exit:${exit}`, text: String(exit), kind: 'area', x: point.x, z: point.z - 1.2 });
    }
  }
  if (floor === '3F') {
    plan.halls.forEach((hall, index) => labels.push({ key: `hall:${index + 1}`, text: `${index + 1}번`, kind: 'hall', x: hall.x, z: hall.z - 3 }));
  }
  return { patches, labels, gates: isDeck(floor), halls: floor === '3F' };
}

function stableOrder(places: Place[]) {
  return [...places].sort((a, b) => a.facilityId.localeCompare(b.facilityId, undefined, { numeric: true }));
}

/** 칸 배치는 시설 번호로 고정합니다. 선택한 시설이 칸 밖이면 마지막 칸에만 대신 보여줍니다. */
function slotted(places: Place[], capacity: number, selectedId: string | null) {
  const slots = stableOrder(places).slice(0, capacity);
  const selected = places.find(place => place.facilityId === selectedId);
  if (selected && !slots.includes(selected)) slots[slots.length - 1] = selected;
  return slots;
}

/** 위치 문장에서 구역을 찾은 시설만 도면에 넣습니다. 나머지는 목록에만 남습니다. */
export function buildFloorMap(
  places: Place[],
  terminal: MapTerminal,
  floor: string,
  selectedId: string | null,
): FloorMap {
  const plan = PLANS[terminal];
  const groups = new Map<string, { label: string; places: Place[]; build: (slots: Place[], key: string) => MapUnit[]; capacity: number; pin: Point }>();

  const put = (
    key: string,
    label: string,
    place: Place,
    pin: Point,
    capacity: number,
    build: (slots: Place[], key: string) => MapUnit[],
  ) => {
    const group = groups.get(key) ?? { label, places: [], build, capacity, pin };
    group.places.push(place);
    groups.set(key, group);
  };

  const rowUnits = (center: Point, columns: number, slots: Place[], key: string) => slots.map((place, index) => ({
    place,
    zoneKey: key,
    x: center.x + (index % columns - (columns - 1) / 2) * 1.9,
    z: center.z + Math.floor(index / columns) * 1.9,
    rotation: 0,
    width: 1.6,
  }));

  const ground = isGround(floor);
  const deck = isDeck(floor);

  for (const place of places) {
    if (place.terminal !== terminal || normalizeFloor(place.floor) !== floor) continue;
    // 입국장 시설은 B1·1F에서만 지도에 올립니다. 3F·4F는 출발 시설 중심입니다.
    if (place.area === 'ARRIVAL' && !ground) continue;
    const text = place.location;

    if (deck) {
      const gateNumber = Number(GATE_RE.exec(text)?.[1] ?? NaN);
      const hall = Number(HALL_RE.exec(text)?.[1] ?? NaN);
      const counter = COUNTER_RE.exec(text)?.[1];
      const gate = terminal === 'T2' && gateNumber >= 201 && gateNumber < 225 ? 225 : gateNumber;
      const section = plan.sections.find(item => gate >= item.first && gate <= item.last);

      if (section) {
        const bucket = Math.floor((gate - section.first) / section.bucket);
        const start = section.first + bucket * section.bucket;
        const end = Math.min(section.last, start + section.bucket - 1);
        const span = along(section.points, ((start + end) / 2 - section.first + .5) / (section.last - section.first + 1));
        const side = section.side * 1.65;
        const pin = { x: span.x + span.normalX * (side + (section.rows > 1 ? 3.4 : 2.6)), z: span.z + span.normalZ * (side + (section.rows > 1 ? 3.4 : 2.6)) };
        put(`G:${section.first}:${bucket}`, `${section.name} ${start}~${end}번 게이트`, place, pin, section.columns * section.rows, (slots, key) => slots.map((item, index) => {
          const along_ = (index % section.columns - (section.columns - 1) / 2) * section.pitch;
          const across = section.rows > 1 ? (Math.floor(index / section.columns) ? -1.25 : 1.25) : 0;
          return {
            place: item,
            zoneKey: key,
            x: span.x + span.tangentX * along_ + span.normalX * (side + across),
            z: span.z + span.tangentZ * along_ + span.normalZ * (side + across),
            rotation: -Math.atan2(span.tangentZ, span.tangentX),
            width: section.pitch * .84,
          };
        }));
        continue;
      }
      if (floor === '3F' && hall >= 1 && hall <= plan.halls.length) {
        const center = plan.halls[hall - 1];
        put(`H:${hall}`, `${hall}번 출국장`, place, { x: center.x, z: center.z + 2.8 }, 3, (slots, key) => rowUnits(center, 3, slots, key));
        continue;
      }
      if (floor === '3F' && counter) {
        const center = plan.counters[COUNTERS.indexOf(counter)];
        put(`C:${counter}`, `${counter} 체크인 카운터`, place, { x: center.x, z: center.z + 2.6 }, 2, (slots, key) => rowUnits(center, 2, slots, key));
        continue;
      }
    }

    const area = (key: string, label: string, center: Point) => put(key, label, place, { x: center.x, z: center.z + 4.6 }, 6, (slots, unitKey) => rowUnits(center, 3, slots, unitKey));

    if (floor === 'B1' && RAIL_RE.test(text)) {
      area('T:RAIL', '공항철도', transitAnchor(terminal, 'RAIL'));
      continue;
    }
    if (floor === '1F') {
      const hall = ARRIVAL_HALL_RE.exec(text)?.[1] as 'A' | 'B' | undefined;
      if (hall) {
        area(`R:${hall}`, `${hall} 입국장`, arrivalAnchor(terminal, hall));
        continue;
      }
      const exit = EXIT_RE.exec(text);
      if (exit) {
        const number = Number(exit[1]);
        area(`X:${number}`, `${number}번 출입구`, exitAnchor(terminal, number));
        continue;
      }
    }
    const side = SIDE_RE.exec(text)?.[1] as Side | undefined;
    if (side) {
      area(`S:${side}`, `${side} 구역`, sideAnchor(terminal, floor, side));
      continue;
    }
    if (floor === 'B1' && TRANSIT_RE.test(text)) area('T:TRANS', '교통센터', transitAnchor(terminal, 'TRANS'));
  }

  const units: MapUnit[] = [];
  const zones: MapZone[] = [];
  for (const [key, group] of groups) {
    units.push(...group.build(slotted(group.places, group.capacity, selectedId), key));
    zones.push({ key, label: group.label, places: group.places, ...group.pin });
  }
  return { units, zones };
}
