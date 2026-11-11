
import { useMemo } from "react";
import { useLiveUpdates } from "../../../hooks/useLiveUpdates";
import Skeleton from "../../layout/Skeleton";
import { useYoloAlertFeed } from "../../../hooks/useYoloAlertFeed";
import "./SmartAlerts.css";

type Terminal = "T1" | "T2";
type JsonObject = Record<string, unknown>;

interface Props {
  terminal: Terminal;
  /** YOLO 사건을 누르면 호출됩니다. 스마트 알림 화면으로 이동해 그 사건을 선택하는 데 씁니다. */
  onOpenAlert?: (alertId: string) => void;
}

interface AlertItem {
  id: string;
  title: string;
  message: string | null;
  occurredAt: string | null;
  terminal: string | null;
  type: string | null;
  severity: string | null;
  isImportant: boolean;
  /** YOLO 사건이면 true. 누를 수 있고, 스마트 알림 화면과 같은 목록에서 합쳐 온 항목입니다. */
  isYolo?: boolean;
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

function asBoolean(value: unknown): boolean {
  return value === true;
}

function getFirstString(
  source: JsonObject,
  keys: string[]
): string | null {
  for (const key of keys) {
    const value = asString(source[key]);
    if (value !== null) return value;
  }

  return null;
}

function normalizeAlert(
  value: unknown,
  index: number
): AlertItem | null {
  const item = asObject(value);
  if (!item) return null;

  const title = getFirstString(item, [
    "title",
    "alertTitle",
  ]);

  // 제목이 없는 데이터를 임의 제목으로 표시하지 않음
  if (!title) return null;

  const message = getFirstString(item, [
    "message",
    "summary",
    "description",
  ]);

  const occurredAt = getFirstString(item, [
    "occurredAt",
    "createdAt",
    "timestamp",
  ]);

  const explicitId = item.id ?? item.alertId;

  const id =
    typeof explicitId === "string" ||
    typeof explicitId === "number"
      ? String(explicitId)
      : `row-${index}`;

  return {
    id,
    title,
    message,
    occurredAt,
    terminal: getFirstString(item, ["terminal"]),
    type: getFirstString(item, ["type", "category"]),
    severity: getFirstString(item, ["severity"]),
    isImportant: asBoolean(item.isImportant),
  };
}

function extractAlertArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;

  const root = asObject(raw);
  if (!root) {
    throw new Error("알림 API 응답 형식이 올바르지 않습니다.");
  }

  for (const key of ["alerts", "items", "results", "data"]) {
    const candidate = root[key];

    if (Array.isArray(candidate)) {
      return candidate;
    }

    const nested = asObject(candidate);

    if (nested) {
      for (const nestedKey of ["alerts", "items", "results"]) {
        if (Array.isArray(nested[nestedKey])) {
          return nested[nestedKey] as unknown[];
        }
      }
    }
  }

  throw new Error("알림 목록 필드를 찾지 못했습니다.");
}

async function getAlerts(
  signal: AbortSignal
): Promise<AlertItem[]> {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/alerts`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      signal,
    }
  );

  if (!response.ok) {
    throw new Error(
      `알림 조회 실패: HTTP ${response.status}`
    );
  }

  const raw: unknown = await response.json();
  const list = extractAlertArray(raw);

  return list
    .map(normalizeAlert)
    .filter((item): item is AlertItem => item !== null);
}

function getTimeValue(value: string | null): number {
  if (!value) return -Infinity;

  const time = Date.parse(value);
  return Number.isFinite(time) ? time : -Infinity;
}

function formatTime(value: string | null): string | null {
  if (!value) return null;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul",
  }).format(date);
}

function getTone(alert: AlertItem): string {
  const severity = alert.severity?.toUpperCase() ?? "";

  if (
    ["CRITICAL", "HIGH", "DANGER", "ERROR"]
      .includes(severity)
  ) {
    return "danger";
  }

  if (
    ["WARNING", "WARN", "MEDIUM", "MID", "CAUTION"]
      .includes(severity)
  ) {
    return "warning";
  }

  if (alert.isImportant) return "important";

  return "normal";
}

export default function SmartAlerts({ terminal, onOpenAlert }: Props) {
  const { data, loading, error } = useLiveUpdates<AlertItem[]>({
    topic: "alerts",
    scope: null,
    fetcher: getAlerts,
    intervalMs: 0,
  });
  // 위젯에는 판정 대기(PENDING) 중인 YOLO 사건 중 최신 1건만 보여 줍니다. 판정된 사건은 숨기고, 나머지 칸은 기존 알림입니다.
  // (스마트 알림 페이지는 판정된 사건까지 모두 보여 줍니다.) 새 알림·판정은 실시간으로 반영됩니다.
  const yoloAlerts = useYoloAlertFeed();
  const alerts = data ?? [];

  const yoloLatest = useMemo<AlertItem | null>(() => {
    const pending = yoloAlerts
      .filter((alert) => alert.yolo?.reviewStatus === "PENDING")
      .filter((alert) => {
        // 터미널 정보가 없으면 공항 공통 알림으로 취급
        if (!alert.terminal) return true;
        return alert.terminal.trim().toUpperCase() === terminal;
      })
      .sort((a, b) => getTimeValue(b.createdAt) - getTimeValue(a.createdAt))[0];

    return pending
      ? {
          id: pending.alertId,
          title: pending.title,
          message: pending.message,
          occurredAt: pending.createdAt,
          terminal: pending.terminal ?? null,
          type: pending.type,
          severity: pending.severity,
          isImportant: true,
          isYolo: true,
        }
      : null;
  }, [yoloAlerts, terminal]);

  const visibleAlerts = useMemo(() => {
    const scoped = alerts.filter((alert) => {
      // 터미널 정보가 없으면 공항 공통 알림으로 취급
      if (!alert.terminal) return true;

      const value = alert.terminal.trim().toUpperCase();

      return (
        value === terminal ||
        value === "ALL" ||
        value === "BOTH"
      );
    });

    const sorted = [...scoped].sort((a, b) => {
      if (a.isImportant !== b.isImportant) {
        return Number(b.isImportant) - Number(a.isImportant);
      }

      return (
        getTimeValue(b.occurredAt) -
        getTimeValue(a.occurredAt)
      );
    });

    // 명시적인 ID가 있으면 ID로, 없으면 내용으로 중복 검사
    const seen = new Set<string>();

    return sorted
      .filter((alert) => {
        const key = alert.id.startsWith("row-")
          ? [
              alert.title,
              alert.message ?? "",
              alert.occurredAt ?? "",
              alert.terminal ?? "",
            ].join("|")
          : alert.id;

        if (seen.has(key)) return false;

        seen.add(key);
        return true;
      });
  }, [alerts, terminal]);
  // 판정 대기 YOLO 사건이 있으면 맨 위 한 칸, 나머지 칸은 기존 알림입니다.
  const shownAlerts = yoloLatest
    ? [yoloLatest, ...visibleAlerts.slice(0, MAX_ITEMS - 1)]
    : visibleAlerts.slice(0, MAX_ITEMS);

  if (loading && !data) {
    return (
      <Skeleton label="알림 정보를 불러오는 중입니다." variant="rows" count={3} />
    );
  }

  if (error && !data) {
    return (
      <div
        className="smart-alerts__state smart-alerts__error"
        role="alert"
      >
        {error}
      </div>
    );
  }

  if (visibleAlerts.length === 0 && !yoloLatest) {
    return (
      <div className="smart-alerts__state">
        알림 데이터 없음
      </div>
    );
  }

  return (
    <section className="smart-alerts">
      <div className="smart-alerts__summary">
        {terminal} 기준 · 최신 알림 최대 {MAX_ITEMS}건
      </div>

      <div className="smart-alerts__list">
        {shownAlerts.map((alert) => {
          const tone = getTone(alert);
          const time = formatTime(alert.occurredAt);

          return (
            <article
              key={alert.id}
              className={`smart-alerts__item smart-alerts__item--${tone}${alert.isYolo && onOpenAlert ? " smart-alerts__item--link" : ""}`}
              {...(alert.isYolo && onOpenAlert
                ? {
                    role: "button",
                    tabIndex: 0,
                    title: "스마트 알림에서 이 사건 보기",
                    onClick: () => onOpenAlert(alert.id),
                    onKeyDown: (event: React.KeyboardEvent) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onOpenAlert(alert.id);
                      }
                    },
                  }
                : {})}
            >
              <span
                className="smart-alerts__indicator"
                aria-hidden="true"
              />

              <div className="smart-alerts__info">
                <div className="smart-alerts__title-row">
                  <strong className="smart-alerts__title">
                    {alert.title}
                  </strong>

                  {time && (
                    <time className="smart-alerts__time">
                      {time}
                    </time>
                  )}
                </div>

                {alert.message && (
                  <p className="smart-alerts__message">
                    {alert.message}
                  </p>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
