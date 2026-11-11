/**
 * YOLO DEMO API. 기준 문서: docs/yolo-demo-contract.md (v0.3).
 * 타입은 계약 문서를 기준으로 수동 정의했고, 자동 생성 파일(types.ts)은 건드리지 않습니다.
 * cameraId는 demo_yolo_cameras.camera_id(정수)입니다. eventId는 식별용이며 연속 번호가 아닙니다.
 */
import { get, patch } from './client'
import type { Terminal } from './client'

export { getYoloViewUrl } from './client'

export type YoloConnState = 'ONLINE' | 'OFFLINE'
export type YoloCrowdLevel = 'LOW' | 'MID' | 'HIGH'
export type YoloReviewStatus = 'PENDING' | 'CONFIRMED' | 'FALSE_POSITIVE'
/** 판정 요청에 쓸 수 있는 값. PENDING으로 되돌리는 요청은 서버가 받지 않습니다. */
export type YoloReviewDecision = Exclude<YoloReviewStatus, 'PENDING'>

// ---------- 이벤트 종류별 화면 이름 (계약 v0.4: HELP_GESTURE, FINGER_GUN) ----------

/** name은 문장에, short는 좁은 곳(분포 막대 등)에 씁니다. 모르는 종류는 일반 제스처로 보여 줍니다. */
const YOLO_EVENT_NAMES: Record<string, { name: string; short: string }> = {
  HELP_GESTURE: { name: '도움 요청 제스처', short: '도움 요청' },
  FINGER_GUN: { name: '손가락 총 제스처', short: '손가락 총' },
}

export function yoloEventName(eventType: string): { name: string; short: string } {
  return YOLO_EVENT_NAMES[eventType] ?? { name: '제스처', short: '제스처' }
}

// ---------- 카메라 ↔ 출국장 ----------

/**
 * 카메라가 비추는 출국장. DEMO 고정값이며, 2차에 백엔드 필드(YoloCamera의 terminal·hallId)로 옮깁니다.
 * 이 배열이 카메라와 혼잡도 화면의 출국장(terminal + hallId)을 잇는 유일한 곳입니다.
 */
export const YOLO_CAMERA_HALLS: readonly { cameraId: number; terminal: Terminal; hallId: number }[] = [
  { cameraId: 1, terminal: 'T1', hallId: 3 },
]

/**
 * 편의시설 지도의 구역과 카메라. DEMO 고정값이며, 2차에 백엔드 필드로 옮깁니다.
 * 구역: T1 4F 스카이허브 라운지(서편) 구역. 위치 문장 "제1여객터미널 4층 서편 환승구역(42번 게이트 부근)"이
 * 편의시설 지도에서 게이트 구역 `G:37:1`("T1 40~42번 게이트")이 됩니다(facilityMap.ts의 gateZoneAnchor).
 * 백엔드 airport_zones에는 편의시설 구역이 없습니다(airport_facilities.zone_id는 모두 NULL). 카메라 2번의 zone_id는
 * DB 담당이 이 구역에 맞는 airport_zones 행을 정해 등록합니다. 카메라 2번은 등록·송출 전일 수 있습니다.
 */
export const YOLO_FACILITY_CAMERAS: readonly {
  cameraId: number
  terminal: Terminal
  floor: string
  /** 편의시설 지도의 구역 키 */
  zoneKey: string
  /** 구역 위치를 잡는 대표 게이트 번호 */
  gate: number
  label: string
}[] = [{ cameraId: 2, terminal: 'T1', floor: '4F', zoneKey: 'G:37:1', gate: 42, label: 'T1 스카이허브 라운지 구역' }]

export function cameraIdForHall(terminal: Terminal, hallId: number): number | null {
  return YOLO_CAMERA_HALLS.find(item => item.terminal === terminal && item.hallId === hallId)?.cameraId ?? null
}

// ---------- REST (6장) ----------

export type YoloCamera = {
  cameraId: number
  zoneId: number
  name: string
  isActive: boolean
  camera: YoloConnState
  worker: YoloConnState
}

export type YoloEvent = {
  eventId: number
  cameraId: number
  zoneId: number
  eventType: string
  confidence: number
  detectedAt: string
  reviewStatus: YoloReviewStatus
  reviewedAt: string | null
}

export function getYoloCameras(signal?: AbortSignal): Promise<YoloCamera[]> {
  return get('/api/v1/yolo/cameras', signal)
}

export function getYoloEvents(
  params: { cameraId?: number; reviewStatus?: YoloReviewStatus; limit?: number } = {},
  signal?: AbortSignal,
): Promise<YoloEvent[]> {
  const search = new URLSearchParams()
  if (params.cameraId !== undefined) search.set('cameraId', String(params.cameraId))
  if (params.reviewStatus) search.set('reviewStatus', params.reviewStatus)
  if (params.limit !== undefined) search.set('limit', String(params.limit))
  const query = search.toString()
  return get(`/api/v1/yolo/events${query ? `?${query}` : ''}`, signal)
}

/** 이미 판정된 이벤트는 409, YOLO_WRITE_ENABLED가 꺼진 db 모드는 503(ApiError.status)입니다. */
export function reviewYoloEvent(eventId: number, reviewStatus: YoloReviewDecision): Promise<YoloEvent> {
  return patch(`/api/v1/yolo/events/${eventId}`, { reviewStatus })
}

// ---------- /ws/live yolo_* data (5장) ----------

export type YoloCameraLive = { cameraId: number; zoneId: number; camera: YoloConnState; worker: YoloConnState }
export type YoloCountLive = {
  cameraId: number
  zoneId: number
  personCount: number
  crowdLevel: YoloCrowdLevel
  measuredAt: string
}
export type YoloAlertLive = {
  eventId: number
  cameraId: number
  zoneId: number
  eventType: string
  confidence: number
  detectedAt: string
  reviewStatus: YoloReviewStatus
}
export type YoloAlertReviewedLive = { eventId: number; reviewStatus: YoloReviewStatus; reviewedAt: string }

// ---------- /ws/yolo/view (4장) ----------

/** box는 [x1, y1, x2, y2], 이미지 크기 대비 0~1 비율입니다. */
export type YoloDetection = { cls: string; conf: number; box: [number, number, number, number]; trackId: number | null }
export type YoloViewStatus = { type: 'status'; cameraId: number; camera: YoloConnState; worker: YoloConnState }
export type YoloViewResult = {
  type: 'result'
  cameraId: number
  frameId: number
  personCount: number
  crowdLevel: YoloCrowdLevel
  inferMs: number | null
  detections: YoloDetection[]
}
export type YoloFrameHeader = { cameraId: number; frameId: number; capturedAt: number; width: number; height: number }

// ---------- 런타임 검사 (서버 메시지는 unknown으로 들어옵니다) ----------

type Raw = Record<string, unknown>

function isObject(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}
function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
function isConn(value: unknown): value is YoloConnState {
  return value === 'ONLINE' || value === 'OFFLINE'
}
function isCrowd(value: unknown): value is YoloCrowdLevel {
  return value === 'LOW' || value === 'MID' || value === 'HIGH'
}
function isReview(value: unknown): value is YoloReviewStatus {
  return value === 'PENDING' || value === 'CONFIRMED' || value === 'FALSE_POSITIVE'
}

export function parseYoloCameraLive(value: unknown): YoloCameraLive | null {
  if (!isObject(value) || !isInt(value.cameraId) || !isInt(value.zoneId)) return null
  if (!isConn(value.camera) || !isConn(value.worker)) return null
  return { cameraId: value.cameraId, zoneId: value.zoneId, camera: value.camera, worker: value.worker }
}

export function parseYoloCountLive(value: unknown): YoloCountLive | null {
  if (!isObject(value) || !isInt(value.cameraId) || !isInt(value.zoneId)) return null
  if (!isInt(value.personCount) || !isCrowd(value.crowdLevel) || typeof value.measuredAt !== 'string') return null
  return {
    cameraId: value.cameraId,
    zoneId: value.zoneId,
    personCount: value.personCount,
    crowdLevel: value.crowdLevel,
    measuredAt: value.measuredAt,
  }
}

export function parseYoloEvent(value: unknown): YoloEvent | null {
  if (!isObject(value) || !isInt(value.eventId) || !isInt(value.cameraId) || !isInt(value.zoneId)) return null
  if (typeof value.eventType !== 'string' || !isNumber(value.confidence) || typeof value.detectedAt !== 'string') return null
  if (!isReview(value.reviewStatus)) return null
  return {
    eventId: value.eventId,
    cameraId: value.cameraId,
    zoneId: value.zoneId,
    eventType: value.eventType,
    confidence: value.confidence,
    detectedAt: value.detectedAt,
    reviewStatus: value.reviewStatus,
    reviewedAt: typeof value.reviewedAt === 'string' ? value.reviewedAt : null,
  }
}

/** yolo_alert의 data는 reviewedAt이 없는 YoloEvent와 같은 모양입니다. */
export function parseYoloAlertLive(value: unknown): YoloAlertLive | null {
  const event = parseYoloEvent(value)
  return event ? { ...event } : null
}

export function parseYoloAlertReviewed(value: unknown): YoloAlertReviewedLive | null {
  if (!isObject(value) || !isInt(value.eventId) || !isReview(value.reviewStatus) || typeof value.reviewedAt !== 'string') return null
  return { eventId: value.eventId, reviewStatus: value.reviewStatus, reviewedAt: value.reviewedAt }
}

function parseDetection(value: unknown): YoloDetection | null {
  if (!isObject(value) || typeof value.cls !== 'string' || !isNumber(value.conf)) return null
  const box = value.box
  if (!Array.isArray(box) || box.length !== 4 || !box.every(isNumber)) return null
  const trackId = isInt(value.trackId) ? value.trackId : null
  return { cls: value.cls, conf: value.conf, box: [box[0], box[1], box[2], box[3]], trackId }
}

/** /ws/yolo/view 텍스트 메시지. 모르는 형식은 null입니다. */
export function parseYoloViewMessage(value: unknown): YoloViewStatus | YoloViewResult | null {
  if (!isObject(value) || !isInt(value.cameraId)) return null
  if (value.type === 'status') {
    if (!isConn(value.camera) || !isConn(value.worker)) return null
    return { type: 'status', cameraId: value.cameraId, camera: value.camera, worker: value.worker }
  }
  if (value.type === 'result') {
    if (!isInt(value.frameId) || !isInt(value.personCount) || !isCrowd(value.crowdLevel)) return null
    const detections = Array.isArray(value.detections)
      ? value.detections.map(parseDetection).filter((item): item is YoloDetection => item !== null)
      : []
    return {
      type: 'result',
      cameraId: value.cameraId,
      frameId: value.frameId,
      personCount: value.personCount,
      crowdLevel: value.crowdLevel,
      inferMs: isNumber(value.inferMs) ? value.inferMs : null,
      detections,
    }
  }
  return null
}

/** 계약 1.2 바이너리 프레임의 헤더(4바이트 길이 + JSON)와 JPEG 시작 위치. JPEG은 해석하지 않습니다. */
export function parseYoloFrame(buffer: ArrayBuffer): { header: YoloFrameHeader; jpegStart: number } | null {
  if (buffer.byteLength < 5) return null
  const size = new DataView(buffer).getUint32(0, false)
  if (size === 0 || size > 4096 || 4 + size >= buffer.byteLength) return null
  try {
    const header: unknown = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, size)))
    if (!isObject(header) || !isInt(header.cameraId) || !isInt(header.frameId)) return null
    return {
      header: {
        cameraId: header.cameraId,
        frameId: header.frameId,
        capturedAt: isNumber(header.capturedAt) ? header.capturedAt : 0,
        width: isInt(header.width) ? header.width : 0,
        height: isInt(header.height) ? header.height : 0,
      },
      jpegStart: 4 + size,
    }
  } catch {
    return null
  }
}
