
import {
  getWeather as requestWeather,
  type Weather,
} from "./client";

export type WeatherResponse = Weather;

export const WEATHER_REFRESH_MS = 60_000;
export const WEATHER_STALE_MS = 30 * 60_000;

export function getWeather(
  signal?: AbortSignal
): Promise<WeatherResponse> {
  return requestWeather(signal);
}

export function formatWeatherNumber(
  value: number | null | undefined,
  unit: string,
  digits = 0
): string {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value)
  ) {
    return "미관측";
  }

  return `${value.toFixed(digits)}${unit}`;
}

export function formatWindDirection(
  value: number | null | undefined
): string {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value)
  ) {
    return "미관측";
  }

  const directions = [
    "북", "북동", "동", "남동",
    "남", "남서", "서", "북서",
  ];

  const normalized = ((value % 360) + 360) % 360;
  const index = Math.round(normalized / 45) % 8;

  return `${Math.round(normalized)}° ${directions[index]}`;
}

export function getRunwayHeading(
  runway: string | null | undefined
): number | null {
  if (!runway) return null;

  const match = runway.match(/^([0-3]\d)/);

  if (!match) return null;

  const number = Number(match[1]);

  if (number < 1 || number > 36) {
    return null;
  }

  // 활주로 번호 기반의 개략적인 자북 방향
  return (number * 10) % 360;
}

export function formatObservationTime(
  value: string | null | undefined
): string {
  if (!value) return "미확인";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "미확인";
  }

  return date.toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function getObservationAge(
  value: string | null | undefined,
  now = Date.now()
): number | null {
  if (!value) return null;

  const observed = new Date(value).getTime();

  if (!Number.isFinite(observed)) {
    return null;
  }

  const elapsed = now - observed;

  // 미래 관측값은 시간 기준 이상으로 취급
  if (elapsed < -60_000) {
    return null;
  }

  return Math.max(0, elapsed);
}

export function getObservationStatus(
  value: string | null | undefined,
  now = Date.now()
): "fresh" | "stale" | "unknown" {
  const age = getObservationAge(value, now);

  if (age === null) return "unknown";

  return age >= WEATHER_STALE_MS
    ? "stale"
    : "fresh";
}

export function getDelayRiskLabel(
  risk: string | null | undefined
): string {
  switch (risk?.toUpperCase()) {
    case "LOW":
      return "낮음";
    case "MID":
    case "MEDIUM":
      return "보통";
    case "HIGH":
      return "높음";
    default:
      return "산출 불가";
  }
}

export function getWeatherConditionLabel(
  condition: string | null | undefined
): string {
  const labels: Record<string, string> = {
    CLEAR: "맑음",
    CLOUDY: "흐림",
    RAIN: "비",
    SNOW: "눈",
    FOG: "안개",
  };

  if (!condition) return "미관측";

  return labels[condition.toUpperCase()] ?? condition;
}
