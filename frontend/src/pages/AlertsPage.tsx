import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, Ban, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Clock3, CloudSun, Plane, Search, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { getAlerts } from '../api/client';
import type { Alert } from '../api/client';
import { useLiveUpdates } from '../hooks/useLiveUpdates';
import Skeleton from '../components/layout/Skeleton';
import './AlertsPage.css';

type FeedAlert = Alert & { terminal?: string | null };
type Severity = 'ALL' | 'CRITICAL' | 'WARN' | 'INFO';

const SEVERITIES: { key: Severity; label: string }[] = [
  { key: 'ALL', label: '전체' },
  { key: 'CRITICAL', label: '긴급' },
  { key: 'WARN', label: '주의' },
  { key: 'INFO', label: '정보' },
];
const TYPES: Record<string, { label: string; icon: LucideIcon }> = {
  DELAY: { label: '지연', icon: Clock3 },
  CANCELLED: { label: '결항', icon: Ban },
  GATE_CHANGE: { label: '게이트 변경', icon: ArrowLeftRight },
  CONGESTION: { label: '출국장 혼잡', icon: Users },
  WEATHER: { label: '기상 주의', icon: CloudSun },
  BOARDING: { label: '탑승', icon: Plane },
};
const SEVERITY_COLOR: Record<string, string> = { CRITICAL: '#d9434e', WARN: '#c98a1b', INFO: '#1d6fd1' };
const SEVERITY_LABEL: Record<string, string> = { CRITICAL: '긴급', WARN: '주의', INFO: '정보' };
const ROW_HEIGHT = 64;
const MIN_ROWS = 3;
const MAX_TYPE_ROWS = 6;
const HOUR_BUCKETS = 6;
const HOUR_MS = 3_600_000;
const DONUT_RADIUS = 42;
const DONUT_LENGTH = 2 * Math.PI * DONUT_RADIUS;

const timeFormat = new Intl.DateTimeFormat('ko-KR', {
  hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul',
});
const fullFormat = new Intl.DateTimeFormat('ko-KR', {
  month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul',
});

const hourFormat = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', hour12: false, timeZone: 'Asia/Seoul' });

const typeOf = (alert: FeedAlert) => TYPES[alert.type] ?? { label: alert.type, icon: Clock3 };

/** 목록 영역에 스크롤 없이 들어가는 줄 수를 계산합니다. */
function usePageSize() {
  const listRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(MIN_ROWS);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const observer = new ResizeObserver(() => {
      setSize(Math.max(MIN_ROWS, Math.floor(list.clientHeight / ROW_HEIGHT)));
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, []);
  return { listRef, size };
}

/** 1, 마지막, 현재 페이지 주변 번호를 중복 없이 만들고 빈 구간은 말줄임표로 표시합니다. */
function pageItems(current: number, total: number): Array<number | 'gap'> {
  const nums = new Set<number>([1, total]);
  for (let p = current - 2; p <= current + 2; p++) if (p >= 1 && p <= total) nums.add(p);
  const sorted = [...nums].sort((a, b) => a - b);
  const items: Array<number | 'gap'> = [];
  sorted.forEach((n, i) => {
    if (i > 0) {
      const gap = n - sorted[i - 1];
      if (gap === 2) items.push(n - 1);
      else if (gap > 2) items.push('gap');
    }
    items.push(n);
  });
  return items;
}

function Donut({ alerts }: { alerts: FeedAlert[] }) {
  let offset = 0;
  return <div className="alert-donut">
    <svg viewBox="0 0 100 100" role="img" aria-label={`표시 중인 알림 ${alerts.length}건`}>
      <circle cx="50" cy="50" r={DONUT_RADIUS} className="alert-donut__track" />
      {(['CRITICAL', 'WARN', 'INFO'] as const).map(severity => {
        const count = alerts.filter(alert => alert.severity === severity).length;
        const length = alerts.length ? (count / alerts.length) * DONUT_LENGTH : 0;
        const segment = <circle
          key={severity}
          cx="50"
          cy="50"
          r={DONUT_RADIUS}
          stroke={SEVERITY_COLOR[severity]}
          strokeDasharray={`${length} ${DONUT_LENGTH - length}`}
          strokeDashoffset={-offset} />;
        offset += length;
        return segment;
      })}
    </svg>
    <div><strong>{alerts.length}</strong><span>알림</span></div>
  </div>;
}

export default function AlertsPage() {
  const { data, loading, error, connected, updatedAt } = useLiveUpdates<FeedAlert[]>({
    topic: 'alerts',
    fetcher: getAlerts,
    intervalMs: 60_000,
  });
  const [severity, setSeverity] = useState<Severity>('ALL');
  const [terminal, setTerminal] = useState('ALL');
  const [type, setType] = useState('ALL');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const { listRef, size } = usePageSize();
  const [clock, setClock] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const alerts = useMemo(
    () => [...(data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [data],
  );

  const scoped = useMemo(() => {
    const word = search.trim().toLowerCase();
    return alerts.filter(alert => {
      if (terminal !== 'ALL' && alert.terminal !== terminal) return false;
      if (type !== 'ALL' && alert.type !== type) return false;
      if (!word) return true;
      return `${alert.flightNo ?? ''} ${alert.title} ${alert.message}`.toLowerCase().includes(word);
    });
  }, [alerts, terminal, type, search]);

  const visible = severity === 'ALL' ? scoped : scoped.filter(alert => alert.severity === severity);
  const totalPages = Math.max(1, Math.ceil(visible.length / size));
  const currentPage = Math.min(page, totalPages);
  const paged = visible.slice((currentPage - 1) * size, currentPage * size);
  const selected = visible.find(alert => alert.alertId === selectedId) ?? visible[0] ?? null;
  const typeCounts = useMemo(() => {
    const counts = new Map<string, { key: string; label: string; count: number }>();
    scoped.forEach(alert => {
      const entry = counts.get(alert.type) ?? { key: alert.type, label: typeOf(alert).label, count: 0 };
      entry.count += 1;
      counts.set(alert.type, entry);
    });
    const sorted = [...counts.values()].sort((a, b) => b.count - a.count);
    if (sorted.length <= MAX_TYPE_ROWS) return sorted;
    const rest = sorted.slice(MAX_TYPE_ROWS);
    return [
      ...sorted.slice(0, MAX_TYPE_ROWS),
      { key: '__rest', label: `외 ${rest.length}개`, count: rest.reduce((sum, item) => sum + item.count, 0) },
    ];
  }, [scoped]);
  const maxType = Math.max(1, ...typeCounts.map(item => item.count));
  const hourBuckets = useMemo(() => {
    const currentStart = Math.floor(clock / HOUR_MS) * HOUR_MS;
    const buckets = Array.from({ length: HOUR_BUCKETS }, (_, index) => {
      const start = currentStart - (HOUR_BUCKETS - 1 - index) * HOUR_MS;
      return { start, label: hourFormat.format(new Date(start)), count: 0, current: index === HOUR_BUCKETS - 1 };
    });
    scoped.forEach(alert => {
      const time = Date.parse(alert.createdAt);
      const bucket = buckets.find(item => time >= item.start && time < item.start + HOUR_MS);
      if (bucket) bucket.count += 1;
    });
    return buckets;
  }, [scoped, clock]);
  const maxHour = Math.max(1, ...hourBuckets.map(item => item.count));
  const count = (key: string) => scoped.filter(alert => alert.severity === key).length;

  useEffect(() => {
    setSelectedId(null);
    setPage(1);
  }, [severity, terminal, type, search]);

  return <main className="icn-detail alert-page">
    <div className="alert-top">
      <small>AIRPORT OPERATIONS · LIVE FEED</small>
      <h1>공항의 지금을, 한눈에.</h1>
      <p>여행에 필요한 변화를 놓치지 마세요.</p>
    </div>

    <section className="alert-summary" aria-label="알림 요약">
      <div className="alert-summary__live">
        <strong className={connected ? 'is-on' : ''}>{connected ? 'LIVE' : '연결 대기'}</strong>
        <span>{connected ? '실시간 연결됨' : '연결을 기다리는 중'}</span>
      </div>
      <div><small>현재 조회</small><strong>{scoped.length}</strong></div>
      <div><small>긴급</small><strong data-severity="CRITICAL">{count('CRITICAL')}</strong></div>
      <div><small>주의</small><strong data-severity="WARN">{count('WARN')}</strong></div>
      <div><small>정보</small><strong data-severity="INFO">{count('INFO')}</strong></div>
      <div><small>마지막 수신</small><b>{updatedAt ? timeFormat.format(updatedAt) : '—'}</b></div>
    </section>

    <div className="alert-grid">
      <section className="alert-feed">
        <div className="alert-feed__head">
          <div><small>EVENT TIMELINE</small><h2>실시간 알림</h2></div>
          <span>{visible.length} EVENTS</span>
        </div>
        <div className="alert-filters">
          <label>
            <Search size={15} aria-hidden="true" />
            <input type="search" value={search} placeholder="편명, 제목, 내용 검색" aria-label="알림 검색" onChange={event => setSearch(event.target.value)} />
          </label>
          <select value={terminal} aria-label="터미널 선택" onChange={event => setTerminal(event.target.value)}>
            <option value="ALL">전체 터미널</option>
            <option value="T1">T1</option>
            <option value="T2">T2</option>
          </select>
          <select value={type} aria-label="알림 유형" onChange={event => setType(event.target.value)}>
            <option value="ALL">모든 유형</option>
            {Object.entries(TYPES).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
          </select>
        </div>
        <div className="alert-chips" role="group" aria-label="중요도">
          {SEVERITIES.map(item => (
            <button type="button" key={item.key} aria-pressed={severity === item.key} onClick={() => setSeverity(item.key)}>{item.label}</button>
          ))}
        </div>

        {loading && !data && <Skeleton label="알림을 불러오는 중입니다." variant="rows" count={5} />}
        {error && !data && <p className="alert-empty" role="alert">{error}</p>}
        {data && visible.length === 0 && <p className="alert-empty">조건에 맞는 알림이 없습니다.</p>}

        <div className="alert-list" ref={listRef}>
          {paged.map(alert => {
            const Icon = typeOf(alert).icon;
            return <button
              type="button"
              key={alert.alertId}
              data-severity={alert.severity}
              className={alert.alertId === selected?.alertId ? 'is-active' : ''}
              onClick={() => setSelectedId(alert.alertId)}>
              <time dateTime={alert.createdAt}>{timeFormat.format(new Date(alert.createdAt))}</time>
              <i><Icon size={17} /></i>
              <span>
                <strong>{alert.title}</strong>
                <small>{[alert.terminal, typeOf(alert).label].filter(Boolean).join(' · ')} · {alert.message}</small>
              </span>
              <em>{SEVERITY_LABEL[alert.severity] ?? alert.severity}</em>
            </button>;
          })}
        </div>

        <nav className="alert-pages" aria-label="알림 페이지">
          <div className="alert-pages__side">
            <button type="button" className="alert-pages__latest" disabled={currentPage === 1} onClick={() => setPage(1)}>최신 알림</button>
          </div>
          <div className="alert-pages__main">
            <button type="button" aria-label="첫 페이지로 이동" disabled={currentPage === 1} onClick={() => setPage(1)}><ChevronsLeft size={16} /></button>
            <button type="button" aria-label="이전 페이지" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={16} /></button>
            {pageItems(currentPage, totalPages).map((item, index) => typeof item === 'number' ? (
              <button type="button" key={item} aria-current={item === currentPage ? 'page' : undefined} onClick={() => setPage(item)}>{item}</button>
            ) : (
              <span key={`gap-${index}`} className="alert-pages__gap" aria-hidden="true">…</span>
            ))}
            <button type="button" aria-label="다음 페이지" disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)}><ChevronRight size={16} /></button>
            <button type="button" aria-label="마지막 페이지로 이동" disabled={currentPage === totalPages} onClick={() => setPage(totalPages)}><ChevronsRight size={16} /></button>
          </div>
          <div className="alert-pages__side" aria-hidden="true" />
        </nav>
      </section>

      <aside className="alert-side">
        {selected && <section className={`alert-pass ${selected.flightNo ? '' : 'is-common'}`} data-severity={selected.severity} aria-label="선택한 알림 상세">
          <div className="alert-pass__head">
            <small>OPERATION ALERT</small>
            <h2>{selected.title}</h2>
            <div className="alert-pass__badges">
              <b data-severity={selected.severity}>{SEVERITY_LABEL[selected.severity] ?? selected.severity}</b>
              <span>{typeOf(selected).label}</span>
            </div>
          </div>
          <div className="alert-pass__route">
            <div><small>FLIGHT</small><strong>{selected.flightNo ?? '공항 전체'}</strong></div>
            <i aria-hidden="true">✈</i>
            <div><small>TERMINAL</small><strong>{selected.terminal ?? '공통'}</strong></div>
          </div>
          <p className="alert-pass__message">{selected.message}</p>
          <dl>
            <dt>발생 시각</dt><dd><time dateTime={selected.createdAt}>{fullFormat.format(new Date(selected.createdAt))} KST</time></dd>
          </dl>
          <div className="alert-pass__barcode" aria-hidden="true" />
        </section>}
        {!selected && <section className="alert-pass is-common is-empty" aria-label="선택한 알림 상세">
          <div className="alert-pass__head">
            <small>OPERATION ALERT</small>
            <h2>선택된 알림 없음</h2>
            <div className="alert-pass__badges" aria-hidden="true">&nbsp;</div>
          </div>
          <div className="alert-pass__empty">
            <p className="alert-pass__message">왼쪽 목록에서 알림을 고르면 상세 정보가 보입니다.</p>
          </div>
        </section>}

        <section className="alert-insight">
          <small>FEED INSIGHTS</small>
          <h2>수신 알림 분포</h2>
          <div className="alert-insight__top">
            <Donut alerts={scoped} />
            <dl className="alert-insight__stats">
              {(['CRITICAL', 'WARN', 'INFO'] as const).map(key => (
                <div key={key}><dt>{SEVERITY_LABEL[key]}</dt><dd data-severity={key}>{count(key)}</dd></div>
              ))}
            </dl>
          </div>
          <ul className="alert-insight__types">
            {typeCounts.map(item => <li key={item.key}>
              <span>{item.label}</span>
              <i><u style={{ width: `${(item.count / maxType) * 100}%` }} /></i>
              <b>{item.count}</b>
            </li>)}
          </ul>
          <div className="alert-insight__hours">
            <h3>최근 시간대별 알림</h3>
            <div className="alert-insight__bars">
              {hourBuckets.map(item => (
                <div key={item.start} className={item.current ? 'is-current' : ''}>
                  <b>{item.count}</b>
                  <span><u style={{ height: `${(item.count / maxHour) * 100}%` }} /></span>
                  <small>{item.label}</small>
                </div>
              ))}
            </div>
          </div>
        </section>
      </aside>
    </div>
  </main>;
}
