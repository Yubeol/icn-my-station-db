
import { useEffect, useState } from "react";

import {
  getCongestion,
} from "../../../api/congestion";

import type {
  Hall,
  Terminal,
} from "../../../api/congestion";

import TerminalMap from "./TerminalMap";
import HallCard from "./HallCard";

import "./Congestion.css";

interface Props {
  terminal: Terminal;
}

export default function Congestion({
  terminal,
}: Props) {
  const [halls, setHalls] = useState<Hall[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] =
    useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function loadCongestion() {
      setLoading(true);
      setError(null);
      setHalls([]);
      setSelectedId(null);

      try {
        const data = await getCongestion(
          terminal,
          controller.signal
        );

        if (controller.signal.aborted) return;

        setHalls(data);
      } catch (err) {
        if (controller.signal.aborted) return;

        const message =
          err instanceof Error
            ? err.message
            : "혼잡도 정보를 불러오지 못했습니다.";

        console.error("[출국장 혼잡도]", err);

        setError(message);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void loadCongestion();

    return () => controller.abort();
  }, [terminal]);

  return (
    <section className="congestion-panel">
      <div className="congestion-panel__map">
        <TerminalMap
          terminal={terminal}
          halls={halls}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </div>

      <div className="congestion-panel__bottom">
        <div className="congestion-panel__heading">
          <strong>출국장별 혼잡 현황</strong>
          <span>{terminal}</span>
        </div>

        {loading ? (
          <div className="congestion-panel__message">
            출국장 혼잡도를 불러오는 중입니다.
          </div>
        ) : error ? (
          <div
            className="congestion-panel__message congestion-panel__error"
            role="alert"
          >
            {error}
          </div>
        ) : halls.length === 0 ? (
          <div className="congestion-panel__message">
            표시할 출국장 정보가 없습니다.
          </div>
        ) : (
          <div className="congestion-panel__cards">
            {halls.map((hall) => (
              <HallCard
                key={hall.id}
                hall={hall}
                selected={selectedId === hall.id}
                onClick={() => setSelectedId(hall.id)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
