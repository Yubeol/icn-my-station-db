
import type { Terminal } from "../../../api/congestion";

export interface HallPosition {
  number: string;
  x: number;
  y: number;
}

// 0~100% 기준 상대 좌표
// 실제 지도상의 위치 확인 후 보정해야 합니다.
export const HALL_POSITIONS: Record<
  Terminal,
  HallPosition[]
> = {
  T1: [
    { number: "1", x: 23, y: 70 },
    { number: "2", x: 34, y: 66 },
    { number: "3", x: 45, y: 64 },
    { number: "4", x: 56, y: 64 },
    { number: "5", x: 67, y: 66 },
    { number: "6", x: 78, y: 70 },
  ],
  T2: [
    { number: "1", x: 38, y: 55 },
    { number: "2", x: 62, y: 55 },
  ],
};

// "1번 출국장", "H1", "1" 등의 형태를 대응
export function getHallNumber(
  id: string,
  name: string
): string | null {
  const nameMatch = name.match(/(\d+)\s*번?\s*출국장/);
  if (nameMatch) return nameMatch[1];

  const idMatch = id.match(/^(?:H|HALL)?0*(\d+)$/i);
  return idMatch?.[1] ?? null;
}
