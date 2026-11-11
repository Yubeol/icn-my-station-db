import { useEffect, useState } from 'react'
import { getYoloViewUrl, parseYoloFrame, parseYoloViewMessage } from '../api/yolo'
import type { YoloConnState, YoloViewResult } from '../api/yolo'

/** 뷰어에 보여 줄 현재 프레임. url은 브라우저 메모리의 Blob 주소이며 저장하거나 로그로 남기지 않습니다. */
export type YoloViewFrame = { url: string; frameId: number; width: number; height: number }

export type YoloViewState = {
  /** connecting: 연결 중 · open: 연결됨 · closed: 끊김(재연결 대기) · rejected: 등록되지 않은 카메라(4404, 재시도 중) */
  link: 'connecting' | 'open' | 'closed' | 'rejected'
  camera: YoloConnState
  worker: YoloConnState
  frame: YoloViewFrame | null
  /** 가장 최근 result. 다음 result가 올 때까지 유지합니다. */
  result: YoloViewResult | null
}

const INITIAL: YoloViewState = { link: 'connecting', camera: 'OFFLINE', worker: 'OFFLINE', frame: null, result: null }
const RETRY_MS = [1000, 2000, 4000] // 계약 2장의 앱 재연결과 같은 간격(최대 4초)
const KEEP_URLS = 3 // 아직 그리는 중인 이미지가 깨지지 않도록 직전 몇 장의 주소는 늦게 해제합니다.

/** /ws/yolo/view를 열고 프레임·상태·result를 받습니다. enabled가 false이거나 화면이 닫히면 연결을 끊습니다. */
export function useYoloView(cameraId: number, enabled: boolean): YoloViewState {
  const [state, setState] = useState<YoloViewState>(INITIAL)

  useEffect(() => {
    if (!enabled) return
    let active = true
    let socket: WebSocket | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let attempt = 0
    // 지금 화면에 표시 중인 프레임 번호. 이보다 작은 frameId의 result는 버립니다(계약 4장).
    let shownFrameId = -1
    const urls: string[] = []

    const releaseOld = () => {
      while (urls.length > KEEP_URLS) URL.revokeObjectURL(urls.shift() as string)
    }

    const connect = () => {
      if (!active) return
      const ws = new WebSocket(getYoloViewUrl(cameraId))
      ws.binaryType = 'arraybuffer'
      socket = ws
      setState(current => ({ ...current, link: 'connecting' }))

      ws.onopen = () => {
        if (socket !== ws) return
        attempt = 0
        setState(current => ({ ...current, link: 'open' }))
      }

      ws.onmessage = event => {
        if (socket !== ws) return
        if (event.data instanceof ArrayBuffer) {
          const parsed = parseYoloFrame(event.data)
          if (!parsed || parsed.header.cameraId !== cameraId) return
          const url = URL.createObjectURL(new Blob([event.data.slice(parsed.jpegStart)], { type: 'image/jpeg' }))
          urls.push(url)
          releaseOld()
          shownFrameId = parsed.header.frameId
          const { frameId, width, height } = parsed.header
          setState(current => ({ ...current, frame: { url, frameId, width, height } }))
          return
        }
        let raw: unknown
        try {
          raw = JSON.parse(String(event.data))
        } catch {
          return
        }
        const message = parseYoloViewMessage(raw)
        if (!message || message.cameraId !== cameraId) return
        if (message.type === 'status') {
          // 카메라가 끊기면 남아 있는 박스가 현재 장면처럼 보이지 않도록 지웁니다.
          setState(current => ({
            ...current,
            camera: message.camera,
            worker: message.worker,
            result: message.camera === 'OFFLINE' ? null : current.result,
          }))
        } else if (message.frameId >= shownFrameId) {
          setState(current => ({ ...current, result: message }))
        }
      }

      ws.onclose = closeEvent => {
        if (socket !== ws) return
        socket = null
        shownFrameId = -1 // 재연결하면 frameId가 다시 1부터 시작합니다.
        // 등록되지 않은 카메라(4404)도 계속 다시 시도합니다. 카메라가 나중에 등록·송출되면 자동으로 이어집니다.
        const link = closeEvent.code === 4404 ? 'rejected' : 'closed'
        setState(current => ({ ...current, link, camera: 'OFFLINE', worker: 'OFFLINE', result: null }))
        if (!active) return
        timer = setTimeout(connect, RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)])
        attempt += 1
      }
    }

    connect()

    return () => {
      active = false
      if (timer !== null) clearTimeout(timer)
      const closing = socket
      socket = null
      closing?.close()
      urls.forEach(url => URL.revokeObjectURL(url))
      urls.length = 0
      setState(INITIAL)
    }
  }, [cameraId, enabled])

  return state
}
