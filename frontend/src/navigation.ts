import type { Terminal } from './api/client'

/** 화면 이동 때 함께 넘기는 값. nonce가 바뀌면 같은 화면에 있더라도 새로 적용합니다. */
export type AlertsFocus = {
  nonce: number
  /** 중요도 필터를 이 값으로 맞춥니다. */
  severity?: 'CRITICAL'
  /** 선택할 알림. YOLO 사건은 `yolo-<eventId>`입니다. */
  alertId?: string
}

export type CongestionFocus = {
  nonce: number
  terminal: Terminal
  /** 선택할 출국장 번호 */
  hallId: number
}
