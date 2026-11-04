
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';
import { getWeather } from '../api/client';
import { getWeatherHistory } from '../api/weatherHistory';
import { useApiResource } from '../hooks/useApiResource';
import {
  formatObservationTime, formatWeatherNumber,
  formatWindDirection, getDelayRiskLabel,
} from '../api/weather';
import { WindCompass } from '../components/main/Weather/WeatherConditions';
import '../components/main/Weather/WeatherConditions.css';
import './WeatherPage.css';

const WEATHER_NAMES: Record<string, string> = {
  CLEAR: '맑음',
  CLOUDY: '흐림',
  RAIN: '비',
  SNOW: '눈',
  FOG: '안개',
  THUNDER: '뇌우',
};

type WeatherExtra = {
  phenomenon?: string | null;
  windGust?: number | null;
};

type OperationExtra = {
  delayRisk?: string | null;
  level?: string | null;
  score?: number | null;
  minutesAhead?: number | null;
};

type ParticleStyle = CSSProperties & {
  '--drift'?: string;
};

type HistoryPoint = {
  observedAt: string;
  condition?: string | null;
  temperature?: number | null;
  windSpeed?: number | null;
  pressure?: number | null;
  visibility?: number | null;
};

type MetricKey =
  | 'temperature'
  | 'windSpeed'
  | 'pressure'
  | 'visibility';

const HEATMAP_METRICS: {
  key: MetricKey;
  label: string;
  unit: string;
  digits: number;
}[] = [
  { key: 'temperature', label: '기온', unit: '°C', digits: 1 },
  { key: 'windSpeed', label: '풍속', unit: 'm/s', digits: 1 },
  { key: 'pressure', label: '기압', unit: 'hPa', digits: 0 },
  { key: 'visibility', label: '시정', unit: 'km', digits: 1 },
];

function randomAt(index: number, seed: number) {
  const value =
    Math.sin((index + 1) * 127.1 + seed * 311.7) *
    43758.5453;

  return value - Math.floor(value);
}

function formatHour(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return '—';

  return date.toLocaleTimeString('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

type TimePhase = 'dawn' | 'day' | 'dusk' | 'night';

function getKoreaTimePhase(date: Date): TimePhase {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Seoul',
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(date)
  );

  if (hour >= 5 && hour < 7) return 'dawn';
  if (hour >= 7 && hour < 17) return 'day';
  if (hour >= 17 && hour < 19) return 'dusk';

  return 'night';
}

function riskClass(value: string | null) {
  const risk = value?.toUpperCase();

  if (risk === 'LOW') return 'low';
  if (risk === 'MID' || risk === 'MEDIUM') return 'mid';
  if (risk === 'HIGH') return 'high';

  return 'unknown';
}

function WeatherEffects({
  condition,
}: {
  condition: string | null;
}) {
  const mode = (condition ?? '').toUpperCase();

  const kind =
    mode === 'RAIN' || mode === 'THUNDER'
      ? 'rain'
      : mode === 'SNOW'
        ? 'snow'
        : mode === 'CLEAR'
          ? 'wind'
          : null;

  const count =
    mode === 'THUNDER' ? 95 :
    mode === 'RAIN' ? 75 :
    mode === 'SNOW' ? 55 :
    mode === 'CLEAR' ? 12 : 0;

  const particles = useMemo(() => {
    return Array.from({ length: count }, (_, index) => {
      const rand = (seed: number) => randomAt(index, seed);

      const duration =
        kind === 'rain'
          ? 0.7 + rand(3) * 0.7
          : kind === 'snow'
            ? 5 + rand(3) * 5
            : 2.5 + rand(3) * 3;

      const style: ParticleStyle = {
        left: `${rand(1) * 100}%`,
        top: `${rand(2) * 100}%`,
        animationDuration: `${duration}s`,
        animationDelay: `${-rand(4) * 10}s`,
        '--drift': `${(rand(5) - 0.5) * 110}px`,
      };

      return { index, style };
    });
  }, [count, kind]);

  return (
    <div className="icn-w-effects" aria-hidden="true">
      {(mode === 'CLEAR' || mode === 'CLOUDY') && (
        <>
          <div className="icn-w-cloud icn-w-cloud-one" />
          <div className="icn-w-cloud icn-w-cloud-two" />
        </>
      )}

      {mode === 'FOG' && (
        <div className="icn-w-fog-layer" />
      )}

      {mode === 'THUNDER' && (
        <div className="icn-w-lightning" />
      )}

      {particles.map(particle => (
        <span
          key={particle.index}
          className={`icn-w-particle icn-w-particle-${kind}`}
          style={particle.style}
        >
          {kind === 'snow' ? '❄' : null}
        </span>
      ))}
    </div>
  );
}

function AirportLandscape() {
  return (
    <svg
      className="icn-w-landscape"
      viewBox="0 0 850 390"
      preserveAspectRatio="xMidYMax slice"
      role="img"
      aria-label="공항 터미널과 관제탑, 활주로 및 비행기"
    >
      <path d="M0 303H850V390H0Z" fill="#88b39a" />
      <path d="M0 312H850V360H0Z" fill="#536e8a" />
      <path d="M0 326H850V333H0Z" fill="#c3d2df" />

      <g fill="#ffda75" className="icn-w-runway-lights">
        {[88, 210, 332, 454, 576, 698, 815].map(x => (
          <circle key={x} cx={x} cy="349" r="4" />
        ))}
      </g>

      <path
        d="M10 270 Q100 267 175 285 Q245 245 325 263 Q390 270 450 278 L535 280 L535 315 H10Z"
        fill="#f5f9ff"
      />

      <path
        d="M15 285 Q110 283 175 299 Q240 263 325 279 Q385 286 450 292 H525V316H15Z"
        fill="#8eb7d9"
      />

      <g opacity=".8" stroke="#e1f2ff" strokeWidth="3">
        <path d="M55 285V317M100 285V317M145 289V317M190 291V317M235 279V317M280 276V317M325 279V317M370 286V317M415 290V317M460 292V317" />
      </g>

      <rect
        x="175"
        y="190"
        width="42"
        height="107"
        fill="#f8fbff"
      />

      <path
        d="M166 190H226L218 177H175Z"
        fill="#d7e9f9"
      />

      <path
        d="M172 176H222L215 160H179Z"
        fill="#6e9bc3"
      />

      <rect
        x="195"
        y="143"
        width="4"
        height="17"
        fill="#fff"
      />

      <path
        d="M184 142H210"
        stroke="#fff"
        strokeLinecap="round"
        strokeWidth="5"
      />

      <g
        className="icn-w-airplane"
        transform="translate(550 284)"
      >
        <ellipse
          cx="94"
          cy="39"
          rx="111"
          ry="8"
          fill="#36516c"
          opacity=".18"
        />

        <path
          d="M8 20 Q28 5 66 9 L137 10 L166 -21 L184 -21 L173 15 L200 20 Q211 25 198 30 L42 31 Q9 32 8 20"
          fill="#f9fcff"
        />

        <path
          d="M80 10L126 10L142 14L81 15Z"
          fill="#4c88c5"
        />

        <path
          d="M147 9L164 -21L184 -21L171 15Z"
          fill="#3c78bd"
        />

        <path
          d="M68 24L112 24"
          stroke="#5a93c8"
          strokeWidth="4"
        />

        <circle cx="57" cy="34" r="6" fill="#3c5875" />
        <circle cx="160" cy="34" r="6" fill="#3c5875" />
      </g>

      <g fill="#75a47e">
        <circle cx="12" cy="367" r="44" />
        <circle cx="63" cy="376" r="40" />
        <circle cx="805" cy="370" r="45" />
        <circle cx="849" cy="357" r="43" />
      </g>
    </svg>
  );
}

function getHeatmapLevel(
  value: number | null,
  min: number,
  max: number
) {
  if (value === null) return 0;
  if (min === max) return 3;

  const ratio = (value - min) / (max - min);

  return Math.min(
    5,
    Math.max(1, Math.ceil(ratio * 4) + 1)
  );
}

export default function WeatherPage() {
  const [refresh, setRefresh] = useState(0);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setRefresh(value => value + 1);
      setNow(new Date());
    }, 60_000);

    return () => window.clearInterval(timer);
  }, []);

  const current = useApiResource(
    signal => getWeather(signal),
    [refresh]
  );

  const history = useApiResource(
    signal => getWeatherHistory(24, signal),
    [refresh]
  );

  const weather = current.data;

  const extra = weather as
    | (NonNullable<typeof weather> & WeatherExtra)
    | null;

  const condition = weather?.condition ?? null;
  const mode = (condition ?? 'UNKNOWN').toUpperCase();

  const timePhase = getKoreaTimePhase(now);

  const operation = weather?.operationScore as
    | OperationExtra
    | null
    | undefined;

  const risk =
    operation?.delayRisk ??
    operation?.level ??
    null;

  const score = operation?.score ?? null;

  const minutesAhead =
    operation?.minutesAhead ?? null;

  const runway = weather?.crosswind?.runway ?? null;

  const chart = useMemo(() => {
    const points = (history.data ?? []) as HistoryPoint[];

    return [...points]
      .sort(
        (a, b) =>
          new Date(a.observedAt).getTime() -
          new Date(b.observedAt).getTime()
      )
      .map(point => ({
        ...point,
        hour: formatHour(point.observedAt),
      }));
  }, [history.data]);

  const heatmapPoints = useMemo(
    () => chart.slice(-6),
    [chart]
  );

  const metric = (
    value: number | null | undefined,
    unit: string,
    digits = 0
  ) => formatWeatherNumber(value, unit, digits);

  return (
    <main className="icn-detail icn-weather-page">
      {current.status === 'error' && (
        <p className="icn-w-error" role="alert">
          {current.error}
        </p>
      )}

      <div className="icn-w-top">
        <div className="icn-w-left">
          <section
            className={
              `icn-w-scene icn-w-${mode.toLowerCase()} ` +
              `icn-w-time-${timePhase}`
            }
          >
            <div className="icn-w-sky" aria-hidden="true">
              {(timePhase === 'night' ||
                timePhase === 'dawn') && (
                <div className="icn-w-stars">
                  {Array.from(
                    { length: 24 },
                    (_, index) => (
                      <i
                        key={index}
                        style={{
                          left: `${randomAt(index, 11) * 100}%`,
                          top: `${randomAt(index, 12) * 68}%`,
                          animationDelay:
                            `${-randomAt(index, 13) * 4}s`,
                        }}
                      />
                    )
                  )}
                </div>
              )}

              {timePhase === 'night' && (
                <div className="icn-w-moon" />
              )}

              {(
                timePhase === 'day' ||
                timePhase === 'dawn' ||
                timePhase === 'dusk'
              ) && (
                <div className="icn-w-sun" />
              )}
            </div>

            <AirportLandscape />
            <WeatherEffects condition={condition} />

            <div className="icn-w-scene-compass">
              <WindCompass
                windDirection={
                  weather?.windDirection ?? null
                }
                runway={runway}
              />

              <span>
                {formatWindDirection(
                  weather?.windDirection
                )}
              </span>

              <small>
                활주로 {runway ?? '정보 없음'}
              </small>
            </div>

            <div className="icn-w-weather-badge">
              <strong>
                {WEATHER_NAMES[mode] ?? '관측 정보 없음'}
              </strong>

              <span>
                {formatObservationTime(
                  weather?.observedAt
                )}
              </span>
            </div>
          </section>

          <section className="icn-w-risk">
            <div className="icn-w-risk-item">
              <span>출발 지연 위험</span>

              <strong
                className={`icn-w-risk-${riskClass(risk)}`}
              >
                {risk
                  ? getDelayRiskLabel(risk)
                  : '정보 없음'}
              </strong>
            </div>

            <div className="icn-w-risk-item">
              <span>운항 여건 점수</span>

              <strong>
                {score == null
                  ? '정보 없음'
                  : `${Math.round(score)} / 100`}
              </strong>

              <small>
                {minutesAhead == null
                  ? '기준 시각 정보 없음'
                  : `${minutesAhead}분 후 기준`}
              </small>
            </div>
          </section>
        </div>

        <div className="icn-w-right">
          <section className="icn-w-description">
            <h2>오늘의 공항 날씨</h2>

            <p>
              {WEATHER_NAMES[mode] ?? '관측 정보 없음'} 상태입니다.{' '}
              {extra?.phenomenon
                ? `관측 기상현상: ${extra.phenomenon}. `
                : ''}
              운항 전 최신 공항 기상 정보를 확인해 주세요.
            </p>
          </section>

          <div className="icn-w-metrics">
            <article>
              <span>바람</span>

              <strong>
                {metric(weather?.windSpeed, ' m/s', 1)}
              </strong>

              <small>
                {formatWindDirection(
                  weather?.windDirection
                )}
                {extra?.windGust != null
                  ? ` · 돌풍 ${extra.windGust} m/s`
                  : ' · 돌풍 정보 없음'}
              </small>
            </article>

            <article>
              <span>기압</span>
              <strong>
                {metric(weather?.pressure, ' hPa')}
              </strong>
              <small>관측 기압</small>
            </article>

            <article>
              <span>시정</span>
              <strong>
                {metric(weather?.visibility, ' km', 1)}
              </strong>
              <small>수평 가시거리</small>
            </article>

            <article>
              <span>기온</span>
              <strong>
                {metric(weather?.temperature, '°C', 1)}
              </strong>
              <small>관측 기온</small>
            </article>
          </div>
        </div>
      </div>

      <div className="icn-w-charts">
        <section className="icn-w-heatmap-card">
          <div className="icn-w-heatmap-heading">
            <div>
              <h2>시간별 기상 열지도</h2>
              <p>
                최근 6개 관측 시점의 기상 지표 상대 수준
              </p>
            </div>

            <span>WEATHER HEATMAP</span>
          </div>

          {history.status === 'error' && (
            <p className="icn-w-error">
              {history.error}
            </p>
          )}

          {heatmapPoints.length > 0 ? (
            <div className="icn-w-heatmap-scroll">
              <div className="icn-w-heatmap-table">
                <div className="icn-w-heatmap-label" />

                {Array.from(
                  { length: 6 },
                  (_, index) => {
                    const point = heatmapPoints[index];

                    return (
                      <div
                        key={`time-${index}`}
                        className="icn-w-heatmap-time"
                      >
                        {point
                          ? formatHour(point.observedAt)
                          : '—'}
                      </div>
                    );
                  }
                )}

                {HEATMAP_METRICS.map(item => {
                  const values = heatmapPoints
                    .map(point => point[item.key])
                    .filter(
                      (value): value is number =>
                        typeof value === 'number' &&
                        Number.isFinite(value)
                    );

                  const min = values.length
                    ? Math.min(...values)
                    : 0;

                  const max = values.length
                    ? Math.max(...values)
                    : 0;

                  return (
                    <div
                      className="icn-w-heatmap-row"
                      key={item.key}
                    >
                      <div className="icn-w-heatmap-label">
                        {item.label}
                      </div>

                      {Array.from(
                        { length: 6 },
                        (_, index) => {
                          const point =
                            heatmapPoints[index];

                          const raw =
                            point?.[item.key];

                          const value =
                            typeof raw === 'number' &&
                            Number.isFinite(raw)
                              ? raw
                              : null;

                          const level =
                            getHeatmapLevel(
                              value,
                              min,
                              max
                            );

                          return (
                            <div
                              key={`${item.key}-${index}`}
                              className={
                                `icn-w-heatmap-value ` +
                                `level-${level}`
                              }
                              title={
                                value === null
                                  ? `${item.label}: 관측 정보 없음`
                                  : `${item.label}: ${value.toFixed(
                                      item.digits
                                    )} ${item.unit}`
                              }
                            >
                              {value === null
                                ? '—'
                                : value.toFixed(
                                    item.digits
                                  )}
                            </div>
                          );
                        }
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="icn-w-placeholder">
              {history.status === 'loading'
                ? '기상 이력 조회 중'
                : '기상 이력 데이터가 없습니다.'}
            </p>
          )}

          <div className="icn-w-heatmap-footer">
            <span>
              색상은 각 지표의 상대 수준이며,
              실제 위험도 판정이 아닙니다.
            </span>

            <div className="icn-w-heatmap-legend">
              낮음
              {[1, 2, 3, 4, 5].map(level => (
                <i
                  key={level}
                  className={`level-${level}`}
                />
              ))}
              높음
            </div>
          </div>
        </section>

        <section className="icn-w-line-card">
          <h2>기온·풍속 변화</h2>

          {chart.length > 0 ? (
            <div className="icn-w-chart">
              <ResponsiveContainer
                width="100%"
                height="100%"
              >
                <LineChart
                  data={chart}
                  margin={{
                    top: 10,
                    right: 15,
                    left: 0,
                    bottom: 5,
                  }}
                >
                  <CartesianGrid
                    stroke="#e1ebf7"
                    strokeDasharray="3 3"
                  />

                  <XAxis
                    dataKey="hour"
                    tick={{ fontSize: 11 }}
                  />

                  <YAxis
                    tick={{ fontSize: 11 }}
                  />

                  <Tooltip
                    shared
                    cursor={{
                      stroke: '#94a3b8',
                      strokeDasharray: '4 4',
                    }}
                  />

                  <Line
                    type="monotone"
                    dataKey="temperature"
                    name="기온 °C"
                    stroke="#e88938"
                    strokeWidth={1.5}
                    dot={false}
                    activeDot={false}
                    connectNulls
                  />

                  <Line
                    type="monotone"
                    dataKey="windSpeed"
                    name="풍속 m/s"
                    stroke="#1471c9"
                    strokeWidth={1.5}
                    dot={false}
                    activeDot={false}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="icn-w-placeholder">
              {history.status === 'loading'
                ? '그래프 불러오는 중'
                : '그래프 데이터가 없습니다.'}
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
