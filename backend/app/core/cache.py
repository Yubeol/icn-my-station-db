"""짧은 시간 동안 같은 조회 결과를 재사용하는 메모리 캐시.

WebSocket이 몇 초마다 모든 토픽을 다시 만들기 때문에, 캐시가 없으면 접속자 수만큼 같은 쿼리가 반복된다.
수집 주기(혼잡도 2분, 운항 15분 등)보다 짧게 잡으면 화면이 늦게 갱신되는 일은 없다.
"""

import time
from collections.abc import Callable
from functools import wraps
from typing import Any


def ttl_cache(seconds: float) -> Callable:
    def decorator(func: Callable) -> Callable:
        store: dict[tuple, tuple[float, Any]] = {}

        @wraps(func)
        def wrapper(*args: Any) -> Any:
            now = time.monotonic()
            hit = store.get(args)
            if hit is not None and now - hit[0] < seconds:
                return hit[1]
            value = func(*args)
            store[args] = (now, value)
            return value

        wrapper.cache_clear = store.clear  # type: ignore[attr-defined]
        return wrapper

    return decorator