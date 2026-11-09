import { useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import type { CongestionHourly } from '../../../api/client';

type Props = { data: CongestionHourly | null; currentHour: number };

// 시계 모양(viewBox 300x300). 안쪽부터: 어제 링 → 오늘 막대 링 → 숫자 → 눈금 → 베젤
const SIZE = 300;
const CENTER = SIZE / 2;
const YESTERDAY_INNER = 46;
const YESTERDAY_OUTER = 53;
const INNER = 58;
const OUTER = 112;
const LABEL_RADIUS = 122;
const TICK_OUTER = 142;
const TICK_MINOR = 138;
const TICK_MAJOR = 134;
const BEZEL = 147;
const HAND_END = OUTER + 3;
const LEVEL_COLOR: Record<string, string> = { LOW: '#3bb886', MID: '#f0b13c', HIGH: '#ec6a5e' };
const LEVEL_LABEL: Record<string, string> = { LOW: '여유', MID: '보통', HIGH: '혼잡' };
const YESTERDAY_COLOR = '#8fa6bd';
const AHEAD_COUNT = 4;          // 앞으로 보여줄 시간 수
const AHEAD_RESERVE = 132;      // "앞으로 몇 시간" 섹션이 차지하는 높이(px, 여백 포함)
const LEGEND_RESERVE = 30;      // 범례 높이(px, 여백 포함)
const CLOCK_WIDTH_RATIO = .9;   // CSS의 시계 폭 비율과 같아야 합니다
const minuteFormat = new Intl.DateTimeFormat('en-GB', { minute: 'numeric', timeZone: 'Asia/Seoul' });

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
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [roomy, setRoomy] = useState(false);
  const hours = data?.hours ?? [];
  const peak = Math.max(1, ...hours.flatMap(hour => [hour.today ?? 0, hour.yesterday ?? 0]));
  const shownHour = active ?? currentHour;
  const shown = hours.find(hour => hour.hour === shownHour);
  const hasData = hours.some(hour => hour.today !== null || hour.yesterday !== null);
  const value = shown?.today ?? null;
  const handHour = currentHour + Number(minuteFormat.format(new Date())) / 60;
  const handTip = point(HAND_END, handHour);
  const handBase = point(INNER - 1, handHour);
  const hovered = active === null ? undefined : hours.find(hour => hour.hour === active);
  // 오른쪽 끝에서는 툴팁이 카드 밖으로 잘리지 않게 왼쪽으로 펼칩니다.
  const flip = tip !== null && boxRef.current !== null && tip.x > boxRef.current.clientWidth * .55;

  // 시계가 줄어들지 않을 만큼 카드 높이에 여유가 있을 때만 '앞으로 몇 시간'을 보여줍니다.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setRoomy(height - LEGEND_RESERVE - AHEAD_RESERVE >= width * CLOCK_WIDTH_RATIO);
    });
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  // 현재 시각 다음 시간부터. 값은 '하루 전 같은 시간'입니다.
  // 자정 전 칸은 어제 값(yesterday), 자정을 넘긴 칸(내일 0시~)은 하루 전이 오늘이므로 오늘 같은 시간 값(today)을 씁니다.
  const ahead = Array.from({ length: AHEAD_COUNT }, (_, index) => {
    const hour = currentHour + 1 + index;
    const next = hour > 23;
    const row = hours.find(item => item.hour === hour % 24);
    return { hour, label: hour % 24, value: (next ? row?.today : row?.yesterday) ?? null };
  });

  const track = (event: MouseEvent, hour: number) => {
    const box = boxRef.current?.getBoundingClientRect();
    setActive(hour);
    if (box) setTip({ x: event.clientX - box.left, y: event.clientY - box.top });
  };
  const leave = () => {
    setActive(null);
    setTip(null);
  };

  return <div className="cong-clock-wrap" ref={wrapRef}>
  <div className="cong-clock" ref={boxRef}>
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label="시간대별 출국장 대기 인원 시계">
      <circle cx={CENTER} cy={CENTER} r={BEZEL} fill="#f3f7fd" stroke="#b9c8d8" strokeWidth="1.5" />
      <circle cx={CENTER} cy={CENTER} r={INNER - 4} fill="#fff" />
      {Array.from({ length: 24 }, (_, hour) => {
        const major = hour % 3 === 0;
        const from = point(major ? TICK_MAJOR : TICK_MINOR, hour);
        const to = point(TICK_OUTER, hour);
        return <line key={hour} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={major ? '#8295a9' : '#b9c8d8'} strokeWidth={major ? 1.4 : 1} />;
      })}
      {[0, 3, 6, 9, 12, 15, 18, 21].map(hour => {
        const place = point(LABEL_RADIUS, hour);
        return <text key={hour} x={place.x} y={place.y + 3.8} textAnchor="middle" className="cong-clock__tick">{hour}</text>;
      })}
      {hours.map(hour => {
        const length = (count: number) => INNER + Math.max(3, (count / peak) * (OUTER - INNER));
        const dim = active !== null && active !== hour.hour;
        return <g
          key={hour.hour}
          tabIndex={0}
          className="cong-clock__hour"
          onMouseEnter={event => track(event, hour.hour)}
          onMouseMove={event => track(event, hour.hour)}
          onMouseLeave={leave}
          onFocus={() => setActive(hour.hour)}
          onBlur={leave}>
          <path d={wedge(hour.hour, YESTERDAY_INNER, OUTER)} fill="transparent" />
          {hour.yesterday !== null && <path
            d={wedge(hour.hour, YESTERDAY_INNER, YESTERDAY_OUTER)}
            fill={YESTERDAY_COLOR}
            opacity={.22 + .5 * (hour.yesterday / peak)}
          />}
          {hour.today !== null && <path
            d={wedge(hour.hour, INNER, length(hour.today))}
            fill={LEVEL_COLOR[hour.level ?? 'LOW']}
            opacity={dim ? .45 : 1}
          />}
        </g>;
      })}
      <line x1={handBase.x} y1={handBase.y} x2={handTip.x} y2={handTip.y} stroke="#fff" strokeWidth="4.5" strokeLinecap="round" />
      <line x1={handBase.x} y1={handBase.y} x2={handTip.x} y2={handTip.y} stroke="#0f4c92" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx={handBase.x} cy={handBase.y} r="3.6" fill="#0f4c92" stroke="#fff" strokeWidth="1.5" />
    </svg>
    <div className="cong-clock__center">
      <small title="그 시간 동안 측정한 출국장 합산 대기 인원의 평균입니다. 현재값은 위 '전체 대기'를 보세요.">{shownHour}시 평균</small>
      <strong>{value === null ? '-' : `${value.toLocaleString()}명`}</strong>
      <em data-level={shown?.level ?? undefined}>{shown?.level ? LEVEL_LABEL[shown.level] : '측정 없음'}</em>
    </div>
    {hovered && tip && <div className={`cong-clock__tip${flip ? ' is-left' : ''}`} style={{ left: tip.x, top: tip.y }} role="tooltip">
      <b>{hovered.hour}시{hovered.today === null ? ' · 오늘 측정 없음' : ` · 평균 ${hovered.today.toLocaleString()}명${hovered.level ? ` · ${LEVEL_LABEL[hovered.level]}` : ''}`}</b>
      {hovered.yesterday !== null && <span>어제 {hovered.yesterday.toLocaleString()}명</span>}
    </div>}
    {!hasData && <p className="cong-clock__empty">쌓인 측정값이 아직 없습니다.</p>}
  </div>
  <ul className="cong-card__legend">
    <li><i data-level="LOW" />여유</li>
    <li><i data-level="MID" />보통</li>
    <li><i data-level="HIGH" />혼잡</li>
    <li><i className="is-yesterday" />어제</li>
  </ul>
  {roomy && hasData && <section className="cong-ahead" aria-label="앞으로 몇 시간 (하루 전 같은 시간 기준)">
    <div className="cong-ahead__head">
      <h3>앞으로 {AHEAD_COUNT}시간</h3>
      <small>하루 전 같은 시간 기준 · 예측 아님</small>
    </div>
    <ol>
      {ahead.map((item, index) => <li key={item.hour} className={index === 0 ? 'is-next' : undefined}>
        <span className="cong-ahead__bar" aria-hidden="true"><i style={{ height: item.value === null ? 0 : `${Math.max(6, (item.value / peak) * 100)}%` }} /></span>
        <b>{item.label}시</b>
        <span>{item.value === null ? '-' : `${item.value.toLocaleString()}명`}</span>
      </li>)}
    </ol>
  </section>}
  </div>;
}
