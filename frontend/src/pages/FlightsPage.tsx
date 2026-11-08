
import { useEffect, useMemo, useRef, useState } from 'react';
import { getFlights, type Flight } from '../api/client';
import { isDelayedFlight } from '../api/rules';
import { useLiveUpdates } from '../hooks/useLiveUpdates';
import 'flag-icons/css/flag-icons.min.css';
import Skeleton from '../components/layout/Skeleton';
import './FlightsPage.css';

type Terminal = 'T1' | 'T2';

type FlightExtra = Flight & {
  airlineCode?: string | null;
  countryCode?: string | null;
};

const AIRLINES: Record<string, { name: string; domain: string }> = {
  KE: { name: '대한항공', domain: 'koreanair.com' },
  OZ: { name: '아시아나항공', domain: 'flyasiana.com' },
  '7C': { name: '제주항공', domain: 'jejuair.net' },
  TW: { name: '티웨이항공', domain: 'twayair.com' },
  LJ: { name: '진에어', domain: 'jinair.com' },
  BX: { name: '에어부산', domain: 'airbusan.com' },
  RS: { name: '에어서울', domain: 'flyairseoul.com' },
  ZE: { name: '이스타항공', domain: 'eastarjet.com' },
  DL: { name: '델타항공', domain: 'delta.com' },
  UA: { name: '유나이티드항공', domain: 'united.com' },
  JL: { name: '일본항공', domain: 'jal.co.jp' },
  NH: { name: '전일본공수', domain: 'ana.co.jp' },
  SQ: { name: '싱가포르항공', domain: 'singaporeair.com' },
  CX: { name: '캐세이퍼시픽', domain: 'cathaypacific.com' },
  QR: { name: '카타르항공', domain: 'qatarairways.com' },
  EK: { name: '에미레이트항공', domain: 'emirates.com' },
  KL: { name: 'KLM', domain: 'klm.com' },
};

const COUNTRY_BY_AIRPORT: Record<string, string> = {
  NRT: 'JP', HND: 'JP', KIX: 'JP', FUK: 'JP',
  CTS: 'JP', NGO: 'JP', OKA: 'JP',
  PVG: 'CN', PEK: 'CN', PKX: 'CN',
  SHA: 'CN', CAN: 'CN', TAO: 'CN',
  TPE: 'TW', TSA: 'TW', KHH: 'TW',
  HKG: 'HK', MFM: 'MO',
  BKK: 'TH', DMK: 'TH', HKT: 'TH',
  SGN: 'VN', HAN: 'VN', DAD: 'VN',
  MNL: 'PH', CEB: 'PH', CRK: 'PH',
  SIN: 'SG', KUL: 'MY', CGK: 'ID',
  DPS: 'ID', DEL: 'IN',
  LAX: 'US', SFO: 'US', SEA: 'US',
  JFK: 'US', EWR: 'US', ORD: 'US',
  ATL: 'US', DFW: 'US', HNL: 'US',
  YVR: 'CA', YYZ: 'CA',
  LHR: 'GB', CDG: 'FR', FRA: 'DE',
  MUC: 'DE', FCO: 'IT', AMS: 'NL',
  SYD: 'AU', MEL: 'AU',
  DXB: 'AE', DOH: 'QA',
};

const DEFAULT_PAGE_SIZE = 20;
const MIN_PAGE_SIZE = 5;
const TABLE_ROW_HEIGHT = 44;
const FIT_SCREEN_QUERY = '(min-width: 1101px)';

function flightTime(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  return date.toLocaleTimeString('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function observationTime(date: Date) {
  return date.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function airlineCode(flight: FlightExtra) {
  const explicit = flight.airlineCode?.trim().toUpperCase();
  if (explicit) return explicit;

  return (
    flight.flightNo.trim().toUpperCase()
      .match(/^[A-Z0-9]{2}/)?.[0] ?? ''
  );
}

function countryCode(flight: FlightExtra) {
  const explicit = flight.countryCode?.trim().toUpperCase();

  if (explicit && /^[A-Z]{2}$/.test(explicit)) {
    return explicit;
  }

  return COUNTRY_BY_AIRPORT[
    flight.airportCode?.trim().toUpperCase() ?? ''
  ] ?? '';
}

function CountryFlag({ code }: { code: string }) {
  if (!/^[A-Z]{2}$/.test(code)) {
    return <span aria-label="국가 정보 없음">🌐</span>;
  }

  return (
    <span
      className={`fi fi-${code.toLowerCase()}`}
      role="img"
      aria-label={`${code} 국기`}
    />
  );
}

function statusLabel(value: string) {
  const status = (value ?? '').toUpperCase();

  if (status.includes('DELAY') || status.includes('지연')) {
    return '지연';
  }
  if (status.includes('CANCEL') || status.includes('결항')) {
    return '결항';
  }
  if (status.includes('BOARD') || status.includes('탑승')) {
    return '탑승중';
  }
  if (status.includes('DEPART') || status.includes('출발')) {
    return '출발';
  }
  if (status.includes('ARRIV') || status.includes('도착')) {
    return '도착';
  }
  if (
    status.includes('SCHEDULE') ||
    status.includes('ON_TIME') ||
    status.includes('정상') ||
    status.includes('예정')
  ) {
    return '정상';
  }

  return value || '정보 없음';
}

/** 표에 보이는 상태 문구. 출발을 마쳤어도 지연 기준 이상 늦었으면 '지연 출발'로 구분합니다. */
function displayStatus(flight: FlightExtra) {
  const base = statusLabel(flight.status);
  if (!isDelayedFlight(flight)) return base;
  return base === '출발' ? '지연 출발' : '지연';
}

/** 상태 필터: '지연'은 지연 기준(15분 이상 또는 DELAYED)으로, 나머지는 원래 상태로 거릅니다. */
function matchesStatus(flight: FlightExtra, filter: string) {
  return filter === '지연' ? isDelayedFlight(flight) : statusLabel(flight.status) === filter;
}

function statusClass(flight: FlightExtra) {
  const status = statusLabel(flight.status);

  if (status === '결항') return 'cancel';
  if (isDelayedFlight(flight)) {
    return 'delay';
  }
  if (status === '탑승중') return 'boarding';

  return 'normal';
}

function getDepartureTime(flight: FlightExtra) {
  const estimated = flight.estimatedAt
    ? Date.parse(flight.estimatedAt)
    : NaN;

  if (Number.isFinite(estimated)) return estimated;
  return Date.parse(flight.scheduledAt);
}

function AirlineMark({ flight }: { flight: FlightExtra }) {
  const code = airlineCode(flight);
  const brand = AIRLINES[code];
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [code]);

  return (
    <span className="icn-flight-airline-mark">
      {brand && !failed ? (
        <img
          src={
            `https://www.google.com/s2/favicons?domain=` +
            `${encodeURIComponent(brand.domain)}&sz=64`
          }
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <span>{code || '✈'}</span>
      )}
    </span>
  );
}

function GateTimeline({
  terminal,
  flights,
  now,
}: {
  terminal: Terminal;
  flights: FlightExtra[];
  now: Date;
}) {
  const HOUR = 60 * 60 * 1000;
  const currentTime = now.getTime();
  // 현재 시각을 기준으로 앞뒤 운항 일정을 함께 보여줍니다.
  const start = Math.floor(currentTime / HOUR) * HOUR - HOUR;
  const end = start + 4 * HOUR;
  const duration = end - start;

  const gateFlights = useMemo(() => {
    const candidates = flights.filter(flight => {
      const scheduled = Date.parse(flight.scheduledAt);

      return (
        flight.terminal?.toUpperCase() === terminal &&
        Boolean(flight.gate) &&
        Number.isFinite(scheduled) &&
        scheduled >= start - HOUR &&
        scheduled < end &&
        statusLabel(flight.status) !== '결항'
      );
    });

    const gates = new Map<string, FlightExtra[]>();

    for (const flight of candidates) {
      const gate = String(flight.gate)
        .replace(/^G/i, '')
        .trim();

      if (!gates.has(gate)) gates.set(gate, []);
      gates.get(gate)?.push(flight);
    }

    return [...gates.entries()]
      .sort((a, b) => {
        const aTime = Math.min(
          ...a[1].map(f => Date.parse(f.scheduledAt))
        );
        const bTime = Math.min(
          ...b[1].map(f => Date.parse(f.scheduledAt))
        );
        const aPriority = aTime >= currentTime ? 0 : 1;
        const bPriority = bTime >= currentTime ? 0 : 1;
        return aPriority - bPriority ||
          Math.abs(aTime - currentTime) - Math.abs(bTime - currentTime);
      })
      .slice(0, 4);
  }, [flights, terminal, start, end, currentTime]);

  const ticks = Array.from({ length: 5 }, (_, i) =>
    new Date(start + i * HOUR).toLocaleTimeString('ko-KR', {
      timeZone: 'Asia/Seoul',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  );

  return (
    <article className="icn-flight-card icn-flight-terminal-card">
      <div className="icn-flight-card-head">
        <h2>
          <span className="icn-flight-terminal-icon">
            {terminal === 'T1' ? '1' : '2'}
          </span>
          제{terminal === 'T1' ? '1' : '2'}여객터미널
          <small>{terminal}</small>
        </h2>

        <span className="icn-flight-pill">게이트 일정</span>
      </div>

      <div className="icn-flight-timeline">
        <div className="icn-flight-ticks">
          {ticks.map((tick, index) => (
            <span key={`${tick}-${index}`}>{tick}</span>
          ))}
        </div>

        <div className="icn-flight-gate-list">
          {gateFlights.length > 0 ? (
            gateFlights.map(([gate, items]) => (
              <div className="icn-flight-gate-row" key={gate}>
                <span className="icn-flight-gate-name">
                  G{gate}
                </span>

                <div className="icn-flight-track">
                  {items.map((flight, index) => {
                    const scheduled = Date.parse(
                      flight.scheduledAt
                    );
                    const actual = getDepartureTime(flight);
                    const barStart = Math.max(scheduled, start);

                    const barEnd = Math.min(
                      Math.max(
                        scheduled + 30 * 60 * 1000,
                        Number.isFinite(actual)
                          ? actual
                          : scheduled
                      ),
                      end
                    );

                    const left =
                      ((barStart - start) / duration) * 100;
                    const width =
                      ((barEnd - barStart) / duration) * 100;

                    if (barEnd <= barStart) return null;

                    return (
                      <div
                        key={`${flight.flightNo}-${index}`}
                        className={
                          `icn-flight-bar ${statusClass(flight)}`
                        }
                        style={{
                          left: `${left}%`,
                          width: `${Math.max(width, 3)}%`,
                          maxWidth: `${100 - left}%`,
                        }}
                        title={
                          `${flight.flightNo} | ` +
                          `예정 ${flightTime(flight.scheduledAt)} | ` +
                          `변경 ${flightTime(flight.estimatedAt)} | ` +
                          displayStatus(flight)
                        }
                      >
                        {flight.flightNo}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          ) : (
            <div className="icn-flight-empty-gates">
              해당 시간대의 게이트 정보가 없습니다.
            </div>
          )}
          {gateFlights.length > 0 && currentTime >= start && currentTime <= end && (
            <div
              className="icn-flight-current-time-line"
              style={{
                left: `calc(var(--gate-label-offset) + (100% - var(--gate-label-offset)) * ${(currentTime - start) / duration})`,
              }}
              aria-label={`현재 시각 ${now.toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false })}`}
              title="현재 시각"
            />
          )}
        </div>
      </div>

      <p className="icn-flight-timeline-note">
        현재 시각 기준 · 게이트별 최대 4개 행 표시
      </p>
    </article>
  );
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

type FlightView = 'upcoming' | 'past' | 'all';
const VIEW_TABS: { key: FlightView; label: string }[] = [
  { key: 'upcoming', label: '예정' },
  { key: 'past', label: '지난 항공편' },
  { key: 'all', label: '전체' },
];
const PAST_GRACE_MS = 30 * 60_000;

/** 출발·도착·결항이거나 기준 시각이 30분 넘게 지난 항공편인지 판단합니다. */
function isPastFlight(flight: FlightExtra, nowMs: number) {
  const label = statusLabel(flight.status);
  if (label === '출발' || label === '도착' || label === '결항') return true;
  const time = getDepartureTime(flight);
  return Number.isFinite(time) && time < nowMs - PAST_GRACE_MS;
}

export default function FlightsPage() {
  const [terminal, setTerminal] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [search, setSearch] = useState('');
  const [now, setNow] = useState(() => new Date());
  const [page, setPage] = useState(1);
  const [view, setView] = useState<FlightView>('upcoming');
  const tableRef = useRef<HTMLDivElement>(null);
const [PAGE_SIZE, setPageSize] = useState(DEFAULT_PAGE_SIZE);

// 넓은 화면에서는 표 영역에 들어가는 행 수만큼만 한 페이지에 보여줍니다.
useEffect(() => {
  const table = tableRef.current;
  if (!table) return;
  const wide = window.matchMedia(FIT_SCREEN_QUERY);
  const measure = () => {
    if (!wide.matches) {
      setPageSize(DEFAULT_PAGE_SIZE);
      return;
    }
    const head = table.querySelector('thead')?.offsetHeight ?? 0;
    const rows = Math.floor((table.clientHeight - head) / TABLE_ROW_HEIGHT);
    setPageSize(Math.max(MIN_PAGE_SIZE, rows));
  };
  const observer = new ResizeObserver(measure);
  observer.observe(table);
  wide.addEventListener('change', measure);
  measure();
  return () => {
    observer.disconnect();
    wide.removeEventListener('change', measure);
  };
}, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date());
    }, 60_000);

    return () => window.clearInterval(timer);
  }, []);

  // 최초 REST 조회 후 WebSocket으로 출발편 자동 갱신
  const api = useLiveUpdates<Flight[]>({
    topic: 'flights',
    scope: 'DEPARTURE',
    fetcher: signal => getFlights('DEPARTURE', signal),
    intervalMs: 0,
    parseMessage: value => {
      if (!Array.isArray(value)) return undefined;
      return value as Flight[];
    },
  });

  const allFlights = useMemo(
    () => (api.data ?? []) as FlightExtra[],
    [api.data]
  );

  const baseFlights = useMemo(() => {
    const keyword = search.trim().toLowerCase();

    return allFlights.filter(flight => {
      if (terminal !== 'ALL' && flight.terminal?.toUpperCase() !== terminal) return false;
      if (status !== 'ALL' && !matchesStatus(flight, status)) return false;

      const searchable = [
        flight.flightNo,
        flight.airline,
        flight.city,
        flight.airportCode,
        airlineCode(flight),
        countryCode(flight),
      ]
        .join(' ')
        .toLowerCase();

      return searchable.includes(keyword);
    });
  }, [allFlights, terminal, status, search]);

  const { upcomingFlights, pastFlights } = useMemo(() => {
    const nowMs = now.getTime();
    const byTime = (a: FlightExtra, b: FlightExtra) => getDepartureTime(a) - getDepartureTime(b);
    const sorted = [...baseFlights].sort(byTime);
    return {
      upcomingFlights: sorted.filter(f => !isPastFlight(f, nowMs)),
      pastFlights: sorted.filter(f => isPastFlight(f, nowMs)).reverse(),
    };
  }, [baseFlights, now]);

  const allSorted = useMemo(
    () => [...baseFlights].sort((a, b) => getDepartureTime(a) - getDepartureTime(b)),
    [baseFlights],
  );
  const filteredFlights = view === 'upcoming' ? upcomingFlights : view === 'past' ? pastFlights : allSorted;
  const viewCounts: Record<FlightView, number> = {
    upcoming: upcomingFlights.length,
    past: pastFlights.length,
    all: allSorted.length,
  };

  const totalPages = Math.max(1, Math.ceil(filteredFlights.length / PAGE_SIZE));

  // 갱신으로 페이지 범위를 벗어나면 마지막 페이지로 조정합니다.
  useEffect(() => {
    setPage(p => (p > totalPages ? totalPages : p));
  }, [totalPages]);

  const visibleFlights = filteredFlights.slice(
    (Math.min(page, totalPages) - 1) * PAGE_SIZE,
    Math.min(page, totalPages) * PAGE_SIZE
  );

  // 지연 편수는 메인·운항통계(백엔드 통계)와 같은 기준입니다.
  const delayed = allFlights.filter(isDelayedFlight).length;

  const cancelled = allFlights.filter(
    flight => statusLabel(flight.status) === '결항'
  ).length;

  const lastScheduled = allFlights.reduce((latest, flight) => {
    const time = Date.parse(flight.scheduledAt);
    return Number.isFinite(time)
      ? Math.max(latest, time)
      : latest;
  }, 0);

  return (
    <main className="icn-detail icn-flights-page">
      {Boolean(api.error) && (
        <div className="icn-flight-error" role="alert">
          항공편 정보를 불러오지 못했습니다.
          <p>{api.error}</p>
        </div>
      )}

      <div className="icn-flight-terminal-grid">
        <GateTimeline
          terminal="T1"
          flights={allFlights}
          now={now}
        />
        <GateTimeline
          terminal="T2"
          flights={allFlights}
          now={now}
        />
      </div>

      <section className="icn-flight-card icn-flight-table-card">
        <div className="icn-flight-card-head icn-flight-table-head">
          <div>
            <div className="icn-flight-title-row">
              <h2>출발 항공편 목록</h2>
              <div className="icn-flight-view-tabs" role="group" aria-label="항공편 보기 전환">
                {VIEW_TABS.map(tab => (
                  <button
                    type="button"
                    key={tab.key}
                    aria-pressed={view === tab.key}
                    onClick={() => { setView(tab.key); setPage(1); }}
                  >
                    {tab.label} <span>{viewCounts[tab.key].toLocaleString()}</span>
                  </button>
                ))}
              </div>
            </div>
            <p className="icn-flight-count">
              조회 {allFlights.length}편 · 지연 {delayed}편 ·
              결항 {cancelled}편
            </p>
          </div>

          <div className="icn-flight-filters">
            <input
              aria-label="편명 또는 목적지 검색"
              placeholder="⌕ 편명 또는 목적지 검색"
              value={search}
              onChange={event => { setSearch(event.target.value); setPage(1); }}
            />

            <select
              aria-label="터미널 필터"
              value={terminal}
              onChange={event => { setTerminal(event.target.value); setPage(1); }}
            >
              <option value="ALL">전체 터미널</option>
              <option value="T1">T1</option>
              <option value="T2">T2</option>
            </select>

            <select
              aria-label="운항 상태 필터"
              value={status}
              onChange={event => { setStatus(event.target.value); setPage(1); }}
            >
              <option value="ALL">전체 상태</option>
              <option value="정상">정상</option>
              <option value="탑승중">탑승중</option>
              <option value="지연">지연</option>
              <option value="결항">결항</option>
              <option value="출발">출발</option>
            </select>
          </div>
        </div>

        {api.loading && !api.data && (
          <Skeleton label="실제 항공편 데이터를 불러오는 중입니다." variant="rows" count={6} />
        )}

        <div className="icn-flight-table-scroll" ref={tableRef}>
          <table>
            <thead>
              <tr>
                <th>예정 시간</th>
                <th>변경 시간</th>
                <th>편명</th>
                <th>항공사 / 목적지 국가</th>
                <th>터미널</th>
                <th>게이트</th>
                <th>운항 상태</th>
              </tr>
            </thead>

            <tbody>
              {visibleFlights.map((flight, index) => {
                const code = countryCode(flight);

                return (
                  <tr
                    key={
                      `${flight.flightNo}-` +
                      `${flight.scheduledAt}-${index}`
                    }
                  >
                    <td>{flightTime(flight.scheduledAt)}</td>
                    <td>{flightTime(flight.estimatedAt)}</td>
                    <td>
                      <strong>{flight.flightNo}</strong>
                    </td>

                    <td>
                      <div className="icn-flight-identity">
                        <span className="icn-flight-airline">
                          <AirlineMark flight={flight} />
                          <span>{flight.airline}</span>
                        </span>

                        <span className="icn-flight-divider">/</span>

                        <span className="icn-flight-destination">
                          <span
                            className="icn-flight-flag"
                            title={code || '국가 정보 없음'}
                          >
                            <CountryFlag code={code} />
                          </span>
                          <span>
                            {flight.city}
                            {flight.airportCode && (
                              <small>
                                {' '}({flight.airportCode})
                              </small>
                            )}
                          </span>
                        </span>
                      </div>
                    </td>

                    <td>{flight.terminal || '—'}</td>
                    <td>
                      {flight.gate
                        ? `G${String(flight.gate).replace(/^G/i, '')}`
                        : '—'}
                    </td>
                    <td>
                      <span
                        className={
                          `icn-flight-status ${statusClass(flight)}`
                        }
                      >
                        {displayStatus(flight)}
                      </span>
                    </td>
                  </tr>
                );
              })}

              {!api.loading && !api.error &&
                filteredFlights.length === 0 && (
                  <tr>
                    <td colSpan={7} className="icn-flight-empty">
                      조건에 맞는 항공편이 없습니다.
                    </td>
                  </tr>
                )}
            </tbody>
          </table>
        </div>

        {filteredFlights.length > 0 && (
          <nav className="icn-flight-pagination" aria-label="항공편 페이지 이동">
            <div className="icn-flight-pagination-top">
              <span className="icn-flight-pagination-count">총 <strong>{filteredFlights.length.toLocaleString()}</strong>편 · 페이지당 {PAGE_SIZE}편</span>
              <span className="icn-flight-pagination-current"><strong>{Math.min(page, totalPages)}</strong> / {totalPages} 페이지</span>
            </div>
            <div className="icn-flight-pagination-controls">
              <div className="icn-flight-pagination-side">
              </div>
              <div className="icn-flight-pagination-main">
                <button className="icn-flight-page-arrow" type="button" disabled={page <= 1} onClick={() => setPage(1)} aria-label="첫 페이지로 이동">«</button>
                <button className="icn-flight-page-arrow" type="button" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} aria-label="이전 페이지">‹</button>
                <div className="icn-flight-page-numbers" aria-label="페이지 번호 목록">
                  {(() => {
                    const current = Math.min(page, totalPages);
                    return pageItems(current, totalPages).map((item, i) => typeof item === 'number' ? (
                      <button type="button" key={item} onClick={() => setPage(item)}
                        aria-current={item === current ? 'page' : undefined}
                        className={`icn-flight-page-number ${item === current ? 'is-active' : ''}`}>
                        {item}
                      </button>
                    ) : (
                      <span key={`gap-${i}`} className="icn-flight-page-ellipsis" aria-hidden="true">…</span>
                    ));
                  })()}
                </div>
                <button className="icn-flight-page-arrow" type="button" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))} aria-label="다음 페이지">›</button>
                <button className="icn-flight-page-arrow" type="button" disabled={page >= totalPages} onClick={() => setPage(totalPages)} aria-label="마지막 페이지로 이동">»</button>
              </div>
              <div className="icn-flight-pagination-side" aria-hidden="true" />
            </div>
          </nav>
        )}

        <div className="icn-flight-footer">
          <span>
            실시간 운항정보 · WebSocket 자동 갱신
          </span>
          <span>
            {lastScheduled > 0
              ? `수신 데이터의 마지막 예정 시각: ${
                  observationTime(new Date(lastScheduled))
                }`
              : '마지막 예정 시각 정보 없음'}
          </span>
        </div>
      </section>
    </main>
  );
}
