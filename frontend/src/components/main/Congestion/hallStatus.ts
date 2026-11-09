import type { Hall } from '../../../api/congestion';

export type HallLike = { waitingCount: number; operationStatus?: string | null };

/**
 * 인원 대신 보여주는 문구. 백엔드 operationStatus CHECK_REQUIRED는 '최근 24시간 측정은 충분한데 대기 인원이 매우 적다'는 뜻이라
 * 데이터가 없는 것도, 미운영 확정도 아닙니다. 그래서 '미운영 가능'으로 표시하고 설명은 HALL_CHECK_HINT로 보여줍니다.
 */
export const HALL_CHECK_LABEL = '미운영 가능';
export const HALL_CHECK_HINT = '측정은 되고 있지만 대기 인원이 거의 없어 운영하지 않을 수 있습니다. 미운영으로 확정된 것은 아닙니다.';

/** 운영 확인이 필요하거나 대기 인원이 0명(측정 확인 중)이면 인원·혼잡 단계를 보여주지 않습니다. */
export function isHallChecking(hall: HallLike) {
  return hall.operationStatus === 'CHECK_REQUIRED' || hall.waitingCount === 0;
}

/** 메인 화면의 Hall은 currentCount를 쓰므로 같은 기준으로 맞춰 줍니다. */
export function isMainHallChecking(hall: Hall) {
  return isHallChecking({ waitingCount: hall.currentCount ?? 0, operationStatus: hall.operationStatus });
}
