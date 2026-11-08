import type { Flight } from './client';

/**
 * 지연 기준(분). 백엔드 rules.DELAY_THRESHOLD_MINUTES(backend/app/core/rules.py)와 같은 값이어야 합니다.
 * API로 내려오지 않으므로 프런트 상수로 둡니다. 백엔드 기준이 바뀌면 함께 바꿔 주세요.
 */
export const DELAY_THRESHOLD_MINUTES = 15;

/**
 * 지연 편 판정. 백엔드 운항통계(stats.py의 _category)와 같은 기준입니다.
 * 결항·회항은 지연으로 세지 않고, 상태가 DELAYED이거나 지연 기준 이상 늦은 편이 지연입니다.
 * 이미 출발한 편도 기준 이상 늦었으면 지연으로 셉니다.
 */
export function isDelayedFlight(flight: Pick<Flight, 'status' | 'delayMinutes'>) {
  if (flight.status === 'CANCELLED' || flight.status === 'DIVERTED') return false;
  return flight.status === 'DELAYED' || flight.delayMinutes >= DELAY_THRESHOLD_MINUTES;
}

/** 운항 여건 점수 계산 근거 안내 문구. 백엔드 operation_score는 풍속·돌풍만 반영합니다(강수·시정 미반영). */
export const OPERATION_SCORE_BASIS = '풍속·돌풍 기준';
