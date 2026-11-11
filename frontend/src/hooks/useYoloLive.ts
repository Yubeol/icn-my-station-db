import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError } from '../api/client'
import { subscribeLive, subscribeLiveConnection } from '../api/websocket'
import {
  getYoloEvents,
  parseYoloAlertLive,
  parseYoloAlertReviewed,
  parseYoloCameraLive,
  parseYoloCountLive,
  reviewYoloEvent,
} from '../api/yolo'
import type { YoloCameraLive, YoloCountLive, YoloEvent, YoloReviewDecision } from '../api/yolo'

/**
 * /ws/live의 yolo_* 메시지와 판정 대기 알림을 앱 전체에서 한 번만 구독합니다.
 * 판정 대기 알림은 스냅샷으로 오지 않으므로(계약 5장) 접속·재연결 때마다 GET events?reviewStatus=PENDING으로 조회합니다.
 * eventId는 식별용입니다. 연속 번호가 아니므로 정렬·표시에는 detectedAt을 씁니다.
 */

/** ok: 판정됨 · already: 이미 판정되었거나 없는 이벤트 · disabled: 서버가 저장을 꺼 둠(503) · error: 그 밖의 실패 */
export type YoloReviewOutcome = 'ok' | 'already' | 'disabled' | 'error'

export type YoloLiveState = {
  connected: boolean
  /** cameraId별 카메라·워커 연결 상태(yolo_camera) */
  cameras: Record<number, YoloCameraLive>
  /** cameraId별 마지막 인원(yolo_count) */
  counts: Record<number, YoloCountLive>
  /** 판정 대기 알림. 최근 감지가 앞입니다. */
  pending: YoloEvent[]
  /** WebSocket으로 새로 받은 마지막 알림(접속할 때 REST로 받은 기존 대기 알림은 제외). 토스트가 씁니다. */
  lastAlert: { seq: number; event: YoloEvent } | null
  /** yolo_alert·yolo_alert_reviewed·판정을 받을 때마다 올라가는 번호. 목록 화면이 다시 조회할 때 씁니다. */
  eventsVersion: number
  /** 판정 모드 CCTV 뷰어로 보고 있는 알림. 앱 어디서든 열 수 있습니다. */
  reviewing: YoloEvent | null
  openReview: (event: YoloEvent) => void
  closeReview: () => void
  review: (eventId: number, decision: YoloReviewDecision) => Promise<YoloReviewOutcome>
}

const EMPTY: YoloLiveState = {
  connected: false,
  cameras: {},
  counts: {},
  pending: [],
  lastAlert: null,
  eventsVersion: 0,
  reviewing: null,
  openReview: () => {},
  closeReview: () => {},
  review: async () => 'error',
}

export const YoloLiveContext = createContext<YoloLiveState>(EMPTY)

export function useYolo(): YoloLiveState {
  return useContext(YoloLiveContext)
}

function newestFirst(events: YoloEvent[]): YoloEvent[] {
  return [...events].sort((a, b) => Date.parse(b.detectedAt) - Date.parse(a.detectedAt) || b.eventId - a.eventId)
}

function upsert(list: YoloEvent[], event: YoloEvent): YoloEvent[] {
  return newestFirst([...list.filter(item => item.eventId !== event.eventId), event])
}

/** YoloProvider가 한 번만 부릅니다. */
export function useYoloLiveState(): YoloLiveState {
  const [connected, setConnected] = useState(false)
  const [cameras, setCameras] = useState<Record<number, YoloCameraLive>>({})
  const [counts, setCounts] = useState<Record<number, YoloCountLive>>({})
  const [pending, setPending] = useState<YoloEvent[]>([])
  const [lastAlert, setLastAlert] = useState<YoloLiveState['lastAlert']>(null)
  const [eventsVersion, setEventsVersion] = useState(0)
  const [reviewing, setReviewing] = useState<YoloEvent | null>(null)
  // 판정이 끝난 eventId. 조회 응답이 늦게 도착해도 닫힌 알림이 되살아나지 않게 합니다.
  const reviewedIds = useRef(new Set<number>())

  useEffect(() => {
    let active = true
    let controller: AbortController | null = null
    // 이번 조회가 진행되는 동안 WebSocket으로 먼저 받은 알림
    let receivedDuringFetch: YoloEvent[] = []

    const loadPending = () => {
      controller?.abort()
      const current = new AbortController()
      controller = current
      receivedDuringFetch = []
      getYoloEvents({ reviewStatus: 'PENDING', limit: 200 }, current.signal)
        .then(events => {
          if (!active || current.signal.aborted) return
          const merged = new Map<number, YoloEvent>()
          for (const event of [...events, ...receivedDuringFetch]) {
            if (!reviewedIds.current.has(event.eventId)) merged.set(event.eventId, event)
          }
          setPending(newestFirst([...merged.values()]))
        })
        .catch(error => {
          if (current.signal.aborted) return
          console.warn('[YOLO] 판정 대기 알림 조회 실패', error)
        })
    }

    const markReviewed = (eventId: number) => {
      reviewedIds.current.add(eventId)
      receivedDuringFetch = receivedDuringFetch.filter(item => item.eventId !== eventId)
      setPending(list => list.filter(item => item.eventId !== eventId))
    }

    const unsubscribeConnection = subscribeLiveConnection(isConnected => {
      if (!active) return
      setConnected(isConnected)
      // 처음 연결과 재연결 모두 대기 알림을 다시 조회합니다. 끊긴 동안의 알림·판정을 따라잡기 위해서입니다.
      if (isConnected) loadPending()
      else controller?.abort()
    })

    const unsubscribeMessage = subscribeLive(message => {
      if (!active) return
      if (message.topic === 'yolo_camera') {
        const data = parseYoloCameraLive(message.data)
        if (data) setCameras(current => ({ ...current, [data.cameraId]: data }))
      } else if (message.topic === 'yolo_count') {
        const data = parseYoloCountLive(message.data)
        if (data) setCounts(current => ({ ...current, [data.cameraId]: data }))
      } else if (message.topic === 'yolo_alert') {
        const alert = parseYoloAlertLive(message.data)
        if (!alert || alert.reviewStatus !== 'PENDING' || reviewedIds.current.has(alert.eventId)) return
        const event: YoloEvent = { ...alert, reviewedAt: null }
        receivedDuringFetch = [...receivedDuringFetch, event]
        setPending(list => upsert(list, event))
        setLastAlert(current => ({ seq: (current?.seq ?? 0) + 1, event }))
        setEventsVersion(version => version + 1)
      } else if (message.topic === 'yolo_alert_reviewed') {
        const reviewed = parseYoloAlertReviewed(message.data)
        if (reviewed) {
          markReviewed(reviewed.eventId)
          setEventsVersion(version => version + 1)
        }
      }
    })

    return () => {
      active = false
      controller?.abort()
      unsubscribeConnection()
      unsubscribeMessage()
    }
  }, [])

  const review = useCallback(async (eventId: number, decision: YoloReviewDecision): Promise<YoloReviewOutcome> => {
    const close = () => {
      reviewedIds.current.add(eventId)
      setPending(list => list.filter(item => item.eventId !== eventId))
    }
    try {
      await reviewYoloEvent(eventId, decision)
      close()
      setEventsVersion(version => version + 1)
      return 'ok'
    } catch (error) {
      if (error instanceof ApiError) {
        // 이미 다른 화면에서 판정됐거나(409) 목록에서 사라진 이벤트(404)는 닫습니다.
        if (error.status === 409 || error.status === 404) {
          close()
          return 'already'
        }
        if (error.status === 503) return 'disabled'
      }
      console.warn('[YOLO] 판정 요청 실패', error)
      return 'error'
    }
  }, [])

  const openReview = useCallback((event: YoloEvent) => setReviewing(event), [])
  const closeReview = useCallback(() => setReviewing(null), [])

  return useMemo(
    () => ({ connected, cameras, counts, pending, lastAlert, eventsVersion, reviewing, openReview, closeReview, review }),
    [connected, cameras, counts, pending, lastAlert, eventsVersion, reviewing, openReview, closeReview, review],
  )
}
