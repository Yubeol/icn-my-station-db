
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type { LiveTopic } from "../api/client";

import {
  subscribeLive,
  subscribeLiveConnection,
} from "../api/websocket";

// ==========================================
// ICN My Station
// 공통 REST + WebSocket Hook
// ==========================================

const DEFAULT_INTERVAL_MS = 60_000;

// ==========================================
// 옵션 타입
// ==========================================

export interface LiveOptions<T> {
  // null이면 WebSocket 없이 REST만 사용
  topic: LiveTopic | null;

  // REST 조회 함수
  fetcher: (signal: AbortSignal) => Promise<T>;

  // WebSocket 메시지 범위
  scope?: string | null;

  // 터미널, 출발/도착 등 조회 조건
  resourceKey?: string | number;

  // 자동 갱신 간격 (기본 60초)
  // 0이면 자동 갱신 중지
  intervalMs?: number;

  // Hook 활성화 여부
  enabled?: boolean;

  // WebSocket 데이터를 직접 반영할 때 사용
  parseMessage?: (value: unknown) => T | undefined;
}

// ==========================================
// 반환 타입
// ==========================================

export interface LiveResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  connected: boolean;
  updatedAt: Date | null;
  refresh: () => Promise<void>;
}

// ==========================================
// scope 비교
// ==========================================

function matchesScope(
  messageScope: string | null,
  widgetScope: string | null
): boolean {
  // 위젯이 scope를 지정하지 않으면
  // 해당 topic의 모든 메시지를 수신
  if (widgetScope === null) {
    return true;
  }

  // 서버의 공통 메시지
  if (messageScope === null) {
    return true;
  }

  return (
    messageScope.trim().toUpperCase() ===
    widgetScope.trim().toUpperCase()
  );
}

// ==========================================
// 공통 Hook
// ==========================================

export function useLiveUpdates<T>({
  topic,
  fetcher,
  scope = null,
  resourceKey,
  intervalMs = DEFAULT_INTERVAL_MS,
  enabled = true,
  parseMessage,
}: LiveOptions<T>): LiveResult<T> {
  // ========================================
  // 상태
  // ========================================

  const [data, setData] = useState<T | null>(null);

  const [loading, setLoading] = useState(enabled);

  const [error, setError] = useState<string | null>(
    null
  );

  const [connected, setConnected] = useState(false);

  const [updatedAt, setUpdatedAt] =
    useState<Date | null>(null);

  // ========================================
  // 최신 함수 참조
  // ========================================

  const fetcherRef = useRef(fetcher);

  const parserRef = useRef(parseMessage);

  fetcherRef.current = fetcher;
  parserRef.current = parseMessage;

  // 현재 활성화된 조회 함수
  const refreshRef = useRef<() => Promise<void>>(
    async () => {}
  );

  // ========================================
  // 외부에서 호출하는 새로고침
  // ========================================

  const refresh = useCallback(async () => {
    await refreshRef.current();
  }, []);

  // ========================================
  // 최초 조회 + WebSocket + 자동 갱신
  // ========================================

  useEffect(() => {
    if (!enabled) {
      refreshRef.current = async () => {};

      setConnected(false);
      setLoading(false);

      return;
    }

    let active = true;

    let controller: AbortController | null = null;

    let requestVersion = 0;

    let hasData = false;

    let connectedOnce = false;

    // --------------------------------------
    // 새로운 조회 조건 적용
    // --------------------------------------

    setData(null);
    setError(null);
    setLoading(true);
    setUpdatedAt(null);
    setConnected(false);

    // --------------------------------------
    // REST API 요청
    // --------------------------------------

    const fetchCurrent = async (): Promise<void> => {
      if (!active) return;

      // 이전 요청 취소
      controller?.abort();

      const currentController =
        new AbortController();

      controller = currentController;

      const currentVersion = ++requestVersion;

      // 최초 조회에만 로딩 화면 표시
      if (!hasData) {
        setLoading(true);
      }

      try {
        const result = await fetcherRef.current(
          currentController.signal
        );

        if (
          !active ||
          currentController.signal.aborted ||
          currentVersion !== requestVersion
        ) {
          return;
        }

        hasData = true;

        setData(result);
        setError(null);
        setLoading(false);
        setUpdatedAt(new Date());

        console.info(
          `[ICN REST] ${topic ?? "facilities"} 갱신 성공`
        );
      } catch (err) {
        if (
          !active ||
          currentController.signal.aborted ||
          currentVersion !== requestVersion
        ) {
          return;
        }

        const message =
          err instanceof Error
            ? err.message
            : "데이터 조회 중 오류가 발생했습니다.";

        setError(message);
        setLoading(false);

        console.error(
          `[ICN REST] ${topic ?? "facilities"} 오류`,
          err
        );
      }
    };

    // 외부 refresh() 연결
    refreshRef.current = fetchCurrent;

    // --------------------------------------
    // 1. REST 최초 조회
    // --------------------------------------

    void fetchCurrent();

    // --------------------------------------
    // 2. WebSocket 연결 상태
    // --------------------------------------

    // topic이 null이면 구독하지 않음
    const unsubscribeConnection = topic
      ? subscribeLiveConnection((isConnected) => {
          if (!active) return;

          setConnected(isConnected);

          if (isConnected) {
            if (connectedOnce) {
              // 재연결 시 데이터 동기화
              void fetchCurrent();
            }

            connectedOnce = true;
          }
        })
      : () => {};

    // --------------------------------------
    // 3. WebSocket 메시지 수신
    // --------------------------------------

    const unsubscribeMessage = topic
      ? subscribeLive((message) => {
          if (!active) return;

          if (message.topic !== topic) {
            return;
          }

          if (!matchesScope(message.scope, scope)) {
            return;
          }

          console.info(
            `[ICN WS] ${topic} 메시지 수신`,
            message.scope
          );

          // WebSocket data 직접 반영
          const parser = parserRef.current;

          if (parser) {
            try {
              const parsed = parser(message.data);

              if (parsed !== undefined) {
                // 이전 REST 응답이 최신 데이터를
                // 덮어쓰지 않도록 취소
                controller?.abort();
                ++requestVersion;

                hasData = true;

                setData(parsed);
                setError(null);
                setLoading(false);
                setUpdatedAt(new Date());

                return;
              }
            } catch (err) {
              console.warn(
                "[ICN WS] 데이터 변환 실패",
                err
              );
            }
          }

          // 직접 변환하지 않으면 REST 재조회
          void fetchCurrent();
        })
      : () => {};

    // --------------------------------------
    // 4. 60초 자동 갱신
    // --------------------------------------

    const timer =
      intervalMs > 0
        ? window.setInterval(() => {
            if (!active) return;

            // 보이지 않는 탭은 갱신하지 않음
            if (
              document.visibilityState !== "visible"
            ) {
              return;
            }

            console.info(
              `[ICN AUTO] ${topic ?? "facilities"} 자동 갱신`
            );

            void fetchCurrent();
          }, intervalMs)
        : null;

    // --------------------------------------
    // 5. 브라우저 탭 복귀 시 갱신
    // --------------------------------------

    const handleVisibility = () => {
      if (!active) return;

      if (
        document.visibilityState === "visible"
      ) {
        console.info(
          `[ICN AUTO] ${topic ?? "facilities"} 탭 복귀 갱신`
        );

        void fetchCurrent();
      }
    };

    document.addEventListener(
      "visibilitychange",
      handleVisibility
    );

    // --------------------------------------
    // 6. 컴포넌트 정리
    // --------------------------------------

    return () => {
      active = false;

      refreshRef.current = async () => {};

      ++requestVersion;

      controller?.abort();

      unsubscribeMessage();
      unsubscribeConnection();

      if (timer !== null) {
        window.clearInterval(timer);
      }

      document.removeEventListener(
        "visibilitychange",
        handleVisibility
      );
    };

    // resourceKey 변경 시 새 데이터 조회
  }, [
    topic,
    scope,
    resourceKey,
    intervalMs,
    enabled,
  ]);

  // ========================================
  // 반환
  // ========================================

  return {
    data,
    loading,
    error,
    connected,
    updatedAt,
    refresh,
  };
}
