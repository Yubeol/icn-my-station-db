/** 비어 있는 디자인 박스를 유지하면서 API의 연결 상태만 표시합니다. */
type Props = { status: 'loading' | 'success' | 'error'; error?: string | null }
export default function ApiStatus({ status, error }: Props) {
  return <p className={`icn-api-status icn-api-status--${status}`} role="status">
    {status === 'loading' ? 'API 연결 중' : status === 'success' ? 'API 응답 수신' : `API 연결 실패: ${error ?? '알 수 없는 오류'}`}
  </p>
}
