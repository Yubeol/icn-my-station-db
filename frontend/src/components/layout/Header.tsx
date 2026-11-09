import { useEffect, useMemo, useState } from 'react';
import { getFlights } from '../../api/client';
import type { Flight } from '../../api/client';
import { useLiveUpdates } from '../../hooks/useLiveUpdates';

const ROTATE_MS = 6000;
const CLOCK_MS = 1000;
const MAX_BOARD_FLIGHTS = 8;
const HIDDEN_STATUS = new Set(['DEPARTED', 'ARRIVED', 'CANCELLED']);
const STATUS_LABEL: Record<string, string> = {
  SCHEDULED: '정상',
  BOARDING_SOON: '탑승준비',
  BOARDING: '탑승중',
  DELAYED: '지연',
  DIVERTED: '회항',
};

const clockFormat = new Intl.DateTimeFormat('ko-KR', {
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Seoul',
});
const timeFormat = new Intl.DateTimeFormat('ko-KR', {
  hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul',
});

/** 공항 전광판처럼 글자가 한 칸씩 넘어가는 표시입니다. */
function Flap({ text }: { text: string }) {
  return <span className="icn-flap" aria-label={text}>
    {[...text].map((char, index) => (
      <span
        className="icn-flap__cell"
        aria-hidden="true"
        key={`${text}-${index}`}
        style={{ animationDelay: `${index * 45}ms` }}>
        {char}
      </span>
    ))}
  </span>;
}

type Props = { onBrandClick?: () => void };

export default function Header({ onBrandClick }: Props = {}) {
  const { data, connected } = useLiveUpdates<Flight[]>({
    topic: 'flights',
    scope: 'DEPARTURE',
    fetcher: signal => getFlights('DEPARTURE', signal),
    intervalMs: 60_000,
  });
  const [now, setNow] = useState(() => new Date());
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    const clock = window.setInterval(() => setNow(new Date()), CLOCK_MS);
    const rotate = window.setInterval(() => setCursor(value => value + 1), ROTATE_MS);
    return () => {
      window.clearInterval(clock);
      window.clearInterval(rotate);
    };
  }, []);

  const upcoming = useMemo(() => {
    const limit = Date.now() - 10 * 60_000;
    return (data ?? [])
      .filter(flight => !HIDDEN_STATUS.has(flight.status))
      .filter(flight => new Date(flight.estimatedAt ?? flight.scheduledAt).getTime() >= limit)
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
      .slice(0, MAX_BOARD_FLIGHTS);
  }, [data]);

  const flight = upcoming.length ? upcoming[cursor % upcoming.length] : null;

  return <header className="icn-banner">
    <button type="button" className="icn-brand icn-brand--button" onClick={onBrandClick} aria-label="ICN My Station 소개 화면으로 이동">
      <span aria-hidden="true">✈</span>
      <div><strong>ICN My Station</strong><small>인천공항 맞춤형 실시간 정보 대시보드</small></div>
    </button>

    <div className="icn-board" aria-label="다음 출발 항공편">
      {flight ? <>
        <div className="icn-board__item"><small>출발</small><Flap text={timeFormat.format(new Date(flight.estimatedAt ?? flight.scheduledAt))} /></div>
        <div className="icn-board__item"><small>편명</small><Flap text={flight.flightNo.padEnd(6, ' ').slice(0, 6)} /></div>
        <div className="icn-board__item icn-board__item--city"><small>목적지</small><strong key={flight.flightNo}>{flight.city}</strong></div>
        <div className="icn-board__item"><small>게이트</small><Flap text={String(flight.gate ?? '-').padStart(3, ' ')} /></div>
        <div className="icn-board__item icn-board__item--status"><small>상태</small><strong data-status={flight.status}>{STATUS_LABEL[flight.status] ?? flight.status}</strong></div>
      </> : <p>다음 출발 항공편을 확인하는 중입니다</p>}
    </div>

    <div className="icn-clock">
      <time dateTime={now.toISOString()}>{clockFormat.format(now)}</time>
      <small className={connected ? 'is-live' : ''}>{connected ? '● 실시간 연결' : '○ 연결 대기'}</small>
    </div>
  </header>;
}
