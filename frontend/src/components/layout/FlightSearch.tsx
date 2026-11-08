import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, FormEvent, KeyboardEvent, ReactNode } from 'react';
import { Search } from 'lucide-react';
import { getFlights } from '../../api/client';
import type { Flight } from '../../api/client';
import { useLiveUpdates } from '../../hooks/useLiveUpdates';

type Props = { onSearch: (flightNo: string) => void };

const REFRESH_MS = 60_000;
const MAX_SUGGESTIONS = 6;
const DROPDOWN_MAX_WIDTH = 440;
const VIEWPORT_GAP = 8;

const timeFormat = new Intl.DateTimeFormat('ko-KR', {
  hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul',
});

/** 공백을 지우고 대문자로 바꿔 비교용 문자열을 만듭니다. */
const normalize = (value: string) => value.replace(/\s+/g, '').toUpperCase();
const flightTime = (flight: Flight) => Date.parse(flight.estimatedAt ?? flight.scheduledAt);

/** 일치하는 글자를 노란색으로 표시합니다. 공백이 섞인 문자열도 원문 위치를 따라갑니다. */
function Highlight({ text, query }: { text: string; query: string }): ReactNode {
  if (!query) return text;
  // 공백을 뺀 위치와 원문 위치를 이어 둡니다.
  const positions: number[] = [];
  let compact = '';
  [...text].forEach((char, index) => {
    if (/\s/.test(char)) return;
    positions.push(index);
    compact += char.toUpperCase();
  });
  const at = compact.indexOf(query);
  if (at < 0) return text;
  const start = positions[at];
  const end = positions[at + query.length - 1] + 1;
  return <>{text.slice(0, start)}<mark>{text.slice(start, end)}</mark>{text.slice(end)}</>;
}

/** 출발·도착 목록에서 입력값과 맞는 항공편을 골라 냅니다. */
function findSuggestions(flights: Flight[], query: string, now: number) {
  if (!query) return [];
  // 같은 편명은 현재 시각과 가장 가까운 편만 남깁니다.
  const nearest = new Map<string, Flight>();
  for (const flight of flights) {
    const code = normalize(flight.flightNo);
    if (!code.includes(query) && !normalize(flight.city ?? '').includes(query)) continue;
    const saved = nearest.get(code);
    if (!saved || Math.abs(flightTime(flight) - now) < Math.abs(flightTime(saved) - now)) nearest.set(code, flight);
  }
  return [...nearest.values()]
    .sort((a, b) => {
      const aStarts = normalize(a.flightNo).startsWith(query) ? 0 : 1;
      const bStarts = normalize(b.flightNo).startsWith(query) ? 0 : 1;
      return aStarts - bStarts || Math.abs(flightTime(a) - now) - Math.abs(flightTime(b) - now);
    })
    .slice(0, MAX_SUGGESTIONS);
}

/** 상단 메뉴의 편명 검색창입니다. 공백을 지우고 대문자로 바꿔 넘기며, 오늘 항공편으로 자동완성합니다. */
export default function FlightSearch({ onSearch }: Props) {
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [position, setPosition] = useState<CSSProperties>({});
  const formRef = useRef<HTMLFormElement>(null);
  const listId = useId();

  // 목록을 못 불러와도 직접 입력 후 조회는 그대로 동작합니다.
  const departures = useLiveUpdates<Flight[]>({
    topic: null,
    fetcher: signal => getFlights('DEPARTURE', signal),
    resourceKey: 'search-departure',
    intervalMs: REFRESH_MS,
  });
  const arrivals = useLiveUpdates<Flight[]>({
    topic: null,
    fetcher: signal => getFlights('ARRIVAL', signal),
    resourceKey: 'search-arrival',
    intervalMs: REFRESH_MS,
  });

  const query = normalize(value);
  const suggestions = useMemo(
    () => findSuggestions([...(departures.data ?? []), ...(arrivals.data ?? [])], query, Date.now()),
    [departures.data, arrivals.data, query],
  );
  const listLoading = !departures.data && !arrivals.data && (departures.loading || arrivals.loading);
  const expanded = open && query.length > 0;
  const optionId = (index: number) => `${listId}-option-${index}`;

  // 메뉴가 가로로 스크롤되는 좁은 화면에서도 잘리지 않도록 화면 기준으로 자리를 잡습니다.
  useLayoutEffect(() => {
    if (!expanded) return;
    const place = () => {
      const rect = formRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewport = document.documentElement.clientWidth;
      const width = Math.min(Math.max(rect.width, Math.min(DROPDOWN_MAX_WIDTH, viewport)), viewport - VIEWPORT_GAP * 2);
      const left = Math.min(Math.max(rect.right - width, VIEWPORT_GAP), viewport - width - VIEWPORT_GAP);
      setPosition({ top: rect.bottom + 6, left, width });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [expanded]);

  // 검색창 바깥을 누르면 닫습니다.
  useEffect(() => {
    if (!expanded) return;
    const close = (event: PointerEvent) => {
      if (!formRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [expanded]);

  const choose = (flightNo: string) => {
    setValue(flightNo);
    setOpen(false);
    setActive(-1);
    onSearch(normalize(flightNo));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (expanded && active >= 0 && suggestions[active]) {
      choose(suggestions[active].flightNo);
      return;
    }
    setOpen(false);
    if (query) onSearch(query);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setOpen(false);
      setActive(-1);
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    if (!query) return;
    setOpen(true);
    if (suggestions.length === 0) return;
    const step = event.key === 'ArrowDown' ? 1 : -1;
    setActive(current => (current + step + suggestions.length) % suggestions.length);
  };

  return <form className="icn-flight-search" role="search" onSubmit={submit} ref={formRef}>
    <Search size={16} aria-hidden="true" />
    <input
      type="search"
      value={value}
      onChange={event => {
        setValue(event.target.value);
        setOpen(true);
        setActive(-1);
      }}
      onFocus={() => setOpen(true)}
      onKeyDown={onKeyDown}
      placeholder="내 편명 검색 (예: KE703)"
      aria-label="편명 검색"
      role="combobox"
      aria-autocomplete="list"
      aria-expanded={expanded}
      aria-controls={listId}
      aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
      maxLength={10}
      autoComplete="off"
      spellCheck={false}
    />
    <button type="submit">조회</button>

    {expanded && <div className="icn-flight-suggest" style={position}>
      <ul id={listId} role="listbox" aria-label="편명 자동완성">
        {suggestions.map((flight, index) => {
          const departure = flight.type === 'DEPARTURE';
          const time = flight.estimatedAt ?? flight.scheduledAt;
          return <li
            key={`${flight.flightNo}-${flight.type}`}
            id={optionId(index)}
            role="option"
            aria-selected={index === active}
            className={index === active ? 'is-active' : ''}
            onPointerDown={event => event.preventDefault()}
            onPointerEnter={() => setActive(index)}
            onClick={() => choose(flight.flightNo)}>
            <strong><Highlight text={flight.flightNo} query={query} /></strong>
            <em data-type={flight.type}>{departure ? '출발' : '도착'}</em>
            <span className="icn-flight-suggest__city"><Highlight text={flight.city ?? '-'} query={query} /></span>
            <time dateTime={time}>{Number.isFinite(Date.parse(time)) ? timeFormat.format(new Date(time)) : '-'}</time>
            <span className="icn-flight-suggest__gate">{flight.gate ? `G${flight.gate}` : '-'}</span>
          </li>;
        })}
      </ul>
      {suggestions.length === 0 && <p role="status">
        {listLoading ? '항공편 목록을 불러오는 중입니다.' : '일치하는 항공편이 없습니다'}
      </p>}
    </div>}
  </form>;
}
