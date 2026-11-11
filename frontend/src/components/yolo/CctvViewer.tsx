import { useEffect, useRef } from 'react'
import { useYoloView } from '../../hooks/useYoloView'
import type { YoloViewState } from '../../hooks/useYoloView'
import type { YoloDetection } from '../../api/yolo'
import YoloDialog from './YoloDialog'
import { YOLO_LEVEL_LABEL } from './yoloStatus'

/** 판정 모드. 긴급 알림에서 영상을 확인한 뒤 판정할 때 쓰며, 일반 CCTV 버튼으로 연 뷰어에는 없습니다. */
export type ReviewMode = {
  /** 상단 띠 문구 */
  band: string
  /** 영상 제목 아래 보조 문구. 없으면 DEMO 안내 문구를 씁니다. */
  note?: string | null
  /** 이미 판정됨(다른 화면 등). 띠를 회색으로 바꾸고 버튼을 막습니다. */
  done: boolean
  busy: boolean
  message: string | null
  onDecide: (decision: 'CONFIRMED' | 'FALSE_POSITIVE') => void
}

type Props = {
  cameraId: number
  /** 예: "T1 3번 출국장" */
  title: string
  onClose: () => void
  review?: ReviewMode
}

// 제스처 클래스(help_gesture, finger_gun)는 같은 빨간색으로 강조합니다.
const GESTURE_CLASSES = new Set(['help_gesture', 'finger_gun'])
const BOX_COLOR: Record<string, string> = { person: '#4fe0ae', head: '#6db3ff', help_gesture: '#ff5d4d', finger_gun: '#ff5d4d' }
const DEFAULT_ASPECT = { width: 640, height: 360 }

/** 이미지가 object-fit: contain으로 놓인 영역(캔버스 좌표). 박스 좌표는 이 영역 기준 0~1 비율입니다. */
function contentRect(canvasW: number, canvasH: number, srcW: number, srcH: number) {
  const scale = Math.min(canvasW / srcW, canvasH / srcH)
  const width = srcW * scale
  const height = srcH * scale
  return { x: (canvasW - width) / 2, y: (canvasH - height) / 2, width, height }
}

function drawBoxes(canvas: HTMLCanvasElement, detections: YoloDetection[], srcW: number, srcH: number, boldGesture: boolean) {
  const ratio = window.devicePixelRatio || 1
  const cssW = canvas.clientWidth
  const cssH = canvas.clientHeight
  if (!cssW || !cssH) return
  canvas.width = Math.round(cssW * ratio)
  canvas.height = Math.round(cssH * ratio)
  const context = canvas.getContext('2d')
  if (!context) return
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.clearRect(0, 0, cssW, cssH)
  const area = contentRect(cssW, cssH, srcW, srcH)
  context.lineWidth = 2
  context.font = '600 12px system-ui, sans-serif'
  context.textBaseline = 'top'
  for (const detection of detections) {
    const [x1, y1, x2, y2] = detection.box
    const x = area.x + x1 * area.width
    const y = area.y + y1 * area.height
    const w = (x2 - x1) * area.width
    const h = (y2 - y1) * area.height
    const color = BOX_COLOR[detection.cls] ?? '#ffd23f'
    context.strokeStyle = color
    context.lineWidth = boldGesture && GESTURE_CLASSES.has(detection.cls) ? 4 : 2
    context.strokeRect(x, y, w, h)
    const label = `${detection.cls} ${Math.round(detection.conf * 100)}%`
    const labelW = context.measureText(label).width + 8
    const labelY = y >= 18 ? y - 18 : y
    context.fillStyle = color
    context.fillRect(x, labelY, labelW, 18)
    context.fillStyle = '#06162c'
    context.fillText(label, x + 4, labelY + 3)
  }
}

function linkText(view: YoloViewState): { text: string; tone: 'ok' | 'warn' | 'off' } {
  // 등록·송출 전인 카메라는 오류 화면 대신 '카메라 미연결'로 보여 줍니다.
  if (view.link === 'rejected') return { text: '카메라 미연결', tone: 'off' }
  if (view.link === 'connecting') return { text: '서버에 연결하는 중…', tone: 'warn' }
  if (view.link === 'closed') return { text: '서버 연결이 끊겼습니다. 다시 연결하는 중…', tone: 'warn' }
  if (view.camera === 'OFFLINE') return { text: '카메라 미연결', tone: 'off' }
  if (view.worker === 'OFFLINE') return { text: '카메라 연결됨 · 분석 워커 대기', tone: 'warn' }
  return { text: '카메라·워커 연결됨', tone: 'ok' }
}

/** DEMO 카메라 영상 위에 YOLO 검출 박스를 겹쳐 보여 주는 뷰어입니다. 영상은 저장하지 않고 화면에만 그립니다. */
export default function CctvViewer({ cameraId, title, onClose, review }: Props) {
  const view = useYoloView(cameraId, true)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { frame, result } = view
  const srcW = frame?.width || DEFAULT_ASPECT.width
  const srcH = frame?.height || DEFAULT_ASPECT.height
  const status = linkText(view)
  const reviewMode = review !== undefined
  const live = view.link === 'open' && view.camera === 'ONLINE'

  // 박스는 최근 result를 다음 result가 올 때까지 유지해서 그립니다. 크기가 바뀌면 다시 그립니다.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const draw = () => drawBoxes(canvas, live && result ? result.detections : [], srcW, srcH, reviewMode)
    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [live, result, srcW, srcH, reviewMode])

  // 판정 모드에서는 배경 클릭·Esc로 닫히지 않게 하고(실수로 닫아 판정이 미뤄지는 것을 막음), 닫기 버튼으로만 닫습니다.
  return <YoloDialog
    label={review ? `${title} CCTV 현장 확인, 제스처 판정` : `${title} CCTV`}
    onClose={review ? undefined : onClose}
    urgent={review !== undefined}
    className={`yolo-cctv${review ? ' is-review' : ''}`}>
    {review && <div className={`yolo-cctv__band${review.done ? ' is-done' : ''}`} role="status">{review.band}</div>}
    <header className="yolo-cctv__head">
      <div>
        <h2>{title} CCTV</h2>
        <p>{review?.note ?? '실제 공항 CCTV가 아닌 DEMO 카메라 영상입니다.'}</p>
      </div>
      <button type="button" className="yolo-cctv__close" onClick={onClose} aria-label="CCTV 닫기">닫기</button>
    </header>

    <div className="yolo-cctv__stage" style={{ aspectRatio: `${srcW} / ${srcH}` }}>
      {frame && live
        ? <img src={frame.url} alt={`${title} 카메라 영상`} draggable={false} />
        : <div className="yolo-cctv__empty" role="status">{status.text}</div>}
      <canvas ref={canvasRef} aria-hidden="true" />
      <span className="yolo-cctv__demo">DEMO</span>
      {live && <span className={`yolo-cctv__status is-${status.tone}`} role="status">{status.text}</span>}
    </div>

    <dl className="yolo-cctv__info">
      <div>
        <dt>인원</dt>
        <dd>{live && result ? `${result.personCount.toLocaleString()}명 · ${YOLO_LEVEL_LABEL[result.crowdLevel]}` : '-'}</dd>
      </div>
      <div>
        <dt>검출</dt>
        <dd>{live && result ? `${result.detections.length}개` : '-'}</dd>
      </div>
      <div>
        <dt>분석 시간</dt>
        <dd>{live && result && result.inferMs !== null ? `${result.inferMs.toFixed(0)}ms` : '-'}</dd>
      </div>
    </dl>

    {review && <>
      {review.message && <p className="yolo-alert__error" role="alert">{review.message}</p>}
      <div className="yolo-alert__actions">
        <button type="button" className="is-confirm" disabled={review.busy || review.done} onClick={() => review.onDecide('CONFIRMED')}>확인 (실제 상황)</button>
        <button type="button" className="is-false" disabled={review.busy || review.done} onClick={() => review.onDecide('FALSE_POSITIVE')}>오탐 (잘못 감지)</button>
      </div>
    </>}
  </YoloDialog>
}
