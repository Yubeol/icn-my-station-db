import { useYolo } from '../../hooks/useYoloLive'
import './yolo.css'

/** 헤더 시계 왼쪽의 "긴급 N" 알약. 아직 판정하지 않은 YOLO 사건 수이고, 0이면 보이지 않습니다. */
export default function YoloHeaderCount({ onClick }: { onClick: () => void }) {
  const { pending } = useYolo()
  if (pending.length === 0) return null
  return <button type="button" className="yolo-urgent-pill" onClick={onClick} title="판정하지 않은 도움 요청 제스처 사건 보기" aria-label={`판정 대기 긴급 알림 ${pending.length}건, 스마트 알림에서 보기`}>
    긴급 {pending.length}
  </button>
}
