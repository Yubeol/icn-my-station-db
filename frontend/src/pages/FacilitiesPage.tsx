import { useEffect, useMemo, useState } from 'react';
import { Armchair, Coffee, MoreHorizontal, Pill, Search, ShoppingBag, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { getFacilities } from '../api/client';
import AirportScene from '../components/main/Facilities/AirportScene';
import { buildFloorMap, MAP_FLOORS, normalizeFloor } from '../components/main/Facilities/facilityMap';
import type { MapTerminal, Place } from '../components/main/Facilities/facilityMap';
import { useLiveUpdates } from '../hooks/useLiveUpdates';
import Skeleton from '../components/layout/Skeleton';
import './FacilitiesPage.css';

const PAGE_SIZE = 40;
const TERMINALS: MapTerminal[] = ['T1', 'T2'];
const FLOORS = MAP_FLOORS;
const LEGEND = [
  { key: 'FOOD_CAFE', label: '식음료' },
  { key: 'SHOPPING', label: '쇼핑' },
  { key: 'LOUNGE', label: '라운지' },
  { key: 'PHARMACY', label: '약국' },
  { key: 'ETC', label: '기타' },
];
const CATEGORIES: { key: string; label: string; icon: LucideIcon | null }[] = [
  { key: 'ALL', label: '전체', icon: null },
  { key: 'FOOD_CAFE', label: '식음료', icon: Coffee },
  { key: 'SHOPPING', label: '쇼핑', icon: ShoppingBag },
  { key: 'LOUNGE', label: '라운지', icon: Armchair },
  { key: 'PHARMACY', label: '약국', icon: Pill },
  { key: 'ETC', label: '기타', icon: MoreHorizontal },
];
const CROWD_LABEL = { LOW: '여유', MID: '보통', HIGH: '혼잡' };
const BASIS_LABEL: Record<string, string> = { HALL: '출국장 기준', TERMINAL: '터미널 기준', FLIGHTS: '출발편 기준' };

const iconOf = (category: string) => CATEGORIES.find(item => item.key === category)?.icon ?? MoreHorizontal;

function statusText(place: Place) {
  if (place.isOpen === true) return '운영 중';
  if (place.isOpen === false) return '운영 종료';
  return '운영 정보 없음';
}

function hoursText(place: Place) {
  if (place.is24h) return '24시간';
  if (place.openTime && place.closeTime) return `${place.openTime} ~ ${place.closeTime}`;
  return '정보 없음';
}

function FacilityPass({ place, onClose }: { place: Place; onClose: () => void }) {
  const Icon = iconOf(place.category);
  return <aside className="fac-pass" aria-label={`${place.name} 시설 정보`}>
    <div className="fac-pass__head">
      <small>FACILITY PASS</small>
      <button type="button" aria-label="시설 정보 닫기" onClick={onClose}><X size={18} /></button>
      <h2>{place.name}</h2>
      <span><Icon size={13} /> {statusText(place)}</span>
    </div>
    <div className="fac-pass__route">
      <div><small>TERMINAL</small><strong>{place.terminal ?? '—'}</strong></div>
      <i aria-hidden="true">✈</i>
      <div><small>FLOOR</small><strong>{place.floor ?? '—'}</strong></div>
    </div>
    <dl className="fac-pass__body">
      <dt>위치</dt><dd>{place.location}</dd>
      <dt>운영시간</dt><dd>{hoursText(place)}</dd>
      {place.items && <><dt>취급 품목</dt><dd>{place.items}</dd></>}
      {place.tel && <><dt>전화번호</dt><dd>{place.tel}</dd></>}
      {place.crowdEstimate && <>
        <dt>주변 혼잡 예상</dt>
        <dd><b data-level={place.crowdEstimate}>{CROWD_LABEL[place.crowdEstimate]}</b> {BASIS_LABEL[place.crowdBasis ?? ''] ?? ''} · 실측값 아님</dd>
      </>}
    </dl>
    <div className="fac-pass__barcode" aria-hidden="true" />
  </aside>;
}

export default function FacilitiesPage() {
  const { data, loading, error } = useLiveUpdates<Place[]>({
    topic: null,
    fetcher: getFacilities,
    intervalMs: 60_000,
  });
  const [terminal, setTerminal] = useState<MapTerminal>('T1');
  const [category, setCategory] = useState('ALL');
  const [search, setSearch] = useState('');
  const [openOnly, setOpenOnly] = useState(false);
  const [floor, setFloor] = useState('3F');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [allFloors, setAllFloors] = useState(false);

  const filtered = useMemo(() => {
    const word = search.trim().toLowerCase();
    return (data ?? []).filter(place => {
      if (place.terminal !== terminal) return false;
      if (category !== 'ALL' && place.category !== category) return false;
      if (openOnly && place.isOpen !== true) return false;
      if (!word) return true;
      return `${place.name} ${place.location} ${place.items ?? ''}`.toLowerCase().includes(word);
    });
  }, [data, terminal, category, openOnly, search]);

  const floorMap = useMemo(
    () => buildFloorMap(filtered, terminal, floor, selectedId),
    [filtered, terminal, floor, selectedId],
  );
  const floorPlaces = useMemo(() => filtered.filter(place => normalizeFloor(place.floor) === floor), [filtered, floor]);
  const list = allFloors ? filtered : floorPlaces;
  const selected = filtered.find(place => place.facilityId === selectedId) ?? null;
  const selectedFloor = selected ? normalizeFloor(selected.floor) : null;
  const onMap = floorMap.units.some(unit => unit.place.facilityId === selectedId);
  const mapNotice = !selected || onMap ? null
    : selectedFloor && selectedFloor !== floor && FLOORS.includes(selectedFloor) ? `${selectedFloor} 지도에서 확인할 수 있어요`
    : '상세 위치 정보 없음';

  useEffect(() => {
    setSelectedId(null);
    setLimit(PAGE_SIZE);
  }, [terminal, floor, category, openOnly, search]);

  return <main className="icn-detail fac-page">
    <aside className="fac-explorer">
      <div>
        <small>FACILITY EXPLORER</small>
        <h1>어디를 찾으세요?</h1>
      </div>
      <label className="fac-search">
        <Search size={16} aria-hidden="true" />
        <input type="search" value={search} placeholder="시설명, 위치, 취급 품목" aria-label="시설 검색" onChange={event => setSearch(event.target.value)} />
      </label>
      <div className="fac-terminal" role="group" aria-label="터미널 선택">
        {TERMINALS.map(item => (
          <button type="button" key={item} aria-pressed={terminal === item} onClick={() => setTerminal(item)}>{item}</button>
        ))}
      </div>
      <div className="fac-categories" role="group" aria-label="시설 분류">
        {CATEGORIES.map(item => {
          const Icon = item.icon;
          return <button type="button" key={item.key} aria-pressed={category === item.key} onClick={() => setCategory(item.key)}>
            {Icon && <Icon size={14} />}{item.label}
          </button>;
        })}
      </div>
      <label className="fac-open">
        <input type="checkbox" checked={openOnly} onChange={event => setOpenOnly(event.target.checked)} />
        운영 중만 보기
      </label>
      <div className="fac-count">
        <span>{allFloors ? '전체 층' : `${floor} 시설`} <b>{list.length.toLocaleString('ko-KR')}</b></span>
        <button type="button" aria-pressed={allFloors} onClick={() => { setAllFloors(value => !value); setLimit(PAGE_SIZE); }}>{allFloors ? `${floor}만 보기` : '다른 층 포함'}</button>
      </div>
      <div className="fac-list">
        {loading && !data && <Skeleton label="시설을 불러오는 중입니다." variant="rows" count={6} />}
        {error && !data && <p role="alert">{error}</p>}
        {data && list.length === 0 && <p>조건에 맞는 시설이 없습니다.</p>}
        {list.slice(0, limit).map(place => {
          const Icon = iconOf(place.category);
          return <button
            type="button"
            key={place.facilityId}
            className={place.facilityId === selectedId ? 'is-active' : ''}
            onClick={() => setSelectedId(place.facilityId)}>
            <i><Icon size={16} /></i>
            <span><strong>{place.name}</strong><small>{place.floor ?? '층 미확인'} · {statusText(place)}</small></span>
            {place.crowdEstimate && <em data-level={place.crowdEstimate}>{CROWD_LABEL[place.crowdEstimate]}</em>}
          </button>;
        })}
        {list.length > limit && <button type="button" className="fac-list__more" onClick={() => setLimit(value => value + PAGE_SIZE)}>더 보기</button>}
      </div>
    </aside>

    <section className="fac-map" aria-label={`${terminal} 시설 지도`}>
      <AirportScene
        terminal={terminal}
        floor={floor}
        map={floorMap}
        selectedId={selectedId}
        onPickPlace={id => setSelectedId(id)} />
      <div className="fac-map__title"><strong>{terminal}</strong><span>{floor} 개략도 · 드래그 회전, 휠 확대</span></div>
      <div className="fac-floor" role="group" aria-label="층 선택">
        {FLOORS.map(item => (
          <button type="button" key={item} aria-pressed={floor === item} onClick={() => setFloor(item)}>{item}</button>
        ))}
      </div>
      <ul className="fac-legend" aria-hidden="true">
        {LEGEND.map(item => <li key={item.key} data-category={item.key}>{item.label}</li>)}
      </ul>
      <p className="fac-map__note">위치 문장의 게이트·출국장·출입구·동편/서편/중앙 등으로 구역만 나눈 개략 위치입니다. 작은 숫자는 구역별 시설 수이며 구역 이름은 마우스를 올리면 보입니다. 칸의 순서는 실제 위치가 아니고, 칸이 모자란 구역은 왼쪽 목록에서 이어서 찾을 수 있습니다.</p>
      {mapNotice && <p className="fac-map__notice" role="status">{mapNotice}</p>}
      {selected && <FacilityPass place={selected} onClose={() => setSelectedId(null)} />}
    </section>
  </main>;
}
