import { useState } from 'react'
import { YOLO_CAMERA_HALLS } from '../../api/yolo'
import type { YoloReviewDecision } from '../../api/yolo'
import { useYolo } from '../../hooks/useYoloLive'
import type { YoloReviewOutcome } from '../../hooks/useYoloLive'
import YoloDialog from './YoloDialog'

const timeFormat = new Intl.DateTimeFormat('ko-KR', {
  month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Seoul',
})

const FAILURE_TEXT: Partial<Record<YoloReviewOutcome, string>> = {
  disabled: '서버에서 판정 저장이 꺼져 있어 지금은 판정할 수 없습니다.',
  error: '판정을 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.',
}

function placeName(cameraId: number): string {
  const hall = YOLO_CAMERA_HALLS.find(item => item.cameraId === cameraId)
  return hall ? `${hall.terminal} ${hall.hallId}번 출국장` : `카메라 ${cameraId}번`
}

/**
 * 도움 요청 제스처 후보가 감지되면 어느 화면에서든 띄우는 긴급 알림입니다. 확정이 아니라 사람이 확인해야 하는 후보입니다.
 * 판정(확인·오탐)을 하면 다른 화면의 같은 알림도 yolo_alert_reviewed로 함께 닫힙니다.
 */
export default function YoloAlertModal() {
  const { pending, review } = useYolo()
  // 보고 있는 알림을 고정합니다. 새 알림이 와도 판정하려던 알림이 바뀌지 않게 하려는 것입니다(잘못 누름 방지).
  const [focusId, setFocusId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<{ eventId: number; text: string } | null>(null)

  const event = pending.find(item => item.eventId === focusId) ?? pending[0] ?? null
  if (event && event.eventId !== focusId) setFocusId(event.eventId)
  if (!event) return null

  const others = pending.length - 1
  const message = failure?.eventId === event.eventId ? failure.text : null

  const decide = async (decision: YoloReviewDecision) => {
    if (busy) return
    setBusy(true)
    setFailure(null)
    const outcome = await review(event.eventId, decision)
    setBusy(false)
    const text = FAILURE_TEXT[outcome]
    if (text) setFailure({ eventId: event.eventId, text })
  }

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
      <div><dt>위치</dt><dd>{placeName(event.cameraId)} · DEMO 카메라</dd></div>
      <div><dt>감지 시각</dt><dd>{timeFormat.format(new Date(event.detectedAt))}</dd></div>
      <div><dt>감지 신뢰도</dt><dd>{Math.round(event.confidence * 100)}% <small>(오탐일 수 있습니다)</small></dd></div>
    </dl>
    {message && <p className="yolo-alert__error" role="alert">{message}</p>}
    <div className="yolo-alert__actions">
      <button type="button" className="is-confirm" disabled={busy} onClick={() => void decide('CONFIRMED')}>확인 (실제 상황)</button>
      <button type="button" className="is-false" disabled={busy} onClick={() => void decide('FALSE_POSITIVE')}>오탐 (잘못 감지)</button>
    </div>
  </YoloDialog>
}
