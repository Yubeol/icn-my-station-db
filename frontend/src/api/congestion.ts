
export type Terminal = "T1" | "T2";

export interface Hall {
  id: string;
  name: string;
  currentCount: number | null;
  level: string | null;
  changeRate: number | null;
  operationStatus: string | null;
}

const API_BASE_URL = String(
  import.meta.env.VITE_API_BASE_URL ?? ""
).replace(/\/+$/, "");

type Raw = Record<string, unknown>;

function asObject(value: unknown): Raw {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? (value as Raw)
    : {};
}

function first(
  object: Raw,
  keys: string[]
): unknown {
  for (const key of keys) {
    if (object[key] !== undefined &&
        object[key] !== null) {
      return object[key];
    }
  }
  return null;
}

function numeric(value: unknown): number | null {
  if (value === null || value === undefined ||
      value === "") return null;

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function stringValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();
  return text || null;
}

function normalizeHall(rawValue: unknown, index: number): Hall {
  const raw = asObject(rawValue);

  const id = stringValue(first(raw, [
    "hallId", "zoneId", "id", "hall", "zone",
  ])) ?? String(index + 1);

  const name = stringValue(first(raw, [
    "hallName", "zoneName", "name", "label",
  ])) ?? `${id} 출국장`;

  return {
    id,
    name,
    currentCount: numeric(first(raw, [
      "currentCount", "currentPassengers",
      "passengerCount", "peopleCount",
      "count", "current",
    ])),
    level: stringValue(first(raw, [
      "level", "congestionLevel",
      "congestionStatus",
    ])),
    changeRate: numeric(first(raw, [
      "changeRate", "changePercent",
      "previousDayChangeRate",
    ])),
    operationStatus: stringValue(
      raw.operationStatus
    ),
  };
}

function extractHalls(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;

  const root = asObject(data);
  const nested = asObject(root.data);

  for (const source of [root, nested]) {
    for (const key of [
      "halls", "zones", "congestion",
      "items", "results",
    ]) {
      if (Array.isArray(source[key])) {
        return source[key] as unknown[];
      }
    }
  }

  throw new Error(
    "혼잡도 응답에서 출국장 배열을 찾지 못했습니다."
  );
}

export async function getCongestion(
  terminal: Terminal,
  signal?: AbortSignal
): Promise<Hall[]> {
  const params = new URLSearchParams({ terminal });
  const url =
    `${API_BASE_URL}/api/v1/congestion?${params}`;

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal,
  });

  if (!response.ok) {
    throw new Error(
      `혼잡도 API 오류: HTTP ${response.status}`
    );
  }

  const data: unknown = await response.json();

  console.log(`[혼잡도 ${terminal}] 원본 응답`, data);

  const halls = extractHalls(data).map(normalizeHall);

  console.table(halls);

  return halls;
}
