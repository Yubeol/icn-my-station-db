/** HTTP GET 공통 처리. 프로젝트 내 API 호출은 이 함수를 통해 수행합니다. */
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export function makeQuery(params: Record<string, string | undefined | null>): string {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.set(key, value)
  })
  const result = search.toString()
  return result ? `?${result}` : ''
}

export async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  })

  if (!response.ok) {
    let message = `API 요청 실패: HTTP ${response.status}`
    try {
      const body: unknown = await response.json()
      if (body && typeof body === 'object' && 'detail' in body) {
        if (typeof body.detail === 'string') message = body.detail
      }
    } catch {
      // JSON이 아닌 오류 응답은 기본 메시지를 사용합니다.
    }
    throw new ApiError(response.status, message)
  }

  return (await response.json()) as T
}

/** WebSocket 주소도 HTTP API와 동일한 서버를 사용합니다. */
export function getLiveUrl(): string {
  const base = new URL(API_BASE_URL || window.location.origin, window.location.origin)
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
  base.pathname = '/ws/live'
  base.search = ''
  return base.toString()
}
