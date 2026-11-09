
import { useLiveUpdates } from "../../../hooks/useLiveUpdates";
import { getWeather } from "../../../api/client";
import { OPERATION_SCORE_BASIS } from "../../../api/rules";
import Skeleton from "../../layout/Skeleton";
import "./WeatherConditions.css";

type Dict = Record<string, unknown>;

interface WeatherData {
  observedAt: string | null;
  windDirection: number | null;
  windSpeed: number | null;
  windGust: number | null;
  visibility: number | null;
  runway: string | null;
  crosswind: number | null;
  crosswindDirection: string | null;
  delayRisk: string | null;
  score: number | null;
  minutesAhead: number | null;
  message: string | null;
}

function obj(value: unknown): Dict {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? (value as Dict)
    : {};
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}

function normalize(raw: unknown): WeatherData {
  const root = obj(raw);
  const data = obj(root.data);

  const source = Object.keys(data).length ? data : root;
  const crosswind = obj(source.crosswind);
  const operation = obj(source.operationScore);

  return {
    observedAt: str(source.observedAt),

    windDirection: num(source.windDirection),
    windSpeed: num(source.windSpeed),
    windGust: num(source.windGust),
    visibility: num(source.visibility),

    runway:
      str(crosswind.activeRunway) ??
      str(crosswind.runway) ??
      str(source.activeRunway),

    crosswind:
      num(crosswind.speed) ??
      num(source.crosswindSpeed),

    crosswindDirection:
      str(crosswind.direction) ??
      str(source.crosswindDirection),

    delayRisk:
      str(operation.delayRisk) ??
      str(source.delayRisk),

    score:
      num(operation.score) ??
      num(source.operationScore),

    minutesAhead:
      num(operation.minutesAhead) ??
      num(source.minutesAhead),

    message:
      str(operation.message) ??
      str(source.message),
  };
}

function formatValue(
  value: number | null,
  unit: string,
  digits = 0
): string {
  return value === null
    ? "확인 중"
    : `${value.toFixed(digits)}${unit}`;
}

function directionName(degrees: number | null): string {
  if (degrees === null) return "";

  const names = [
    "북", "북동", "동", "남동",
    "남", "남서", "서", "북서",
  ];

  const index =
    Math.round((((degrees % 360) + 360) % 360) / 45) % 8;

  return names[index];
}

function getRisk(value: string | null) {
  const normalized = (value ?? "").toUpperCase();

  if (["LOW", "GOOD", "SAFE"].includes(normalized)) {
    return { label: "낮음", className: "low" };
  }

  if (
    ["MID", "MEDIUM", "MODERATE", "CAUTION"]
      .includes(normalized)
  ) {
    return { label: "주의", className: "mid" };
  }

  if (
    ["HIGH", "DANGER", "CRITICAL"]
      .includes(normalized)
  ) {
    return { label: "높음", className: "high" };
  }

  return {
    label: value ?? "확인 중",
    className: "unknown",
  };
}

// 활주로 번호에 대응하는 개략 방위
function getRunwayBearing(runway: string | null): number | null {
  if (!runway) return null;

  const match = runway.match(
    /(?:^|[^0-9])([0-3][0-9])[LRC]?(?=$|[^0-9])/i
  );

  if (!match) return null;

  const number = Number(match[1]);

  if (number < 1 || number > 36) return null;

  return (number * 10) % 360;
}

export function WindCompass({
  windDirection,
  runway,
}: {
  windDirection: number | null;
  runway: string | null;
}) {
  const runwayBearing = getRunwayBearing(runway);

  function point(degrees: number, radius: number) {
    const rad = (degrees * Math.PI) / 180;

    return {
      x: 100 + Math.sin(rad) * radius,
      y: 100 - Math.cos(rad) * radius,
    };
  }

  const runwayA =
    runwayBearing === null
      ? null
      : point(runwayBearing, 67);

  const runwayB =
    runwayBearing === null
      ? null
      : point(runwayBearing + 180, 67);

  // 풍향은 바람이 불어오는 방향
  const wind =
    windDirection === null
      ? null
      : point(windDirection, 70);

  return (
    <svg
      className="weather-compass"
      viewBox="0 0 200 200"
      role="img"
      aria-label={
        windDirection === null
          ? "풍향 확인 중"
          : `${windDirection}도 방향에서 불어오는 바람`
      }
    >
      <circle
        cx="100"
        cy="100"
        r="73"
        fill="#f5f9ff"
        stroke="#c8d9ee"
        strokeWidth="2"
      />

      <circle
        cx="100"
        cy="100"
        r="49"
        fill="none"
        stroke="#dce7f5"
        strokeWidth="1.5"
      />

      <line
        x1="100" y1="27"
        x2="100" y2="173"
        stroke="#dde7f4"
      />

      <line
        x1="27" y1="100"
        x2="173" y2="100"
        stroke="#dde7f4"
      />

      <g
        fill="#536d91"
        fontSize="13"
        fontWeight="700"
        textAnchor="middle"
      >
        <text x="100" y="15">N</text>
        <text x="100" y="196">S</text>
        <text x="11" y="105">W</text>
        <text x="189" y="105">E</text>
      </g>

      {runwayA && runwayB && (
        <line
          x1={runwayA.x}
          y1={runwayA.y}
          x2={runwayB.x}
          y2={runwayB.y}
          stroke="#657992"
          strokeWidth="13"
          strokeLinecap="round"
        />
      )}

      {wind && (
        <>
          <line
            x1="100"
            y1="100"
            x2={wind.x}
            y2={wind.y}
            stroke="#00b98d"
            strokeWidth="4"
            strokeLinecap="round"
          />

          <circle
            cx={wind.x}
            cy={wind.y}
            r="6"
            fill="#00b98d"
            stroke="white"
            strokeWidth="2"
          />
        </>
      )}

      <circle
        cx="100"
        cy="100"
        r="5"
        fill="#173f72"
      />
    </svg>
  );
}

function Metric({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: string;
}) {
  return (
    <div className={`weather-metric ${tone ?? ""}`}>
      <span className="weather-metric__label">
        {label}
      </span>

      <strong className="weather-metric__value">
        {value}
      </strong>

      {detail && (
        <small className="weather-metric__detail">
          {detail}
        </small>
      )}
    </div>
  );
}

export default function WeatherConditions() {
  const { data: weather, loading, error } = useLiveUpdates<WeatherData>({
    topic: "weather",
    scope: null,
    fetcher: async (signal) => normalize(await getWeather(signal)),
    intervalMs: 0,
  });

  if (loading && !weather) {
    return (
      <Skeleton label="기상 정보를 불러오는 중입니다." variant="rows" count={2} />
    );
  }

  if (error && !weather) {
    return (
      <div
        className="weather-message weather-error"
        role="alert"
      >
        {error}
      </div>
    );
  }

  if (!weather) {
    return (
      <div className="weather-message">
        기상 정보가 없습니다.
      </div>
    );
  }

  const risk = getRisk(weather.delayRisk);
  return (
    <section className="weather-widget">
      <div className="weather-widget__content">
        <div className="weather-widget__compass-area">
          <WindCompass
            windDirection={weather.windDirection}
            runway={weather.runway}
          />

          <span className="weather-widget__runway">
            활주로 {weather.runway ?? "확인 중"}
          </span>
        </div>

        <div className="weather-widget__metrics">
          <Metric
            label="풍향"
            value={formatValue(weather.windDirection, "°")}
            detail={directionName(weather.windDirection)}
          />

          <Metric
            label="풍속"
            value={formatValue(weather.windSpeed, " m/s", 1)}
          />

          <Metric
            label="측풍"
            value={formatValue(weather.crosswind, " kt", 1)}
            detail={weather.crosswindDirection ?? undefined}
          />

          <Metric
            label="출발 지연 위험"
            value={risk.label}
            tone={`weather-metric--${risk.className}`}
          />

          <Metric
            label="운항 여건 점수"
            value={
              weather.score === null
                ? "확인 중"
                : `${weather.score.toFixed(0)} / 100`
            }
            detail={
              weather.minutesAhead === null
                ? OPERATION_SCORE_BASIS
                : `${weather.minutesAhead}분 후 · ${OPERATION_SCORE_BASIS}`
            }
          />
        </div>
      </div>
    </section>
  );
}
