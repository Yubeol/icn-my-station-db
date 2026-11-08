
import { useEffect, useState } from "react";
import { useLiveUpdates } from "../../../hooks/useLiveUpdates";
import Skeleton from "../../layout/Skeleton";

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
  const { data, loading, error } = useLiveUpdates<Hall[]>({
    topic: "congestion",
    scope: terminal,
    fetcher: (signal) => getCongestion(terminal, signal),
    intervalMs: 0,
  });
  const halls = data ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // 터미널 전환할 때에만 선택 해제. 실시간 갱신은 선택 유지.
  useEffect(() => {
    setSelectedId(null);
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

        {loading && !data ? (
          <Skeleton label="출국장 혼잡도를 불러오는 중입니다." variant="block" />
        ) : error && !data ? (
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
