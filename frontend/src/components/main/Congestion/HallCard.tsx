
import type { Hall } from "../../../api/congestion";
import AnimatedNumber from "../../layout/AnimatedNumber";
import { HALL_CHECK_HINT, HALL_CHECK_LABEL, isMainHallChecking } from "./hallStatus";

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
    "MID", "NORMAL", "MODERATE", "MEDIUM", "보통",
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
  const checking = isMainHallChecking(hall);

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

      <strong
        className="congestion-hall-card__count"
        style={checking ? { color: "var(--muted)", fontSize: 12, fontWeight: 600, opacity: 0.8 } : undefined}
        title={checking ? HALL_CHECK_HINT : undefined}
      >
        {checking
          ? HALL_CHECK_LABEL
          : <><AnimatedNumber value={hall.currentCount ?? 0} />명</>}
      </strong>

      {!checking && (
        <span
          className={`congestion-level congestion-level--${level}`}
        >
          {getLevelLabel(hall)}
        </span>
      )}

      {!checking && hall.changeRate !== null && (
        <span className="congestion-hall-card__change">
          30분 전 대비 {hall.changeRate > 0 ? "+" : ""}
          {hall.changeRate.toFixed(1)}%
        </span>
      )}
    </button>
  );
}
