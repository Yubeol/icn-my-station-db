import { YOLO_CAMERA_HALLS } from '../../api/yolo'
import type { YoloLiveState } from '../../hooks/useYoloLive'

export type YoloTone = 'LOW' | 'MID' | 'HIGH' | 'OFF'

export const YOLO_LEVEL_LABEL = { LOW: '여유', MID: '보통', HIGH: '혼잡' } as const

/** 화면에 보여 줄 카메라 인원 상태. 연결이 되어 있고 인원을 받은 경우에만 실측 값을 보여 줍니다. */
export function describeYolo(state: YoloLiveState, cameraId: number): { tone: YoloTone; text: string } {
  if (!state.connected) return { tone: 'OFF', text: '연결 대기' }
  const camera = state.cameras[cameraId]
  if (!camera || camera.camera === 'OFFLINE') return { tone: 'OFF', text: '카메라 미연결' }
  if (camera.worker === 'OFFLINE') return { tone: 'OFF', text: '분석 대기' }
  const count = state.counts[cameraId]
  if (!count) return { tone: 'OFF', text: '인원 집계 중' }
  return { tone: count.crowdLevel, text: `${count.personCount.toLocaleString()}명 · ${YOLO_LEVEL_LABEL[count.crowdLevel]}` }
}

/** 카메라가 비추는 곳의 이름. 예: "T1 3번 출국장" */
export function cameraPlace(cameraId: number): string {
  const hall = YOLO_CAMERA_HALLS.find(item => item.cameraId === cameraId)
  return hall ? `${hall.terminal} ${hall.hallId}번 출국장` : `카메라 ${cameraId}번`
}
