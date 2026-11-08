import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { getFlightDetail } from '../api/client';
import type { Flight, FlightDetail } from '../api/client';
import type { PageKey } from '../App';
import { useLiveUpdates } from '../hooks/useLiveUpdates';
import { saveFlight } from '../hooks/savedFlight';
import { isHallChecking } from '../components/main/Congestion/hallStatus';
import { flightLeftText } from '../components/main/MyFlight/remaining';
import Skeleton from '../components/layout/Skeleton';
import './MyFlightPage.css';

type Props = { flightNo: string; navigate: (page: PageKey) => void };

// 자동 생성 타입이 갱신되기 전이라 operationStatus만 여기서 보완합니다.
type HallRow = FlightDetail['congestion']['halls'][number] & { operationStatus?: string | null };
const isChecking = (hall: HallRow) => isHallChecking(hall);

const REFRESH_MS = 60_000;
const MAX_ALERTS = 4;
const MAX_FACILITIES = 4;
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
const LEVEL_LABEL: Record<string, string> = { LOW: '여유', MID: '보통', HIGH: '혼잡' };
const RISK_LABEL: Record<string, string> = { LOW: '낮음', MID: '보통', HIGH: '높음' };

const timeFormat = new Intl.DateTimeFormat('ko-KR', {
  hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul',
});
const dateFormat = new Intl.DateTimeFormat('ko-KR', {
  month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Seoul',
});

const DEPARTURE_STEPS = ['예정', '탑승 준비', '탑승 중', '출발 완료'];
const ARRIVAL_STEPS = ['예정', '운항 중', '도착 완료'];

function stepIndex(flight: Flight) {
  const departure = flight.type === 'DEPARTURE';
  switch (flight.status) {
    case 'SCHEDULED':
    case 'DELAYED':
      return 0;
    case 'BOARDING_SOON':
      return departure ? 1 : -1;
    case 'BOARDING':
      return departure ? 2 : -1;
    case 'DEPARTED':
      return departure ? 3 : 1;
    case 'ARRIVED':
      return departure ? -1 : 2;
    default:
      return -1;
  }
}

/** 탑승권 아래의 운항 단계. 단계는 flight.status만으로 판단합니다. */
function FlightSteps({ flight }: { flight: Flight }) {
  if (flight.status === 'CANCELLED' || flight.status === 'DIVERTED') {
    return <section className="my-steps my-steps--notice" data-status={flight.status} aria-label="운항 상태">
      <b>{flight.status === 'CANCELLED' ? '결항' : '회항'}</b>
      <p>{flight.status === 'CANCELLED'
        ? '이 항공편은 결항되었습니다. 대체 항공편과 환불은 항공사 안내를 확인해 주세요.'
        : '이 항공편은 회항했습니다. 변경된 일정은 항공사 안내를 확인해 주세요.'}</p>
    </section>;
  }
  const steps = flight.type === 'DEPARTURE' ? DEPARTURE_STEPS : ARRIVAL_STEPS;
  const current = stepIndex(flight);
  return <section className="my-steps" aria-label="운항 단계">
    <ol style={{ '--steps': steps.length } as CSSProperties}>
      {steps.map((step, index) => <li
        key={step}
        className={index < current ? 'is-done' : index === current ? 'is-current' : ''}
        aria-current={index === current ? 'step' : undefined}>
        <i aria-hidden="true">{index < current ? '✓' : index + 1}</i>
        <span>{step}{index === current && flight.status === 'DELAYED' && <em>지연</em>}</span>
      </li>)}
    </ol>
  </section>;
}

function BoardingPass({ flight }: { flight: Flight }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const departure = flight.type === 'DEPARTURE';
  const actual = flight.estimatedAt ?? flight.scheduledAt;
  const changed = actual !== flight.scheduledAt;
  const label = STATUS_LABEL[flight.status] ?? flight.status;

  return <section className="my-pass" aria-label={`${flight.flightNo} 항공편 정보`}>
    <div className="my-pass__main">
      <p className="my-pass__eyebrow">{departure ? 'BOARDING PASS' : 'ARRIVAL PASS'}<span>{flight.airline}</span></p>
      <div className="my-pass__route">
        <div><strong>{departure ? 'ICN' : flight.airportCode}</strong><small>{departure ? '인천' : flight.city}</small></div>
        <i aria-hidden="true">✈</i>
        <div><strong>{departure ? flight.airportCode : 'ICN'}</strong><small>{departure ? flight.city : '인천'}</small></div>
      </div>
      <dl className="my-pass__facts">
        <div><dt>날짜</dt><dd>{dateFormat.format(new Date(actual))}</dd></div>
        <div><dt>터미널</dt><dd>{flight.terminal ?? '-'}</dd></div>
        <div><dt>게이트</dt><dd>{flight.gate ?? '-'}</dd></div>
        <div><dt>지연</dt><dd>{flight.delayMinutes > 0 ? `${flight.delayMinutes}분` : '없음'}</dd></div>
        <div><dt>{departure ? '출발까지' : '도착까지'}</dt><dd className="my-pass__left">{flightLeftText(flight.status, actual, now)}</dd></div>
      </dl>
    </div>
    <div className="my-pass__stub">
      <small>편명</small>
      <h1>{flight.flightNo}</h1>
      <small>{departure ? '출발' : '도착'} 시각</small>
      <time dateTime={actual}>{timeFormat.format(new Date(actual))}</time>
      {changed && <del>예정 {timeFormat.format(new Date(flight.scheduledAt))}</del>}
      <b data-status={flight.status}>{label}</b>
      <span className="my-pass__barcode" aria-hidden="true" />
    </div>
  </section>;
}

function Detail({ detail }: { detail: FlightDetail }) {
  const { flight, congestion, weather, facilities, alerts } = detail;
  const halls = congestion.halls as HallRow[];
  // 운영 확인 대상(CHECK_REQUIRED 또는 0명)은 추천에서 뺍니다.
  const best = useMemo(
    () => [...halls].filter(hall => !isChecking(hall)).sort((a, b) => a.waitingCount - b.waitingCount)[0] ?? null,
    [halls],
  );
  const shownAlerts = alerts
    .filter(alert => alert.isMine || alert.flightNo === null)
    .sort((a, b) => Number(b.isMine) - Number(a.isMine))
    .slice(0, MAX_ALERTS);
  const openPlaces = facilities.filter(place => place.isOpen !== false).slice(0, MAX_FACILITIES);
  const risk = weather.operationScore.delayRisk;
  // 목록은 카드 높이에 맞춰 늘어나되, 항목 수만큼만 커지게 최대 높이를 줍니다.
  const rows = (count: number) => ({ '--rows': count } as CSSProperties);

  return <>
    <BoardingPass flight={flight} />
    <FlightSteps flight={flight} />
    <div className="my-flight__grid">
      <section className="my-card">
        <h2>{flight.terminal} 출국장 혼잡도</h2>
        {best && <p className="my-card__lead">지금 가장 여유로운 곳은 <strong>{best.hallName}</strong>입니다.</p>}
        {halls.length === 0 && <p className="my-card__empty">혼잡도 정보가 없습니다.</p>}
        <ul className="my-halls" style={rows(halls.length)}>
          {halls.map(hall => isChecking(hall)
            ? <li key={hall.hallId} className="is-checking">
              <span>{hall.hallName}</span>
              <strong>운영 확인</strong>
              <em aria-hidden="true" />
            </li>
            : <li key={hall.hallId} className={hall.hallId === best?.hallId ? 'is-best' : ''}>
              <span>{hall.hallName}</span>
              <strong>{hall.waitingCount.toLocaleString()}명</strong>
              <em data-level={hall.level}>{LEVEL_LABEL[hall.level] ?? hall.level}</em>
            </li>)}
        </ul>
      </section>

      <section className="my-card">
        <h2>내 항공편 알림</h2>
        {shownAlerts.length === 0
          ? <p className="my-card__empty">확인된 알림이 없습니다.</p>
          : <ul className="my-alerts" style={rows(shownAlerts.length)}>
            {shownAlerts.map(alert => <li key={alert.alertId} data-severity={alert.severity} className={alert.isMine ? 'is-mine' : ''}>
              <strong>{alert.isMine && <span>내 항공편</span>}{alert.title}</strong>
              <small>{alert.message}</small>
            </li>)}
          </ul>}
      </section>

      <section className="my-card">
        <h2>운항 여건</h2>
        <div className="my-weather">
          <div><small>출발 지연 위험</small><strong data-level={risk ?? undefined}>{risk ? RISK_LABEL[risk] : '-'}</strong></div>
          <div><small>운항 여건 점수</small><strong>{weather.operationScore.score ?? '-'}<i> / 100</i></strong></div>
          <div><small>풍속</small><strong>{weather.windSpeed ?? '-'}<i> m/s</i></strong></div>
          <div><small>돌풍</small><strong>{weather.windGust ?? '-'}<i> m/s</i></strong></div>
        </div>
        <p className="my-card__note">{weather.operationScore.message}</p>
      </section>

      <section className="my-card">
        <h2>{flight.terminal} 주변 시설</h2>
        {openPlaces.length === 0
          ? <p className="my-card__empty">표시할 시설이 없습니다.</p>
          : <ul className="my-places" style={rows(openPlaces.length)}>
            {openPlaces.map(place => <li key={place.facilityId}>
              <strong>{place.name}</strong>
              <small>{place.location}</small>
            </li>)}
          </ul>}
      </section>
    </div>
  </>;
}

/** 검색한 편명 하나의 탑승권, 혼잡도, 알림, 운항 여건을 한 화면에 모은 개인 페이지입니다. */
export default function MyFlightPage({ flightNo, navigate }: Props) {
  // 응답 구조가 달라 WebSocket 메시지 대신 주기 조회만 사용합니다.
  const { data, loading, error } = useLiveUpdates<FlightDetail>({
    topic: null,
    fetcher: signal => getFlightDetail(flightNo, signal),
    resourceKey: flightNo,
    intervalMs: REFRESH_MS,
  });

  // 조회에 성공한 편명만 메인 화면의 내 항공편 카드용으로 저장합니다.
  const foundFlightNo = data?.flight.flightNo ?? null;
  useEffect(() => {
    if (foundFlightNo) saveFlight(foundFlightNo);
  }, [foundFlightNo]);

  return <main className="my-flight">
    {data ? <Detail detail={data} />
      : loading && !error
        ? <>
          <Skeleton label={`${flightNo} 항공편을 찾는 중입니다.`} variant="pass" />
          <Skeleton label="항공편 주변 정보를 불러오는 중입니다." variant="cards" count={4} className="my-flight__skeleton" />
        </>
        : <div className="my-flight__message" role="alert">
          <>
            <strong>{flightNo} 항공편을 찾지 못했습니다.</strong>
            <p>{error ?? '편명을 다시 확인해 주세요.'}</p>
            <button type="button" onClick={() => navigate('flights')}>운행현황에서 찾기</button>
          </>
        </div>}
  </main>;
}