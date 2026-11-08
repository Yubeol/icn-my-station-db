import { useEffect, useRef, useState } from 'react';
import { HALL_CHECK_HINT, HALL_CHECK_LABEL } from './hallStatus';

export type LiveHall = {
  id: number;
  name: string;
  count: number;
  level: string;
  checking: boolean;
};

type Terminal = 'T1' | 'T2';
type Props = {
  terminal: Terminal;
  halls: LiveHall[];
  selectedId: number | null;
  onSelect: (id: number) => void;
};

const WIDTH = 1000;
const DEFAULT_HEIGHT = 760;
const MIN_HEIGHT = 560;
const MAX_HEIGHT = 900;
const FAN = .42;
const ROWS = 4;
const WALL_FLOOR = 300;
const PEOPLE_PER_FIGURE: Record<Terminal, number> = { T1: 25, T2: 100 };
const MAX_FIGURES = 20;
const PER_ROW = 5;
const LEVEL_COLOR: Record<string, string> = { LOW: '#4fe0ae', MID: '#ffcb5c', HIGH: '#ff7566', CHECK: '#9db0c6' };
const LEVEL_TEXT: Record<string, string> = { LOW: '여유', MID: '보통', HIGH: '혼잡', CHECK: '미운영 가능' };

function range(count: number) {
  return Array.from({ length: count }, (_, index) => index);
}

/** 앞으로 올수록 넓어지는 원근 계수입니다. */
function perspective(y: number, height: number) {
  return 1 + ((y - WALL_FLOOR) / (height - WALL_FLOOR)) * FAN;
}

function gateAt(index: number, total: number) {
  const step = total <= 2 ? 330 : Math.min(156, 930 / total);
  const x = WIDTH / 2 + (index - (total - 1) / 2) * step;
  return { x, width: total <= 2 ? 210 : 132, height: total <= 2 ? 158 : 138 };
}

function HallGate({ hall, index, total, terminal, height, selected, onSelect }: {
  hall: LiveHall;
  height: number;
  index: number;
  total: number;
  terminal: Terminal;
  selected: boolean;
  onSelect: (id: number) => void;
}) {
  const gate = gateAt(index, total);
  const level = hall.checking ? 'CHECK' : hall.level;
  const color = LEVEL_COLOR[level] ?? LEVEL_COLOR.CHECK;
  const top = WALL_FLOOR - gate.height;
  const rowGap = (height - WALL_FLOOR - 60) / ROWS;
  const header = 42;
  const half = gate.width / 2;
  const toFloorX = (x: number, y: number) => WIDTH / 2 + (x - WIDTH / 2) * perspective(y, height);
  const left = gate.x - half + 10;
  const right = gate.x + half - 10;
  const lanePath = `M${left} ${WALL_FLOOR} L${right} ${WALL_FLOOR} L${toFloorX(right, height)} ${height} L${toFloorX(left, height)} ${height} Z`;
  const figures = hall.checking ? 0 : Math.min(MAX_FIGURES, Math.ceil(hall.count / PEOPLE_PER_FIGURE[terminal]));

  return <g
    className={`cong-hall${selected ? ' is-selected' : ''}${level === 'HIGH' ? ' is-high' : ''}`}
    role="button"
    tabIndex={0}
    aria-label={`${hall.name} ${hall.checking ? `${HALL_CHECK_LABEL}. ${HALL_CHECK_HINT}` : `${hall.count}명 ${LEVEL_TEXT[level]}`}`}
    aria-pressed={selected}
    onClick={() => onSelect(hall.id)}
    onKeyDown={event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onSelect(hall.id);
      }
    }}>
    <path d={lanePath} fill={`url(#cong-lane-${level})`} className="cong-hall__lane" />

    <rect x={gate.x - half} y={top} width={gate.width} height={gate.height} rx="6" className="cong-hall__body" />
    <rect x={left} y={top + header} width={right - left} height={gate.height - header} fill={`url(#cong-door-${level})`} className="cong-hall__door" />
    <line x1={gate.x} y1={top + header} x2={gate.x} y2={WALL_FLOOR} className="cong-hall__seam" />
    <rect x={gate.x - half} y={top + header - 2} width={gate.width} height="2.5" fill={color} />
    <text x={gate.x - half + 13} y={top + 28} className="cong-hall__no">{hall.id}번</text>
    <text x={gate.x + half - 13} y={top + 28} className={`cong-hall__count${hall.checking ? ' is-check' : ''}`}>{hall.checking ? <><title>{HALL_CHECK_HINT}</title>{HALL_CHECK_LABEL}</> : `${hall.count.toLocaleString()}명`}</text>

    {range(figures).map(order => {
      const row = Math.floor(order / PER_ROW);
      const slot = row % 2 === 0 ? order % PER_ROW : PER_ROW - 1 - (order % PER_ROW);
      const y = WALL_FLOOR + 38 + row * rowGap;
      const x = toFloorX(left + ((slot + .5) / PER_ROW) * (right - left), y);
      const size = perspective(y, height) * (total <= 2 ? 1.1 : .9);
      return <g key={order} transform={`translate(${x} ${y}) scale(${size})`}>
        <ellipse rx="7" ry="2" fill="rgba(0, 8, 24, .45)" />
        <path d="M-4.6 0 Q-5.6 -13 -5 -18 Q-4.4 -23 0 -23 Q4.4 -23 5 -18 Q5.6 -13 4.6 0 Z" fill={color} opacity=".92" />
        <circle cy="-27.5" r="3.9" fill="#eef5fc" />
      </g>;
    })}
  </g>;
}

/** 해 질 무렵 출국장 입구 앞 대기 공간을 실내에서 바라본 장면입니다. */
export default function CongestionLiveMap({ terminal, halls, selectedId, onSelect }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);

  // 패널 비율에 맞춰 바닥 깊이를 바꿔 양쪽 출국장이 잘리지 않게 합니다.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => {
      if (!host.clientWidth || !host.clientHeight) return;
      const next = Math.round((WIDTH * host.clientHeight) / host.clientWidth);
      setHeight(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, next)));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    measure();
    return () => observer.disconnect();
  }, []);

  return <div className="cong-map" ref={hostRef}>
    <svg className="cong-map__scene" viewBox={`0 0 ${WIDTH} ${height}`} preserveAspectRatio="xMidYMid slice" role="img" aria-label={`${terminal} 출국장 입구 앞 대기 모습`}>
      <defs>
        <linearGradient id="cong-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#14335d" />
          <stop offset="62%" stopColor="#3f6a9c" />
          <stop offset="88%" stopColor="#e8ad84" />
          <stop offset="100%" stopColor="#f7d4a8" />
        </linearGradient>
        <linearGradient id="cong-floor" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#274a73" />
          <stop offset="30%" stopColor="#14325a" />
          <stop offset="100%" stopColor="#0a2243" />
        </linearGradient>
        <linearGradient id="cong-ceiling" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#081c38" />
          <stop offset="100%" stopColor="#123258" />
        </linearGradient>
        <linearGradient id="cong-reflect" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f3c9a0" stopOpacity=".34" />
          <stop offset="100%" stopColor="#f3c9a0" stopOpacity="0" />
        </linearGradient>
        <filter id="cong-blur" x="-20%" y="-200%" width="140%" height="500%"><feGaussianBlur stdDeviation="5" /></filter>
        {Object.entries(LEVEL_COLOR).map(([level, color]) => <g key={level}>
          <linearGradient id={`cong-lane-${level}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity=".3" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`cong-door-${level}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity=".14" />
            <stop offset="100%" stopColor={color} stopOpacity=".62" />
          </linearGradient>
        </g>)}
      </defs>

      {/* 창밖 */}
      <rect width={WIDTH} height={WALL_FLOOR} fill="url(#cong-sky)" />
      <path d="M0 262 L120 256 L300 261 L470 254 L640 260 L820 255 L1000 261 V300 H0 Z" fill="#203c5f" opacity=".75" />
      {range(26).map(item => <circle key={item} cx={20 + item * 39} cy={280 + (item % 3) * 2} r="1.3" fill="#ffe7b0" opacity=".85" />)}
      <path d="M716 160 l58 -9 l15 -13 l7 1 l-7 12 l40 -7 q10 -1 11 3 q0 4 -10 6 l-40 8 l9 14 l-6 1 l-20 -13 l-54 6 q-5 0 -3 -9 z" fill="#0d2748" opacity=".55" />

      {/* 유리벽 */}
      {range(21).map(item => <line key={item} x1={item * 50} y1="70" x2={item * 50} y2={WALL_FLOOR} className="cong-map__mullion" />)}
      <line x1="0" y1="150" x2={WIDTH} y2="150" className="cong-map__mullion" />

      {/* 곡선 천장 */}
      <path d={`M0 0 H${WIDTH} V94 Q500 52 0 94 Z`} fill="url(#cong-ceiling)" />
      {[-.8, -.5, -.2, .2, .5, .8].map(item => <line key={item} x1={500 + item * 640} y1="0" x2={500 + item * 520} y2={78 - Math.abs(item) * -12} className="cong-map__rib" />)}
      <path d="M0 62 Q500 22 1000 62" className="cong-map__glow" filter="url(#cong-blur)" />
      <path d="M0 62 Q500 22 1000 62" className="cong-map__strip" />

      {/* 윤이 나는 바닥 */}
      <rect y={WALL_FLOOR} width={WIDTH} height={height - WALL_FLOOR} fill="url(#cong-floor)" />
      <rect y={WALL_FLOOR} width={WIDTH} height="150" fill="url(#cong-reflect)" />
      {[-1, -.75, -.5, -.25, 0, .25, .5, .75, 1].map(item => <line key={item} x1={500 + item * 500} y1={WALL_FLOOR} x2={500 + item * 760} y2={height} className="cong-map__tile" />)}
      {[338, 396, 482, 590, 720, 870].map(y => <line key={y} x1="0" y1={y} x2={WIDTH} y2={y} className="cong-map__tile" />)}

      {halls.map((hall, index) => <HallGate
        key={hall.id}
        hall={hall}
        index={index}
        total={halls.length}
        terminal={terminal}
        height={height}
        selected={hall.id === selectedId}
        onSelect={onSelect}
      />)}
    </svg>
    <p className="cong-map__note">그림으로 표현한 장면입니다 · 사람 1명 ≈ {PEOPLE_PER_FIGURE[terminal]}명</p>
  </div>;
}