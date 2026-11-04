
import { useState } from "react";
import type { Flight } from "../../../types/flight";

interface FlightBarProps {
  flight: Flight;
  left: number;
}

// 항공사 로고 경로
const AIRLINE_LOGOS: Record<string, string> = {
  KE: "/airlines/korean-air.png",
  OZ: "/airlines/asiana.png",
  "7C": "/airlines/jeju-air.png",
  LJ: "/airlines/jin-air.png",
  TW: "/airlines/tway.png",
  BX: "/airlines/air-busan.png",
  ZE: "/airlines/eastar.png",
  RS: "/airlines/air-seoul.png",
};

// 운항 지연 여부
function isDelayed(flight: Flight): boolean {
  const status = String(
    flight.status ?? ""
  ).toUpperCase();

  return (
    status.includes("DELAY") ||
    status.includes("지연") ||
    Number(flight.delayMinutes ?? 0) > 0
  );
}

// 시간 표시 형식
function formatTime(
  value: string | null | undefined
): string {
  if (!value) return "-";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul",
  });
}

// 편명에서 항공사 코드 추출
function getAirlineCode(flightNo: string): string {
  const value = String(flightNo ?? "")
    .trim()
    .toUpperCase();

  const match = value.match(/^[A-Z0-9]{2}/);

  return match?.[0] ?? "";
}

export default function FlightBar({
  flight,
  left,
}: FlightBarProps) {
  const delayed = isDelayed(flight);

  const airlineCode = getAirlineCode(flight.flightNo);
  const logo = AIRLINE_LOGOS[airlineCode];

  const [brokenLogo, setBrokenLogo] = useState<string | null>(
    null
  );

  const delayMinutes = Number(
    flight.delayMinutes ?? 0
  );

  // 실제 시간 위치가 카드 밖으로 벗어나지 않도록 제한
  const safeLeft = Math.max(
    0,
    Math.min(100, Number.isFinite(left) ? left : 0)
  );

  // 마우스를 올리면 확인할 간단한 정보
  const tooltip = [
    `${flight.airline} ${flight.flightNo}`,
    `게이트: ${flight.gate ?? "-"}`,
    `목적지: ${flight.city ?? "-"}`,
    `예정: ${formatTime(flight.scheduledAt)}`,
    `변경: ${formatTime(flight.estimatedAt)}`,
    `상태: ${flight.status}`,
    delayed && delayMinutes > 0
      ? `지연: ${delayMinutes}분`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div
      className={
        `flight-bar ${
          delayed
            ? "flight-bar--delayed"
            : "flight-bar--normal"
        }`
      }
      style={{
        left: `clamp(40px, ${safeLeft}%, calc(100% - 40px))`,
      }}
      title={tooltip}
      aria-label={tooltip}
    >
      {/* 항공사 로고 */}
      {logo && brokenLogo !== logo && (
        <img
          src={logo}
          alt=""
          className="flight-bar__logo"
          onError={() => setBrokenLogo(logo)}
        />
      )}

      {/* 편명 */}
      <span className="flight-bar__number">
        {flight.flightNo}
      </span>

      {/* 지연 시간 */}
      {delayed && delayMinutes > 0 && (
        <span className="flight-bar__delay">
          +{delayMinutes}분
        </span>
      )}
    </div>
  );
}
