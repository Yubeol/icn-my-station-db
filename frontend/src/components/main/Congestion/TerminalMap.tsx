import { useEffect, useMemo, useState } from 'react';
import type { Hall, Terminal } from '../../../api/congestion';
import AnimatedNumber from '../../layout/AnimatedNumber';
import { getHallLevel, getLevelLabel } from './HallCard';
import { isMainHallChecking } from './hallStatus';
import './TerminalScene.css';

type Props = {
  terminal: Terminal;
  halls: Hall[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

type Layout = {
  cx: number;
  cy: number;
  radius: number;
  buildingSpan: number;
  hallSpan: number;
  planes: number;
};

const VIEW_WIDTH = 1000;
const VIEW_HEIGHT = 800;
const BAND = 62;
const ROAD_OFFSET = 196;
const FLOW_DOTS = { relaxed: 2, normal: 4, busy: 7, unknown: 0 };
const FLOW_SECONDS = { relaxed: 3.4, normal: 2.6, busy: 1.8, unknown: 3 };

// 실제 축척이 아니라 터미널 형태를 단순화한 개략도입니다.
const LAYOUTS: Record<Terminal, Layout> = {
  T1: { cx: 500, cy: 1010, radius: 770, buildingSpan: 50, hallSpan: 40, planes: 13 },
  T2: { cx: 500, cy: 945, radius: 700, buildingSpan: 42, hallSpan: 15, planes: 11 },
};

function polar(layout: Layout, degree: number, radius: number) {
  const angle = (degree * Math.PI) / 180;
  return {
    x: layout.cx + radius * Math.sin(angle),
    y: layout.cy - radius * Math.cos(angle),
  };
}

function arcPath(layout: Layout, radius: number, span: number) {
  const start = polar(layout, -span, radius);
  const end = polar(layout, span, radius);
  return `M${start.x} ${start.y}A${radius} ${radius} 0 0 1 ${end.x} ${end.y}`;
}

function bandPath(layout: Layout, inner: number, outer: number, span: number) {
  const a = polar(layout, -span, outer);
  const b = polar(layout, span, outer);
  const c = polar(layout, span, inner);
  const d = polar(layout, -span, inner);
  return `M${a.x} ${a.y}A${outer} ${outer} 0 0 1 ${b.x} ${b.y}L${c.x} ${c.y}A${inner} ${inner} 0 0 0 ${d.x} ${d.y}Z`;
}

function spread(count: number, span: number) {
  if (count <= 1) return [0];
  return Array.from({ length: count }, (_, index) => -span + (index * span * 2) / (count - 1));
}

function usePrefersMotion() {
  const [enabled, setEnabled] = useState(true);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setEnabled(!query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return enabled;
}

function Airplane({ x, y, degree }: { x: number; y: number; degree: number }) {
  return <path
    className="terminal-scene__plane"
    transform={`translate(${x} ${y}) rotate(${degree}) scale(1.35)`}
    d="M0-24c2 0 3 2 3 5v9l15 9v4L3-1v11l5 4v3l-8-2-8 2v-3l5-4V-1L-18 5V1l15-9v-9c0-3 1-5 3-5z" />;
}

export default function TerminalMap({ terminal, halls, selectedId, onSelect }: Props) {
  const layout = LAYOUTS[terminal];
  const motion = usePrefersMotion();
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const placed = useMemo(() => {
    const angles = spread(halls.length, layout.hallSpan);
    return halls.map((hall, index) => ({ hall, degree: angles[index] }));
  }, [halls, layout.hallSpan]);

  const planes = useMemo(() => spread(layout.planes, layout.buildingSpan - 2), [layout]);

  const operating = halls.filter(hall => !isMainHallChecking(hall));
  const total = operating.reduce((sum, hall) => sum + (hall.currentCount ?? 0), 0);
  const busiest = operating.reduce<Hall | null>(
    (top, hall) => ((hall.currentCount ?? -1) > (top?.currentCount ?? -1) ? hall : top),
    null,
  );
  const focused = halls.find(hall => hall.id === (hoveredId ?? selectedId)) ?? busiest;
  const focusedChecking = focused ? isMainHallChecking(focused) : false;
  const focusedLevel = focused && !focusedChecking ? getHallLevel(focused) : 'unknown';
  const inner = layout.radius - BAND;

  return <div className="terminal-scene" data-terminal={terminal}>
    <svg
      className="terminal-scene__svg"
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      preserveAspectRatio="xMidYMid meet"
      role="group"
      aria-label={`${terminal} 출국장 혼잡 개략도`}>
      <defs>
        <linearGradient id="scene-terminal" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a5d97" />
          <stop offset="1" stopColor="#123a68" />
        </linearGradient>
        <filter id="scene-glow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="9" />
        </filter>
      </defs>

      {/* 활주로와 유도로 */}
      <g className="terminal-scene__runway">
        <path d={arcPath(layout, layout.radius + 150, 62)} />
        <path className="is-dashed" d={arcPath(layout, layout.radius + 150, 62)} />
      </g>
      <path className="terminal-scene__taxi" d={arcPath(layout, layout.radius + 66, 60)} />

      {/* 탑승교와 주기 항공기 */}
      {planes.map((degree, index) => {
        const gate = polar(layout, degree, layout.radius + 8);
        const plane = polar(layout, degree, layout.radius + 42);
        return <g key={index}>
          <line className="terminal-scene__bridge" x1={gate.x} y1={gate.y} x2={plane.x} y2={plane.y} />
          <Airplane x={plane.x} y={plane.y} degree={degree} />
        </g>;
      })}

      {/* 터미널 건물 */}
      <path className="terminal-scene__building" d={bandPath(layout, inner, layout.radius, layout.buildingSpan)} fill="url(#scene-terminal)" />
      <path className="terminal-scene__roofline" d={arcPath(layout, layout.radius - BAND / 2, layout.buildingSpan - 1)} />

      {/* 공항 진입 도로 */}
      <path className="terminal-scene__road" d={arcPath(layout, layout.radius - ROAD_OFFSET, 56)} />
      <path className="terminal-scene__road-line" d={arcPath(layout, layout.radius - ROAD_OFFSET, 56)} />

      {/* 출국장 */}
      {placed.map(({ hall, degree }) => {
        const level = getHallLevel(hall);
        const checking = isMainHallChecking(hall);
        const tone = checking ? 'unknown' : level;
        const portal = polar(layout, degree, inner + 10);
        const road = polar(layout, degree, layout.radius - ROAD_OFFSET + 8);
        const label = polar(layout, degree, inner - 92);
        const flowPath = `M${road.x} ${road.y}L${portal.x} ${portal.y}`;
        const dots = checking ? 0 : FLOW_DOTS[level];
        const seconds = FLOW_SECONDS[level];
        const active = hall.id === (hoveredId ?? selectedId);

        return <g
          key={hall.id}
          className={`terminal-scene__hall is-${tone}${active ? ' is-active' : ''}`}
          role="button"
          tabIndex={0}
          aria-pressed={active}
          aria-label={`${hall.name} ${checking ? '운영 확인' : `${hall.currentCount ?? 0}명 ${getLevelLabel(hall)}`}`}
          onClick={() => onSelect(hall.id)}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onSelect(hall.id);
            }
          }}
          onMouseEnter={() => setHoveredId(hall.id)}
          onMouseLeave={() => setHoveredId(null)}>
          <path className="terminal-scene__lane" d={flowPath} />
          {motion && Array.from({ length: dots }, (_, index) => (
            <circle className="terminal-scene__person" r="5" key={index}>
              <animateMotion
                dur={`${seconds}s`}
                begin={`${(index * seconds) / dots}s`}
                repeatCount="indefinite"
                path={flowPath} />
            </circle>
          ))}

          <g transform={`translate(${portal.x} ${portal.y}) rotate(${degree})`}>
            <rect className="terminal-scene__aura" x="-46" y="-36" width="92" height="72" rx="24" filter="url(#scene-glow)" />
            <rect className="terminal-scene__gate" x="-36" y="-26" width="72" height="52" rx="12" />
            <rect className="terminal-scene__door" x="-22" y="-14" width="18" height="28" rx="3" />
            <rect className="terminal-scene__door" x="4" y="-14" width="18" height="28" rx="3" />
          </g>

          <g transform={`translate(${label.x} ${label.y})`}>
            <rect className="terminal-scene__tag" x="-69" y="-46" width="138" height="92" rx="14" />
            <text className="terminal-scene__name" y="-20" textAnchor="middle">{hall.name}</text>
            <text className="terminal-scene__count" y="13" textAnchor="middle">
              {checking ? '운영 확인' : `${(hall.currentCount ?? 0).toLocaleString('ko-KR')}명`}
            </text>
            <text className="terminal-scene__level" y="34" textAnchor="middle">{checking ? '' : getLevelLabel(hall)}</text>
          </g>
        </g>;
      })}
    </svg>

    <div className="terminal-scene__title">
      <strong>{terminal}</strong>
      <span>3F 출발층 · 개략도</span>
    </div>

    <ul className="terminal-scene__legend" aria-hidden="true">
      <li className="is-relaxed">여유</li>
      <li className="is-normal">보통</li>
      <li className="is-busy">혼잡</li>
    </ul>

    <div className="terminal-scene__hud">
      <div>
        <small>전체 대기</small>
        <strong><AnimatedNumber value={total} /><em>명</em></strong>
      </div>
      {focused && <div className={`is-${focusedLevel}`}>
        <small>{hoveredId || selectedId ? '선택한 출국장' : '가장 붐비는 곳'}</small>
        <strong>{focused.name}</strong>
        <span>{focusedChecking ? '운영 확인' : getLevelLabel(focused)}{!focusedChecking && focused.changeRate !== null ? ` · 30분 전 ${focused.changeRate > 0 ? '+' : ''}${focused.changeRate.toFixed(1)}%` : ''}</span>
      </div>}
    </div>
  </div>;
}
