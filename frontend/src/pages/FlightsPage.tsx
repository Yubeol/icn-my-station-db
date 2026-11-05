
import { useEffect, useMemo, useState } from 'react';
import { getFlights, type Flight } from '../api/client';
import { useLiveUpdates } from '../hooks/useLiveUpdates';
import 'flag-icons/css/flag-icons.min.css';
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

function statusClass(flight: FlightExtra) {
  const status = statusLabel(flight.status);

  if (flight.delayMinutes > 0 || status === '지연') {
    return 'delay';
  }
  if (status === '결항') return 'cancel';
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
  const start = Math.floor(currentTime / HOUR) * HOUR;
  const end = start + 6 * HOUR;
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
        return aTime - bTime;
      })
      .slice(0, 4);
  }, [flights, terminal, start, end]);

  const ticks = Array.from({ length: 7 }, (_, i) =>
    new Date(start + i * HOUR).toLocaleTimeString('ko-KR', {
      timeZone: 'Asia/Seoul',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  );

  const nowPosition = ((currentTime - start) / duration) * 100;

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
                  <div
                    className="icn-flight-nowline"
                    style={{ left: `${nowPosition}%` }}
                  />

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
                          statusLabel(flight.status)
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
        </div>
      </div>

      <p className="icn-flight-timeline-note">
        출발편 기준 · 게이트별 최대 4개 행 표시
      </p>
    </article>
  );
}

export default function FlightsPage() {
  const [terminal, setTerminal] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [search, setSearch] = useState('');
  const [now, setNow] = useState(() => new Date());

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

  const filteredFlights = useMemo(() => {
    const keyword = search.trim().toLowerCase();

    return allFlights
      .filter(flight => {
        if (
          terminal !== 'ALL' &&
          flight.terminal?.toUpperCase() !== terminal
        ) {
          return false;
        }

        if (
          status !== 'ALL' &&
          statusLabel(flight.status) !== status
        ) {
          return false;
        }

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
      })
      .sort(
        (a, b) =>
          Date.parse(a.scheduledAt) -
          Date.parse(b.scheduledAt)
      );
  }, [allFlights, terminal, status, search]);

  const delayed = allFlights.filter(
    flight =>
      flight.delayMinutes > 0 ||
      statusLabel(flight.status) === '지연'
  ).length;

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
            <h2>출발 항공편 목록</h2>
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
              onChange={event => setSearch(event.target.value)}
            />

            <select
              aria-label="터미널 필터"
              value={terminal}
              onChange={event => setTerminal(event.target.value)}
            >
              <option value="ALL">전체 터미널</option>
              <option value="T1">T1</option>
              <option value="T2">T2</option>
            </select>

            <select
              aria-label="운항 상태 필터"
              value={status}
              onChange={event => setStatus(event.target.value)}
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

        {api.loading && (
          <p className="icn-flight-info">
            실제 항공편 데이터를 불러오는 중입니다.
          </p>
        )}

        <div className="icn-flight-table-scroll">
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
              {filteredFlights.map((flight, index) => {
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
                        {statusLabel(flight.status)}
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
