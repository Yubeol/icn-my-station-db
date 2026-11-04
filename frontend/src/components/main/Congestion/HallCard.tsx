
import type { Hall } from "../../../api/congestion";

interface Props {
  hall: Hall;
  selected?: boolean;
  onClick?: () => void;
}

export function getHallLevel(
  hall: Hall
): "relaxed" | "normal" | "busy" | "unknown" {
  const level = String(hall.level ?? "").toUpperCase();

  if ([
    "RELAXED", "SPACIOUS", "LOW",
    "여유", "원활",
  ].includes(level)) return "relaxed";

  if ([
    "NORMAL", "MODERATE", "MEDIUM", "보통",
  ].includes(level)) return "normal";

  if ([
    "BUSY", "CROWDED", "HIGH",
    "VERY_CROWDED", "혼잡", "매우혼잡",
  ].includes(level)) return "busy";

  return "unknown";
}

export function getLevelLabel(hall: Hall): string {
  const level = getHallLevel(hall);

  if (level === "relaxed") return "여유";
  if (level === "normal") return "보통";
  if (level === "busy") return "혼잡";

  return hall.level || "확인 중";
}

export default function HallCard({
  hall,
  selected = false,
  onClick,
}: Props) {
  const checkRequired =
    hall.operationStatus === "CHECK_REQUIRED";

  const level = getHallLevel(hall);

  return (
    <button
      type="button"
      className={[
        "congestion-hall-card",
        selected ? "is-selected" : "",
      ].join(" ")}
      onClick={onClick}
      disabled={!onClick}
    >
      <span className="congestion-hall-card__name">
        {hall.name}
      </span>

      <strong className="congestion-hall-card__count">
        {hall.currentCount === null
          ? "인원 확인 중"
          : `${hall.currentCount.toLocaleString()}명`}
      </strong>

      <span
        className={`congestion-level congestion-level--${level}`}
      >
        {getLevelLabel(hall)}
      </span>

      {checkRequired && (
        <span className="congestion-hall-card__warning">
          운영 확인 필요
        </span>
      )}

      {hall.changeRate !== null && (
        <span className="congestion-hall-card__change">
          전일 대비 {hall.changeRate > 0 ? "+" : ""}
          {hall.changeRate.toFixed(1)}%
        </span>
      )}
    </button>
  );
}
