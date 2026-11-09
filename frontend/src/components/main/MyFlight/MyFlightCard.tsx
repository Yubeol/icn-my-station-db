import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { X } from 'lucide-react';
import { getFlightDetail } from '../../../api/client';
import type { FlightDetail } from '../../../api/client';
import { useLiveUpdates } from '../../../hooks/useLiveUpdates';
import { clearSavedFlight, readSavedFlight, subscribeSavedFlight } from '../../../hooks/savedFlight';
import { isHallChecking } from '../Congestion/hallStatus';
import Skeleton from '../../layout/Skeleton';
import { flightLeftText } from './remaining';
import './MyFlightCard.css';

type Props = { onOpen: (flightNo: string) => void };

const REFRESH_MS = 60_000;
const STATUS_LABEL: Record<string, string> = {
  SCHEDULED: '정상',
  BOARDING_SOON: '탑승 준비',
  BOARDING: '탑승 중',
  DEPARTED: '출발',
  ARRIVED: '도착',
  DELAYED: '지연',
  CANCELLED: '결항',
  DIVERTED: '회항',
};
type HallRow = FlightDetail['congestion']['halls'][number] & { operationStatus?: string | null };

function Ticket({ detail, onOpen, onClose }: { detail: FlightDetail; onOpen: () => void; onClose: () => void }) {
  const { flight, congestion } = detail;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  // 운영 확인이 필요하거나 대기 인원이 0명인 출국장은 추천에서 빼고, 후보가 없으면 추천 칸을 숨깁니다.
  const best = useMemo(
    () => [...((congestion?.halls ?? []) as HallRow[])]
      .filter(hall => !isHallChecking(hall))
      .sort((a, b) => a.waitingCount - b.waitingCount)[0] ?? null,
    [congestion],
  );
  const departure = flight.type === 'DEPARTURE';
  const actual = flight.estimatedAt ?? flight.scheduledAt;

  return <section className="my-mini" data-status={flight.status} aria-label="내 항공편">
    <button type="button" className="my-mini__open" onClick={onOpen} aria-label={`${flight.flightNo} 내 항공편 자세히 보기`}>
      <span className="my-mini__main">
        <small>MY FLIGHT</small>
        <strong>{flight.flightNo}</strong>
        <span>{departure ? 'ICN → ' : ''}{flight.airportCode}{!departure ? ' → ICN' : ''}<em>{flight.city}</em></span>
      </span>
      <span className="my-mini__info">
      <span className="my-mini__facts">
        <span><small>터미널</small><b>{flight.terminal ?? '-'}</b></span>
        <span><small>게이트</small><b>{flight.gate ?? '-'}</b></span>
        <span><small>{departure ? '출발까지' : '도착까지'}</small><b className="my-mini__left">{flightLeftText(flight.status, actual, now)}</b></span>
        <span className="my-mini__hall"><small>여유 출국장</small><b className={best ? 'my-mini__best' : undefined}>{best ? best.hallName.replace(/\s*출국장$/, '') : '-'}</b></span>
      </span>
      <span className="my-mini__barcode" aria-hidden="true" />
      </span>
      <span className="my-mini__status" data-status={flight.status}>{STATUS_LABEL[flight.status] ?? flight.status}</span>
    </button>
    <button type="button" className="my-mini__close" onClick={onClose} aria-label="저장한 내 항공편 지우기"><X size={14} /></button>
  </section>;
}

function SavedFlight({ flightNo, onOpen }: { flightNo: string; onOpen: (flightNo: string) => void }) {
  const { data, loading, error } = useLiveUpdates<FlightDetail>({
    topic: null,
    fetcher: signal => getFlightDetail(flightNo, signal),
    resourceKey: flightNo,
    intervalMs: REFRESH_MS,
  });

  if (data) return <Ticket detail={data} onOpen={() => onOpen(data.flight.flightNo)} onClose={clearSavedFlight} />;
  if (loading && !error) return <Skeleton label="내 항공편을 불러오는 중입니다." variant="rows" count={1} className="my-mini__skeleton" />;
  // 찾지 못하거나 오류가 나면 메인 배치를 지키기 위해 카드만 숨깁니다.
  return null;
}

/** 저장된 편명이 있을 때만 메인 화면에 작은 탑승권 카드를 보여 줍니다. */
export default function MyFlightCard({ onOpen }: Props) {
  const flightNo = useSyncExternalStore(subscribeSavedFlight, readSavedFlight, () => null);
  if (!flightNo) return null;
  return <SavedFlight key={flightNo} flightNo={flightNo} onOpen={onOpen} />;
}
