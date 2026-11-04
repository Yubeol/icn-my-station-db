
import { useEffect, useMemo, useState } from "react";
import "./Facilities.css";

type Terminal = "T1" | "T2";
type JsonObject = Record<string, unknown>;

interface Props {
  terminal: Terminal;
}

type CrowdLevel = "LOW" | "MID" | "HIGH" | null;

interface Facility {
  id: string;
  name: string;
  terminal: string | null;
  category: string | null;
  location: string | null;
  openingHours: string | null;
  isOpen: boolean | null;
  crowdLevel: CrowdLevel;
  crowdCount: number | null;
  crowdRate: number | null;
}

const API_BASE_URL = String(
  import.meta.env.VITE_API_BASE_URL ?? ""
).replace(/\/+$/, "");

function obj(value: unknown): JsonObject | null {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return null;
  }

  return value as JsonObject;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const result = Number(value);
    return Number.isFinite(result) ? result : null;
  }

  return null;
}

function firstString(
  source: JsonObject,
  keys: string[]
): string | null {
  for (const key of keys) {
    const value = stringValue(source[key]);
    if (value !== null) return value;
  }
  return null;
}

function firstNumber(
  source: JsonObject,
  keys: string[]
): number | null {
  for (const key of keys) {
    const value = numberValue(source[key]);
    if (value !== null) return value;
  }
  return null;
}

function openStatus(
  source: JsonObject
): boolean | null {
  const value =
    source.isOpen ??
    source.is_open ??
    source.openNow ??
    source.operationStatus ??
    source.status;

  if (typeof value === "boolean") return value;

  if (typeof value === "string") {
    const normalized = value.trim().toUpperCase();

    if (
      ["OPEN", "OPERATING", "영업중", "운영중"]
        .includes(normalized)
    ) {
      return true;
    }

    if (
      ["CLOSED", "CLOSE", "휴업", "영업종료", "운영종료"]
        .includes(normalized)
    ) {
      return false;
    }
  }

  return null;
}

function crowdLevel(value: unknown): CrowdLevel {
  if (typeof value !== "string") return null;

  const normalized = value.trim().toUpperCase();

  if (
    ["LOW", "RELAXED", "SPACIOUS", "여유", "원활"]
      .includes(normalized)
  ) {
    return "LOW";
  }

  if (
    ["MID", "MEDIUM", "NORMAL", "MODERATE", "보통"]
      .includes(normalized)
  ) {
    return "MID";
  }

  if (
    [
      "HIGH", "BUSY", "CROWDED",
      "VERY_CROWDED", "혼잡", "매우혼잡",
    ].includes(normalized)
  ) {
    return "HIGH";
  }

  return null;
}

function normalizeFacility(
  raw: unknown,
  index: number
): Facility | null {
  const item = obj(raw);
  if (!item) return null;

  const name = firstString(item, [
    "name",
    "facilityName",
    "facility_name",
  ]);

  if (!name) return null;

  const crowd = obj(item.crowd) ?? obj(item.congestion) ?? {};

  const idValue = item.id ?? item.facilityId;

  const id =
    typeof idValue === "string" ||
    typeof idValue === "number"
      ? String(idValue)
      : `row-${index}`;

  return {
    id,
    name,
    terminal: firstString(item, ["terminal", "terminalId"]),
    category: firstString(item, ["category", "type"]),
    location: firstString(item, ["location", "floor", "area"]),
    openingHours: firstString(item, [
      "openingHours",
      "opening_hours",
      "businessHours",
    ]),
    isOpen: openStatus(item),
    crowdLevel: crowdLevel(
      item.crowdLevel ??
      item.congestionLevel ??
      crowd.level
    ),
    crowdCount:
      firstNumber(item, ["crowdCount", "currentCount"]) ??
      firstNumber(crowd, ["count", "currentCount"]),
    crowdRate:
      firstNumber(item, ["crowdRate", "occupancyRate"]) ??
      firstNumber(crowd, ["rate", "occupancyRate"]),
  };
}

function extractFacilities(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;

  const root = obj(raw);

  if (!root) {
    throw new Error("편의시설 응답 형식이 올바르지 않습니다.");
  }

  for (const key of ["facilities", "items", "results", "data"]) {
    const value = root[key];

    if (Array.isArray(value)) return value;

    const nested = obj(value);
    if (nested) {
      for (const nestedKey of ["facilities", "items", "results"]) {
        if (Array.isArray(nested[nestedKey])) {
          return nested[nestedKey] as unknown[];
        }
      }
    }
  }

  throw new Error("편의시설 목록을 찾지 못했습니다.");
}

async function getFacilities(
  signal: AbortSignal
): Promise<Facility[]> {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/facilities`,
    {
      method: "GET",
      headers: { Accept: "application/json" },
      signal,
    }
  );

  if (!response.ok) {
    throw new Error(
      `편의시설 조회 실패: HTTP ${response.status}`
    );
  }

  const raw: unknown = await response.json();

  return extractFacilities(raw)
    .map(normalizeFacility)
    .filter(
      (facility): facility is Facility =>
        facility !== null
    );
}

function levelRank(level: CrowdLevel): number | null {
  if (level === "LOW") return 0;
  if (level === "MID") return 1;
  if (level === "HIGH") return 2;
  return null;
}

function levelLabel(level: CrowdLevel): string {
  if (level === "LOW") return "여유";
  if (level === "MID") return "보통";
  if (level === "HIGH") return "혼잡";
  return "혼잡 미확인";
}

function isTerminalMatch(
  facility: Facility,
  terminal: Terminal
): boolean {
  const value = facility.terminal?.toUpperCase();

  return (
    value === terminal ||
    value === (terminal === "T1" ? "1" : "2")
  );
}

export default function Facilities({ terminal }: Props) {
  const [facilities, setFacilities] =
    useState<Facility[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setLoading(true);
      setError(null);
      setFacilities([]);

      try {
        const result = await getFacilities(controller.signal);

        if (!controller.signal.aborted) {
          setFacilities(result);
        }
      } catch (err) {
        if (controller.signal.aborted) return;

        setError(
          err instanceof Error
            ? err.message
            : "편의시설 조회 중 오류가 발생했습니다."
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => controller.abort();
  }, []);

  const recommended = useMemo(() => {
    const candidates = facilities.filter((facility) => {
      // 터미널이 일치하고 운영 중이며 혼잡도가 확인된 시설만
      return (
        isTerminalMatch(facility, terminal) &&
        facility.isOpen === true &&
        facility.crowdLevel !== null
      );
    });

    // 혼잡 단계: 여유 -> 보통 -> 혼잡
    // 같은 단계에서 혼잡률이 둘 다 있으면 낮은 순으로 정렬
    const ranked = [...candidates].sort((a, b) => {
      const rankA = levelRank(a.crowdLevel) ?? Infinity;
      const rankB = levelRank(b.crowdLevel) ?? Infinity;

      if (rankA !== rankB) return rankA - rankB;

      if (a.crowdRate !== null && b.crowdRate !== null) {
        return a.crowdRate - b.crowdRate;
      }

      if (a.crowdCount !== null && b.crowdCount !== null) {
        return a.crowdCount - b.crowdCount;
      }

      return 0;
    });

    const seen = new Set<string>();

    return ranked.filter((facility) => {
      const key = facility.id.startsWith("row-")
        ? `${facility.name}|${facility.location ?? ""}`
        : facility.id;

      if (seen.has(key)) return false;

      seen.add(key);
      return true;
    }).slice(0, 3);
  }, [facilities, terminal]);

  if (loading) {
    return (
      <div className="facilities-message">
        편의시설 정보를 불러오는 중입니다.
      </div>
    );
  }

  if (error) {
    return (
      <div className="facilities-message facilities-error" role="alert">
        {error}
      </div>
    );
  }

  if (recommended.length === 0) {
    return (
      <div className="facilities-message">
        운영 및 혼잡도가 확인된 추천 시설이 없습니다.
      </div>
    );
  }

  return (
    <section className="facilities-widget">
      <div className="facilities-widget__list">
        {recommended.map((facility, index) => (
          <article
            className="facilities-widget__item"
            key={facility.id}
          >
            <span className="facilities-widget__rank">
              {index + 1}
            </span>

            <div className="facilities-widget__info">
              <strong className="facilities-widget__name">
                {facility.name}
              </strong>

              <div className="facilities-widget__meta">
                {facility.category && (
                  <span>{facility.category}</span>
                )}
                {facility.location && (
                  <span>{facility.location}</span>
                )}
                {facility.openingHours && (
                  <span>{facility.openingHours}</span>
                )}
              </div>
            </div>

            <div className="facilities-widget__status">
              <span className="facilities-widget__open">
                운영 중
              </span>

              <span
                className={
                  `facilities-widget__level ` +
                  `facilities-widget__level--${facility.crowdLevel?.toLowerCase()}`
                }
              >
                {levelLabel(facility.crowdLevel)}
              </span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
