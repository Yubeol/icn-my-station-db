import { useEffect, useRef, useState } from 'react'
import { yoloEventName } from '../../api/yolo'
import type { YoloEvent } from '../../api/yolo'
import { useYolo } from '../../hooks/useYoloLive'
import { cameraPlace } from './yoloStatus'
import './yolo.css'

const SHOW_MS = 4000

const clockFormat = new Intl.DateTimeFormat('ko-KR', {
  hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul',
})

type Props = {
  /** 토스트를 누르면 호출됩니다. 스마트 알림 화면으로 이동해 이 사건을 선택하는 데 씁니다. */
  onOpen: (event: YoloEvent) => void
}

/**
 * 제스처(도움 요청, 손가락 총) 후보가 새로 감지되면 헤더 아래 가운데에 잠깐 보이는 긴급 토스트입니다.
 * 4초 동안 보이고 마우스를 올려 두면 사라지지 않습니다. 연속으로 오면 쌓지 않고 최신 1건만 보여 주며 "외 N건"을 붙입니다.
 * 접속할 때 조회한 기존 대기 알림은 새 알림이 아니므로 띄우지 않습니다(useYolo의 lastAlert는 WebSocket으로 온 것만 담습니다).
 */
export default function YoloToast({ onOpen }: Props) {
  const { lastAlert } = useYolo()
  const [seenSeq, setSeenSeq] = useState(lastAlert?.seq ?? 0)
  const [shown, setShown] = useState<YoloEvent | null>(null)
  // 이 토스트가 떠 있는 동안 앞서 왔다가 최신 건에 밀린 알림 수
  const [earlier, setEarlier] = useState(0)
  const [paused, setPaused] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 메뉴 막대 바로 아래에 오도록 화면 위쪽에서의 위치를 잽니다(헤더 높이가 화면 크기에 따라 달라서 숫자로 고정하지 않음).
  const [top, setTop] = useState(108)

  if (lastAlert && lastAlert.seq !== seenSeq) {
    setSeenSeq(lastAlert.seq)
    setEarlier(shown ? earlier + 1 : 0)
    setShown(lastAlert.event)
  }

  // 새 알림이 오거나 마우스를 떼면 4초를 다시 잽니다.
  useEffect(() => {
    if (!shown || paused) return
    timer.current = setTimeout(() => {
      setShown(null)
      setEarlier(0)
    }, SHOW_MS)
    return () => {
      if (timer.current !== null) clearTimeout(timer.current)
    }
  }, [shown, paused])

  useEffect(() => {
    if (!shown) return
    const place = () => {
      const bar = document.querySelector('.icn-nav') ?? document.querySelector('.icn-banner')
      if (bar) setTop(Math.round(bar.getBoundingClientRect().bottom) + 8)
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [shown])

  if (!shown) return null

  const dismissAndOpen = () => {
    const event = shown
    setShown(null)
    setEarlier(0)
    setPaused(false)
    onOpen(event)
  }

  return <div
    className="yolo-toast"
    role="alert"
    style={{ top }}
    onMouseEnter={() => setPaused(true)}
    onMouseLeave={() => setPaused(false)}
    onFocus={() => setPaused(true)}
    onBlur={() => setPaused(false)}>
    <button type="button" onClick={dismissAndOpen} title="스마트 알림에서 이 사건 보기">
      <b className="yolo-toast__urgent">긴급</b>
      <span className="yolo-toast__text">{yoloEventName(shown.eventType).name} · {cameraPlace(shown.cameraId)} · {clockFormat.format(new Date(shown.detectedAt))}</span>
      {earlier > 0 && <span className="yolo-toast__more">외 {earlier}건</span>}
      <span className="yolo-toast__demo">DEMO</span>
      <span className="yolo-toast__go" aria-hidden="true">보기 ›</span>
    </button>
  </div>
}
