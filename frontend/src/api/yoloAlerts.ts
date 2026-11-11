import type { Alert } from './client'
import { YOLO_CAMERA_HALLS } from './yolo'
import type { YoloEvent, YoloReviewStatus } from './yolo'

/**
 * 스마트 알림 화면이 쓰는 알림 항목. 기존 알림(Alert)에 YOLO 사건을 같은 모양으로 합쳐 보여 주기 위한 타입입니다.
 * type은 서버의 AlertType 외에 YOLO_GESTURE가 올 수 있어 문자열로 넓혔습니다. yolo가 있으면 YOLO 사건입니다.
 */
export type FeedAlert = Omit<Alert, 'type'> & { type: string; terminal?: string | null; yolo?: YoloEvent }

export const YOLO_ALERT_TYPE = 'YOLO_GESTURE'
export const YOLO_ALERT_WINDOW_MS = 24 * 3_600_000 // 기존 알림 목록과 같은 최근 24시간

export const YOLO_STATUS_LABEL: Record<YoloReviewStatus, string> = {
  PENDING: '판정 대기',
  CONFIRMED: '확인됨',
  FALSE_POSITIVE: '오탐',
}

export function yoloAlertId(eventId: number): string {
  return `yolo-${eventId}`
}

/** 카메라가 비추는 출국장(DEMO 고정 매핑). 모르는 카메라면 null입니다. */
export function yoloPlace(cameraId: number): { terminal: string; hallId: number; label: string } | null {
  const hall = YOLO_CAMERA_HALLS.find(item => item.cameraId === cameraId)
  return hall ? { terminal: hall.terminal, hallId: hall.hallId, label: `${hall.terminal} ${hall.hallId}번 출국장` } : null
}

/**
 * YOLO 사건을 스마트 알림 항목으로 바꿉니다. 심각도는 "긴급"이고, 오탐으로 판정된 사건만 "정보"로 내려
 * 목록에는 남기되 긴급 집계에서는 빠지게 합니다. eventId는 식별용이라 화면 번호로 쓰지 않습니다.
 */
export function yoloEventToAlert(event: YoloEvent): FeedAlert {
  const place = yoloPlace(event.cameraId)
  const where = place?.label ?? `카메라 ${event.cameraId}번`
  return {
    alertId: yoloAlertId(event.eventId),
    type: YOLO_ALERT_TYPE,
    severity: event.reviewStatus === 'FALSE_POSITIVE' ? 'INFO' : 'CRITICAL',
    title: '도움 요청 제스처 감지',
    message: `${where} · DEMO 카메라 · 신뢰도 ${Math.round(event.confidence * 100)}% · ${YOLO_STATUS_LABEL[event.reviewStatus]}`,
    flightNo: null,
    isMine: false,
    isImportant: true,
    createdAt: event.detectedAt,
    terminal: place?.terminal ?? null,
    yolo: event,
  }
}
