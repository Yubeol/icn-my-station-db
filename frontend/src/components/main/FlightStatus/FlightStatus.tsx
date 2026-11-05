
import { useEffect, useMemo, useState } from "react";
import { useLiveUpdates } from "../../../hooks/useLiveUpdates";
import type {
  Flight,
  FlightStatusProps,
} from "../../../types/flight";

import { getFlights } from "../../../api/flights";
import FlightTimeline from "./FlightTimeline";
import "./FlightStatus.css";

const MAX_FLIGHTS = 5;

function isCancelled(flight: Flight): boolean {
  const status = String(flight.status ?? "").toUpperCase();

  return status.includes("CANCEL") || status.includes("결항");
}

function getFlightTime(flight: Flight): number | null {
  const value = flight.estimatedAt || flight.scheduledAt;
  if (!value) return null;

  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function hasGate(flight: Flight): boolean {
  return (
    flight.gate !== null &&
    flight.gate !== undefined &&
    String(flight.gate).trim() !== ""
  );
}

export default function FlightStatus({
  terminal,
}: FlightStatusProps) {
  const { data, loading, error } = useLiveUpdates<Flight[]>({
    topic: "flights",
    // 편명 갱신 scope는 최신 api-contract.md를 확인한 뒤 세분화.
    scope: null,
    fetcher: (signal) => getFlights(terminal, "DEPARTURE", signal),
    intervalMs: 0,
    // 터미널 전환 시 해당 데이터로 초기화하기 위한 key
    resourceKey: terminal,
  });
  const flights = data ?? [];
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const clock = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(clock);
  }, []);

  const visibleFlights = useMemo(() => {
    const currentTime = now.getTime();

    const valid = flights.filter(
      (flight) =>
        !isCancelled(flight) &&
        hasGate(flight) &&
        getFlightTime(flight) !== null
    );

    const selected = [...valid]
      .sort((a, b) => {
        const aTime = getFlightTime(a)!;
        const bTime = getFlightTime(b)!;

        return (
          Math.abs(aTime - currentTime) -
            Math.abs(bTime - currentTime) ||
          aTime - bTime
        );
      })
      .slice(0, MAX_FLIGHTS);

    return selected.sort(
      (a, b) => getFlightTime(a)! - getFlightTime(b)!
    );
  }, [flights, now]);

  return (
    <section className="flight-status">
      <div className="flight-status__content">
        {loading && !data ? (
          <div className="flight-status__message">
            <span className="flight-status__spinner" />
            <span>항공편 정보를 불러오는 중입니다.</span>
          </div>
        ) : error && !data ? (
          <div
            className="flight-status__message flight-status__message--error"
            role="alert"
          >
            <strong>항공편 조회 실패</strong>
            <span>{error}</span>
          </div>
        ) : visibleFlights.length === 0 ? (
          <div className="flight-status__message">
            표시할 항공편이 없습니다.
          </div>
        ) : (
          <FlightTimeline
            flights={visibleFlights}
            now={now}
          />
        )}
      </div>

      <div className="flight-status__legend">
        <span>
          <i className="flight-status__dot flight-status__dot--normal" />
          정상
        </span>
        <span>
          <i className="flight-status__dot flight-status__dot--delayed" />
          지연
        </span>
        <span>
          <i className="flight-status__dot flight-status__dot--original" />
          기존 일정
        </span>
      </div>
    </section>
  );
}
