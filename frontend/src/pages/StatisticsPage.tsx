import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import ApiStatus from '../components/layout/ApiStatus';
import { getFlightStats, getLiveUrl } from '../api/client';
import type { FlightStats, LiveMessage } from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
import './StatisticsPage.css';

type Category = FlightStats['breakdown'][number]['category'];
type Hour = FlightStats['hourly'][number];

const CATEGORIES: { key: Category; label: string }[] = [
  { key: 'NORMAL', label: '정상' },
  { key: 'DELAYED', label: '지연' },
  { key: 'CANCELLED', label: '결항' },
  { key: 'DIVERTED', label: '회항' },
];
const COLORS = { normal: '#74a8ee', delayed: '#f2b64a', cancelled: '#ec8585', diverted: '#a494ec' };
const PLANE_PATH = 'M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z';
const RECONNECT_MS = 5000;
const MIN_FLIGHTS_FOR_RATE = 5;

const formatNumber = (value: number) => value.toLocaleString('ko-KR');
const formatHour = (hour: number) => `${String(hour).padStart(2, '0')}시`;
const delayRate = (hour: Hour) => (hour.count ? (hour.delayedCount / hour.count) * 100 : 0);
const hourLabel = (hour: Hour) => `${formatHour(hour.hour)}, 전체 ${hour.count}편, 지연 ${hour.delayedCount}편, 지연율 ${delayRate(hour).toFixed(0)}%`;

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function seoulNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return { date: `${value('year')}-${value('month')}-${value('day')}`, hour: Number(value('hour')) };
}

function formatDate(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return `${year}년 ${month}월 ${day}일`;
}

/** 첫 화면은 REST로 그리고, 이후에는 값이 바뀐 출발 통계만 WebSocket으로 반영합니다. */
function useLiveDepartureStats() {
  const [live, setLive] = useState<FlightStats | null>(null);
  const lastPayload = useRef('');
  useEffect(() => {
    let socket: WebSocket | null = null;
    let retry: number | undefined;
    let closed = false;
    const connect = () => {
      socket = new WebSocket(getLiveUrl());
      socket.onmessage = event => {
        const message = JSON.parse(event.data as string) as LiveMessage;
        if (message.topic !== 'stats' || message.scope !== 'DEPARTURE') return;
        const payload = JSON.stringify(message.data);
        if (payload === lastPayload.current) return;
        lastPayload.current = payload;
        setLive(message.data as FlightStats);
      };
      socket.onclose = () => {
        if (!closed) retry = window.setTimeout(connect, RECONNECT_MS);
      };
    };
    connect();
    return () => {
      closed = true;
      window.clearTimeout(retry);
      socket?.close();
    };
  }, []);
  return live;
}

function categoryItems(stats: FlightStats) {
  return CATEGORIES.map(category => {
    const item = stats.breakdown.find(entry => entry.category === category.key);
    return { ...category, count: item?.count ?? 0, ratio: item?.ratio ?? 0, changeRate: item?.changeRate ?? null };
  });
}

function headline(stats: FlightStats) {
  const items = categoryItems(stats);
  const delayed = items.find(item => item.key === 'DELAYED')?.count ?? 0;
  const cancelled = items.find(item => item.key === 'CANCELLED')?.count ?? 0;
  const total = formatNumber(stats.total);
  if (delayed && cancelled) return `오늘 출발 ${total}편 중 ${formatNumber(delayed)}편이 지연, ${formatNumber(cancelled)}편이 결항입니다.`;
  if (delayed) return `오늘 출발 ${total}편 중 ${formatNumber(delayed)}편이 지연됐습니다.`;
  if (cancelled) return `오늘 출발 ${total}편 중 ${formatNumber(cancelled)}편이 결항입니다.`;
  return `오늘 출발 ${total}편, 지연과 결항 없이 운항 중입니다.`;
}

const CLIMB = { left: 34, right: 786, ground: 322, top: 54 };

/** 시간대별 예정편을 누적해, 하루의 출발 흐름을 항공기 상승 곡선으로 그립니다. */
function ClimbScene({ stats, currentHour }: { stats: FlightStats; currentHour: number | null }) {
  const [active, setActive] = useState<number | null>(null);
  const points = useMemo(() => {
    const scale = (CLIMB.ground - CLIMB.top) / Math.max(stats.total, 1);
    const toX = (hour: number) => CLIMB.left + (hour / 24) * (CLIMB.right - CLIMB.left);
    let flights = 0;
    let delayed = 0;
    const result = [{ x: toX(0), y: CLIMB.ground, delayY: CLIMB.ground, flights: 0 }];
    for (const hour of stats.hourly) {
      flights += hour.count;
      delayed += hour.delayedCount;
      result.push({ x: toX(hour.hour + 1), y: CLIMB.ground - flights * scale, delayY: CLIMB.ground - delayed * scale, flights });
    }
    return result;
  }, [stats]);
  const nowIndex = currentHour === null ? null : currentHour + 1;
  const toPath = (items: typeof points, key: 'y' | 'delayY') => items.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)} ${point[key].toFixed(1)}`).join(' ');
  const flown = nowIndex === null ? points : points.slice(0, nowIndex + 1);
  const ahead = nowIndex === null ? [] : points.slice(nowIndex);
  const plane = nowIndex === null ? null : points[nowIndex];
  const lastFlown = flown[flown.length - 1];
  const shown = active === null ? null : stats.hourly[active];
  const shownPoint = active === null ? null : points[active + 1];

  return <section className="icn-flightstats__scene" aria-labelledby="flightstats-headline">
    <div className="icn-flightstats__scene-head">
      <h2 id="flightstats-headline">{headline(stats)}</h2>
      {nowIndex !== null && <p>{formatHour(currentHour ?? 0)}까지 예정 {formatNumber(points[nowIndex].flights)}편</p>}
    </div>
    <div className="icn-flightstats__scene-plot">
      <svg viewBox="0 0 820 380" role="img" aria-label="하루 누적 출발 예정 편수와 누적 지연 편수를 나타낸 상승 곡선">
        <g fill="#fff" opacity=".62">
          <ellipse cx="200" cy="82" rx="58" ry="20" /><circle cx="180" cy="72" r="24" /><circle cx="218" cy="66" r="31" />
        </g>
        <g fill="#fff" opacity=".42">
          <ellipse cx="460" cy="158" rx="46" ry="15" /><circle cx="446" cy="150" r="18" /><circle cx="476" cy="146" r="23" />
        </g>
        <g fill="#f8fbfe">
          <path d="M648 322v-74h-9l9-20h34l9 20h-9v74z" />
          <rect x="655" y="210" width="20" height="8" rx="2" /><rect x="663" y="218" width="4" height="10" />
          <path d="M520 322v-28c44-18 92-18 128-6v34zM682 322v-34c34-11 70-11 104-2v36z" />
        </g>
        <rect x="0" y="322" width="820" height="58" fill="#9fb4cc" />
        <rect x="0" y="360" width="820" height="20" fill="#bcd8c3" />
        {stats.hourly.filter(hour => hour.hour % 3 === 0).map(hour =>
          <g key={hour.hour}>
            <circle cx={points[hour.hour].x} cy="341" r="3.5" fill="#ffe6a8" />
            <text x={points[hour.hour].x} y="374" textAnchor="middle" className="icn-flightstats__scene-tick">{hour.hour}시</text>
          </g>)}
        <path className="icn-flightstats__fade-in" d={`${toPath(flown, 'y')} L${lastFlown.x} ${CLIMB.ground} L${CLIMB.left} ${CLIMB.ground} Z`} fill="#fff" opacity=".3" />
        <path className="icn-flightstats__draw" pathLength={1} d={toPath(flown, 'y')} fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        {ahead.length > 1 && <path d={toPath(ahead, 'y')} fill="none" stroke="#fff" strokeWidth="3" strokeDasharray="2 10" strokeLinecap="round" />}
        <path className="icn-flightstats__draw" pathLength={1} d={toPath(flown, 'delayY')} fill="none" stroke={COLORS.delayed} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {plane && <g className="icn-flightstats__plane" style={{ offsetPath: `path('${toPath(flown, 'y')}')` }}>
          <g transform="rotate(90) scale(1.75) translate(-11.5 -12)"><path d={PLANE_PATH} fill="#fff" stroke="#6f9bd0" strokeWidth=".5" /></g>
        </g>}
        {shownPoint && <circle cx={shownPoint.x} cy={shownPoint.y} r="6" fill="#4f86c8" stroke="#fff" strokeWidth="2" />}
        <g>
          {stats.hourly.map(hour => <rect
            key={hour.hour}
            x={points[hour.hour].x}
            y="40"
            width={points[hour.hour + 1].x - points[hour.hour].x}
            height="282"
            fill="transparent"
            tabIndex={0}
            aria-label={`${hourLabel(hour)}, 누적 ${points[hour.hour + 1].flights}편`}
            onMouseEnter={() => setActive(hour.hour)}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(hour.hour)}
            onBlur={() => setActive(null)}
          />)}
        </g>
      </svg>
      {shown && shownPoint && <div
        className={`icn-flightstats__tooltip${shown.hour > 18 ? ' is-end' : ''}`}
        style={{ left: `${(shownPoint.x / 820) * 100}%`, top: `${Math.max((shownPoint.y / 380) * 100 - 6, 2)}%` }}
      >
        <b>{formatHour(shown.hour)}까지</b>
        <span>누적 <em>{formatNumber(shownPoint.flights)}편</em></span>
        <span>이 시간 <em>{shown.count}편</em></span>
      </div>}
    </div>
    <ul className="icn-flightstats__scene-legend">
      <li><i className="is-climb" />누적 출발 예정</li>
      <li><i className="is-delayed" />누적 지연</li>
    </ul>
  </section>;
}

function Composition({ stats }: { stats: FlightStats }) {
  const items = categoryItems(stats);
  return <section className="icn-flightstats__card" aria-labelledby="flightstats-composition">
    <h2 id="flightstats-composition">운항 구성</h2>
    <div className="icn-flightstats__share" role="img" aria-label={items.map(item => `${item.label} ${item.count}편 ${item.ratio}%`).join(', ')}>
      {items.filter(item => item.count > 0).map(item =>
        <span key={item.key} className={`icn-flightstats__segment is-${item.key.toLowerCase()}`} style={{ flexGrow: item.count }} />)}
    </div>
    <dl className="icn-flightstats__categories">
      {items.map(item => <div key={item.key}>
        <dt><i className={`is-${item.key.toLowerCase()}`} />{item.label}</dt>
        <dd><strong>{formatNumber(item.count)}편</strong><span>{item.ratio.toFixed(1)}%{item.changeRate !== null && `, 어제보다 ${item.changeRate > 0 ? '+' : ''}${item.changeRate}%`}</span></dd>
      </div>)}
    </dl>
  </section>;
}

const GAUGE = { center: 160, baseline: 158, radius: 126 };

function gaugePoint(radius: number, percent: number) {
  const radian = Math.PI + (percent / 100) * Math.PI;
  return [GAUGE.center + radius * Math.cos(radian), GAUGE.baseline + radius * Math.sin(radian)];
}

function gaugeArc(start: number, end: number) {
  const [x1, y1] = gaugePoint(GAUGE.radius, start);
  const [x2, y2] = gaugePoint(GAUGE.radius, end);
  return `M${x1.toFixed(1)} ${y1.toFixed(1)}A${GAUGE.radius} ${GAUGE.radius} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`;
}

/** 조종석 계기판처럼 오늘의 정상 운항 비율을 바늘로 보여줍니다. */
function OnTimeGauge({ stats }: { stats: FlightStats }) {
  const items = categoryItems(stats).filter(item => item.count > 0);
  const normal = items.find(item => item.key === 'NORMAL')?.count ?? 0;
  const percent = (normal / Math.max(stats.total, 1)) * 100;
  const arcs = items.map((item, index) => {
    const before = items.slice(0, index).reduce((sum, entry) => sum + entry.count, 0);
    const toPercent = (count: number) => (count / Math.max(stats.total, 1)) * 100;
    return { key: item.key, start: toPercent(before), end: toPercent(before + item.count) };
  });
  return <section className="icn-flightstats__card icn-flightstats__gauge" aria-labelledby="flightstats-gauge">
    <h2 id="flightstats-gauge">정상 운항 계기판</h2>
    <p className="icn-flightstats__note">바늘이 오른쪽 끝에 가까울수록 지연과 결항 없이 운항되고 있습니다.</p>
    <svg viewBox="0 0 320 208" role="img" aria-label={`오늘 정상 운항 비율 ${percent.toFixed(1)}%`}>
      <path d={gaugeArc(0, 100)} fill="none" stroke="#edf2f9" strokeWidth="20" />
      {arcs.map((arc, index) => <path
        key={arc.key}
        className="icn-flightstats__draw"
        pathLength={1}
        d={gaugeArc(arc.start + (index ? 0.5 : 0), arc.end)}
        fill="none"
        stroke={COLORS[arc.key.toLowerCase() as keyof typeof COLORS]}
        strokeWidth="20"
      />)}
      {[0, 25, 50, 75, 100].map(mark => {
        const [x1, y1] = gaugePoint(GAUGE.radius - 15, mark);
        const [x2, y2] = gaugePoint(GAUGE.radius - 22, mark);
        return <line key={mark} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#b9c9dc" strokeWidth="1.5" />;
      })}
      <g className="icn-flightstats__needle" style={{ '--needle': `${(percent / 100) * 180}deg` } as CSSProperties}>
        <path d="M60 158 158 154a4 4 0 0 1 0 8z" fill="#4f6f96" />
      </g>
      <circle cx={GAUGE.center} cy={GAUGE.baseline} r="8" fill="#fff" stroke="#4f6f96" strokeWidth="3" />
      <text x="28" y="182" textAnchor="middle" className="icn-flightstats__radar-label">0%</text>
      <text x="292" y="182" textAnchor="middle" className="icn-flightstats__radar-label">100%</text>
      <text x="160" y="198" textAnchor="middle" className="icn-flightstats__radar-value">{percent.toFixed(1)}%</text>
    </svg>
  </section>;
}

const STREAM = { width: 1000, height: 210, middle: 105, reach: 98 };

function smoothPath(points: [number, number][]) {
  return points.reduce((path, [x, y], index) => {
    if (index === 0) return `M${x} ${y}`;
    const [previousX, previousY] = points[index - 1];
    const middle = (previousX + x) / 2;
    return `${path}C${middle.toFixed(1)} ${previousY.toFixed(1)} ${middle.toFixed(1)} ${y.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }, '');
}

function ribbon(xs: number[], widths: number[]) {
  const edgeXs = [0, ...xs, STREAM.width];
  const edgeWidths = [0, ...widths, 0];
  const upper = edgeXs.map((x, index): [number, number] => [x, STREAM.middle - edgeWidths[index]]);
  const lower = edgeXs.map((x, index): [number, number] => [x, STREAM.middle + edgeWidths[index]]).reverse();
  return `${smoothPath(upper)}L${lower[0][0]} ${lower[0][1]}${smoothPath(lower).replace(/^M[^C]*/, '')}Z`;
}

/** 시간대별 출발량을 강물처럼 흐르는 띠로 그립니다. 띠가 두꺼울수록 출발이 많고, 가운데 물길이 지연입니다. */
function FlightStream({ stats, currentHour }: { stats: FlightStats; currentHour: number | null }) {
  const [active, setActive] = useState<number | null>(null);
  const [reduceMotion] = useState(prefersReducedMotion);
  const peak = Math.max(...stats.hourly.map(hour => hour.count), 1);
  const xs = stats.hourly.map(hour => 20 + ((hour.hour + 0.5) / 24) * (STREAM.width - 40));
  const step = (STREAM.width - 40) / 24;
  const shown = active === null ? null : stats.hourly[active];
  return <section className="icn-flightstats__card icn-flightstats__stream" aria-labelledby="flightstats-stream">
    <div className="icn-flightstats__section-head">
      <h2 id="flightstats-stream">하루 출발 물결</h2>
      <ul>
        <li><i className="is-normal" />출발</li>
        <li><i className="is-delayed" />그중 지연</li>
      </ul>
    </div>
    <p className="icn-flightstats__note">띠가 두꺼울수록 출발이 몰리는 시간이고, 가운데 물길이 넓을수록 지연이 많습니다.</p>
    <div className="icn-flightstats__stream-plot">
      <svg viewBox={`0 0 ${STREAM.width} ${STREAM.height}`} preserveAspectRatio="none" role="img" aria-label="시간대별 출발량과 지연량을 나타낸 흐름 그래프">
        <defs>
          <linearGradient id="flightstats-flow" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#cfe2f8" /><stop offset=".5" stopColor={COLORS.normal} /><stop offset="1" stopColor="#c4c6f2" />
          </linearGradient>
          <clipPath id="flightstats-reveal">
            <rect x="0" y="0" width={STREAM.width} height={STREAM.height}>
              {!reduceMotion && <animate attributeName="width" from="0" to={STREAM.width} dur="1.5s" fill="freeze" calcMode="spline" keySplines=".35 0 .25 1" keyTimes="0;1" />}
            </rect>
          </clipPath>
        </defs>
        <g clipPath="url(#flightstats-reveal)">
          <path d={ribbon(xs, stats.hourly.map(hour => (hour.count / peak) * STREAM.reach + 1))} fill="url(#flightstats-flow)" />
          <path d={ribbon(xs, stats.hourly.map(hour => (hour.delayedCount / peak) * STREAM.reach))} fill={COLORS.delayed} />
        </g>
        {currentHour !== null && <line x1={xs[currentHour]} x2={xs[currentHour]} y1="2" y2={STREAM.height - 2} stroke="#6d84a3" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />}
        {stats.hourly.map(hour => <rect
          key={hour.hour}
          x={xs[hour.hour] - step / 2}
          y="0"
          width={step}
          height={STREAM.height}
          fill={active === hour.hour ? 'rgba(90,130,190,.1)' : 'transparent'}
          tabIndex={0}
          aria-label={hourLabel(hour)}
          onMouseEnter={() => setActive(hour.hour)}
          onMouseLeave={() => setActive(null)}
          onFocus={() => setActive(hour.hour)}
          onBlur={() => setActive(null)}
        />)}
      </svg>
      <div className="icn-flightstats__stream-ticks" aria-hidden="true">
        {stats.hourly.filter(hour => hour.hour % 3 === 0).map(hour =>
          <span key={hour.hour} style={{ left: `${(xs[hour.hour] / STREAM.width) * 100}%` }}>{hour.hour}시</span>)}
      </div>
      {shown && <div className={`icn-flightstats__tooltip${shown.hour > 18 ? ' is-end' : shown.hour < 5 ? ' is-start-at' : ''}`} style={{ left: `${(xs[shown.hour] / STREAM.width) * 100}%`, top: '4%' }}>
        <b>{formatHour(shown.hour)}</b>
        <span>전체 <em>{shown.count}편</em></span>
        <span>지연 <em>{shown.delayedCount}편</em></span>
      </div>}
    </div>
  </section>;
}

function Highlights({ stats, currentHour }: { stats: FlightStats; currentHour: number | null }) {
  const busiest = stats.hourly.reduce((best, hour) => (hour.count > best.count ? hour : best), stats.hourly[0]);
  const worst = stats.hourly
    .filter(hour => hour.count >= MIN_FLIGHTS_FOR_RATE && hour.delayedCount > 0)
    .reduce<Hour | null>((best, hour) => (!best || delayRate(hour) > delayRate(best) ? hour : best), null);
  const remaining = currentHour === null ? null : stats.hourly.filter(hour => hour.hour > currentHour).reduce((sum, hour) => sum + hour.count, 0);
  return <dl className="icn-flightstats__highlights">
    <div className="icn-flightstats__card"><dt>가장 붐비는 시간</dt><dd>{formatHour(busiest.hour)}<span>{busiest.count}편 출발</span></dd></div>
    <div className="icn-flightstats__card"><dt>지연 비율 최고</dt><dd>{worst ? formatHour(worst.hour) : '없음'}<span>{worst ? `${delayRate(worst).toFixed(0)}%, ${worst.delayedCount}/${worst.count}편` : '지연편이 아직 없습니다'}</span></dd></div>
    <div className="icn-flightstats__card"><dt>남은 출발</dt><dd>{remaining === null ? '-' : `${formatNumber(remaining)}편`}<span>{remaining === null ? '오늘 날짜 데이터가 아닙니다' : currentHour === 23 ? '남은 시간대가 없습니다' : `${formatHour((currentHour ?? 0) + 1)} 이후`}</span></dd></div>
  </dl>;
}

function HourlyChart({ stats, currentHour }: { stats: FlightStats; currentHour: number | null }) {
  const peak = Math.max(...stats.hourly.map(hour => hour.count), 1);
  const peakRate = Math.max(...stats.hourly.filter(hour => hour.count >= MIN_FLIGHTS_FOR_RATE).map(delayRate), 20);
  return <section className="icn-flightstats__card" aria-labelledby="flightstats-hourly">
    <div className="icn-flightstats__section-head">
      <h2 id="flightstats-hourly">시간대별 출발</h2>
      <ul>
        <li><i className="is-normal" />지연 외</li>
        <li><i className="is-delayed" />지연</li>
        <li><i className="is-upcoming" />출발 전 시간대</li>
      </ul>
    </div>
    <div className="icn-flightstats__chart">
      {stats.hourly.map(hour => {
        const rate = delayRate(hour);
        const isUpcoming = currentHour !== null && hour.hour > currentHour;
        const isNow = hour.hour === currentHour;
        const align = hour.hour < 5 ? ' is-start' : hour.hour > 18 ? ' is-end' : '';
        return <button key={hour.hour} type="button" className={`icn-flightstats__hour${isUpcoming ? ' is-upcoming' : ''}${isNow ? ' is-now' : ''}`} aria-label={hourLabel(hour)}>
          <span className="icn-flightstats__plot">
            {hour.count === peak && <span className="icn-flightstats__peak">{hour.count}</span>}
            <span className="icn-flightstats__stack" style={{ height: `${(hour.count / peak) * 100}%`, animationDelay: `${hour.hour * 20}ms` }}>
              {hour.count > hour.delayedCount && <span className="is-normal" style={{ flexGrow: hour.count - hour.delayedCount }} />}
              {hour.delayedCount > 0 && <span className="is-delayed" style={{ flexGrow: hour.delayedCount }} />}
            </span>
          </span>
          <span className="icn-flightstats__heat" style={{ background: hour.count >= MIN_FLIGHTS_FOR_RATE ? `color-mix(in srgb, #f3a64a ${Math.round((rate / peakRate) * 100)}%, #f3f7fb)` : '#f3f6fa' }} />
          <span className={`icn-flightstats__tick${hour.hour % 3 === 0 ? ' is-major' : ''}`}>{isNow ? <b>지금</b> : hour.hour}</span>
          <span className={`icn-flightstats__tooltip is-hover${align}`} aria-hidden="true">
            <b>{formatHour(hour.hour)}</b>
            <span>전체 <em>{hour.count}편</em></span>
            <span>지연 <em>{hour.delayedCount}편</em></span>
            <span>지연율 <em>{rate.toFixed(0)}%</em></span>
          </span>
        </button>;
      })}
    </div>
    <p className="icn-flightstats__note">아래 띠는 지연율입니다. 진할수록 지연 비율이 높고, 5편 미만인 시간대는 표시하지 않습니다.</p>
  </section>;
}

const RADAR = { center: 180, inner: 34, outer: 150 };
const HIGH_DELAY_RATE = 20;
const SWEEP_TRAIL = [0, 8, 16, 24, 32, 40];

function polar(radius: number, degree: number) {
  const radian = ((degree - 90) * Math.PI) / 180;
  return [RADAR.center + radius * Math.cos(radian), RADAR.center + radius * Math.sin(radian)];
}

function sector(start: number, end: number) {
  const [x1, y1] = polar(RADAR.outer, start);
  const [x2, y2] = polar(RADAR.outer, end);
  return `M${RADAR.center} ${RADAR.center}L${x1.toFixed(1)} ${y1.toFixed(1)}A${RADAR.outer} ${RADAR.outer} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}Z`;
}

/** 관제 레이더처럼 시간대를 항적 점으로 표시합니다. 바깥일수록 출발이 많고, 점이 클수록 지연이 많습니다. */
function FlightRadar({ stats, currentHour }: { stats: FlightStats; currentHour: number | null }) {
  const [active, setActive] = useState<number | null>(null);
  const peak = Math.max(...stats.hourly.map(hour => hour.count), 1);
  const peakDelay = Math.max(...stats.hourly.map(hour => hour.delayedCount), 1);
  const focusHour = active ?? currentHour;
  const shown = focusHour === null ? null : stats.hourly[focusHour];
  return <section className="icn-flightstats__card icn-flightstats__radar-card" aria-labelledby="flightstats-radar">
    <div className="icn-flightstats__section-head">
      <h2 id="flightstats-radar">출발 레이더</h2>
      <ul>
        <li><i className="is-normal" />보통</li>
        <li><i className="is-delayed" />지연율 {HIGH_DELAY_RATE}% 이상</li>
      </ul>
    </div>
    <p className="icn-flightstats__note">점 하나가 한 시간대입니다. 바깥일수록 출발이 많고, 점이 클수록 지연이 많습니다.</p>
    <svg className="icn-flightstats__radar" viewBox="0 0 360 360" role="img" aria-label="시간대별 출발량과 지연량을 레이더 점으로 나타낸 차트">
      <defs>
        <radialGradient id="flightstats-scope">
          <stop offset="0" stopColor="#4f7cb0" /><stop offset="1" stopColor="#35598a" />
        </radialGradient>
      </defs>
      <circle cx="180" cy="180" r={RADAR.outer} fill="url(#flightstats-scope)" />
      {[0.34, 0.67, 1].map(ring => <circle key={ring} cx="180" cy="180" r={RADAR.outer * ring} fill="none" stroke="#a9c8ea" strokeOpacity=".35" />)}
      <path d="M30 180H330M180 30V330" stroke="#a9c8ea" strokeOpacity=".22" />
      <g className="icn-flightstats__sweep">
        {SWEEP_TRAIL.map((degree, index) => <path key={degree} d={sector(-degree - 8, -degree)} fill="#bfe0ff" opacity={0.3 - index * 0.05} />)}
        <path d="M180 180V30" stroke="#d9edff" strokeWidth="1.5" />
      </g>
      {stats.hourly.filter(hour => hour.count > 0).map(hour => {
        const [x, y] = polar(RADAR.inner + (hour.count / peak) * (RADAR.outer - RADAR.inner - 8), hour.hour * 15 + 7.5);
        const size = 4 + (hour.delayedCount / peakDelay) * 7;
        const isHigh = hour.count >= MIN_FLIGHTS_FOR_RATE && delayRate(hour) >= HIGH_DELAY_RATE;
        const isUpcoming = currentHour !== null && hour.hour > currentHour;
        return <g
          key={hour.hour}
          tabIndex={0}
          aria-label={hourLabel(hour)}
          className={`icn-flightstats__blip${hour.hour === active ? ' is-active' : ''}`}
          style={{ transformOrigin: `${x.toFixed(1)}px ${y.toFixed(1)}px`, animationDelay: `${hour.hour * 26}ms` }}
          onMouseEnter={() => setActive(hour.hour)}
          onMouseLeave={() => setActive(null)}
          onFocus={() => setActive(hour.hour)}
          onBlur={() => setActive(null)}
        >
          <circle cx={x} cy={y} r="14" fill="transparent" />
          <circle cx={x} cy={y} r={size + 4} fill={isHigh ? COLORS.delayed : '#bfe0ff'} opacity=".22" />
          <circle cx={x} cy={y} r={size} fill={isHigh ? COLORS.delayed : '#bfe0ff'} opacity={isUpcoming ? 0.5 : 1} />
        </g>;
      })}
    </svg>
    <p className="icn-flightstats__readout" aria-live="polite">
      {shown ? <><b>{formatHour(shown.hour)}</b><span>출발 {shown.count}편</span><span>지연 {shown.delayedCount}편</span><span>지연율 {delayRate(shown).toFixed(0)}%</span></> : <b>점을 선택하면 시간대 수치가 표시됩니다</b>}
    </p>
  </section>;
}

function HourlyTable({ stats }: { stats: FlightStats }) {
  return <details className="icn-flightstats__card icn-flightstats__table">
    <summary>시간대별 수치를 표로 보기</summary>
    <div>
      <table>
        <thead><tr><th scope="col">시간</th><th scope="col">전체</th><th scope="col">지연</th><th scope="col">지연율</th></tr></thead>
        <tbody>
          {stats.hourly.map(hour => <tr key={hour.hour}>
            <th scope="row">{formatHour(hour.hour)}</th>
            <td>{hour.count}</td>
            <td>{hour.delayedCount}</td>
            <td>{delayRate(hour).toFixed(1)}%</td>
          </tr>)}
        </tbody>
      </table>
    </div>
  </details>;
}

/** 운항통계 상세 화면. 출발편 기준이며 터미널 구분 없이 공항 전체를 집계합니다. */
export default function StatisticsPage() {
  const api = useApiResource(signal => getFlightStats('DEPARTURE', signal));
  const live = useLiveDepartureStats();
  const stats = live ?? api.data;
  const currentHour = useMemo(() => {
    const now = seoulNow();
    return stats?.date === now.date ? now.hour : null;
  }, [stats]);

  return <main className="icn-detail icn-flightstats">
    <div className="icn-detail__heading">
      <h1>운항통계</h1>
      <p>{stats ? `${formatDate(stats.date)} 출발편, 공항 전체 기준` : '인천공항 출발편 기준'}</p>
    </div>
    {!stats && <ApiStatus status={api.status} error={api.error} />}
    {stats && stats.total === 0 && <p className="icn-flightstats__empty">오늘 출발편 데이터가 아직 없습니다. 수집이 시작되면 이 화면에 표시됩니다.</p>}
    {stats && stats.total > 0 && <div className="icn-flightstats__grid">
      <ClimbScene stats={stats} currentHour={currentHour} />
      <div className="icn-flightstats__side">
        <Composition stats={stats} />
        <OnTimeGauge stats={stats} />
        <Highlights stats={stats} currentHour={currentHour} />
      </div>
      <HourlyChart stats={stats} currentHour={currentHour} />
      <FlightRadar stats={stats} currentHour={currentHour} />
      <FlightStream stats={stats} currentHour={currentHour} />
      <HourlyTable stats={stats} />
    </div>}
  </main>;
}