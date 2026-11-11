import { yoloEventName } from '../../api/yolo'
import { YOLO_STATUS_LABEL, yoloPlace } from '../../api/yoloAlerts'
import type { FeedAlert } from '../../api/yoloAlerts'
import './yolo.css'

const fullFormat = new Intl.DateTimeFormat('ko-KR', {
  month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Seoul',
})

type Props = {
  alert: FeedAlert
  /** [CCTV로 현장 확인]. 판정 모드 CCTV 뷰어를 엽니다. */
  onCctv: () => void
  /** 출국장 혼잡도 화면으로 이동(출국장 카메라 사건). 넘기지 않으면 링크를 숨깁니다. */
  onOpenHall?: (terminal: string, hallId: number) => void
  /** 편의시설 지도로 이동(편의시설 카메라 사건). 그 층의 그 구역이 선택된 채 열립니다. */
  onOpenFacility?: (terminal: string, floor: string, zoneKey: string) => void
}

/**
 * 스마트 알림의 오른쪽 상세 패널에서 YOLO 사건을 선택했을 때 보여 주는 내용입니다. 기존 알림 카드(.alert-pass)와 같은 틀을 씁니다.
 * 판정은 여기서 하지 않고, 영상을 확인할 수 있는 판정 모드 CCTV 뷰어에서 합니다.
 * 높이는 기존 알림 카드(약 255px)보다 크지 않게 맞춰, 아래 '수신 알림 분포'가 기존보다 더 잘리지 않도록 했습니다.
 */
export default function YoloAlertDetail({ alert, onCctv, onOpenHall, onOpenFacility }: Props) {
  const event = alert.yolo
  if (!event) return null
  const place = yoloPlace(event.cameraId)
  const pending = event.reviewStatus === 'PENDING'
  const hallId = place?.hallId ?? null // 출국장 카메라만 출국장 혼잡도로 이동할 수 있다

  return <section className="alert-pass is-yolo" data-severity={alert.severity} aria-label="선택한 알림 상세">
    <div className="alert-pass__head">
      <small>OPERATION ALERT</small>
      <h2>{alert.title}</h2>
      <div className="alert-pass__badges">
        <b data-severity={alert.severity}>{alert.severity === 'CRITICAL' ? '긴급' : '정보'}</b>
        <span>{yoloEventName(event.eventType).name}</span>
        <span className="yolo-detail__status" data-status={event.reviewStatus}>{YOLO_STATUS_LABEL[event.reviewStatus]}</span>
        <span className="yolo-detail__demo">DEMO · CCTV</span>
      </div>
    </div>
    <p className="alert-pass__message">{yoloEventName(event.eventType).note ?? '자동 감지 후보입니다. CCTV로 확인한 뒤 판정해 주세요.'}</p>
    <dl>
      <dt>위치</dt><dd>{place?.label ?? `카메라 ${event.cameraId}번`}</dd>
      <dt>감지 시각</dt><dd><time dateTime={event.detectedAt}>{fullFormat.format(new Date(event.detectedAt))}</time></dd>
      <dt>신뢰도</dt><dd>{Math.round(event.confidence * 100)}%</dd>
      {event.reviewedAt && <><dt>판정 시각</dt><dd><time dateTime={event.reviewedAt}>{fullFormat.format(new Date(event.reviewedAt))}</time></dd></>}
    </dl>
    <div className="yolo-detail__actions">
      {pending
        ? <button type="button" className="yolo-detail__cctv" onClick={onCctv}>CCTV로 현장 확인</button>
        : <span className="yolo-detail__result" data-status={event.reviewStatus}>{event.reviewStatus === 'CONFIRMED' ? '실제 상황으로 확인되었습니다' : '오탐으로 판정되었습니다'}</span>}
      {place?.facility && onOpenFacility && <button type="button" className="yolo-detail__hall" onClick={() => place.facility && onOpenFacility(place.terminal, place.facility.floor, place.facility.zoneKey)}>편의시설에서 보기 ›</button>}
      {place && hallId !== null && onOpenHall && <button type="button" className="yolo-detail__hall" onClick={() => onOpenHall(place.terminal, hallId)}>출국장 혼잡도에서 보기 ›</button>}
    </div>
  </section>
}
