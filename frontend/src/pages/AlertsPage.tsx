import PlaceholderBox from '../components/layout/PlaceholderBox';
import ApiStatus from '../components/layout/ApiStatus';
import { getAlerts } from '../api/client';
import { useApiResource } from '../hooks/useApiResource';

/** 스마트 알림 담당자: 상세 화면 UI는 이 파일에서 독립 구현합니다. */
export default function AlertsPage() {
  const api = useApiResource(signal => getAlerts(signal));
  // api.data에 실제 응답이 들어갑니다. UI는 담당 팀원이 구현합니다.
  return <main className="icn-detail">
    <div className="icn-detail__heading"><h1>스마트 알림</h1><p>담당 페이지 독립 개발 영역</p></div>
    <ApiStatus status={api.status} error={api.error} />
    <PlaceholderBox className="icn-detail__content" label="스마트 알림 상세 화면 영역" />
  </main>;
}
