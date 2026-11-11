import type { YoloTone } from './yoloStatus'
import './yolo.css'

type Props = { tone: YoloTone; text: string }

/** 출국장 행에 붙는 카메라 인원 표시. 공항 공식 대기 인원이 아니라 DEMO 카메라 실측임을 함께 보여 줍니다. */
export default function YoloHallBadge({ tone, text }: Props) {
  return <span className="yolo-badge" data-tone={tone} title="DEMO 카메라가 센 인원입니다. 공항 공식 대기 인원이 아닙니다.">
    <i aria-hidden="true" />
    <b>DEMO</b>
    <span>YOLO 실측 {text}</span>
  </span>
}
