import type { ReactNode } from 'react'
import { YoloLiveContext, useYoloLiveState } from '../../hooks/useYoloLive'

/** 앱 전체에서 /ws/live의 yolo_* 와 판정 대기 알림을 한 번만 구독해 하위 화면에 나눠 줍니다. */
export default function YoloProvider({ children }: { children: ReactNode }) {
  const state = useYoloLiveState()
  return <YoloLiveContext.Provider value={state}>{children}</YoloLiveContext.Provider>
}
