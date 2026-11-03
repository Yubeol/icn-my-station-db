import { useState } from 'react';
import { getDashboardSummary } from '../../api/client';
import { useApiResource } from '../../hooks/useApiResource';
import ApiStatus from '../layout/ApiStatus';
import PlaceholderBox from '../layout/PlaceholderBox';
import SectionBox from '../layout/SectionBox';
import type { PageKey } from '../../App';

type Props = { navigate: (page: PageKey) => void };

/** 메인 화면은 각 상세 페이지의 데이터를 배치할 자리만 담당합니다. */
export default function MainDashboard({ navigate }: Props) {
  const [terminal, setTerminal] = useState<'T1' | 'T2'>('T1');
  const summary = useApiResource(getDashboardSummary);
  // summary.data는 모든 영역에 전달 가능한 API 응답입니다.
  // 현재는 데이터 UI를 만들지 않고 각 영역의 자리만 유지합니다.
  return <main className="icn-dashboard">
    <div className="icn-dashboard__left">
      <ApiStatus status={summary.status} error={summary.error} />
      <SectionBox title="운행현황" className="icn-summary" onNavigate={() => navigate('flights')}>
        <PlaceholderBox label="운행현황 요약 영역" detail="운행현황 담당자" />
      </SectionBox>
      <SectionBox title="운항통계" className="icn-stats" onNavigate={() => navigate('statistics')}>
        <PlaceholderBox label="운항통계 요약 영역" detail="운항통계 담당자" />
      </SectionBox>
    </div>
    <div className="icn-dashboard__center">
      <SectionBox title="출국장 혼잡도" className="icn-congestion" onNavigate={() => navigate('congestion')}>
        <div className="icn-terminal" role="group" aria-label="터미널 선택">
          {(['T1', 'T2'] as const).map(t => <button type="button" key={t} aria-pressed={terminal === t} className={terminal === t ? 'is-active' : ''} onClick={() => setTerminal(t)}>{t}</button>)}
        </div>
        <PlaceholderBox className="icn-congestion__map" label={`${terminal} 출국장 혼잡도 지도 영역`} detail="출국장 혼잡도 담당자" />
        <PlaceholderBox className="icn-congestion__details" label="출국장별 혼잡 현황 영역" detail="출국장 혼잡도 담당자" />
      </SectionBox>
    </div>
    <div className="icn-dashboard__right">
      <SectionBox title="날씨 · 운항 확률" className="icn-weather" onNavigate={() => navigate('weather')}>
        <PlaceholderBox label="날씨 · 운항 확률 요약 영역" detail="날씨 담당자" />
      </SectionBox>
      <SectionBox title="스마트 알림" className="icn-alerts" onNavigate={() => navigate('alerts')}>
        <PlaceholderBox label="스마트 알림 최신 3개 영역" detail="스마트 알림 담당자" />
      </SectionBox>
      <SectionBox title="편의시설" className="icn-facilities" onNavigate={() => navigate('facilities')}>
        <PlaceholderBox label="가장 여유로운 편의시설 3곳 영역" detail="편의시설 담당자" />
      </SectionBox>
      <div className="icn-barcode" aria-hidden="true"><i/><span>ICN · MY STATION</span></div>
    </div>
  </main>;
}
