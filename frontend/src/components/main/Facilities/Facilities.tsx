
import { useMemo } from "react";
import { useLiveUpdates } from "../../../hooks/useLiveUpdates";
import Skeleton from "../../layout/Skeleton";
import "./Facilities.css";

type Terminal = "T1" | "T2";
type CrowdEstimate = "LOW" | "MID" | "HIGH" | null;
type CrowdBasis = "HALL" | "TERMINAL" | "FLIGHTS" | null;
type JsonObject = Record<string, unknown>;

interface Props {
  terminal: Terminal;
}

interface Facility {
  id: string;
  name: string;
  terminal: string | null;
  category: string | null;
  location: string | null;
  openingHours: string | null;
  isOpen: boolean | null;
  crowdEstimate: CrowdEstimate;
  crowdBasis: CrowdBasis;
}

const MAX_ITEMS = 3;

const API_BASE_URL = String(
  import.meta.env.VITE_API_BASE_URL ?? ""
).replace(/\/+$/, "");

function asObject(value: unknown): JsonObject | null {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return null;
  }
  return value as JsonObject;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}

function firstString(
  source: JsonObject,
  keys: string[]
): string | null {
  for (const key of keys) {
    const value = asString(source[key]);
    if (value !== null) return value;
  }
  return null;
}

function parseCrowd(value: unknown): CrowdEstimate {
  if (typeof value !== "string") return null;
  const level = value.toUpperCase();

  if (level === "LOW" || level === "MID" || level === "HIGH") {
    return level;
  }
  return null;
}

function parseBasis(value: unknown): CrowdBasis {
  if (typeof value !== "string") return null;
  const basis = value.toUpperCase();

  if (
    basis === "HALL" ||
    basis === "TERMINAL" ||
    basis === "FLIGHTS"
  ) {
    return basis;
  }
  return null;
}

function parseOpen(source: JsonObject): boolean | null {
  const value =
    source.isOpen ??
    source.is_open ??
    source.operationStatus ??
    source.status;

  if (typeof value === "boolean") return value;

  if (typeof value === "string") {
    const status = value.trim().toUpperCase();

    if (["OPEN", "OPERATING", "영업중", "운영중"].includes(status)) {
      return true;
    }

    if (
      ["CLOSED", "CLOSE", "영업종료", "운영종료"].includes(status)
    ) {
      return false;
    }
  }

  return null;
}

function formatHours(source: JsonObject): string | null {
  const is24h = source.is24h ?? source.is24H;

  if (is24h === true) return "24시간";

  const hours = firstString(source, [
    "openingHours",
    "opening_hours",
    "businessHours",
  ]);

  if (hours) return hours;

  const open = firstString(source, ["openTime"]);
  const close = firstString(source, ["closeTime"]);

  if (open && close) return `${open}~${close}`;
  return open ?? close;
}

function normalizeFacility(
  raw: unknown,
  index: number
): Facility | null {
  const item = asObject(raw);
  if (!item) return null;

  const name = firstString(item, [
    "name",
    "facilityName",
    "facility_name",
  ]);

  if (!name) return null;

  const rawId = item.id ?? item.facilityId;
  const id =
    typeof rawId === "string" || typeof rawId === "number"
      ? String(rawId)
      : `facility-${index}`;

  return {
    id,
    name,
    terminal: firstString(item, [
      "terminal",
      "terminalId",
    ]),
    category: firstString(item, [
      "category",
      "type",
    ]),
    location: firstString(item, [
      "location",
      "area",
      "floor",
    ]),
    openingHours: formatHours(item),
    isOpen: parseOpen(item),
    crowdEstimate: parseCrowd(item.crowdEstimate),
    crowdBasis: parseBasis(item.crowdBasis),
  };
}

function extractFacilities(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;

  const root = asObject(raw);
  if (!root) {
    throw new Error("편의시설 응답 형식이 올바르지 않습니다.");
  }

  for (const key of ["facilities", "items", "results", "data"]) {
    const value = root[key];

    if (Array.isArray(value)) return value;

    const nested = asObject(value);
    if (!nested) continue;

    for (const subKey of ["facilities", "items", "results"]) {
      const list = nested[subKey];
      if (Array.isArray(list)) return list;
    }
  }

  throw new Error("편의시설 목록을 찾지 못했습니다.");
}

async function fetchFacilities(
  signal: AbortSignal
): Promise<Facility[]> {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/facilities`,
    {
      method: "GET",
      signal,
      headers: {
        Accept: "application/json",
      },
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
      (item): item is Facility => item !== null
    );
}

function crowdRank(level: CrowdEstimate): number {
  switch (level) {
    case "LOW":
      return 0;
    case "MID":
      return 1;
    case "HIGH":
      return 2;
    default:
      return 3;
  }
}

function crowdLabel(level: CrowdEstimate): string {
  switch (level) {
    case "LOW":
      return "여유";
    case "MID":
      return "보통";
    case "HIGH":
      return "혼잡";
    default:
      return "";
  }
}

function basisLabel(basis: CrowdBasis): string {
  switch (basis) {
    case "HALL":
      return "출국장 기준";
    case "TERMINAL":
      return "터미널 기준";
    case "FLIGHTS":
      return "출발편 기준";
    default:
      return "";
  }
}

function terminalMatch(
  facility: Facility,
  terminal: Terminal
): boolean {
  const value = facility.terminal?.trim().toUpperCase();

  if (!value) return false;

  const aliases =
    terminal === "T1"
      ? ["T1", "1", "TERMINAL1", "TERMINAL 1"]
      : ["T2", "2", "TERMINAL2", "TERMINAL 2"];

  return aliases.includes(value);
}

export default function Facilities({ terminal }: Props) {
  // 편의시설 topic은 없음. REST만 60초마다 다시 조회.
  const { data, loading, error } = useLiveUpdates<Facility[]>({
    topic: null,
    fetcher: fetchFacilities,
    intervalMs: 0,
  });
  const facilities = data ?? [];

  const recommended = useMemo(() => {
    const candidates = facilities.filter(
      (facility) =>
        terminalMatch(facility, terminal) &&
        facility.isOpen !== false
    );

    // 예상 혼잡도가 있는 시설을 먼저 추천.
    // null은 최하위지만 임의로 여유라고 판단하지 않음.
    const sorted = [...candidates].sort((a, b) => {
      return (
        crowdRank(a.crowdEstimate) -
          crowdRank(b.crowdEstimate)
      );
    });

    const seen = new Set<string>();

    return sorted
      .filter((facility) => {
        const key = facility.id.startsWith("facility-")
          ? `${facility.name}|${facility.location ?? ""}`
          : facility.id;

        if (seen.has(key)) return false;

        seen.add(key);
        return true;
      });
  }, [facilities, terminal]);
  const shownFacilities = recommended.slice(0, MAX_ITEMS);

  if (loading && !data) {
    return (
      <Skeleton label="편의시설 정보를 불러오는 중입니다." variant="rows" count={3} />
    );
  }

  if (error && !data) {
    return (
      <div
        className="facilities-message facilities-error"
        role="alert"
      >
        {error}
      </div>
    );
  }

  if (recommended.length === 0) {
    return (
      <div className="facilities-message">
        표시할 편의시설이 없습니다.
      </div>
    );
  }

  return (
    <section className="facilities-widget">
      <div className="facilities-widget__list">
        {shownFacilities.map((facility, index) => (
          <article
            className="facilities-widget__item"
            key={facility.id}
          >
            <div className="facilities-widget__rank">
              {index + 1}
            </div>

            <div className="facilities-widget__info">
              <strong
                className="facilities-widget__name"
                title={facility.name}
              >
                {facility.name}
              </strong>

              <div className="facilities-widget__meta">
                {facility.category && (
                  <span title={facility.category}>
                    {facility.category}
                  </span>
                )}

                {facility.location && (
                  <span title={facility.location}>
                    {facility.location}
                  </span>
                )}
              </div>
            </div>

            <div className="facilities-widget__status">
              {facility.crowdEstimate !== null && (
                <div
                  className={
                    "facilities-widget__level " +
                    `facilities-widget__level--${facility.crowdEstimate.toLowerCase()}`
                  }
                  title={
                    `주변 혼잡 예상: ${crowdLabel(facility.crowdEstimate)}` +
                    (facility.crowdBasis
                      ? ` (${basisLabel(facility.crowdBasis)})`
                      : "")
                  }
                >
                  {crowdLabel(facility.crowdEstimate)}
                </div>
              )}

              <span
                className={
                  "facilities-widget__open" +
                  (facility.isOpen === null
                    ? " facilities-widget__open--unknown"
                    : "")
                }
              >
                {facility.isOpen === true
                  ? "운영 중"
                  : facility.isOpen === null
                    ? "운영 미확인"
                    : ""}
              </span>
            </div>
          </article>
        ))}
      </div>

      <div className="facilities-widget__notice">
        <strong>주변 혼잡 예상</strong>
        <span>
          시설 내 실측값이 아닌 주변 데이터 기반 추정입니다.
        </span>
      </div>
    </section>
  );
}
