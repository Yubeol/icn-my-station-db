/** 메인 화면의 내 항공편 카드가 쓰는 편명 저장소입니다. 저장소를 쓸 수 없는 환경에서도 화면은 그대로 동작합니다. */
const STORAGE_KEY = 'icn.myFlightNo';
const CHANGE_EVENT = 'icn:saved-flight';

export function readSavedFlight(): string | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value && value.trim() ? value.trim().toUpperCase() : null;
  } catch {
    return null;
  }
}

export function saveFlight(flightNo: string) {
  try {
    if (window.localStorage.getItem(STORAGE_KEY) === flightNo) return;
    window.localStorage.setItem(STORAGE_KEY, flightNo);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // 저장하지 못해도 조회 화면에는 영향을 주지 않습니다.
  }
}

export function clearSavedFlight() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 지우지 못한 경우에도 카드는 화면에서 닫습니다.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeSavedFlight(listener: () => void) {
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener('storage', listener);
  };
}
