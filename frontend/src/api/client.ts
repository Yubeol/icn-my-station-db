/** ICN My Station API. 응답 타입은 자동 생성된 types.ts를 단일 기준으로 사용합니다. */
import type { components } from './types'

export type Flight = components['schemas']['Flight']
export type FlightStats = components['schemas']['FlightStats']
export type DashboardSummary = components['schemas']['DashboardSummary']
export type Congestion = components['schemas']['Congestion']
export type Weather = components['schemas']['Weather']
export type Alert = components['schemas']['Alert']
export type Facility = components['schemas']['Facility']
export type CongestionHourly = {
  terminal: Terminal
  date: string
  hours: { hour: number; today: number | null; yesterday: number | null; level: 'LOW' | 'MID' | 'HIGH' | null }[]
}
export type FlightDetail = {
  generatedAt: string
  flight: Flight
  congestion: Congestion
  alerts: Alert[]
  weather: Weather & {
    windGust?: number | null
    operationScore: Weather['operationScore'] & { delayRisk?: 'LOW' | 'MID' | 'HIGH' | null }
  }
  facilities: Facility[]
}
export type Direction = components['schemas']['Direction']
export type Terminal = components['schemas']['Terminal']
export type LiveTopic = 'congestion' | 'flights' | 'stats' | 'alerts' | 'weather'

/** Vite 프록시를 쓸 경우 기본값은 상대 경로입니다. 백엔드 주소는 VITE_API_BASE_URL로도 지정할 수 있습니다. */
const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

export class ApiError extends Error {
  public status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}
async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'GET',
    signal,
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) {
    let message = `API 요청 실패: HTTP ${response.status}`
    try {
      const body: unknown = await response.json()
      if (body && typeof body === 'object' && 'detail' in body && typeof body.detail === 'string') message = body.detail
    } catch { /* JSON이 아닌 오류 응답은 기본 메시지 사용 */ }
    throw new ApiError(response.status, message)
  }
  return response.json() as Promise<T>
}

function query(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value)
  const string = search.toString()
  return string ? `?${string}` : ''
}

/** 기존 사용법 getDashboardSummary(signal) 호환. flightNo는 두 번째 인수. */
export function getDashboardSummary(signal?: AbortSignal, flightNo?: string): Promise<DashboardSummary> {
  return get(`/api/v1/dashboard/summary${query({ flightNo })}`, signal)
}
export function getFlights(type: Direction, signal?: AbortSignal, flightNo?: string): Promise<Flight[]> {
  return get(`/api/v1/flights${query({ type, flightNo })}`, signal)
}
export function getFlight(flightNo: string, signal?: AbortSignal): Promise<Flight> {
  return get(`/api/v1/flights/${encodeURIComponent(flightNo)}`, signal)
}
export function getFlightDetail(flightNo: string, signal?: AbortSignal): Promise<FlightDetail> {
  return get(`/api/v1/flights/${encodeURIComponent(flightNo)}/detail`, signal)
}
export function getCongestion(terminal: Terminal, signal?: AbortSignal): Promise<Congestion> {
  return get(`/api/v1/congestion${query({ terminal })}`, signal)
}
export function getCongestionHourly(terminal: Terminal, signal?: AbortSignal): Promise<CongestionHourly> {
  return get(`/api/v1/congestion/hourly${query({ terminal })}`, signal)
}
export function getFlightStats(direction: Direction, signal?: AbortSignal): Promise<FlightStats> {
  return get(`/api/v1/stats/flights${query({ direction })}`, signal)
}
export function getAlerts(signal?: AbortSignal, flightNo?: string): Promise<Alert[]> {
  return get(`/api/v1/alerts${query({ flightNo })}`, signal)
}
export function getWeather(signal?: AbortSignal): Promise<Weather> {
  return get('/api/v1/weather', signal)
}
export function getFacilities(signal?: AbortSignal): Promise<Facility[]> {
  return get('/api/v1/facilities', signal)
}

/** WebSocket 계약. base URL이 지정되면 동일 호스트를 사용합니다. */
export type LiveMessage = {
  topic: LiveTopic
  scope: string | null
  data: unknown
  sentAt: string
}
export function getLiveUrl(): string {
  const base = BASE_URL ? new URL(BASE_URL, window.location.origin) : new URL(window.location.origin)
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
  base.pathname = '/ws/live'
  base.search = ''
  return base.toString()
}
