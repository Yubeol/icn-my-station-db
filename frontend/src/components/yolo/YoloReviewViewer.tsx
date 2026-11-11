import { useState } from 'react'
import type { YoloEvent, YoloReviewDecision } from '../../api/yolo'
import { useYolo } from '../../hooks/useYoloLive'
import type { YoloReviewOutcome } from '../../hooks/useYoloLive'
import CctvViewer from './CctvViewer'
import { cameraPlace } from './yoloStatus'

const clockFormat = new Intl.DateTimeFormat('ko-KR', {
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Seoul',
})

const FAILURE_TEXT: Partial<Record<YoloReviewOutcome, string>> = {
  disabled: '서버에서 판정 저장이 꺼져 있어 지금은 판정할 수 없습니다.',
  error: '판정을 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.',
}

type Props = {
  event: YoloEvent
  /** 판정 없이 닫았을 때도 불립니다. 이벤트는 PENDING 그대로라 긴급 알림이 다시 뜹니다. */
  onClose: () => void
}

/**
 * 긴급 알림에서 [CCTV로 현장 확인]을 누르면 열리는 판정 모드 CCTV 뷰어입니다.
 * 운영자가 영상을 본 뒤 [확인]/[오탐]을 누르면 PATCH를 보내고 닫습니다.
 */
export default function YoloReviewViewer({ event, onClose }: Props) {
  const { pending, review } = useYolo()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  // 대기 목록에서 사라졌다면 다른 화면(또는 이미 판정된 상태)에서 판정된 것입니다.
  // 내가 판정을 보내는 중에는 목록에서 먼저 사라지므로 busy일 때는 제외합니다.
  const elsewhere = !busy && !pending.some(item => item.eventId === event.eventId)

  const decide = async (decision: YoloReviewDecision) => {
    if (busy || elsewhere) return
    setBusy(true)
    setMessage(null)
    const outcome = await review(event.eventId, decision)
    if (outcome === 'ok') {
      onClose() // 성공하면 뷰어를 닫습니다. busy는 그대로 두어 닫히는 동안 '다른 화면' 문구가 번쩍이지 않게 합니다.
      return
    }
    setBusy(false)
    // 409·404(already)는 목록에서 빠져 elsewhere 문구로 바뀝니다. 그 밖의 실패만 메시지로 알립니다.
    setMessage(FAILURE_TEXT[outcome] ?? null)
  }

  return <CctvViewer
    cameraId={event.cameraId}
    title={cameraPlace(event.cameraId)}
    onClose={onClose}
    review={{
      band: elsewhere
        ? '다른 화면에서 판정됨'
        : `도움 요청 제스처 감지 · ${clockFormat.format(new Date(event.detectedAt))} · 신뢰도 ${Math.round(event.confidence * 100)}%`,
      done: elsewhere,
      busy,
      message,
      onDecide: decision => void decide(decision),
    }}
  />
}
