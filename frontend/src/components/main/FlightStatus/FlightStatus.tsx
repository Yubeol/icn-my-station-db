
import { useEffect, useMemo, useState } from "react";
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
  const [flights, setFlights] = useState<Flight[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const controller = new AbortController();

    async function loadFlights() {
      setLoading(true);
      setError(null);
      setFlights([]);

      try {
        const data = await getFlights(
          terminal,
          "DEPARTURE",
          controller.signal
        );

        if (controller.signal.aborted) return;

        setFlights(data);
        setNow(new Date());
      } catch (err) {
        if (controller.signal.aborted) return;

        setError(
          err instanceof Error
            ? err.message
            : "항공편 조회에 실패했습니다."
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void loadFlights();

    return () => controller.abort();
  }, [terminal]);

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
        {loading ? (
          <div className="flight-status__message">
            <span className="flight-status__spinner" />
            <span>항공편 정보를 불러오는 중입니다.</span>
          </div>
        ) : error ? (
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
