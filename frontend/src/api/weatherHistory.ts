
export type WeatherHistoryPoint = {
  observedAt: string;
  temperature: number | null;
  windSpeed: number | null;
  condition: string | null;
  phenomenon: string | null;
  pressure: number | null;
  visibility: number | null;
};

export async function getWeatherHistory(
  hours = 24,
  signal?: AbortSignal
): Promise<WeatherHistoryPoint[]> {
  const base = String(
    import.meta.env.VITE_API_BASE_URL ?? ''
  ).replace(/\/+$/, '');

  const safeHours = Math.max(
    1,
    Math.min(48, Math.round(hours))
  );

  const response = await fetch(
    `${base}/api/v1/weather/history?hours=${safeHours}`,
    { signal }
  );

  if (!response.ok) {
    throw new Error(
      `기상 이력 API 오류: HTTP ${response.status}`
    );
  }

  const data: unknown = await response.json();

  if (!Array.isArray(data)) {
    throw new Error(
      '기상 이력 응답 형식이 올바르지 않습니다.'
    );
  }

  return data as WeatherHistoryPoint[];
}
