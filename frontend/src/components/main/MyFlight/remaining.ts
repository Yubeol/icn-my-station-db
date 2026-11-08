/** 시각이 지난 뒤에는 운항 상태로 안내합니다. */
const PASSED_LABEL: Record<string, string> = {
  BOARDING: '탑승 중',
  BOARDING_SOON: '탑승 준비',
  DEPARTED: '출발 완료',
  ARRIVED: '도착 완료',
  CANCELLED: '결항',
  DIVERTED: '회항',
};

/** 시각과 관계없이 상태를 먼저 보여 줄 항공편 상태입니다. */
const FINAL_STATUSES = new Set(['DEPARTED', 'ARRIVED', 'CANCELLED', 'DIVERTED']);

/**
 * 출발·도착까지 남은 시간을 "1시간 20분" 형식으로 만듭니다.
 * 완료·결항·회항은 상태를, 시각이 지나면 상태 문구나 "시각 확인 필요"를 돌려줍니다.
 */
export function flightLeftText(status: string, target: string, now: number) {
  if (FINAL_STATUSES.has(status)) return PASSED_LABEL[status];
  const minutes = Math.round((Date.parse(target) - now) / 60_000);
  if (!Number.isFinite(minutes) || minutes <= 0) return PASSED_LABEL[status] ?? '시각 확인 필요';
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}시간 ${minutes % 60}분` : `${minutes}분`;
}
