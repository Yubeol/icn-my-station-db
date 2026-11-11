import { useEffect, useMemo, useState } from 'react'
import { getYoloEvents } from '../api/yolo'
import type { YoloEvent } from '../api/yolo'
import { YOLO_ALERT_WINDOW_MS, yoloEventToAlert } from '../api/yoloAlerts'
import type { FeedAlert } from '../api/yoloAlerts'
import { useYolo } from './useYoloLive'

const REFRESH_MS = 60_000

/**
 * 스마트 알림 화면에 합칠 YOLO 사건 목록(최근 24시간). GET /api/v1/yolo/events를 받아 FeedAlert로 바꿉니다.
 * 새 알림(yolo_alert)·판정(yolo_alert_reviewed)·재연결 때, 그리고 1분마다 다시 조회해서 상태를 맞춥니다.
 * 조회에 실패하면 이전 목록을 그대로 두고, 기존 알림 표시에는 영향을 주지 않습니다.
 */
export function useYoloAlertFeed(): FeedAlert[] {
  const { eventsVersion, connected } = useYolo()
  const [events, setEvents] = useState<YoloEvent[]>([])

  useEffect(() => {
    const controller = new AbortController()
    const load = () => {
      getYoloEvents({ limit: 200 }, controller.signal)
        .then(list => {
          if (controller.signal.aborted) return
          const since = Date.now() - YOLO_ALERT_WINDOW_MS
          setEvents(list.filter(event => Date.parse(event.detectedAt) >= since))
        })
        .catch(error => {
          if (!controller.signal.aborted) console.warn('[YOLO] 알림 목록 조회 실패', error)
        })
    }
    load()
    const timer = window.setInterval(load, REFRESH_MS)
    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [eventsVersion, connected])

  return useMemo(() => events.map(yoloEventToAlert), [events])
}
