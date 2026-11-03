import { useEffect, useState } from 'react'

type ApiState<T> =
  | { status: 'loading'; data: null; error: null }
  | { status: 'success'; data: T; error: null }
  | { status: 'error'; data: null; error: string }

/** 요청 취소를 지원하는 간단한 API 연결 훅. 화면 디자인/표시 형식은 담당자가 구현합니다. */
export function useApiResource<T>(load: (signal: AbortSignal) => Promise<T>, dependencies: readonly unknown[] = []): ApiState<T> {
  const [state, setState] = useState<ApiState<T>>({ status: 'loading', data: null, error: null })
  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading', data: null, error: null })
    load(controller.signal)
      .then(data => { if (!controller.signal.aborted) setState({ status: 'success', data, error: null }) })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ status: 'error', data: null, error: error instanceof Error ? error.message : '알 수 없는 API 오류' })
      })
    return () => controller.abort()
    // 호출자는 load가 참조하는 값들을 dependencies에 전달합니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies)
  return state
}
