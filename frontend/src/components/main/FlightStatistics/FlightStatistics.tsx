
import { useMemo } from "react";
import { useLiveUpdates } from "../../../hooks/useLiveUpdates";
import type { Terminal } from "../../../types/flight";
import "./FlightStatistics.css";

// 기존 MainDashboard와 연결 호환성 유지
interface Props {
  terminal: Terminal;
}

type Category =
  | "NORMAL"
  | "DELAYED"
  | "CANCELLED"
  | "DIVERTED"
  | "OTHER";

interface Breakdown {
  category: string;
  count: number;
  ratio: number;
  changeRate: number | null;
}

interface StatisticsResponse {
  date: string;
  direction: string;
  total: number;
  breakdown: Breakdown[];
  hourly: {
    hour: number;
    count: number;
    delayedCount: number;
  }[];
}

const ITEMS: {
  category: Category;
  label: string;
  color: string;
}[] = [
  {
    category: "NORMAL",
    label: "정상 운항",
    color: "#2484f5",
  },
  {
    category: "DELAYED",
    label: "지연",
    color: "#ffb020",
  },
  {
    category: "CANCELLED",
    label: "결항",
    color: "#ff625d",
  },
  {
    category: "DIVERTED",
    label: "회항",
    color: "#78879d",
  },
  {
    category: "OTHER",
    label: "기타/미확인",
    color: "#cbd5e1",
  },
];

const API_BASE_URL = String(
  import.meta.env.VITE_API_BASE_URL ?? ""
).replace(/\/+$/, "");

// 백엔드 전용 통계 API 호출
async function getFlightStatistics(
  signal: AbortSignal
): Promise<StatisticsResponse> {
  const params = new URLSearchParams({
    direction: "DEPARTURE",
  });

  const url =
    `${API_BASE_URL}/api/v1/stats/flights?${params}`;

  console.log("[운항통계] 요청 주소:", url);

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(
      `운항통계 조회 실패: HTTP ${response.status}`
    );
  }

  const data: unknown = await response.json();

  if (
    typeof data !== "object" ||
    data === null ||
    !("total" in data) ||
    !("breakdown" in data) ||
    !("date" in data)
  ) {
    throw new Error("운항통계 API 응답 형식이 다릅니다.");
  }

  const result = data as StatisticsResponse;

  if (
    !Number.isFinite(result.total) ||
    !Array.isArray(result.breakdown) ||
    typeof result.date !== "string"
  ) {
    throw new Error("운항통계 데이터가 올바르지 않습니다.");
  }

  console.group("[운항통계 API 응답]");
  console.log("집계 날짜:", result.date);
  console.log("방향:", result.direction);
  console.log("전체:", result.total);
  console.table(result.breakdown);
  console.groupEnd();

  return result;
}

export default function FlightStatistics({
  terminal: _terminal,
}: Props) {
  // API는 터미널별 통계를 제공하지 않음
  // prop은 기존 공동 개발 구조와의 호환성을 위해 유지
  void _terminal;

  const { data, loading, error } = useLiveUpdates<StatisticsResponse>({
    topic: "stats",
    // 통계는 전체 터미널 기준. 실제 scope 값은 계약 확인 후 구체화.
    scope: null,
    fetcher: getFlightStatistics,
    intervalMs: 0,
  });

  // API 데이터로 차트 값 구성
  const statistics = useMemo(() => {
    if (!data) return null;

    const counts = new Map<string, number>();

    data.breakdown.forEach((item) => {
      counts.set(
        item.category.toUpperCase(),
        item.count
      );
    });

    const knownCategories = new Set([
      "NORMAL",
      "DELAYED",
      "CANCELLED",
      "DIVERTED",
    ]);

    const knownTotal = [...counts.entries()]
      .filter(([category]) =>
        knownCategories.has(category)
      )
      .reduce((sum, [, count]) => sum + count, 0);

    const otherCount = Math.max(
      0,
      data.total - knownTotal
    );

    const rows = ITEMS.map((item) => {
      const count =
        item.category === "OTHER"
          ? otherCount
          : counts.get(item.category) ?? 0;

      const percentage =
        data.total > 0
          ? (count / data.total) * 100
          : 0;

      return {
        ...item,
        count,
        percentage,
      };
    });

    // 실제 편수 기준 도넛 색상 계산
    let position = 0;

    const segments = rows.map((item) => {
      const end = position + item.percentage;

      const segment =
        `${item.color} ${position}% ${end}%`;

      position = end;

      return segment;
    });

    const gradient =
      data.total > 0
        ? `conic-gradient(${segments.join(", ")})`
        : "conic-gradient(#e2e8f0 0% 100%)";

    return {
      rows,
      gradient,
      total: data.total,
    };
  }, [data]);

  return (
    <section className="flight-statistics">
      {/* 집계 기준 */}
      <div className="flight-statistics__period">
        전체 터미널 · {data?.date ?? "오늘"} 출발 운항
      </div>

      <div className="flight-statistics__body">
        {loading && !data ? (
          <div className="flight-statistics__message">
            운항통계를 불러오는 중입니다.
          </div>
        ) : error && !data ? (
          <div
            className="flight-statistics__message flight-statistics__error"
            role="alert"
          >
            {error}
          </div>
        ) : statistics ? (
          <>
            {/* 도넛 차트 */}
            <div className="flight-statistics__chart-area">
              <div
                className="flight-statistics__donut"
                style={{
                  background: statistics.gradient,
                }}
                role="img"
                aria-label={`전체 ${statistics.total}편`}
              >
                <div className="flight-statistics__center">
                  <span>전체</span>
                  <strong>
                    {statistics.total.toLocaleString()}편
                  </strong>
                </div>
              </div>
            </div>

            {/* 운항 상태별 비율 */}
            <div className="flight-statistics__details">
              {statistics.rows.map((item) => {
                if (
                  item.category === "OTHER" &&
                  item.count === 0
                ) {
                  return null;
                }

                return (
                  <div
                    className="flight-statistics__item"
                    key={item.category}
                  >
                    <span
                      className="flight-statistics__dot"
                      style={{
                        backgroundColor: item.color,
                      }}
                    />

                    <span className="flight-statistics__name">
                      {item.label}
                    </span>

                    <strong className="flight-statistics__count">
                      {item.count.toLocaleString()}
                    </strong>

                    <span className="flight-statistics__percent">
                      {item.percentage.toFixed(1)}%
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="flight-statistics__message">
            운항통계 데이터가 없습니다.
          </div>
        )}
      </div>
    </section>
  );
}
