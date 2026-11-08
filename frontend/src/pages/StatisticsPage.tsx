import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import ApiStatus from '../components/layout/ApiStatus';
import Skeleton from '../components/layout/Skeleton';
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
const COLORS = { normal: '#4f92cf', delayed: '#e7a54b', cancelled: '#dc6c73', diverted: '#a494ec' };
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

const CLIMB = { left: 34, right: 786, width: 820, baseHeight: 380, minHeight: 240, groundDepth: 58, top: 44 };

/** 시간대별 예정편을 누적해, 하루의 출발 흐름을 항공기 상승 곡선으로 그립니다. */
function ClimbScene({ stats, currentHour }: { stats: FlightStats; currentHour: number | null }) {
  const [active, setActive] = useState<number | null>(null);
  const [sceneHeight, setSceneHeight] = useState(CLIMB.baseHeight);
  const plotRef = useRef<HTMLDivElement>(null);

  // 패널 비율에 맞춰 그림 높이를 정합니다. 곡선의 위쪽이 잘리지 않게 하기 위함입니다.
  useEffect(() => {
    const plot = plotRef.current;
    if (!plot) return;
    const measure = () => {
      if (!plot.clientWidth || !plot.clientHeight) return;
      const next = Math.round((CLIMB.width * plot.clientHeight) / plot.clientWidth);
      setSceneHeight(Math.max(CLIMB.minHeight, next));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(plot);
    measure();
    return () => observer.disconnect();
  }, []);

  const ground = sceneHeight - CLIMB.groundDepth;
  const points = useMemo(() => {
    const scale = (ground - CLIMB.top) / Math.max(stats.total, 1);
    const toX = (hour: number) => CLIMB.left + (hour / 24) * (CLIMB.right - CLIMB.left);
    let flights = 0;
    let delayed = 0;
    const result = [{ x: toX(0), y: ground, delayY: ground, flights: 0 }];
    for (const hour of stats.hourly) {
      flights += hour.count;
      delayed += hour.delayedCount;
      result.push({ x: toX(hour.hour + 1), y: ground - flights * scale, delayY: ground - delayed * scale, flights });
    }
    return result;
  }, [stats, ground]);
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
    <div className="icn-flightstats__scene-plot" ref={plotRef}>
      <svg viewBox={`0 0 ${CLIMB.width} ${sceneHeight}`} preserveAspectRatio="xMidYMax meet" role="img" aria-label="하루 누적 출발 예정 편수와 누적 지연 편수를 나타낸 상승 곡선">
        <g transform={`translate(0 ${sceneHeight - CLIMB.baseHeight})`}>
          <g fill="#9cc4ee" opacity=".16">
            <ellipse cx="200" cy="82" rx="58" ry="20" /><circle cx="180" cy="72" r="24" /><circle cx="218" cy="66" r="31" />
          </g>
          <g fill="#9cc4ee" opacity=".12">
            <ellipse cx="460" cy="158" rx="46" ry="15" /><circle cx="446" cy="150" r="18" /><circle cx="476" cy="146" r="23" />
          </g>
          <g fill="#0d2748">
            <path d="M648 322v-74h-9l9-20h34l9 20h-9v74z" />
            <rect x="655" y="210" width="20" height="8" rx="2" /><rect x="663" y="218" width="4" height="10" />
            <path d="M520 322v-28c44-18 92-18 128-6v34zM682 322v-34c34-11 70-11 104-2v36z" />
          </g>
          <rect x="0" y="322" width="820" height="58" fill="#16304f" />
          <rect x="0" y="360" width="820" height="20" fill="#0f2744" />
          {stats.hourly.filter(hour => hour.hour % 3 === 0).map(hour =>
            <g key={hour.hour}>
              <circle cx={points[hour.hour].x} cy="341" r="3.5" fill="#ffe6a8" />
              <text x={points[hour.hour].x} y="374" textAnchor="middle" className="icn-flightstats__scene-tick">{hour.hour}시</text>
            </g>)}
        </g>
        <path className="icn-flightstats__fade-in" d={`${toPath(flown, 'y')} L${lastFlown.x} ${ground} L${CLIMB.left} ${ground} Z`} fill="#fff" opacity=".3" />
        <path className="icn-flightstats__draw" pathLength={1} d={toPath(flown, 'y')} fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        {ahead.length > 1 && <path d={toPath(ahead, 'y')} fill="none" stroke="#fff" strokeWidth="3" strokeDasharray="2 10" strokeLinecap="round" />}
        <path className="icn-flightstats__draw" pathLength={1} d={toPath(flown, 'delayY')} fill="none" stroke={COLORS.delayed} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {plane && <g key={sceneHeight} className="icn-flightstats__plane" style={{ offsetPath: `path('${toPath(flown, 'y')}')` }}>
          <g transform="rotate(90) scale(1.75) translate(-11.5 -12)"><path d={PLANE_PATH} fill="#fff" stroke="#6f9bd0" strokeWidth=".5" /></g>
        </g>}
        {shownPoint && <circle cx={shownPoint.x} cy={shownPoint.y} r="6" fill="#4f86c8" stroke="#fff" strokeWidth="2" />}
        <g>
          {stats.hourly.map(hour => <rect
            key={hour.hour}
            x={points[hour.hour].x}
            y={CLIMB.top - 14}
            width={points[hour.hour + 1].x - points[hour.hour].x}
            height={ground - CLIMB.top + 14}
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
        style={{ left: `${(shownPoint.x / CLIMB.width) * 100}%`, top: `${Math.max((shownPoint.y / sceneHeight) * 100 - 6, 2)}%` }}
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

const WAVE = { top: .1, floor: .97, delayMax: .34 };
const WAVE_LAYERS = [
  { amplitude: 10, length: 240, speed: .8, alpha: .32 },
  { amplitude: 7, length: 150, speed: -1.1, alpha: .45 },
  { amplitude: 5, length: 92, speed: 1.5, alpha: 1 },
];
const BUBBLE_COUNT = 26;

/** 앞뒤 시간을 섞어 수면이 뾰족한 산이 아니라 완만한 물결이 되도록 합니다. */
function softened(values: number[]) {
  return values.map((_, index) => {
    const around = [-2, -1, 0, 1, 2].map(offset => values[Math.max(0, Math.min(values.length - 1, index + offset))]);
    return (around[0] + around[1] * 2 + around[2] * 3 + around[3] * 2 + around[4]) / 9;
  });
}

function smoothLevel(values: number[], position: number) {
  const scaled = Math.max(0, Math.min(position * (values.length - 1), values.length - 1));
  const left = Math.floor(scaled);
  const right = Math.min(left + 1, values.length - 1);
  const ratio = scaled - left;
  const eased = ratio * ratio * (3 - 2 * ratio);
  return values[left] + (values[right] - values[left]) * eased;
}

/** 시간대별 출발량을 수조의 수위처럼 그립니다. 수면이 높을수록 출발이 많고, 바닥의 호박색 층이 지연입니다. */
function FlightStream({ stats, currentHour }: { stats: FlightStats; currentHour: number | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const shown = active === null ? null : stats.hourly[active];

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    const peak = Math.max(...stats.hourly.map(hour => hour.count), 1);
    const levels = softened(stats.hourly.map(hour => .24 + (hour.count / peak) * .7));
    const delays = softened(stats.hourly.map(hour => hour.delayedCount / peak));
    const bubbles = Array.from({ length: BUBBLE_COUNT }, (_, index) => ({
      x: (index * 37 % 100) / 100,
      phase: (index * 53 % 100) / 100,
      size: 1 + (index % 3) * .8,
      speed: .05 + (index % 5) * .012,
    }));
    let width = 0;
    let height = 0;
    let frame = 0;

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const surface = (x: number, time: number, layer: (typeof WAVE_LAYERS)[number]) => {
      const usable = height * (WAVE.floor - WAVE.top);
      const base = height * WAVE.floor - smoothLevel(levels, x / width) * usable;
      const ripple = Math.sin((x / layer.length) * Math.PI * 2 + time * layer.speed) * layer.amplitude
        + Math.sin((x / (layer.length * .43)) * Math.PI * 2 - time * layer.speed * .7) * layer.amplitude * .35;
      return base + ripple;
    };

    const draw = (time: number) => {
      context.clearRect(0, 0, width, height);
      const sky = context.createLinearGradient(0, 0, 0, height);
      sky.addColorStop(0, '#f3f8fd');
      sky.addColorStop(1, '#e3eef8');
      context.fillStyle = sky;
      context.fillRect(0, 0, width, height);

      WAVE_LAYERS.forEach((layer, index) => {
        context.beginPath();
        context.moveTo(0, height);
        for (let x = 0; x <= width; x += 3) context.lineTo(x, surface(x, time, layer) + (2 - index) * 7);
        context.lineTo(width, height);
        context.closePath();
        const water = context.createLinearGradient(0, height * WAVE.top, 0, height);
        water.addColorStop(0, '#a9d3f3');
        water.addColorStop(.42, '#6aa8dc');
        water.addColorStop(1, '#2f6fae');
        context.globalAlpha = layer.alpha;
        context.fillStyle = water;
        context.fill();
      });
      context.globalAlpha = 1;

      const front = WAVE_LAYERS[2];
      context.save();
      context.beginPath();
      context.moveTo(0, height);
      for (let x = 0; x <= width; x += 3) context.lineTo(x, surface(x, time, front));
      context.lineTo(width, height);
      context.closePath();
      context.clip();

      for (let beam = 0; beam < 6; beam += 1) {
        const x = ((beam + .5) / 6) * width + Math.sin(time * .4 + beam * 1.7) * 26;
        const light = context.createLinearGradient(0, 0, 0, height);
        light.addColorStop(0, 'rgba(255,255,255,.1)');
        light.addColorStop(1, 'rgba(255,255,255,0)');
        context.fillStyle = light;
        context.beginPath();
        context.moveTo(x - 14, 0);
        context.lineTo(x + 18, 0);
        context.lineTo(x + 54, height);
        context.lineTo(x - 28, height);
        context.closePath();
        context.fill();
      }

      for (const bubble of bubbles) {
        const progress = (bubble.phase + time * bubble.speed) % 1;
        const x = bubble.x * width + Math.sin(time + bubble.phase * 9) * 5;
        const y = height - progress * height * .92;
        context.beginPath();
        context.arc(x, y, bubble.size, 0, Math.PI * 2);
        context.fillStyle = `rgba(255,255,255,${(.5 * (1 - progress)).toFixed(2)})`;
        context.fill();
      }

      context.beginPath();
      context.moveTo(0, height);
      for (let x = 0; x <= width; x += 3) {
        const level = smoothLevel(delays, x / width) * height * WAVE.delayMax * 2.4;
        context.lineTo(x, height - level + Math.sin(x / 46 + time * 1.1) * 1.6);
      }
      context.lineTo(width, height);
      context.closePath();
      const delay = context.createLinearGradient(0, height * .6, 0, height);
      delay.addColorStop(0, 'rgba(240,190,110,.95)');
      delay.addColorStop(1, 'rgba(231,165,75,.95)');
      context.fillStyle = delay;
      context.fill();
      context.restore();

      context.beginPath();
      for (let x = 0; x <= width; x += 3) {
        const y = surface(x, time, front);
        if (x) context.lineTo(x, y);
        else context.moveTo(x, y);
      }
      context.strokeStyle = 'rgba(255,255,255,.85)';
      context.lineWidth = 1.6;
      context.stroke();

      if (currentHour !== null) {
        const x = ((currentHour + .5) / 24) * width;
        context.setLineDash([3, 5]);
        context.strokeStyle = 'rgba(11,43,82,.5)';
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(x, 4);
        context.lineTo(x, height);
        context.stroke();
        context.setLineDash([]);
      }
    };

    const observer = new ResizeObserver(() => {
      resize();
      draw(0);
    });
    observer.observe(canvas);
    resize();
    if (prefersReducedMotion()) {
      draw(0);
    } else {
      const animate = (now: number) => {
        draw(now / 1000);
        frame = requestAnimationFrame(animate);
      };
      frame = requestAnimationFrame(animate);
    }
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [stats, currentHour]);

  return <section className="icn-flightstats__card icn-flightstats__stream" aria-labelledby="flightstats-stream">
    <div className="icn-flightstats__section-head">
      <h2 id="flightstats-stream">하루 출발 물결</h2>
      <ul>
        <li><i className="is-normal" />출발</li>
        <li><i className="is-delayed" />그중 지연</li>
      </ul>
    </div>
    <div className="icn-flightstats__stream-plot">
      <canvas ref={canvasRef} aria-hidden="true" />
      <div className="icn-flightstats__stream-hours">
        {stats.hourly.map(hour => <button
          type="button"
          key={hour.hour}
          aria-label={hourLabel(hour)}
          onMouseEnter={() => setActive(hour.hour)}
          onMouseLeave={() => setActive(null)}
          onFocus={() => setActive(hour.hour)}
          onBlur={() => setActive(null)} />)}
      </div>
      <div className="icn-flightstats__stream-ticks" aria-hidden="true">
        {stats.hourly.filter(hour => hour.hour % 3 === 0).map(hour =>
          <span key={hour.hour} style={{ left: `${((hour.hour + .5) / 24) * 100}%` }}>{hour.hour}시</span>)}
      </div>
      {shown && <div
        className={`icn-flightstats__tooltip${shown.hour > 18 ? ' is-end' : shown.hour < 5 ? ' is-start-at' : ''}`}
        style={{ left: `${((shown.hour + .5) / 24) * 100}%`, top: '6%' }}>
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
    <svg className="icn-flightstats__radar" viewBox="0 0 360 360" role="img" aria-label="시간대별 출발량과 지연량을 레이더 점으로 나타낸 차트">
      <defs>
        <radialGradient id="flightstats-scope">
          <stop offset="0" stopColor="#1b4a7f" /><stop offset="1" stopColor="#0b2b52" />
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
    <div className="icn-flightstats__top">
      <div className="icn-detail__heading">
        <h1>운항통계</h1>
        <p>{stats ? `${formatDate(stats.date)} 출발편, 공항 전체 기준` : '인천공항 출발편 기준'}</p>
      </div>
      {stats && stats.total > 0 && <Highlights stats={stats} currentHour={currentHour} />}
    </div>
    {!stats && api.status === 'loading' && <Skeleton label="운항통계를 불러오는 중입니다." variant="cards" count={3} />}
    {!stats && api.status === 'error' && <ApiStatus status={api.status} error={api.error} />}
    {stats && stats.total === 0 && <p className="icn-flightstats__empty">오늘 출발편 데이터가 아직 없습니다. 수집이 시작되면 이 화면에 표시됩니다.</p>}
    {stats && stats.total > 0 && <div className="icn-flightstats__grid">
      <ClimbScene stats={stats} currentHour={currentHour} />
      <HourlyChart stats={stats} currentHour={currentHour} />
      <FlightStream stats={stats} currentHour={currentHour} />
      <Composition stats={stats} />
      <OnTimeGauge stats={stats} />
      <FlightRadar stats={stats} currentHour={currentHour} />
    </div>}
  </main>;
}