import { useState } from 'react';
import type { CongestionHourly } from '../../../api/client';

type Props = { data: CongestionHourly | null; currentHour: number };

const SIZE = 240;
const CENTER = SIZE / 2;
const INNER = 58;
const OUTER = 104;
const LEVEL_COLOR: Record<string, string> = { LOW: '#3bb886', MID: '#f0b13c', HIGH: '#ec6a5e' };
const LEVEL_LABEL: Record<string, string> = { LOW: '여유', MID: '보통', HIGH: '혼잡' };

function point(radius: number, hour: number) {
  const angle = (hour / 24) * Math.PI * 2 - Math.PI / 2;
  return { x: CENTER + radius * Math.cos(angle), y: CENTER + radius * Math.sin(angle) };
}

function wedge(hour: number, inner: number, outer: number) {
  const gap = .07;
  const a = point(inner, hour + gap);
  const b = point(outer, hour + gap);
  const c = point(outer, hour + 1 - gap);
  const d = point(inner, hour + 1 - gap);
  return `M${a.x} ${a.y} L${b.x} ${b.y} A${outer} ${outer} 0 0 1 ${c.x} ${c.y} L${d.x} ${d.y} A${inner} ${inner} 0 0 0 ${a.x} ${a.y} Z`;
}

/** 하루 24시간을 시계처럼 둘러 시간대별 대기 인원을 보여줍니다. */
export default function CongestionClock({ data, currentHour }: Props) {
  const [active, setActive] = useState<number | null>(null);
  const hours = data?.hours ?? [];
  const peak = Math.max(1, ...hours.flatMap(hour => [hour.today ?? 0, hour.yesterday ?? 0]));
  const shownHour = active ?? currentHour;
  const shown = hours.find(hour => hour.hour === shownHour);
  const hasData = hours.some(hour => hour.today !== null || hour.yesterday !== null);
  const value = shown?.today ?? null;
  const hand = point(OUTER + 7, currentHour + .5);

  return <div className="cong-clock">
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label="시간대별 출국장 대기 인원 시계">
      <circle cx={CENTER} cy={CENTER} r={OUTER + 12} fill="#f3f7fd" />
      <circle cx={CENTER} cy={CENTER} r={INNER - 4} fill="#fff" />
      {hours.map(hour => {
        const length = (count: number) => INNER + Math.max(3, (count / peak) * (OUTER - INNER));
        return <g
          key={hour.hour}
          tabIndex={0}
          className="cong-clock__hour"
          onMouseEnter={() => setActive(hour.hour)}
          onMouseLeave={() => setActive(null)}
          onFocus={() => setActive(hour.hour)}
          onBlur={() => setActive(null)}>
          <path d={wedge(hour.hour, INNER, OUTER)} fill="transparent" />
          {hour.yesterday !== null && <path d={wedge(hour.hour, INNER, length(hour.yesterday))} fill="#d3dfec" />}
          {hour.today !== null && <path
            d={wedge(hour.hour, INNER, length(hour.today))}
            fill={LEVEL_COLOR[hour.level ?? 'LOW']}
            opacity={active === null || active === hour.hour ? 1 : .45}
          />}
        </g>;
      })}
      {[0, 6, 12, 18].map(hour => {
        const place = point(OUTER + 3, hour);
        const inside = point(INNER - 13, hour);
        return <g key={hour}>
          <line x1={place.x} y1={place.y} x2={point(OUTER + 11, hour).x} y2={point(OUTER + 11, hour).y} stroke="#b9c8d8" />
          <text x={inside.x} y={inside.y + 3.5} textAnchor="middle" className="cong-clock__tick">{hour}</text>
        </g>;
      })}
      <circle cx={hand.x} cy={hand.y} r="4" fill="#0f4c92" stroke="#fff" strokeWidth="1.5" />
    </svg>
    <div className="cong-clock__center">
      <small>{shownHour}시{active === null ? ' · 지금' : ''}</small>
      <strong>{value === null ? '-' : `${value.toLocaleString()}명`}</strong>
      <em data-level={shown?.level ?? undefined}>{shown?.level ? LEVEL_LABEL[shown.level] : '측정 없음'}</em>
    </div>
    {!hasData && <p className="cong-clock__empty">쌓인 측정값이 아직 없습니다.</p>}
  </div>;
}