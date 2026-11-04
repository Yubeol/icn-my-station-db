
import type {
  Flight,
  FlightType,
  Terminal,
} from "../types/flight";

// 환경변수가 없으면 Vite 프록시 사용
const API_BASE_URL = String(
  import.meta.env.VITE_API_BASE_URL ?? ""
).replace(/\/+$/, "");

const TIMEOUT_MS = 12000;

export async function getFlights(
  terminal: Terminal,
  type: FlightType = "DEPARTURE",
  signal?: AbortSignal
): Promise<Flight[]> {
  const params = new URLSearchParams({ type });

  const url =
    `${API_BASE_URL}/api/v1/flights?${params.toString()}`;

  const controller = new AbortController();

  let timedOut = false;

  const onAbort = () => {
    controller.abort();
  };

  if (signal?.aborted) {
    controller.abort();
  } else {
    signal?.addEventListener("abort", onAbort, {
      once: true,
    });
  }

  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, TIMEOUT_MS);

  console.log("[운행현황] 요청 시작", {
    url,
    terminal,
    type,
  });

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    console.log(
      "[운행현황] HTTP 상태:",
      response.status
    );

    if (!response.ok) {
      const errorBody = await response.text();

      console.error(
        "[운행현황] 서버 응답 오류:",
        errorBody
      );

      throw new Error(
        `항공편 API 요청 실패: HTTP ${response.status}`
      );
    }

    const data: unknown = await response.json();

    console.log("[운행현황] 원본 데이터:", data);

    if (!Array.isArray(data)) {
      throw new Error(
        "항공편 API 응답이 배열 형식이 아닙니다."
      );
    }

    const flights = data as Flight[];

    // 백엔드 응답의 터미널 값으로 필터링
    const filtered = flights.filter((flight) => {
      const flightTerminal = String(
        flight.terminal ?? ""
      ).trim().toUpperCase();

      return flightTerminal === terminal;
    });

    console.group("[운행현황 데이터 확인]");
    console.log("전체 항공편:", flights.length);
    console.log("선택 터미널:", terminal);
    console.log("필터링 결과:", filtered.length);
    console.log("첫 항공편:", flights[0] ?? null);
    console.table(filtered);
    console.groupEnd();

    return filtered;
  } catch (error) {
    if (timedOut && !signal?.aborted) {
      throw new Error(
        "서버가 12초 안에 응답하지 않았습니다."
      );
    }

    if (!signal?.aborted) {
      console.error(
        "[운행현황] API 오류:",
        error
      );
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);

    signal?.removeEventListener(
      "abort",
      onAbort
    );
  }
}
