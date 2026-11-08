import type { Hall } from '../../../api/congestion';

export type HallLike = { waitingCount: number; operationStatus?: string | null };

/** 운영 확인이 필요하거나 대기 인원이 0명(측정 확인 중)이면 인원·혼잡 단계를 보여주지 않습니다. */
export function isHallChecking(hall: HallLike) {
  return hall.operationStatus === 'CHECK_REQUIRED' || hall.waitingCount === 0;
}

/** 메인 화면의 Hall은 currentCount를 쓰므로 같은 기준으로 맞춰 줍니다. */
export function isMainHallChecking(hall: Hall) {
  return isHallChecking({ waitingCount: hall.currentCount ?? 0, operationStatus: hall.operationStatus });
}
