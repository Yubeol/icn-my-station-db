import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import './yolo.css'

type Props = {
  /** 화면 읽기 프로그램에 전달할 제목 */
  label: string
  children: ReactNode
  /** 배경 클릭·Esc로 닫는 동작. 판정이 필요한 긴급 알림은 넘기지 않습니다. */
  onClose?: () => void
  className?: string
  /** 긴급 알림처럼 즉시 읽어야 하는 내용이면 alertdialog로 알립니다. */
  urgent?: boolean
}

/** YOLO 화면용 공용 대화상자. 열리면 포커스를 가져가고 닫히면 원래 위치로 돌려줍니다. */
export default function YoloDialog({ label, children, onClose, className = '', urgent = false }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    ref.current?.focus()
    return () => previous?.focus?.()
  }, [])

  return <div className="yolo-dialog__backdrop" onMouseDown={event => {
    if (onClose && event.target === event.currentTarget) onClose()
  }}>
    <div
      ref={ref}
      className={`yolo-dialog ${className}`}
      role={urgent ? 'alertdialog' : 'dialog'}
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={event => {
        if (event.key === 'Escape' && onClose) onClose()
      }}>
      {children}
    </div>
  </div>
}
