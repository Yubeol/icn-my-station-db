
import { useMemo } from "react";
import { contours } from "d3-contour";
import type { Hall } from "../../../api/congestion";

export interface HallPoint {
  number: string;
  x: number;
  y: number;
  hall?: Hall;
}

interface Props {
  points: HallPoint[];
  clipId: string;
}

const WIDTH = 800;
const HEIGHT = 440;

// 계산 격자 해상도
const COLS = 160;
const ROWS = 88;

// 값이 높을수록 혼잡
function getCongestionValue(hall?: Hall): number | null {
  if (!hall) return null;

  if ((hall.operationStatus === "CHECK_REQUIRED" || (hall.currentCount ?? 0) === 0)) {
    return null;
  }

  const level = String(hall.level ?? "")
    .trim()
    .toUpperCase();

  if (
    ["LOW", "RELAXED", "SPACIOUS", "FREE", "여유", "원활"]
      .includes(level)
  ) {
    return 0.18;
  }

  if (
    ["MID", "MEDIUM", "NORMAL", "MODERATE", "보통"]
      .includes(level)
  ) {
    return 0.53;
  }

  if (
    [
      "HIGH",
      "BUSY",
      "CROWDED",
      "VERY_CROWDED",
      "혼잡",
      "매우혼잡",
    ].includes(level)
  ) {
    return 0.95;
  }

  return null;
}

// D3 GeoJSON 좌표를 SVG path로 변환
function polygonPath(
  coordinates: number[][][][]
): string {
  return coordinates
    .map((polygon) =>
      polygon
        .map((ring) =>
          ring
            .map(([x, y], index) =>
              `${index === 0 ? "M" : "L"}${x},${y}`
            )
            .join(" ") + " Z"
        )
        .join(" ")
    )
    .join(" ");
}

export default function ContourOverlay({
  points,
  clipId,
}: Props) {
  const layers = useMemo(() => {
    const samples = points
      .map((point) => ({
        ...point,
        value: getCongestionValue(point.hall),
      }))
      .filter(
        (point): point is typeof point & { value: number } =>
          point.value !== null
      );

    if (samples.length === 0) return [];

    const values: number[] = [];

    // 각 출국장 값을 주변 공간에 확장하여
    // 연속적인 혼잡도 분포 생성
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const px = ((x + 0.5) / COLS) * WIDTH;
        const py = ((y + 0.5) / ROWS) * HEIGHT;

        let weighted = 0;
        let totalWeight = 0;

        for (const point of samples) {
          const dx = (px - point.x) / 110;
          const dy = (py - point.y) / 72;

          const weight = Math.exp(
            -0.5 * (dx * dx + dy * dy)
          );

          weighted += weight * point.value;
          totalWeight += weight;
        }

        // 관측 지점에서 멀어질수록 영향 감소
        const influence = Math.min(1, totalWeight * 2.2);

        const value =
          totalWeight > 0
            ? (weighted / totalWeight) * influence
            : 0;

        values.push(value);
      }
    }

    // 낮은 값부터 높은 값 순서로 영역을 겹침
    const thresholds = [0.08, 0.38, 0.70];

    const generated = contours()
      .size([COLS, ROWS])
      .smooth(true)
      .thresholds(thresholds)(values);

    const colors = [
      "#66DB9A",
      "#FFD56A",
      "#F27777",
    ];

    return generated.map((contour, index) => ({
      id: index,
      color: colors[index],
      d: polygonPath(contour.coordinates),
    }));
  }, [points]);

  return (
    <g
      clipPath={`url(#${clipId})`}
      pointerEvents="none"
    >
      <g
        transform={`scale(${WIDTH / COLS} ${HEIGHT / ROWS})`}
      >
        {layers.map((layer) => (
          <path
            key={layer.id}
            d={layer.d}
            fill={layer.color}
            fillRule="evenodd"
            opacity={0.78}
          />
        ))}
      </g>
    </g>
  );
}
