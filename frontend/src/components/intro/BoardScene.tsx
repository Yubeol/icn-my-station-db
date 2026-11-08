import { useEffect, useMemo, useState } from 'react';
import { getFlights } from '../../api/client';
import type { Flight } from '../../api/client';
import { useLiveUpdates } from '../../hooks/useLiveUpdates';

const TITLE = 'ICN MY STATION';
const ROWS = 4;
const POOL_SIZE = 12;
const ROTATE_MS = 8_000;
const RECENT_MS = 5 * 60_000;
const HIDDEN_STATUS = new Set(['DEPARTED', 'ARRIVED']);
const STATUS_LABEL: Record<string, string> = {
  SCHEDULED: '정상',
  BOARDING_SOON: '탑승준비',
  BOARDING: '탑승중',
  DELAYED: '지연',
  CANCELLED: '결항',
  DIVERTED: '회항',
};
// 칸 수: 시각 5, 편명 7, 목적지 7, 게이트 3, 상태 4
const WIDTH = { time: 5, flight: 7, city: 7, gate: 3, status: 4 };

const timeFormat = new Intl.DateTimeFormat('ko-KR', {
  hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul',
});

const fit = (value: string, width: number) => [...value].slice(0, width).join('').padEnd(width, ' ');
const flightTime = (flight: Flight) => Date.parse(flight.estimatedAt ?? flight.scheduledAt);

/** 글자 한 칸. 글자가 바뀔 때만 다시 그려져 뒤집히는 효과가 납니다. */
function FlapText({ text, delay = 0, step = 45 }: { text: string; delay?: number; step?: number }) {
  return <span className="board-flap">
    {[...text].map((char, index) => <span
      key={`${index}-${char}`}
      className={`board-flap__cell ${char === ' ' ? 'is-blank' : ''}`}
      style={{ animationDelay: `${delay + index * step}ms` }}>
      {char}
    </span>)}
  </span>;
}

function FlightRow({ flight, index }: { flight: Flight; index: number }) {
  const time = flight.estimatedAt ?? flight.scheduledAt;
  const status = flight.status;
  return <li className="board-row" data-status={status}>
    <span className="board-col board-col--time"><FlapText text={fit(timeFormat.format(new Date(time)), WIDTH.time)} delay={600 + index * 120} /></span>
    <span className="board-col board-col--flight"><FlapText text={fit(flight.flightNo, WIDTH.flight)} delay={680 + index * 120} /></span>
    <span className="board-col board-col--city"><FlapText text={fit(flight.city ?? '', WIDTH.city)} delay={760 + index * 120} /></span>
    <span className="board-col board-col--gate"><FlapText text={fit(flight.gate ? String(flight.gate) : '-', WIDTH.gate)} delay={840 + index * 120} /></span>
    <span className="board-col board-col--status"><FlapText text={fit(STATUS_LABEL[status] ?? status, WIDTH.status)} delay={900 + index * 120} /></span>
  </li>;
}

/** 공항 출발 전광판. 실제 출발편이 있을 때만 항공편 행을 보여 줍니다. */
export default function BoardScene() {
  const { data } = useLiveUpdates<Flight[]>({
    topic: null,
    fetcher: signal => getFlights('DEPARTURE', signal),
    resourceKey: 'intro-board',
    intervalMs: 60_000,
  });

  // 지금부터 가까운 출발편 순서로 후보를 모읍니다.
  const pool = useMemo(() => {
    const from = Date.now() - RECENT_MS;
    return (data ?? [])
      .filter(flight => !HIDDEN_STATUS.has(flight.status))
      .filter(flight => flightTime(flight) >= from)
      .sort((a, b) => flightTime(a) - flightTime(b))
      .slice(0, POOL_SIZE);
  }, [data]);

  // 약 8초마다 한 행씩만 다음 항공편으로 바꿉니다.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (pool.length <= ROWS) return;
    const timer = window.setInterval(() => setTick(value => value + 1), ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [pool.length]);

  const rows = useMemo(() => {
    const count = Math.min(ROWS, pool.length);
    const shown = Array.from({ length: count }, (_, index) => index);
    if (pool.length > ROWS) {
      for (let step = 1; step <= tick; step += 1) {
        const row = (step - 1) % ROWS;
        const next = (ROWS - 1 + step) % pool.length;
        if (!shown.includes(next)) shown[row] = next;
      }
    }
    return shown.map(index => pool[index]);
  }, [pool, tick]);

  return <div className="board" role="img" aria-label={rows.length ? `출발 전광판, 다가오는 출발편 ${rows.length}편` : '출발 전광판'}>
    <div className="board__title">
      <span className="board__label">DEPARTURES<small>출발</small></span>
      <FlapText text={TITLE} delay={150} step={70} />
      <span className="board__label board__label--right">ICN<small>인천</small></span>
    </div>
    {rows.length > 0 && <>
      <div className="board-row board-row--head" aria-hidden="true">
        <span className="board-col board-col--time">시각</span>
        <span className="board-col board-col--flight">편명</span>
        <span className="board-col board-col--city">목적지</span>
        <span className="board-col board-col--gate">게이트</span>
        <span className="board-col board-col--status">상태</span>
      </div>
      <ol className="board__rows">
        {rows.map((flight, index) => <FlightRow key={index} flight={flight} index={index} />)}
      </ol>
    </>}
  </div>;
}
