
import { useMemo } from "react";
import type { Flight } from "../../../types/flight";
import FlightBar from "./FlightBar";

interface FlightTimelineProps {
  flights: Flight[];
  now?: Date;
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

function parseTime(value: string | null | undefined) {
  if (!value) return null;

  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function formatTime(time: number) {
  return new Date(time).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul",
  });
}

function isDelayed(flight: Flight) {
  const status = String(flight.status ?? "").toUpperCase();

  return (
    status.includes("DELAY") ||
    status.includes("지연") ||
    Number(flight.delayMinutes ?? 0) > 0
  );
}

function getGate(flight: Flight) {
  return String(flight.gate ?? "-").trim() || "-";
}

export default function FlightTimeline({
  flights,
  now = new Date(),
}: FlightTimelineProps) {
  const timeline = useMemo(() => {
    const times = flights.flatMap((flight) => {
      const scheduled = parseTime(flight.scheduledAt);
      const estimated = parseTime(flight.estimatedAt);

      return [scheduled, estimated].filter(
        (time): time is number => time !== null
      );
    });

    if (times.length === 0) return null;

    const earliest = Math.min(...times);
    const latest = Math.max(...times);

    // 항공편의 시간 차이를 반영하되 최소 2시간 확보
    const start = Math.floor(
      (earliest - 15 * MINUTE) / (30 * MINUTE)
    ) * 30 * MINUTE;

    const end = Math.ceil(
      Math.max(
        latest + 15 * MINUTE,
        start + 2 * HOUR
      ) / (30 * MINUTE)
    ) * 30 * MINUTE;

    const duration = end - start;

    const toPercent = (time: number) =>
      Math.max(
        0,
        Math.min(100, ((time - start) / duration) * 100)
      );

    const ticks = Array.from({ length: 4 }, (_, index) => {
      const time = start + (duration * index) / 3;

      return {
        time,
        left: (index / 3) * 100,
      };
    });

    return {
      start,
      end,
      ticks,
      toPercent,
    };
  }, [flights]);

  if (!timeline) {
    return (
      <div className="flight-timeline__empty">
        표시할 운항 시간이 없습니다.
      </div>
    );
  }

  const nowTime = now.getTime();
  const showNow =
    nowTime >= timeline.start &&
    nowTime <= timeline.end;

  return (
    <div className="flight-timeline">
      <div className="flight-timeline__header">
        <div className="flight-timeline__gate-label">
          게이트
        </div>

        <div className="flight-timeline__time-area">
          {timeline.ticks.map((tick, index) => (
            <span
              key={index}
              className="flight-timeline__tick-label"
              style={{ left: `${tick.left}%` }}
            >
              {formatTime(tick.time)}
            </span>
          ))}
        </div>
      </div>

      <div className="flight-timeline__rows">
        {flights.map((flight, index) => {
          const scheduled = parseTime(flight.scheduledAt);

          const estimated = parseTime(flight.estimatedAt);

          const displayTime = estimated ?? scheduled;

          if (displayTime === null) return null;

          const delayed = isDelayed(flight);

          const position = timeline.toPercent(displayTime);

          const scheduledPosition =
            scheduled !== null
              ? timeline.toPercent(scheduled)
              : null;

          return (
            <div
              className="flight-timeline__row"
              key={`${flight.flightNo}-${index}`}
            >
              <div className="flight-timeline__gate">
                {getGate(flight)}
              </div>

              <div className="flight-timeline__track">
                {timeline.ticks.map((tick, i) => (
                  <div
                    key={i}
                    className="flight-timeline__grid-line"
                    style={{ left: `${tick.left}%` }}
                  />
                ))}

                {showNow && (
                  <div
                    className="flight-timeline__now-line"
                    style={{
                      left: `${timeline.toPercent(nowTime)}%`,
                    }}
                  />
                )}

                {delayed && scheduledPosition !== null && (
                  <div
                    className="flight-timeline__original"
                    style={{
                      left: `clamp(40px, ${scheduledPosition}%, calc(100% - 40px))`,
                    }}
                    title={`기존 예정 ${formatTime(scheduled!)}`}
                  />
                )}

                <FlightBar
                  flight={flight}
                  left={position}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
