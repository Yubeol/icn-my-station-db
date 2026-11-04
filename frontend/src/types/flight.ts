
export type Terminal = "T1" | "T2";

export type FlightType = "DEPARTURE" | "ARRIVAL";

// 백엔드에서 전달하는 운항 상태 코드
export type FlightStatusType = string;

// 백엔드 Flight 응답 구조
export interface Flight {
  flightNo: string;
  airline: string;
  type: FlightType;

  city: string;
  airportCode: string;

  scheduledAt: string;
  estimatedAt: string | null;

  terminal: string;
  gate: string | null;

  status: FlightStatusType;
  delayMinutes: number;
  isMyFlight: boolean;
}

// 메인페이지에서 전달하는 값
export interface FlightStatusProps {
  terminal: Terminal;
}
