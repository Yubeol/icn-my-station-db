import { useState } from 'react'
import type { YoloEvent } from '../../api/yolo'
import { useYolo } from '../../hooks/useYoloLive'
import YoloDialog from './YoloDialog'
import YoloReviewViewer from './YoloReviewViewer'
import { cameraPlace } from './yoloStatus'

const timeFormat = new Intl.DateTimeFormat('ko-KR', {
  month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Seoul',
})

/**
 * 도움 요청 제스처 후보가 감지되면 어느 화면에서든 띄우는 긴급 알림입니다. 확정이 아니라 사람이 확인해야 하는 후보입니다.
 * 이 모달에서는 판정하지 않습니다. [CCTV로 현장 확인]을 누르면 모달은 닫히고, 같은 카메라의 CCTV 뷰어가
 * 판정 모드로 열립니다. 영상을 본 뒤 그 뷰어에서 확인·오탐을 누릅니다.
 * 판정 없이 뷰어를 닫으면 이벤트는 PENDING 그대로라서 이 모달이 다시 뜹니다.
 */
export default function YoloAlertModal() {
  const { pending } = useYolo()
  // 보고 있는 알림을 고정합니다. 새 알림이 와도 판정하려던 알림이 바뀌지 않게 하려는 것입니다(잘못 누름 방지).
  const [focusId, setFocusId] = useState<number | null>(null)
  // 판정 모드 뷰어로 보고 있는 알림. 판정되어 대기 목록에서 사라져도 뷰어에는 그 사실을 보여 줘야 해서 따로 들고 있습니다.
  const [reviewing, setReviewing] = useState<YoloEvent | null>(null)

  const event = pending.find(item => item.eventId === focusId) ?? pending[0] ?? null
  if (event && event.eventId !== focusId) setFocusId(event.eventId)

  if (reviewing) return <YoloReviewViewer event={reviewing} onClose={() => setReviewing(null)} />
  if (!event) return null

  const others = pending.length - 1

  return <YoloDialog label="도움 요청 제스처 감지, 확인 필요" urgent className="yolo-alert">
    <div className="yolo-alert__top">
      <span className="yolo-alert__badge">긴급</span>
      {others > 0 && <span className="yolo-alert__more">외 {others}건 확인 대기</span>}
    </div>
    <div className="yolo-alert__title">
      <span className="yolo-alert__demo">DEMO</span>
      <h2>도움 요청 제스처 감지 · 확인 필요</h2>
    </div>
    <p className="yolo-alert__lead">DEMO 카메라 영상에서 도움을 요청하는 손짓으로 보이는 동작이 감지되었습니다. 자동 감지 후보이므로 실제 상황인지 직원이 확인해 주세요.</p>
    <dl className="yolo-alert__facts">
      <div><dt>위치</dt><dd>{cameraPlace(event.cameraId)} · DEMO 카메라</dd></div>
      <div><dt>감지 시각</dt><dd>{timeFormat.format(new Date(event.detectedAt))}</dd></div>
      <div><dt>감지 신뢰도</dt><dd>{Math.round(event.confidence * 100)}% <small>(오탐일 수 있습니다)</small></dd></div>
    </dl>
    <div className="yolo-alert__actions is-single">
      <button type="button" className="is-confirm" onClick={() => setReviewing(event)}>CCTV로 현장 확인</button>
    </div>
    <p className="yolo-alert__hint">영상을 확인한 뒤 판정해 주세요</p>
  </YoloDialog>
}
