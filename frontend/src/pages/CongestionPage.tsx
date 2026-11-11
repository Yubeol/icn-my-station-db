import { useCallback, useMemo, useState } from 'react';
import AnimatedNumber from '../components/layout/AnimatedNumber';
import CongestionClock from '../components/main/Congestion/CongestionClock';
import CongestionLiveMap from '../components/main/Congestion/CongestionLiveMap';
import type { LiveHall } from '../components/main/Congestion/CongestionLiveMap';
import { HALL_CHECK_HINT, HALL_CHECK_LABEL, isHallChecking } from '../components/main/Congestion/hallStatus';
import { getCongestion, getCongestionHourly } from '../api/client';
import type { Congestion, CongestionHourly, Terminal } from '../api/client';
import { useLiveUpdates } from '../hooks/useLiveUpdates';
import { useYolo } from '../hooks/useYoloLive';
import { cameraIdForHall } from '../api/yolo';
import YoloHallBadge from '../components/yolo/YoloHallBadge';
import CctvViewer from '../components/yolo/CctvViewer';
import { describeYolo } from '../components/yolo/yoloStatus';
import Skeleton from '../components/layout/Skeleton';
import './CongestionPage.css';

// 자동 생성 타입이 갱신되기 전이라 operationStatus만 여기서 보완합니다.
type HallRow = Congestion['halls'][number] & { operationStatus?: string | null };

const LEVEL_LABEL: Record<string, string> = { LOW: '여유', MID: '보통', HIGH: '혼잡' };
const TERMINALS: Terminal[] = ['T1', 'T2'];
const HOURLY_REFRESH_MS = 300_000;

const timeFormat = new Intl.DateTimeFormat('ko-KR', {
  hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul',
});
const hourFormat = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Asia/Seoul' });

function changeText(rate: number | null) {
  if (rate === null) return '30분 전 비교 없음';
  return `30분 전 대비 ${rate > 0 ? '+' : ''}${rate.toFixed(1)}%`;
}

export default function CongestionPage() {
  const [terminal, setTerminal] = useState<Terminal>('T1');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [cctv, setCctv] = useState<{ cameraId: number; title: string } | null>(null);
  const { data, loading, error, connected } = useLiveUpdates<Congestion>({
    topic: 'congestion',
    scope: terminal,
    resourceKey: terminal,
    fetcher: signal => getCongestion(terminal, signal),
    intervalMs: 60_000,
  });
  const hourly = useLiveUpdates<CongestionHourly>({
    topic: null,
    resourceKey: terminal,
    fetcher: signal => getCongestionHourly(terminal, signal),
    intervalMs: HOURLY_REFRESH_MS,
  });

  const yolo = useYolo();
  // 이 출국장을 비추는 DEMO 카메라가 있으면 그 인원 상태를 돌려줍니다. (3번 출국장만 해당)
  const yoloOf = useCallback((hallId: number) => {
    const cameraId = cameraIdForHall(terminal, hallId);
    return cameraId === null ? undefined : describeYolo(yolo, cameraId);
  }, [terminal, yolo]);

  // 라이브맵 게이트에는 인원 상태와 함께 CCTV 열기 동작을 붙입니다.
  const withCctv = useCallback((hallId: number, hallName: string) => {
    const info = yoloOf(hallId);
    const cameraId = cameraIdForHall(terminal, hallId);
    if (!info || cameraId === null) return undefined;
    return { ...info, onCctv: () => setCctv({ cameraId, title: `${terminal} ${hallName}` }) };
  }, [terminal, yoloOf]);

  const halls: HallRow[] = useMemo(() => data?.halls ?? [], [data]);
  const liveHalls: LiveHall[] = useMemo(() => halls.map(hall => ({
    id: hall.hallId,
    name: hall.hallName,
    count: hall.waitingCount,
    level: hall.level,
    checking: isHallChecking(hall),
    yolo: withCctv(hall.hallId, hall.hallName),
  })), [halls, withCctv]);
  const active = halls.filter(hall => !isHallChecking(hall));
  const total = active.reduce((sum, hall) => sum + hall.waitingCount, 0);
  const peak = Math.max(1, ...active.map(hall => hall.waitingCount));
  // 운영 확인 대상은 순위·추천·합계에서 빼고 목록 맨 아래에 둡니다.
  const ranked = [...halls].sort((a, b) => Number(isHallChecking(a)) - Number(isHallChecking(b)) || a.waitingCount - b.waitingCount);
  const quietest = ranked.find(hall => !isHallChecking(hall)) ?? null;
  const busiest = active.reduce<HallRow | null>(
    (top, hall) => (top === null || hall.waitingCount > top.waitingCount ? hall : top),
    null,
  );
  const currentHour = Number(hourFormat.format(new Date())) % 24;

  const hours = hourly.data?.hours ?? [];
  const peakOf = (key: 'today' | 'yesterday') => hours.reduce<{ hour: number; value: number } | null>((top, hour) => {
    const value = hour[key];
    return value !== null && (top === null || value > top.value) ? { hour: hour.hour, value } : top;
  }, null);
  const todayPeak = peakOf('today');
  const yesterdayPeak = peakOf('yesterday');
  const nowHour = hours.find(hour => hour.hour === currentHour);
  const versusYesterday = nowHour?.today != null && nowHour.yesterday
    ? ((nowHour.today - nowHour.yesterday) / nowHour.yesterday) * 100
    : null;
  const biggestChange = Math.max(10, ...active.map(hall => Math.abs(hall.changeRate ?? 0)));

  const changeTerminal = (next: Terminal) => {
    setTerminal(next);
    setSelectedId(null);
  };

  return <main className="icn-detail icn-page cong-page">
    <div className="cong-page__top">
      <div>
        <h1>출국장 혼잡도</h1>
        <p>{data ? `${timeFormat.format(new Date(data.measuredAt))} 측정 · ` : ''}<span className={connected ? 'cong-page__live is-on' : 'cong-page__live'}>{connected ? '실시간' : '연결 대기'}</span></p>
      </div>
      {data && <dl className="cong-page__summary">
        <div><dt>전체 대기</dt><dd><AnimatedNumber value={total} /><em>명</em></dd></div>
        <div><dt>가장 붐비는 곳</dt><dd>{busiest?.hallName ?? '—'}</dd></div>
        <div><dt>가장 여유로운 곳</dt><dd className="is-good">{quietest?.hallName ?? '—'}</dd></div>
      </dl>}
      <div className="icn-switch" role="group" aria-label="터미널 선택">
        {TERMINALS.map(item => (
          <button key={item} type="button" aria-pressed={terminal === item} onClick={() => changeTerminal(item)}>{item}</button>
        ))}
      </div>
    </div>

    {loading && !data && <Skeleton label="혼잡도를 불러오는 중입니다." variant="block" className="icn-skeleton--page" />}
    {error && !data && <p className="icn-empty" role="alert">{error}</p>}

    {data && <div className="cong-page__grid">
      <div className="cong-page__left">
        <section className="cong-page__map" aria-label={`${terminal} 출국장 라이브맵`}>
          <CongestionLiveMap terminal={terminal} halls={liveHalls} selectedId={selectedId} onSelect={setSelectedId} />
        </section>
        <section className="cong-card cong-change">
          <h2>30분 전 대비 변화</h2>
          <ul>
            {halls.map(hall => {
              const rate = isHallChecking(hall) ? null : hall.changeRate;
              const width = rate === null ? 0 : (Math.abs(rate) / biggestChange) * 50;
              return <li key={hall.hallId}>
                <span>{hall.hallId}번</span>
                <div className="cong-change__track">
                  <i className={rate !== null && rate > 0 ? 'is-up' : 'is-down'} style={{ width: `${width}%`, left: rate !== null && rate < 0 ? `${50 - width}%` : '50%' }} />
                </div>
                <small>{rate === null ? '-' : `${rate > 0 ? '+' : ''}${rate.toFixed(1)}%`}</small>
              </li>;
            })}
          </ul>
        </section>
      </div>

      <section className="cong-card">
        <h2>시간대별 혼잡 시계</h2>
        <CongestionClock data={hourly.data} currentHour={currentHour} />
        <dl className="cong-facts">
          <div><dt>오늘 가장 붐빈 시간</dt><dd>{todayPeak ? `${todayPeak.hour}시 · ${todayPeak.value.toLocaleString()}명` : '-'}</dd></div>
          <div><dt>어제 가장 붐빈 시간</dt><dd>{yesterdayPeak ? `${yesterdayPeak.hour}시 · ${yesterdayPeak.value.toLocaleString()}명` : '-'}</dd></div>
          <div><dt>어제 같은 시간 대비</dt><dd>{versusYesterday === null ? '-' : `${versusYesterday > 0 ? '+' : ''}${versusYesterday.toFixed(1)}%`}</dd></div>
        </dl>
      </section>

      <section className="cong-card">
        <h2>여유로운 순서</h2>
        <ol className="cong-rank">
          {ranked.map(hall => {
            const checking = isHallChecking(hall);
            const yoloInfo = yoloOf(hall.hallId);
            return <li key={hall.hallId}>
              <button
                type="button"
                className={hall.hallId === selectedId ? 'is-selected' : ''}
                aria-pressed={hall.hallId === selectedId}
                onClick={() => setSelectedId(hall.hallId)}>
                <span className="cong-rank__name">{hall.hallName}{hall.hallId === quietest?.hallId && <b>추천</b>}</span>
                <span className="cong-rank__count" style={checking ? { color: 'var(--muted)', fontSize: 12, fontWeight: 600, opacity: .8 } : undefined} title={checking ? HALL_CHECK_HINT : undefined}>{checking ? HALL_CHECK_LABEL : <><AnimatedNumber value={hall.waitingCount} />명</>}</span>
                <span className="cong-rank__track"><i data-level={checking ? undefined : hall.level} style={{ width: `${checking ? 0 : Math.max(2, (hall.waitingCount / peak) * 100)}%` }} /></span>
                <small>{checking ? '' : `${LEVEL_LABEL[hall.level] ?? hall.level} · ${changeText(hall.changeRate)}`}{hall.source === 'yolo' ? ' · YOLO' : ''}</small>
                {yoloInfo && <YoloHallBadge tone={yoloInfo.tone} text={yoloInfo.text} />}
              </button>
              {yoloInfo && <button type="button" className="cong-rank__cctv" onClick={() => setCctv({ cameraId: cameraIdForHall(terminal, hall.hallId) ?? 0, title: `${terminal} ${hall.hallName}` })}>CCTV</button>}
            </li>;
          })}
        </ol>
      </section>
    </div>}
    {cctv && <CctvViewer cameraId={cctv.cameraId} title={cctv.title} onClose={() => setCctv(null)} />}
  </main>;
}